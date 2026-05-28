# CT-0039-02: Identity, Tenancy, Cloud Architecture & Privacy Research

**Stage 25 Part 2 — Research Document**
**Date**: 2026-05-15

---

## 1. Context

### CT-0039-01 Summary

CT-0039-01 (2026-05-14) answered Q1 and Q2:

- **Q1 (Tunnel Protocol)**: Cloudflare Tunnel selected for Phase 1. Self-built WebSocket reserved for Phase 2. Tailscale Funnel eliminated (no custom domain). cloudflared binary managed as subprocess, auto-downloaded at setup time.
- **Q2 (Daemon Design)**: `cortex daemon <subcommand>` CLI abstraction over systemd/launchd/Windows Service. State machine: stopped → starting → connected → reconnecting → error. Two subprocesses managed: MCP HTTP server + cloudflared tunnel.

### This Document's Scope

Q3 (identity & authentication), Q4 (multi-tenant isolation), Q5 (cloud service architecture), Q6 (security & privacy), and Cloudflare UX integration (UX-1 through UX-5). Synthesis of all findings into a unified architecture and Stage 26 roadmap.

---

## 2. Constraints (D1–D13)

| ID | Decision | Source |
|----|----------|--------|
| D1 | Cloud acts as relay/broker; user_model stays local | Stage 25 Part 2 launch |
| D2 | Cloud stores NO user_model data | Stage 25 Part 2 launch |
| D3 | Multi-tenant: User A cannot access User B's tunnel | Stage 25 Part 2 launch |
| D4 | Local-first: cortex CLI works without cloud relay | Stage 25 Part 2 launch |
| D5 | Research-only output, English documentation only | Stage 25 Part 2 launch |
| D6 | Tunnel: Cloudflare Tunnel Phase 1, self-built WS Phase 2 | CT-0039-01 |
| D7 | URL: `*.cfargotunnel.com`, no custom domain in v1 | CT-0039-01 |
| D8 | User provides own Cloudflare token | CT-0039-01 |
| D9 | Tech stack: TypeScript/Node.js | CT-0039-01 |
| D10 | Cloud = identity + metadata center, NOT in MCP data path | This session |
| D11 | Auth: GitHub OAuth + device flow, no self-built accounts | This session |
| D12 | MCP client auth: URL = bearer token (128-bit random) | This session |
| D13 | Single token: daemon_token only, no separate access token | This session |

---

## 3. Q3: Identity & Authentication

### 3.1 GitHub OAuth Device Flow

#### Why Device Flow

Cortex daemon runs on headless machines (servers, CI runners, remote dev boxes). Traditional OAuth redirect flows require a browser on the same machine. Device flow is purpose-built for this scenario: the CLI displays a code, the user authorizes on any device with a browser.

#### Flow Sequence

```
cortex daemon login
        │
        ▼
POST https://github.com/login/device/code
  client_id = <CORTEX_OAUTH_APP_ID>
  scope = "read:user user:email"
        │
        ▼
Response:
  device_code      = <long-random-string>
  user_code        = "ABCD-1234"     (8 chars, human-readable)
  verification_uri = "https://github.com/login/device"
  expires_in       = 900             (15 minutes)
  interval         = 5               (poll every 5 seconds)
        │
        ▼
Display to user:
  "To authenticate, visit:"
  "  https://github.com/login/device"
  "  Enter code: ABCD-1234"
  "  (expires in 15 minutes)"
        │
        ▼
Poll (every 5 seconds):
POST https://github.com/github.com/login/oauth/access_token
  client_id     = <CORTEX_OAUTH_APP_ID>
  device_code   = <device_code>
  grant_type    = "urn:ietf:params:oauth:grant-type:device_code"
        │
        ├── pending ──► keep polling
        ├── slow_down ──► increase interval by 5 seconds
        ├── expired_token ──► error, restart flow
        │
        ▼ success
Response:
  access_token  = <github-token>
  token_type    = "bearer"
  scope         = "read:user,user:email"
        │
        ▼
GET https://api.github.com/user
  Authorization: Bearer <github-token>
        │
        ▼
Extract: github_id, username, email
Store locally, exchange for daemon_token with cortex cloud
```

#### GitHub OAuth App Configuration

A Cortex GitHub OAuth App must be created (by Owner) at github.com/settings/developers:

- **Application name**: Cortex
- **Homepage URL**: https://github.com/kiwiai777/cortex (or future site)
- **Authorization callback URL**: Not used for device flow, but GitHub requires it. Set to `http://localhost` (placeholder).
- **Scopes requested**: `read:user` (user ID, username), `user:email` (email for account recovery)

The `client_id` is public and embedded in the CLI. No `client_secret` needed for device flow — GitHub treats device flow as a public client.

#### Implementation Approach

**No external OAuth library required.** The device flow is three HTTP requests:

1. `POST /login/device/code` — get device code
2. `POST /login/oauth/access_token` — poll for token
3. `GET /api/github/user` — fetch user profile

All three use Node.js built-in `fetch` (Node 18+) or `undici`. No `simple-oauth2` or other dependency needed.

#### Rate Limits

- Device code requests: subject to GitHub's general rate limits (5,000 requests/hour authenticated, 60/hour unauthenticated — but the app is authenticated via client_id)
- Token polling: `slow_down` response tells client to increase interval automatically
- Device code expires in 15 minutes; user must re-initiate if expired

---

### 3.2 Daemon Token Design

#### Token Type: Opaque Random Token

**Recommendation**: Use opaque random tokens (not JWT).

Rationale:
- **No token verification needed across services**: The daemon_token is only verified by the cortex cloud API (single verifier). JWT's self-contained claims add no value.
- **Simpler revocation**: Opaque tokens are revoked by deleting from database. JWT revocation requires a blocklist.
- **No secret key management**: JWT signing keys must be rotated; opaque tokens just need `crypto.randomBytes()`.
- **Shorter**: 32 bytes hex = 64 chars vs JWT (typically 200+ chars).

