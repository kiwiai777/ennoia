# CT-0039-01: Tunnel Protocol & Daemon Design Research

**Stage 25 Part 2 — Research Document**
**Date**: 2026-05-14

---

## 1. Context

### Stage 25 Part 1 Status

CT-0038-01 delivered a working end-to-end validation:
- `cortex mcp --http --port 3100` runs locally via `StreamableHTTPServerTransport`
- nginx + Let's Encrypt on `mcp.kiwiai.cloud` (49.232.124.7)
- SSH reverse tunnel (`ssh -R 3100:localhost:3100 kiwiai.cloud -N`) bridges cloud to local
- Verified: `curl https://mcp.kiwiai.cloud/health` → 200, `tools/list` and `tools/call` working

### Part 2 Goals

Design the production architecture for the cloud relay:
- Q1: Which tunnel protocol to use (replacing the manual SSH tunnel)
- Q2: How the cortex daemon should be designed (cross-platform background service)

### This Document's Scope

Q1 and Q2 only. Q3 (auth), Q4 (multi-tenant routing), Q5 (cloud relay service), Q6 (synthesis) are deferred to CT-0039-02.

---

## 2. Q1: Reverse Tunnel Protocol Selection

### 2.1 Candidate Evaluation

#### Candidate A: Cloudflare Tunnel (cloudflared)

**How it works**: The `cloudflared` daemon runs on the user's machine and opens outbound connections to Cloudflare's edge over HTTP/2 (QUIC optional). Cloudflare terminates inbound HTTPS and forwards requests down the tunnel. No inbound firewall ports required.

**DNS compatibility with Tencent Cloud DNS**

Named tunnels (persistent, production-grade) work with any DNS provider via Partial Setup:
- Add one CNAME record at Tencent Cloud DNS: `mcp.kiwiai.cloud → <tunnel-uuid>.cfargotunnel.com`
- DNS migration to Cloudflare is NOT required
- The CNAME is created once; the named tunnel persists across restarts

Quick tunnels (`cloudflared tunnel --url`) generate random `*.trycloudflare.com` URLs — not usable for a stable `mcp.kiwiai.cloud` endpoint.

**Third-party API control**

Full API support. `POST /accounts/{id}/cfd_tunnel` creates a named tunnel and returns a token. Cortex can:
1. Prompt user for a Cloudflare API token (with `Tunnel Write` + `DNS Write` permissions) during `cortex setup`
2. Call the API to create a named tunnel, store the tunnel token locally
3. Spawn `cloudflared tunnel run --token <token>` as a subprocess

**cloudflared installation**

`cloudflared` is a single Go binary (~30 MB). It cannot be embedded as a library. Options:
- User installs manually (`brew install cloudflared`, `apt install cloudflared`)
- Cortex auto-downloads the correct binary at setup time from Cloudflare's GitHub releases

Auto-download is feasible but adds a download step and binary management complexity.

**Protocol support**
- WebSocket: Supported
- SSE (Server-Sent Events): Works, but Cloudflare's HTTP proxy may buffer responses. MCP's SSE transport requires `Cache-Control: no-cache`. Warrants testing — community reports indicate it works but with occasional buffering on free tier.
- HTTP/2: Used internally between `cloudflared` and Cloudflare edge; client-facing is standard HTTPS

**Free tier limits**
- Up to 1,000 named tunnels per account
- No hard bandwidth cap published for tunnel traffic
- 100 MB max request body (hard limit, free and pro)
- No per-request pricing
- ToS restricts large-scale video streaming; MCP JSON-RPC traffic is well within acceptable use

**Firewall penetration**: Excellent. Outbound connections only (port 443 or 7844). Works behind NAT and corporate firewalls.

---

#### Candidate B: Tailscale Funnel

**How it works**: Exposes a local port to the public internet via Tailscale's relay. URL is always `<machine-name>.<tailnet-name>.ts.net`.

**Custom domain support**: Not supported and not planned. GitHub issue #11563 requesting custom domain support is open with no maintainer response. The official docs state: "Funnel can only use DNS names in your tailnet's domain."

**Verdict**: Hard blocker. Cannot serve traffic at `mcp.kiwiai.cloud`. Eliminated.

---

#### Candidate C: Self-built WebSocket Reverse Tunnel