#### Generation

```typescript
import { randomBytes } from 'crypto';

function generateDaemonToken(): string {
  return randomBytes(32).toString('hex'); // 64-char hex string, 256-bit entropy
}
```

The token is generated by cortex cloud during registration and returned to the daemon once over HTTPS.

#### Storage

**On daemon machine**: `~/.cortex/credentials.json`

```json
{
  "daemon_token": "<64-char-hex>",
  "user_id": "github_<github_user_id>",
  "tunnel_name": "cortex-<random-22-chars>",
  "cloud_api_base": "https://cloud.cortex.dev"
}
```

File permissions: `600` (owner read/write only).

**On cortex cloud**: Store SHA-256 hash of token (like password hashing). Never store plaintext.

```typescript
import { createHash } from 'crypto';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

#### Transmission

- HTTPS only. Cloud API enforces TLS.
- Token sent as `Authorization: Bearer <token>` header.
- Never logged. Never included in error messages or debug output.
- The `~/.cortex/credentials.json` file is excluded from git via `.gitignore`.

#### Rotation: `cortex daemon rotate-token`

```
POST /api/daemon/rotate
Authorization: Bearer <old-token>
        │
        ▼
Response: { "daemon_token": "<new-64-char-hex>" }
        │
        ▼
Update ~/.cortex/credentials.json with new token
```

Old token is invalidated immediately on the server side. If rotation fails mid-way, the daemon retains the old token until next successful rotation. The daemon retries on next heartbeat.

#### Revocation

- Via `cortex daemon revoke` CLI command (explicit deauthorization)
- Via cortex cloud dashboard (future): user can see registered daemons and revoke individually
- Via API: `DELETE /api/daemon` removes token hash from database

---

### 3.3 User ID Mapping

#### Strategy

Use GitHub user ID (numeric, immutable) as the primary identifier. Prefix with `github_` to allow future providers.

```typescript
type CortexUserId = `github_${number}`;
// Example: "github_12345678"
```

#### Handling GitHub Username Changes

GitHub user ID never changes. Username can change. The mapping:

| Stored Field | Source | Mutable |
|---|---|---|
| `user_id` | GitHub user ID (numeric) | No — primary key |
| `github_username` | GitHub login | Yes — display only |
| `email` | GitHub primary email | Yes — for recovery |

On each login, update `github_username` and `email` from the latest GitHub API response. No action needed for username changes beyond updating the display name.

#### Handling GitHub Account Deletion

GitHub deauthorizes the OAuth app when an account is deleted. The daemon_token will fail on next heartbeat (cloud returns 401). The daemon transitions to `error` state and prompts re-login.

If the user explicitly wants to delete their Cortex account:

1. `cortex daemon stop && cortex daemon uninstall`
2. `DELETE /api/account` on cortex cloud
3. Cloud deletes: user metadata, all daemon records, token hashes
4. Cloud calls Cloudflare API to delete the user's tunnel (if applicable)

---

### 3.4 Cortex Cloud Registration Flow (End-to-End)

```
cortex daemon login
        │
        ▼
[Device Flow] ──► GitHub access_token ──► user profile (github_id, username, email)
        │
        ▼
POST /api/auth/register
  github_access_token: <token>
  github_id: <id>
  username: <username>
  email: <email>
        │
        ▼
Cloud verifies GitHub token (GET /api/github/user), ensures github_id matches
        │
        ▼
Cloud creates/fetches user record → returns daemon_token
        │
        ▼
Daemon stores ~/.cortex/credentials.json
```

The `github_access_token` is used once for verification and discarded. Only the daemon_token is stored long-term.

---

## 4. Q4: Multi-Tenant Isolation

### 4.1 Data Model

```
users
  id              TEXT PRIMARY KEY    -- "github_12345678"
  github_id       INTEGER NOT NULL
  github_username TEXT NOT NULL
  email           TEXT
  created_at      TEXT NOT NULL       -- ISO 8601

daemons
  id              TEXT PRIMARY KEY    -- UUID
  user_id         TEXT NOT NULL       -- FK → users.id
  tunnel_name     TEXT NOT NULL       -- "cortex-<random>"
  token_hash      TEXT NOT NULL       -- SHA-256 of daemon_token
  created_at      TEXT NOT NULL
  last_heartbeat  TEXT
  status          TEXT DEFAULT 'active'  -- active | inactive | revoked

UNIQUE(tunnel_name)
INDEX(user_id)
```

### 4.2 Isolation Strategy

#### Application-Layer Filtering (Recommended for v1)

All queries include `WHERE user_id = ?`. This is the simplest approach and sufficient for the scale and threat model of v1.

```typescript
// Every daemon API handler extracts user_id from verified token
async function getDaemon(userId: string, daemonId: string) {
  return db.select().from(daemons)
    .where(and(eq(daemons.id, daemonId), eq(daemons.user_id, userId)));
}
```

**Why not Row-Level Security (RLS)**: RLS is a Postgres feature. In v1, we use SQLite, which does not support RLS. Even with Postgres, application-layer filtering is clearer, testable, and does not depend on database-specific features.

#### Multi-Device Support

One `user_id` maps to multiple `daemons` rows. The user can run cortex on their laptop, desktop, and server simultaneously. Each daemon gets its own tunnel URL and daemon_token.

```
User A (github_12345678)
  ├── Daemon 1: laptop   → cortex-a1b2c3d4e5f6g7h8i9j0.cfargotunnel.com
  ├── Daemon 2: desktop  → cortex-k9l8m7n6o5p4q3r2s1t0.cfargotunnel.com
  └── Daemon 3: server   → cortex-u9v8w7x6y5z4a3b2c1d0.cfargotunnel.com