**Architecture**:
```
ChatGPT/Claude.ai
      │ HTTPS
      ▼
mcp.kiwiai.cloud relay server
  - accepts inbound MCP HTTP requests
  - holds persistent WebSocket connections from cortex clients
  - forwards requests down the WS tunnel, streams responses back
      │ WebSocket (outbound from client, port 443)
      ▼
cortex tunnel client (developer's machine)
  - connects to relay WS on startup
  - receives forwarded requests
  - proxies to localhost:3100
  - streams SSE responses back through WS
```

Reference implementations: `wsp` (Go, HTTP-over-WebSocket), `rathole` (Rust, production-grade reconnection).

**Engineering effort**:
- Server side: WS server, HTTP endpoint, request routing by user token, dead connection detection
- Client side: WS client, reconnect loop with exponential backoff, request/response correlation (multiplexing), SSE streaming through WS
- SSE handling is the hard part: must stream SSE body back through WS without buffering
- Realistic estimate: 2–4 weeks for production quality (reconnection, multiplexing, auth, SSE streaming)

**Advantages**: Zero user-side dependencies (client embedded in cortex npm package), full control over protocol, no external service dependency, correct architecture for multi-user scale.

**Firewall penetration**: Excellent. Outbound WS on port 443.

---

#### Candidate D: Self-built gRPC Bidirectional Stream

**Architecture difference from WebSocket**: Cortex client opens a long-lived gRPC bidirectional stream to the relay. HTTP/2 natively multiplexes concurrent MCP requests via stream IDs — no manual multiplexing needed.

**Engineering effort**: Similar to WebSocket but protocol layer is handled by gRPC. Probably 1–2 weeks less custom code. Uses `@grpc/grpc-js` on Node.js client (~5 MB npm dependency).

**Advantages for MCP**: Each MCP request maps to a gRPC stream — cleaner for concurrent tool calls than WebSocket.

**Disadvantages**: gRPC requires HTTP/2, which some corporate proxies block (gRPC-Web over HTTP/1.1 exists as fallback but adds complexity). Adds 5 MB to npm package.

---

### 2.2 Comparison Table

| Dimension | Cloudflare Tunnel | Tailscale Funnel | Self-built WS | Self-built gRPC |
|---|---|---|---|---|
| Custom domain (`mcp.kiwiai.cloud`) | Yes (one CNAME) | **No — hard blocker** | Yes | Yes |
| Latency | Low (Cloudflare PoPs) | Low | Depends on VM location | Depends on VM location |
| Reliability | Cloudflare SLA | Tailscale SLA | Self-managed | Self-managed |
| Firewall penetration | Excellent | Excellent | Excellent | Good (HTTP/2 occasionally blocked) |
| Implementation complexity | Medium | N/A | High (2–4 weeks) | Medium-high (2–3 weeks) |
| User install burden | cloudflared binary | tailscale daemon | None | None |
| Third-party API control | Full API | Limited | Full control | Full control |
| SSE support | Works (needs testing) | Works | Full control | Full control |
| Ecosystem maturity | Production-grade | Production-grade | Reference impls available | Production-grade |
| Operational burden | Cloudflare manages | Tailscale manages | Self-managed | Self-managed |
| Time to working prototype | 1–2 days | N/A | 2–4 weeks | 2–3 weeks |
| Multi-tenant routing | Via Cloudflare Access | N/A | Custom implementation | Custom implementation |

---

### 2.3 Recommendation

**Phase 1 (now): Cloudflare Tunnel**

Cloudflare Tunnel is the correct choice for the current stage. Rationale:

1. **Speed**: Working prototype in 1–2 days vs 2–4 weeks for self-built
2. **Reliability**: Cloudflare's global infrastructure handles reconnection, TLS, and PoP routing
3. **DNS**: One CNAME at Tencent Cloud DNS — no migration required
4. **Firewall**: Outbound-only, works everywhere
5. **Free tier**: Sufficient for single-user and early multi-user validation

The `cloudflared` binary dependency is the main friction point. Mitigate by auto-downloading the correct binary at `cortex setup` time from Cloudflare's versioned GitHub releases.

**Phase 2 (when user volume justifies it): Self-built WebSocket tunnel**

When Cortex grows to many users, owning the relay infrastructure becomes the right call:
- Zero user-side dependencies (client embedded in npm package)
- Full control over routing, auth, and protocol
- No external service dependency or ToS constraints
- The relay runs on the existing `mcp.kiwiai.cloud` VM

The migration path is clean: the daemon interface (`cortex daemon start/stop/status`) stays the same; only the underlying tunnel implementation changes.

---

### 2.4 Rejected Alternatives

**Tailscale Funnel**: Hard blocker — cannot serve traffic at `mcp.kiwiai.cloud`. Custom domain support is not planned by Tailscale.

**Self-built gRPC**: Adds 5 MB npm dependency, HTTP/2 blocked by some corporate proxies, no meaningful advantage over WebSocket for the MCP use case. WebSocket is simpler and more universally supported.

**Raw SSH tunnel (current)**: Manual, no auto-reconnect, requires SSH key management, not embeddable in a daemon without significant wrapper complexity.

---

### 2.5 Hybrid Approach Assessment

The recommended Phase 1 approach IS a hybrid: cortex wraps the UX (`cortex daemon install`, `cortex daemon start`), while the underlying tunnel is `cloudflared`. The user never interacts with `cloudflared` directly — they only see cortex commands.

This is the right pattern. It decouples the user-facing interface from the tunnel implementation, making the Phase 2 migration to self-built WebSocket transparent to users.

---

## 3. Q2: Cortex Daemon Design

### 3.1 CLI Interface

All daemon operations go through `cortex daemon <subcommand>`. The user never interacts with systemd, launchd, or cloudflared directly.

```
cortex daemon install    Install as system service (systemd/launchd/Windows Service)
cortex daemon uninstall  Remove system service
cortex daemon start      Start the daemon
cortex daemon stop       Stop the daemon
cortex daemon restart    Restart the daemon
cortex daemon status     Show connection status and tunnel URL
cortex daemon logs       View daemon output (tail -f style)
```

**`cortex daemon status` output example**:
```
cortex daemon status

  Status:    connected
  Tunnel:    https://mcp.kiwiai.cloud/mcp
  Uptime:    2h 14m
  Requests:  47 served (last 24h)
  MCP:       localhost:3100 (healthy)
```

**`cortex daemon install` flow**:
1. Detect platform (Linux/macOS/Windows)
2. Check if `cloudflared` binary is present; if not, download correct version
3. Write service definition file (systemd unit / launchd plist / Windows Service)
4. Enable service (systemctl enable / launchctl load / sc config start=auto)
5. Print confirmation and next steps

---

### 3.2 Daemon State Machine

```
         install
            │
            ▼
        ┌─────────┐
        │ stopped │ ◄──────────────────────────────────┐
        └─────────┘                                     │
            │ start                                      │ stop
            ▼                                           │
        ┌──────────┐                                    │
        │ starting │                                    │
        └──────────┘                                    │
            │                                           │
     ┌──────┴──────┐                                   │
     │ MCP server  │ fail                               │
     │ starts on   ├──────────────────► ┌───────┐      │
     │ :3100       │                    │ error │      │
     └──────┬──────┘                    └───────┘      │
            │ success                       │           │
            ▼                          retry limit      │
     ┌──────────────┐                  exceeded         │
     │ tunnel       │ fail                  │           │
     │ connecting   ├──────────────────►    │           │
     └──────┬───────┘                       │           │
            │ success                       │           │
            ▼                               │           │
     ┌───────────┐                          │           │
     │ connected │ ◄────────────────────────┘           │
     └───────────┘                                      │
            │ connection lost                           │
            ▼                                           │
     ┌──────────────┐                                   │
     │ reconnecting │ ──── max retries exceeded ────────┘
     └──────────────┘
            │ success
            └──────────► connected
```

**States**:
- `stopped`: Service installed but not running
- `starting`: MCP server and tunnel initializing
- `connected`: Tunnel active, MCP requests being served
- `reconnecting`: Connection lost, attempting reconnect with exponential backoff (1s, 2s, 4s, 8s... max 60s)
- `error`: Unrecoverable error (bad config, auth failure, max retries exceeded) — requires user intervention

**State persistence**: Written to `~/.cortex/daemon-state.json` so `cortex daemon status` can read it without querying the running process.

**Reconnection policy**:
- Transient failures (network blip): reconnect immediately, up to 10 retries with exponential backoff
- Auth failures: transition to `error`, do not retry (would just fail again)
- MCP server crash: restart MCP server subprocess, then reconnect tunnel

---

### 3.3 Cross-Platform Implementation Strategy

#### Linux: systemd user service