```

Each daemon is independently authenticated with its own daemon_token. If one machine is compromised, the user can revoke that specific daemon without affecting others.

#### Isolation Guarantee

- User A's API calls can only access rows where `user_id = User A's ID`
- The daemon_token is verified against `token_hash` AND `user_id` on every request
- There is no admin API or cross-user query in v1
- Tunnel URLs are globally unique random strings (128-bit entropy); guessing another user's URL is computationally infeasible

### 4.3 URL Routing Isolation (Cloudflare Layer)

Per D7, each user gets a unique `cortex-<random>.cfargotunnel.com` URL. Cloudflare routes each tunnel independently. The cortex cloud service is NOT in the MCP data path (D10) — it never sees MCP requests.

Isolation at the Cloudflare layer:
- Each tunnel has its own credentials (tunnel token)
- Cloudflare does not allow cross-tunnel traffic
- Even if a user knows another user's tunnel URL, they cannot redirect their own tunnel to it

---

## 5. Q5: Cloud Service Architecture

### 5.1 Stack Selection

#### Framework: Hono

**Recommendation: Hono** (over Fastify and Express).

| Criteria | Hono | Fastify | Express |
|---|---|---|---|
| Performance | Excellent | Excellent | Good |
| Bundle size | ~14 KB | ~80 KB | ~200 KB |
| TypeScript | Native | Via types | Via @types |
| Edge/runtime support | Native | Node only | Node only |
| Validation | Built-in Zod | JSON Schema | Manual/lib |
| Middleware | Modern chain | Plugin system | Legacy stack |

Rationale:
- **Native TypeScript**: Hono is written in TypeScript, zero `@types` dependencies
- **Lightweight**: 14 KB fits the "Cortex stays lightweight" principle
- **Edge-ready**: If cortex cloud ever migrates to Cloudflare Workers or similar, Hono works natively
- **Type-safe routing**: Routes infer parameter types automatically
- **Future-proof**: Hono runs on Node.js, Bun, Deno, and edge runtimes

For a Node.js long-running server, Fastify is equally viable. The deciding factor is Hono's edge readiness and alignment with the Cloudflare ecosystem.

#### Database: SQLite (v1) → Postgres (scale path)

**v1: SQLite via better-sqlite3**

- Single-file database, zero operational overhead
- Runs embedded in the cloud service process
- Sufficient for hundreds of users (cortex cloud stores only metadata)
- Drizzle ORM provides a migration path: schema defined in TypeScript, same code works with both SQLite and Postgres drivers

**Scale path: Postgres via neon or self-hosted**

- When user count justifies it, switch Drizzle driver from `better-sqlite3` to `@neondatabase/serverless` or `pg`
- Schema stays identical; only connection config changes
- Trigger: concurrent write contention or multi-server deployment

#### ORM: Drizzle

**Recommendation: Drizzle** (over Prisma and raw SQL).

| Criteria | Drizzle | Prisma | Raw SQL |
|---|---|---|---|
| Type safety | Full, no codegen | Via generate step | Manual |
| Bundle size | Zero deps | Heavy runtime | None |
| SQL closeness | Near-identical | Abstracted | Native |
| SQLite + Postgres | Same schema | Different providers | Different dialects |
| Migrations | Drizzle Kit (diff-based) | Prisma Migrate | Manual |

Key advantage for cortex: Drizzle defines schema once in TypeScript. Switching from SQLite to Postgres requires changing the driver import, not the schema. This directly supports the SQLite → Postgres migration path.

### 5.2 API Design

#### Authentication Middleware

All `/api/daemon/*` endpoints require `Authorization: Bearer <daemon_token>`. The middleware:

```typescript
// Pseudocode
async function authMiddleware(c: Context, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const tokenHash = sha256(token);
  const daemon = await db.select().from(daemons)
    .where(eq(daemons.token_hash, tokenHash)).get();

  if (!daemon) return c.json({ error: 'invalid token' }, 401);
  if (daemon.status === 'revoked') return c.json({ error: 'token revoked' }, 401);

  c.set('userId', daemon.user_id);
  c.set('daemonId', daemon.id);
  await next();
}
```

#### Endpoints

**Auth**

```
POST /api/auth/register
  Body: { github_access_token, github_id, username, email }
  Response: { user_id, daemon_token, tunnel_name }
  Notes: Verifies GitHub token, creates user if new, generates daemon_token
         Returns tunnel_name for Cloudflare tunnel creation
```

**Daemon Management** (all require `Authorization: Bearer <daemon_token>`)

```
POST /api/daemon/heartbeat
  Body: { status: "connected" | "reconnecting" | "error", version: string }
  Response: { ok: true }
  Notes: Updates last_heartbeat timestamp. Should be called every 60 seconds.

GET /api/daemon/config
  Response: { tunnel_name, cloud_api_base, heartbeat_interval }
  Notes: Returns configuration for daemon startup.

POST /api/daemon/rotate
  Response: { daemon_token: "<new-token>" }
  Notes: Invalidates old token, returns new one.

DELETE /api/daemon
  Response: { ok: true }
  Notes: Revokes this daemon. Tunnel cleanup is user's responsibility.

GET /api/daemon/status
  Response: { daemon_id, tunnel_name, created_at, last_heartbeat, status }
  Notes: Returns this daemon's metadata.
```

**Account** (requires `Authorization: Bearer <daemon_token>`)

```
GET /api/account/daemons
  Response: { daemons: [{ daemon_id, tunnel_name, status, last_heartbeat }] }
  Notes: Lists all daemons for the authenticated user.

DELETE /api/account
  Response: { ok: true }
  Notes: Deletes all user data, revokes all daemon tokens.
         Does NOT delete Cloudflare tunnels (user must do manually or via --purge flag).
```

**Health**

```
GET /health
  Response: { status: "ok", version: string }
  Notes: Unauthenticated. For load balancer / monitoring.
```

### 5.3 Deployment

#### Target Server: 49.232.124.7

The cloud service runs on the same server as Owner's `mcp.kiwiai.cloud` nginx config. They coexist via nginx routing:

```
# nginx configuration
server {
    server_name cloud.cortex.dev;           # cortex cloud API
    location / {
        proxy_pass http://127.0.0.1:3200;   # Hono cloud service
    }
}

server {
    server_name mcp.kiwiai.cloud;           # Owner's MCP tunnel (unchanged)
    location / {
        proxy_pass http://127.0.0.1:3100;
    }
}
```

The cortex cloud API and MCP tunnel are completely separate processes on different ports. The cloud API port (3200) is not exposed via tunnel — it is only accessible through nginx.

#### Process Management: systemd

```ini
# /etc/systemd/system/cortex-cloud.service
[Unit]
Description=Cortex Cloud API
After=network.target

[Service]
Type=simple
User=cortex
WorkingDirectory=/opt/cortex-cloud
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3200
Environment=DATABASE_PATH=/opt/cortex-cloud/data/cortex.db

[Install]
WantedBy=multi-user.target
```

Why systemd over PM2:
- Already available on the server (Ubuntu)
- Automatic restart on crash
- Log management via `journalctl`
- One fewer dependency

#### TLS: Let's Encrypt via certbot

Same pattern as existing `mcp.kiwiai.cloud` setup:
```bash
certbot --nginx -d cloud.cortex.dev
```

#### Domain: `cloud.cortex.dev`

A subdomain of `cortex.dev` (to be registered). Pointed to `49.232.124.7` via A record. DNS at Tencent Cloud DNS or Cloudflare.

Alternatively, `api.cortex.kiwiai.cloud` if the Owner prefers using the existing `kiwiai.cloud` domain.

### 5.4 Monitoring

#### Daemon Heartbeat Tracking

Each daemon sends `POST /api/daemon/heartbeat` every 60 seconds. The cloud service tracks `last_heartbeat`. A daemon with no heartbeat for 5 minutes is marked `inactive` in the database.

A background job (runs every 60 seconds via `setInterval`):
```typescript
// Mark daemons as inactive if no heartbeat for 5 minutes
const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
await db.update(daemons)
  .set({ status: 'inactive' })
  .where(and(
    eq(daemons.status, 'active'),
    lt(daemons.last_heartbeat, staleThreshold.toISOString())
  ));
```

#### Metrics (v1: minimal)

- `GET /health` endpoint returns: `{ status, version, uptime, active_daemons }`
- Structured logs via `pino` (JSON format): `{"level":"info","msg":"heartbeat","daemon_id":"...","user_id":"..."}`
- Log aggregation: optional; start with `journalctl` + grep

#### Alerting (v1: basic)

- Process crash: systemd `OnFailure` action sends notification
- Disk full: standard OS monitoring
- No external alerting service in v1

### 5.5 Scale Path (Design Only)

```
v1 (current):
  Single server (49.232.124.7)
  SQLite file
  systemd process
  ~100 users max

v1.5:
  Same server
  Postgres (via Docker or managed)
  nginx rate limiting
  ~1,000 users

v2:
  Multiple servers behind load balancer
  Managed Postgres (RDS/neon)
  Redis for session/cache
  Horizontal scaling of stateless API servers
  ~10,000+ users
```

The design is intentionally stateless (no in-memory sessions). All state is in the database. This means horizontal scaling is straightforward: add more API servers behind a load balancer.

---

## 6. Q6: Security & Privacy

### 6.1 Architecture: Physical Isolation

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   MCP DATA PATH (cortex cloud is NOT here)                         │
│                                                                     │
│   AI Client ──HTTPS──► Cloudflare Edge ──Tunnel──► User's Machine  │
│   (ChatGPT)              (PoP)                       (cortex MCP)  │
│                                                                     │
│   Data: MCP JSON-RPC requests/responses, tool calls, user_model    │
│   Cloud sees: NOTHING in this path                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   CONTROL PATH (cortex cloud IS here)                               │
│                                                                     │
│   User's Machine ──HTTPS──► Cloudflare Edge ──► Cortex Cloud API   │
│   (cortex daemon)              (nginx)            (49.232.124.7)    │
│                                                                     │
│   Data: heartbeat, registration, config metadata                   │
│   Cloud sees: ONLY metadata, NEVER user_model or MCP content       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The two paths are physically separate. The cortex cloud API has no endpoint that accepts MCP traffic. The MCP tunnel goes directly from Cloudflare to the user's local machine. The cortex cloud process does not listen on any port accessible from the MCP tunnel.

### 6.2 What Cortex Cloud Stores (Exhaustive List)

| Field | Source | Purpose |
|---|---|---|
| `user_id` | GitHub OAuth (e.g., `github_12345678`) | Primary key, tenant isolation |
| `github_id` | GitHub API (numeric) | Immutable identity |
| `github_username` | GitHub API | Display only, updated on login |
| `email` | GitHub OAuth (`user:email` scope) | Account recovery, notifications |
| `daemon_id` | Generated (UUID) | Daemon identification |
| `tunnel_name` | Generated (e.g., `cortex-a1b2c3...`) | Cloudflare tunnel identifier |
| `token_hash` | SHA-256 of daemon_token | Authentication verification |
| `created_at` | Timestamp | Audit trail |
| `last_heartbeat` | Daemon heartbeat | Status monitoring |
| `status` | Enum: active/inactive/revoked | Lifecycle management |
| `daemon_version` | Daemon self-reported | Version tracking |

### 6.3 What Cortex Cloud Does NOT Store (Exhaustive List)