```ini
# ~/.config/systemd/user/cortex.service
[Unit]
Description=Cortex MCP Daemon
After=network.target

[Service]
ExecStart=/path/to/node /path/to/cortex/dist/daemon/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

- `loginctl enable-linger <user>` required for service to survive logout
- `systemctl --user enable cortex` for auto-start on boot
- Logs via `journalctl --user -u cortex`

#### macOS: launchd plist

```xml
<!-- ~/Library/LaunchAgents/cloud.kiwiai.cortex.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ...>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>cloud.kiwiai.cortex</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/node</string>
    <string>/path/to/cortex/dist/daemon/index.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>~/.cortex/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>~/.cortex/daemon.log</string>
</dict>
</plist>
```

- `launchctl load ~/Library/LaunchAgents/cloud.kiwiai.cortex.plist` to install
- `launchctl unload` to remove
- Runs as user agent (not root), survives login/logout

#### Windows: Windows Service via node-windows

`node-windows` npm package wraps a Node.js script as a Windows Service. Alternative: use a `.bat` file with `sc create` pointing to `node.exe`. The `node-windows` approach is cleaner for npm-distributed tools.

```typescript
// cortex daemon install (Windows path)
import { Service } from 'node-windows';
const svc = new Service({
  name: 'Cortex MCP Daemon',
  script: path.join(__dirname, 'daemon/index.js'),
});
svc.install();
```

#### Abstraction Layer

A single `PlatformService` interface hides the platform differences:

```typescript
interface PlatformService {
  install(): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  getLogs(lines: number): Promise<string>;
}

// Implementations:
class SystemdService implements PlatformService { ... }
class LaunchdService implements PlatformService { ... }
class WindowsService implements PlatformService { ... }

function createPlatformService(): PlatformService {
  if (process.platform === 'linux') return new SystemdService();
  if (process.platform === 'darwin') return new LaunchdService();
  if (process.platform === 'win32') return new WindowsService();
  throw new Error(`Unsupported platform: ${process.platform}`);
}
```

`cortex daemon install` calls `createPlatformService().install()` — the user sees the same command on all platforms.

---

### 3.4 Integration with Q1 Selection (Cloudflare Tunnel)

The daemon manages two subprocesses:

1. **MCP HTTP server**: `node dist/mcp-server/index.js --http --port 3100`
2. **cloudflared tunnel**: `cloudflared tunnel run --token <token>`

**Startup sequence**:
1. Start MCP server subprocess, wait for `/health` to return 200
2. Start `cloudflared` subprocess with stored tunnel token
3. Monitor both processes; restart either on crash
4. Write `connected` state to `~/.cortex/daemon-state.json`

**Configuration storage**: `~/.cortex/config.json` (existing file) gains a `daemon` section:
```json
{
  "daemon": {
    "cloudflare": {
      "tunnel_token": "<encrypted or plaintext token>",
      "tunnel_url": "https://mcp.kiwiai.cloud/mcp"
    }
  }
}
```

**Token security**: The tunnel token grants access to the Cloudflare tunnel (not the user's Cloudflare account). It should be stored with file permissions `600`. Full encryption is a Phase 2 concern.

**cloudflared binary management**:
- Stored at `~/.cortex/bin/cloudflared`
- Downloaded during `cortex daemon install` if not present
- Version pinned in cortex config; `cortex daemon install --update` refreshes it

**Phase 2 migration path (self-built WebSocket)**:
When migrating from Cloudflare Tunnel to self-built WebSocket, only the subprocess management changes:
- Replace `cloudflared tunnel run --token <token>` with `node dist/tunnel-client/index.js --relay wss://mcp.kiwiai.cloud/tunnel --token <auth-token>`
- The `PlatformService` abstraction, state machine, and CLI interface remain identical
- Users run the same `cortex daemon` commands

---

## 4. References

- [Cloudflare Tunnel FAQ — DNS requirements](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/)
- [Cloudflare Tunnel API — create tunnel programmatically](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)
- [Cloudflare One account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/)
- [Tailscale Funnel docs](https://tailscale.com/kb/1223/tailscale-funnel)
- [Tailscale Funnel custom domain issue #11563](https://github.com/tailscale/tailscale/issues/11563)
- [wsp — HTTP tunnel over WebSocket (reference implementation)](https://github.com/root-gg/wsp)
- [rathole — Rust reverse proxy for NAT traversal](https://github.com/rathole-org/rathole)
- [awesome-tunneling — comprehensive list of alternatives](https://github.com/anderspitman/awesome-tunneling)
- [MCP Streamable HTTP Transport spec](https://spec.modelcontextprotocol.io/specification/basic/transports/)