| Category | Items |
|---|---|
| User model data | `user_model.json` content, goals, preferences, constraints, context entries |
| MCP traffic | JSON-RPC request bodies, JSON-RPC response bodies, tool call arguments, tool call results |
| User content | Any text the user has written or imported (reflect, suggest, import) |
| Agent interactions | Prompts sent to agents, agent responses, conversation history |
| System data | Local file paths, local configuration details, adapter-specific data |

This is not a policy — it is a structural guarantee. The cortex cloud codebase has no data model, API endpoint, or log statement that can capture any of the above. Privacy by architecture, not by policy.

### 6.4 URL = Bearer Token Risk Statement

#### Risk

The MCP tunnel URL (`cortex-<random>.cfargotunnel.com`) serves as both the network address and the access credential. Anyone who knows the URL can send MCP requests to the user's local cortex instance.

This is equivalent to how many services use "magic links" for authentication. The risk is accepted based on the following analysis:

#### Impact Assessment

If the URL is leaked, an attacker could:
- Call MCP tools (list tools, read user model, inject context)
- Modify the user model (add/remove goals, preferences, constraints)

The user_model is personal productivity data (goals, preferences, notes) — not financial, medical, or legally sensitive data. The impact of exposure is low.

#### Mitigations

1. **`cortex daemon rotate`**: Generates a new tunnel URL, invalidating the old one instantly
2. **128-bit entropy**: The random portion of the URL is 22 base64 characters (132 bits). Brute-force guessing is computationally infeasible
3. **HTTPS-only**: Cloudflare terminates TLS. The URL is not visible in plaintext on the network
4. **No indexing**: Tunnel URLs are not published or indexed. They exist only in the user's daemon config and AI client configuration

#### Documentation Requirement

This risk model must be documented in the Cortex privacy policy (to be drafted by legal). Users must be informed:
- The tunnel URL is a secret — treat it like a password
- Rotate the URL if it may have been exposed
- The URL grants access to your user model but not your system (the MCP server is sandboxed)

### 6.5 Account Deletion

#### Immediate Deletion Flow

```
cortex account delete
        │
        ▼
Confirm: "This will permanently delete your Cortex account and all data."
        │
        ▼
DELETE /api/account
  Authorization: Bearer <daemon_token>
        │
        ▼
Cloud actions:
  1. Delete all rows in `daemons` WHERE user_id = ?
  2. Delete row in `users` WHERE id = ?
  3. (Optional) Call Cloudflare API to delete tunnels
        │
        ▼
Local actions:
  1. Stop daemon: cortex daemon stop
  2. Remove credentials: rm ~/.cortex/credentials.json
  3. Remove daemon config from ~/.cortex/config.json
```

#### What Gets Deleted

| Location | What | When |
|---|---|---|
| Cortex cloud DB | All user metadata, daemon records, token hashes | Immediately |
| User's machine | `~/.cortex/credentials.json` | Immediately |
| Cloudflare | Tunnel resource | Immediately (via API) or user manual |
| Cortex cloud logs | Heartbeat logs containing user_id | Log rotation (retention: 30 days) |

#### What Does NOT Get Deleted

| Location | What | Why |
|---|---|---|
| User's machine | `~/.cortex/user_model.json` | User's local data, not cloud-managed |
| User's machine | `~/.cortex/config.json` (non-daemon sections) | Local configuration |
| GitHub | OAuth app authorization | User must revoke at github.com/settings/applications |

---

## 7. Cloudflare UX Integration

### 7.1 UX-1: `cortex daemon setup` Complete Flow

**Target**: 4 steps, under 2 minutes for a user who already has a Cloudflare account.

#### CLI Interaction Template

```
$ cortex daemon setup

  Cortex Daemon Setup
  ────────────────────

  Step 1/4: Cloudflare Account
  ─────────────────────────────
  A Cloudflare account is required to create a tunnel.
  If you don't have one, sign up at https://dash.cloudflare.com/sign-up

  Do you have a Cloudflare account? [Y/n]: Y

  Step 2/4: Create API Token
  ───────────────────────────
  Create a Cloudflare API token with the minimum required permissions:

    1. Go to: https://dash.cloudflare.com/profile/api-tokens
    2. Click "Create Token"
    3. Use template: "Edit Cloudflare Tunnels" (or custom — see below)
    4. Click "Continue to summary" → "Create Token"
    5. Copy the generated token

  Minimum permissions (custom token):
    Permissions:
      Account — Cloudflare Tunnel — Edit
    Account Resources:
      Include — All accounts (or specific account)

  Paste your Cloudflare API token: ****-****-****-****-****-****-***

  ✓ Token validated (account: user@example.com)

  Step 3/4: Authenticate Cortex
  ──────────────────────────────
  Opening browser for GitHub login...
  Alternatively, visit:

    https://github.com/login/device

  Enter code: ABCD-1234

  Waiting for authorization...
  ✓ Authenticated as @username

  Step 4/4: Create Tunnel
  ───────────────────────
  Creating Cloudflare tunnel...
  ✓ Tunnel created: cortex-a1b2c3d4e5f6g7h8i9j0

  Your MCP endpoint is ready:

    https://cortex-a1b2c3d4e5f6g7h8i9j0.cfargotunnel.com/mcp

  Add this URL to your AI client's MCP server configuration.

  Setup complete! Run `cortex daemon start` to begin serving.
```

#### Step Details

**Step 1**: Simple yes/no check. If "no", display signup URL and exit with instructions to re-run after signup.

**Step 2**: Token input with validation. Validation = call `GET /accounts` with the token to verify it has the required permissions. If validation fails, display specific error (invalid token, missing permissions) and re-prompt.

**Step 3**: GitHub device flow (as designed in Q3). The code is displayed and polling begins. The daemon registers with cortex cloud and receives its daemon_token.

**Step 4**: Call Cloudflare API to create a named tunnel. Store the tunnel token locally. The tunnel URL is the MCP endpoint the user configures in their AI client.

### 7.2 UX-2: Cloudflare API Token Minimum Permissions

#### Required Permissions

| Permission Type | Resource | Permission | Required |
|---|---|---|---|
| Account | Cloudflare Tunnel | Edit | Yes |
| Account | Account Settings | Read | Yes (implicit, needed by API) |
| Zone | DNS | Edit | **No** (using `*.cfargotunnel.com`, no custom DNS) |

#### Step-by-Step Token Creation Guide

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **My Profile** → **API Tokens**
3. Click **Create Token**
4. Two options:
   - **Quick option**: Scroll to "Cloudflare Tunnel" section, use the **"Edit Cloudflare Tunnels"** template. This pre-selects the correct permissions.
   - **Custom option**: Click **"Create Custom Token"**:
     - Token name: `Cortex Daemon`
     - Permissions → Account → **Cloudflare Tunnel** → **Edit**
     - Account Resources → Include → **All accounts** (or specific)
     - (No zone permissions needed)
5. Click **Continue to summary** → **Create Token**
6. Copy the token immediately (shown only once)

#### Why No Zone Permissions

Using `*.cfargotunnel.com` means Cloudflare manages the DNS automatically. No CNAME records needed at the user's DNS provider. This simplifies setup and reduces permissions.

### 7.3 UX-3: Tunnel Naming Convention

#### Format

```
cortex-<base64url(16-random-bytes)>
```

Example: `cortex-a1b2c3d4e5f6g7h8i9j0kl`

The random suffix is 22 base64url characters = 132 bits of entropy. This exceeds the 128-bit threshold (D12).

#### Implementation

```typescript
import { randomBytes } from 'crypto';

function generateTunnelName(): string {
  const bytes = randomBytes(16);
  const suffix = bytes.toString('base64url'); // 22 chars
  return `cortex-${suffix}`;
}
```

#### Collision Handling

Cloudflare enforces tunnel name uniqueness within an account. If creation fails with a name conflict (extremely unlikely at 132 bits), regenerate and retry up to 3 times. If still failing, error with a message to contact support.

#### Privacy

The tunnel name contains no user identity. It is a random string that cannot be reverse-engineered to identify the user. This is by design.

### 7.4 UX-4: Existing cloudflared Detection

#### Detection Logic

```
cortex daemon setup (or daemon install)
        │
        ▼
Check: which cloudflared
        │
        ├── Not found ──► Download latest stable from GitHub releases
        │                  Platform: linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64
        │                  Save to: ~/.cortex/bin/cloudflared
        │                  chmod +x (Unix)
        │
        └── Found ──► cloudflared --version
                       │
                       ├── Version within 1 year of latest ──► Use existing
                       │
                       └── Version older than 1 year ──► Prompt:
                           "Your cloudflared (v2024.3.0) is over 1 year old.
                            Cloudflare may not support it.
                            [D]ownload latest / [U]se existing / [A]bort"
```

#### Version Check

```typescript
import { execSync } from 'child_process';

function getCloudflaredVersion(binPath: string): string {
  const output = execSync(`${binPath} --version`).toString();
  // Output format: "cloudflared version 2025.4.0"
  const match = output.match(/cloudflared version (\S+)/);
  return match ? match[1] : 'unknown';
}

function isVersionSupported(version: string): boolean {
  // Cloudflare supports versions within 1 year of latest
  const versionDate = parseCloudflaredVersion(version); // e.g., 2025.4.0 → 2025-04-01
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return versionDate > oneYearAgo;
}
```

#### Binary Location Priority

1. `~/.cortex/bin/cloudflared` (cortex-managed, preferred)
2. `cloudflared` in PATH (user-installed, fallback)

If found in PATH but cortex-managed binary also exists, prefer cortex-managed for version consistency.

### 7.5 UX-5: Setup Failure Recovery

#### Error Handling Matrix

| Step | Failure | Error Message | Recovery |
|---|---|---|---|
| 1 | No Cloudflare account | "No Cloudflare account detected. Sign up at https://dash.cloudflare.com/sign-up and re-run setup." | Re-run `cortex daemon setup` |
| 2 | Invalid token | "API token is invalid. Check that you copied the full token and it has Cloudflare Tunnel Edit permission." | Re-prompt for token (same step) |
| 2 | Missing permissions | "Token lacks Cloudflare Tunnel Edit permission. Create a new token at https://dash.cloudflare.com/profile/api-tokens" | Re-prompt for token (same step) |
| 2 | Network error | "Cannot reach Cloudflare API. Check your internet connection and try again." | Re-prompt for token (same step) |
| 3 | Device code expired | "GitHub authorization code expired (15 min limit). Restarting login..." | Re-start step 3 |
| 3 | User denied | "GitHub authorization was denied. Re-run setup to try again." | Exit, re-run setup |
| 4 | Tunnel name collision | "Tunnel name conflict (extremely rare). Retrying..." | Auto-retry up to 3 times |
| 4 | Cloudflare API error | "Failed to create tunnel: <error>. Check Cloudflare status and try again." | Exit, re-run setup |
| 4 | Token store failure | "Tunnel created but failed to save config. Run `cortex daemon setup --reset` and re-run." | Manual reset |

#### Resumable Setup

The setup process writes progress to `~/.cortex/setup-state.json`:

```json
{
  "step": 3,
  "cloudflare_token_validated": true,
  "github_authenticated": false,
  "tunnel_created": false
}
```

If setup is interrupted (Ctrl+C, crash), re-running `cortex daemon setup` reads the state file and resumes from the last incomplete step. Validated data (Cloudflare token) is not re-prompted.

#### `cortex daemon setup --reset`

Clears all setup state and stored daemon configuration:

```bash
$ cortex daemon setup --reset

  This will remove:
    - Daemon configuration
    - Stored credentials
    - Setup progress

  Continue? [y/N]: y
  ✓ Reset complete. Run `cortex daemon setup` to start fresh.
```

---

## 8. Synthesis

### 8.1 Architecture Diagram

```
                        ┌──────────────────┐
                        │   AI Client      │
                        │ (ChatGPT/Claude) │
                        └────────┬─────────┘
                                 │ HTTPS
                                 ▼
                    ┌────────────────────────────┐
                    │     Cloudflare Network      │
                    │  (Global PoPs, TLS, CDN)    │
                    │                             │
                    │  cortex-xyz.cfargotunnel.com│
                    │         │                   │
                    └─────────┼───────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               │               ▼
    ┌─────────────────┐       │      ┌─────────────────┐
    │  User A's       │       │      │  User B's       │
    │  Local Machine  │       │      │  Local Machine  │
    │                 │       │      │                 │
    │  ┌───────────┐  │       │      │  ┌───────────┐  │
    │  │ cortex    │  │       │      │  │ cortex    │  │
    │  │ MCP       │  │       │      │  │ MCP       │  │
    │  │ server    │  │       │      │  │ server    │  │
    │  │ :3100     │  │       │      │  │ :3100     │  │
    │  └─────┬─────┘  │       │      │  └─────┬─────┘  │
    │        │         │       │      │        │         │
    │  ┌─────┴─────┐  │       │      │  ┌─────┴─────┐  │
    │  │ cloudflared│  │       │      │  │ cloudflared│  │
    │  │ (tunnel   │◄─┼───────┘      │  │ (tunnel   │◄─┼── NOT connected
    │  │  client)  │  │              │  │  client)  │  │    to User A
    │  └───────────┘  │              │  └───────────┘  │
    └─────────────────┘              └─────────────────┘

    ┌─────────────────────────────────────────────────────┐
    │              Cortex Cloud (49.232.124.7)             │
    │              cloud.cortex.dev                        │
    │                                                     │
    │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
    │  │ Hono API │  │ SQLite DB│  │ Heartbeat Monitor│  │
    │  │ :3200    │  │ (file)   │  │ (background)     │  │
    │  └────┬─────┘  └──────────┘  └──────────────────┘  │
    │       │                                              │
    │       │  REST API only (metadata, heartbeat, auth)  │
    │       │  NEVER in MCP data path                      │
    └───────┼──────────────────────────────────────────────┘
            │
            ▼
    ┌─────────────────┐
    │  GitHub OAuth   │
    │  (identity)     │
    └─────────────────┘
```

Key insight: The MCP data path (AI client → Cloudflare → user local) never touches cortex cloud. The cloud is purely a control plane for identity and metadata.

### 8.2 Key Interaction Flows

#### Flow 1: First-Time Setup

```
User                Cortex CLI              Cortex Cloud         Cloudflare         GitHub
 │                      │                        │                    │                │
 │  cortex daemon setup │                        │                    │                │
 │─────────────────────►│                        │                    │                │
 │                      │ Check cloudflared      │                    │                │
 │  [Step 1: Account]   │                        │                    │                │
 │◄─────────────────────│                        │                    │                │
 │  [Step 2: CF Token]  │                        │                    │                │
 │◄─────────────────────│                        │                    │                │
 │                      │──Validate token───────►│                    │                │
 │                      │◄──Token valid─────────│                    │                │
 │  [Step 3: GitHub]    │                        │                    │                │
 │◄─────────────────────│                        │                    │                │
 │                      │──POST /login/device/code────────────────────────────────────►│
 │                      │◄──user_code: ABCD-1234──────────────────────────────────────│
 │  "Visit github.com/  │                        │                    │                │
 │   login/device,      │                        │                    │                │
 │   code: ABCD-1234"   │                        │                    │                │
 │◄─────────────────────│                        │                    │                │
 │                      │──Poll access_token─────────────────────────────────────────►│
 │  [User authorizes]   │                        │                    │                │
 │─────────────────────────────────────────────────────────────────GitHub──────────►│
 │                      │◄──access_token─────────────────────────────────────────────│
 │                      │──POST /api/auth/register─────────────────►  │                │
 │                      │  (github_token, user info)                │  │                │
 │                      │◄──daemon_token, tunnel_name──────────────│  │                │
 │  [Step 4: Create]    │                        │                    │                │
 │◄─────────────────────│                        │                    │                │
 │                      │──POST /accounts/{id}/cfd_tunnel───────────────────────────►│
 │                      │◄──tunnel_token─────────────────────────────────────────────│
 │                      │                        │                    │                │
 │  "Your MCP endpoint: │                        │                    │                │
 │   cortex-xyz.cfar... │                        │                    │                │
 │   /mcp"              │                        │                    │                │
 │◄─────────────────────│                        │                    │                │
```

#### Flow 2: Daemon Start

```
cortex daemon start
        │
        ▼
Read ~/.cortex/credentials.json (daemon_token, tunnel_name)
        │
        ▼
Start MCP server subprocess (localhost:3100)
        │
        ├── Health check: GET http://localhost:3100/health
        │   ├── OK → continue
        │   └── Fail → retry 3×, then error state
        │
        ▼
Start cloudflared subprocess (cloudflared tunnel run --token <token>)
        │
        ▼
POST /api/daemon/heartbeat (status: "connected")
        │
        ▼
Periodic heartbeat (every 60 seconds)
        │
        ▼
Daemon is in "connected" state
```

#### Flow 3: AI Client Query

```
ChatGPT user types a message
        │
        ▼
ChatGPT sends MCP tools/call request
        │
        ▼
HTTPS request to cortex-xyz.cfargotunnel.com/mcp
        │
        ▼
Cloudflare edge receives request
        │
        ▼
Routes through tunnel to user's cloudflared process
        │
        ▼
cloudflared forwards to localhost:3100
        │
        ▼
Cortex MCP server processes request (reads user_model, returns tools/call result)
        │
        ▼
Response flows back: MCP server → cloudflared → Cloudflare → ChatGPT
```

Note: Cortex cloud is never involved in Flow 3.

### 8.3 Stage 26 Implementation Roadmap

#### Task Breakdown (Priority Order)

**Phase A: Cloud Service Foundation (Tasks 1–3)**

| # | Task | Description | Dependencies |
|---|---|---|---|
| 1 | Cloud API skeleton | Hono + SQLite + Drizzle setup. Health endpoint. Deploy to 49.232.124.7 with systemd + nginx. | None |
| 2 | Auth endpoints | GitHub device flow integration. `/api/auth/register`. daemon_token generation and storage. | Task 1 |
| 3 | Daemon CRUD endpoints | `/api/daemon/heartbeat`, `/config`, `/rotate`, `DELETE`. Auth middleware with token hash verification. | Task 2 |

**Phase B: Daemon Client (Tasks 4–6)**

| # | Task | Description | Dependencies |
|---|---|---|---|
| 4 | `cortex daemon login` | GitHub device flow in CLI. Store credentials.json. | Task 2 |
| 5 | `cortex daemon setup` | 4-step setup flow (UX-1). cloudflared detection, download, tunnel creation. | Tasks 3, 4 |
| 6 | `cortex daemon start/stop/status` | Daemon lifecycle with state machine. cloudflared subprocess management. Heartbeat to cloud. | Task 5 |

**Phase C: System Integration (Tasks 7–8)**

| # | Task | Description | Dependencies |
|---|---|---|---|
| 7 | `cortex daemon install/uninstall` | Platform services (systemd, launchd). Cross-platform testing. | Task 6 |
| 8 | Integration test suite | End-to-end test: login → setup → start → MCP request → stop. Test against real cloud service. | Tasks 6, 7 |

**Phase D: Polish (Tasks 9–10)**

| # | Task | Description | Dependencies |
|---|---|---|---|
| 9 | Error handling & recovery | Implement UX-5 error matrix. Resumable setup. `--reset` flag. | Task 5 |
| 10 | Documentation & FINALIZE | Update CLAUDE.md, write Stage 26 archive, decision log entries. | All above |

#### Estimated Timeline

- Phase A: 3–4 days
- Phase B: 4–5 days
- Phase C: 2–3 days
- Phase D: 1–2 days
- **Total: ~2 weeks**

#### Dependencies Graph

```
Task 1 ──► Task 2 ──► Task 3 ──┐
                                ├──► Task 5 ──► Task 6 ──► Task 7 ──► Task 8
              Task 4 ──────────┘                  │
                                                   └──► Task 9
                                                          Task 10 ←── All
```

---

## 9. Open Questions

### For Owner Decision Before Stage 26

**OQ-1: Domain for cloud API**
- Option A: `cloud.cortex.dev` (requires registering `cortex.dev` domain)
- Option B: `api.cortex.kiwiai.cloud` (uses existing `kiwiai.cloud` domain)
- Recommendation: Option B for v1 (no new domain registration needed)

**OQ-2: GitHub OAuth App ownership**
- The OAuth App must be created under a GitHub account. Should it be under Owner's personal account or a `kiwiai` organization?
- Recommendation: Organization account for longevity

**OQ-3: Cloudflare account for integration testing**
- A Cloudflare account with a test API token is needed for automated tests. Should we create a dedicated test account or use Owner's account with a scoped token?
- Recommendation: Dedicated test account with one tunnel

**OQ-4: Maximum daemons per user**
- Should there be a limit on how many daemons a user can register?
- Recommendation: 5 daemons per user in v1 (sufficient for laptop + desktop + server + 2 spare)

### v2 Candidates (Not for Stage 26)

- Custom domain support (`*.kiwiai.cloud` instead of `*.cfargotunnel.com`)
- Shared Cloudflare account (cortex manages tunnels for users without their own CF account)
- Self-built WebSocket tunnel (Phase 2, per CT-0039-01 recommendation)
- Cloud dashboard (web UI for daemon management, tunnel status)
- Token encryption at rest on daemon machine
- Audit logging (API access log with timestamps)

---

## 10. References

### OAuth & Authentication
- [GitHub OAuth Device Flow — Official Docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub OAuth App Rate Limits](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/rate-limits-for-oauth-apps)
- [OAuth Device Flow CLI Guide (dev.to)](https://dev.to/ddebajyati/integrate-github-login-with-oauth-device-flow-in-your-js-cli-28fk)
- [oauth_device_flow npm package](https://github.com/flexwie/oauth_device_flow)

### Cloudflare Tunnel
- [Cloudflare Tunnel Permissions](https://developers.cloudflare.com/tunnel/advanced/local-management/tunnel-permissions/)
- [Create Tunnel via API](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)
- [Cloudflare API Token Permissions Reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [cloudflared GitHub Repository](https://github.com/cloudflare/cloudflared)

### Framework & ORM
- [Hono Documentation](https://hono.dev/)
- [Hono vs Fastify vs Express Benchmarks (Medium)](https://medium.com/@sohail_saifii/i-built-the-same-backend-in-hono-fastify-and-express-the-benchmarks-were-shocking-8b23d606e0e4)
- [Hono vs Fastify Guide (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/hono-vs-fastify/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Drizzle vs Prisma Comparison (Encore)](https://encore.dev/articles/drizzle-vs-prisma)
- [Top TypeScript ORM 2025 (Bytebase)](https://www.bytebase.com/blog/top-typescript-orm/)

### Related Cortex Research
- [CT-0039-01: Tunnel Protocol & Daemon Design](./CT-0039-01-tunnel-and-daemon.md)
