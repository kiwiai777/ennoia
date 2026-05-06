# CT-0030-01 MCP Research Report

## Executive Summary

This report provides comprehensive research on enabling cortex to become a queryable user model layer for AI clients via MCP (Model Context Protocol). Key findings:

1. **MCP protocol maturity is high**: Officially maintained by Anthropic, already supported by mainstream AI clients including Claude Desktop, ChatGPT, Cursor, VS Code
2. **Local implementation is simple**: Using official TypeScript SDK, estimated 2-3 days to complete read-only prototype
3. **Cloud deployment requires caution**: Involves complex issues like authentication, encryption, multi-tenant isolation, recommend Stage 23+ implementation
4. **Recommended architecture**: Local authority + cloud read-only replica + pending confirmation queue, aligns with cortex "write only after confirmation" principle

**Key Recommendations**:
- Stage 22 focuses on local MCP server read-only prototype
- Expose 1 core tool: `get_preferences` (returns matching preferences by query)
- Cloud MCP server deferred to Stage 23+, first validate local approach's product value

---

## Question 1: MCP Protocol Specification Summary

### 1.1 Core Concepts

MCP (Model Context Protocol) is an open standard led by Anthropic for connecting AI applications to external systems. The protocol is based on **JSON-RPC 2.0**, using client-server architecture.

**Current version**: `2025-06-18` (protocol version number formatted as date)

**Core participants**:
- **MCP Host**: AI application (e.g., Claude Desktop, ChatGPT, Cursor)
- **MCP Client**: Connection management component inside Host, one client per server
- **MCP Server**: Program providing context data (runs locally or remotely)

**Transport layers**:
- **Stdio transport**: Local inter-process communication, zero network overhead, suitable for local servers
- **Streamable HTTP transport**: HTTP POST + Server-Sent Events, suitable for remote servers, supports OAuth/API key authentication

### 1.2 Three Major Primitives (Server-side)

MCP servers can expose three types of capabilities:

#### 1. Tools
Functions AI can invoke to perform operations.

**Definition format** (JSON Schema):
```json
{
  "name": "get_preferences",
  "description": "Get user preferences matching a query",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query to match preferences"
      },
      "type": {
        "type": "string",
        "enum": ["preference", "goal", "constraint"],
        "description": "Filter by entry type"
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of results",
        "default": 10,
        "maximum": 50
      }
    }
  }
}
```

**Invocation flow**:
1. Host calls `tools/list` to get available tools
2. AI decides to use a tool based on user query
3. Host calls `tools/call` with tool name and arguments
4. Server executes and returns result
5. AI incorporates result into response

#### 2. Resources
Read-only data sources AI can access.

**Use cases**: File contents, database records, API responses

**Not suitable for cortex**: Resources are for static data retrieval, cortex needs query-based filtering (tools are better fit)

#### 3. Prompts
Reusable prompt templates.

**Use cases**: Workflow templates, common task patterns

**Not suitable for cortex**: Cortex provides dynamic user model data, not static templates

### 1.3 Cortex Tool Design: `get_preferences`

**Rationale for single tool**:
- Simplifies initial implementation
- Covers 80% use cases (query user preferences)
- Can expand to multiple tools later (get_goals, get_constraints, search_user_model)

**Input parameters**:
```typescript
interface GetPreferencesInput {
  query?: string;        // Natural language search query
  type?: 'preference' | 'goal' | 'constraint';  // Filter by type
  limit?: number;        // Max results (default 10, max 50)
}
```

**Output format**:
```typescript
interface GetPreferencesOutput {
  preferences: Array<{
    type: 'preference' | 'goal' | 'constraint';
    label: string;
    description: string;
    source: string;
    confidence?: string;
    created_at: string;
  }>;
  total: number;
}
```

**Query logic**:
1. Load `~/.cortex/user_model.json`
2. Filter by type if specified
3. Filter out soft-deleted entries (deleted_at !== null)
4. Apply text search on label + description (case-insensitive)
5. Apply limit
6. Return formatted results

### 1.4 Version Compatibility

**Protocol versioning**: Date-based (e.g., `2025-06-18`)
**SDK compatibility**: Official SDK handles version negotiation automatically
**Breaking changes**: Rare, Anthropic maintains backward compatibility

**Recommendation**: Use official SDK (`@modelcontextprotocol/sdk`) to ensure compatibility

---

## Question 2: Local MCP Server Implementation Approach

### 2.1 Technology Stack

**Recommended stack**:
- **Language**: TypeScript (Node.js runtime)
- **SDK**: `@modelcontextprotocol/sdk` (official Anthropic SDK)
- **Transport**: Stdio (local inter-process communication)
- **Build**: TypeScript compiler (tsc)

**Rationale**:
- Official SDK ensures protocol compliance and long-term maintenance
- TypeScript provides type safety and better IDE support
- Stdio transport has zero network overhead, perfect for local scenarios
- Minimal dependencies, lightweight implementation

### 2.2 Implementation Complexity

**Estimated effort**: 2-3 days

**Day 1**: MCP server framework setup
- Install dependencies: `npm install @modelcontextprotocol/sdk`
- Create `src/mcp-server/index.ts`
- Initialize MCP server with Stdio transport
- Register `tools/list` and `tools/call` handlers
- Basic startup and health check

**Day 2**: `get_preferences` tool implementation
- Load `~/.cortex/user_model.json`
- Implement query/type/limit filtering logic
- Soft-delete filtering (deleted_at !== null)
- Format output as text (not JSON, for better AI consumption)
- Unit tests for query logic

**Day 3**: Claude Desktop integration and end-to-end testing
- Configure Claude Desktop (`claude_desktop_config.json`)
- Test tool invocation in Claude Desktop
- Verify query results match expectations
- Document setup instructions

**Code estimate**: ~200 lines of TypeScript

### 2.3 SDK Reusability

**Official SDK features**:
- Protocol message handling (JSON-RPC 2.0)
- Transport abstraction (Stdio / HTTP)
- Type definitions for all protocol messages
- Error handling and validation
- Version negotiation

**What we need to implement**:
- Tool definition (JSON Schema)
- Tool execution logic (read user_model.json, filter, format)
- Startup and shutdown handling

**Dependency count**: 1 production dependency (`@modelcontextprotocol/sdk`)

### 2.4 Claude Desktop Integration

**Configuration file**: `~/.config/Claude/claude_desktop_config.json` (Linux/macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

**Configuration format**:
```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/absolute/path/to/cortex/dist/mcp-server/index.js"]
    }
  }
}
```

**Startup method**:
- Manual: User runs `node dist/mcp-server/index.js` (for testing)
- Automatic: Claude Desktop spawns process on startup
- Background service: systemd/launchd (future optimization)

**Restart requirement**: Claude Desktop must be fully restarted after config changes

### 2.5 Cortex Codebase Adaptation

**New directory structure**:
```
src/
  mcp-server/
    index.ts          # MCP server entry point
    tools.ts          # Tool definitions and handlers
    query.ts          # Query logic (filter, search, format)
```

**Shared code reuse**:
- `src/core/user-model/storage.ts` - loadUserModel()
- `src/core/user-model/types.ts` - UserModel type definitions

**No refactoring needed**: Existing user model code is already well-structured for reuse

---

## Question 3: Cloud MCP Server Deployment Approach (Design Only, Not Implementation)

### 3.1 Stack Selection

**Recommended stack**:
- **Backend framework**: Fastify (high performance, TypeScript-native)
- **Database**: PostgreSQL (mature, supports Row-Level Security for multi-tenant isolation)
- **Deployment**: Docker + Docker Compose (easy local dev + production deployment)
- **Reverse proxy**: Caddy (automatic HTTPS, simple configuration)
- **Domain**: `mcp.kiwiai.cloud`

**Rationale**:
- Fastify: Faster than Express, better TypeScript support, built-in validation
- PostgreSQL: RLS provides database-level tenant isolation, proven at scale
- Docker: Consistent environment across dev/staging/prod
- Caddy: Automatic Let's Encrypt certificates, simpler than Nginx

### 3.2 Multi-User Isolation

**Three-layer isolation**:

**Layer 1: Application layer**
- Middleware extracts user_id from JWT token
- All queries filtered by user_id
- No cross-user data leakage in application logic

**Layer 2: Database layer (Row-Level Security)**
```sql
CREATE POLICY user_isolation ON user_models
  USING (user_id = current_setting('app.current_user_id')::uuid);
```
- PostgreSQL RLS enforces isolation at database level
- Even if application has bugs, database prevents cross-user access
- Defense in depth

**Layer 3: Network layer**
- HTTPS only (TLS 1.3)
- Rate limiting per user (prevent abuse)
- IP allowlist (optional, for enterprise users)

**User model storage**:
- Database table: `user_models` (user_id, model_data JSONB, updated_at)
- One row per user, JSONB column stores entire user_model.json
- Indexed on user_id for fast lookup

### 3.3 Domain / Certificate / Reverse Proxy

**Domain**: `mcp.kiwiai.cloud`

**DNS setup**:
- A record: `mcp.kiwiai.cloud` → server IP
- CNAME (optional): `api.kiwiai.cloud` → `mcp.kiwiai.cloud`

**Certificate**: Let's Encrypt (automatic renewal via Caddy)

**Reverse proxy** (Caddyfile):
```
mcp.kiwiai.cloud {
    reverse_proxy localhost:3000
    encode gzip
    log {
        output file /var/log/caddy/mcp.log
    }
}
```

**Deployment checklist**:
1. VPS with Docker installed (e.g., DigitalOcean, Linode)
2. Domain DNS configured
3. Caddy + Fastify + PostgreSQL in Docker Compose
4. Automatic HTTPS via Caddy
5. Database backups configured

**Cost estimate**: $15/month
- VPS: $12/month (2GB RAM, 1 vCPU)
- Domain: $12/year (~$1/month)
- Bandwidth: Included in VPS

---

## Question 4: Authentication and Multi-User Isolation

### 4.1 User Identity Scheme

**User registration/login flow**:
1. User signs up with email + password
2. Server generates UUID as user_id
3. Server stores hashed password (bcrypt/argon2)
4. User logs in, receives JWT token
5. JWT token used for all subsequent API calls

**User ID generation**: UUID v4 (random, no collision risk)

**Token format** (JWT):
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1234654290
}
```

### 4.2 OAuth Flow for AI Clients

**Challenge**: AI clients (ChatGPT, Claude.ai) call MCP server on behalf of user

**Solution**: OAuth 2.0 Authorization Code flow

**Flow**:
1. User clicks "Connect cortex" in AI client settings
2. AI client redirects to `mcp.kiwiai.cloud/oauth/authorize`
3. User logs in and grants permission
4. Server redirects back to AI client with authorization code
5. AI client exchanges code for access token
6. AI client uses access token to call MCP server

**MCP protocol support**: Streamable HTTP transport supports custom headers (Authorization: Bearer <token>)

**Alternative (simpler)**: API key authentication
- User generates API key in cortex web dashboard
- User manually configures API key in AI client settings
- Simpler than OAuth, but less secure (no expiration, no refresh)

**Recommendation for Stage 23**: Start with API key, add OAuth later if needed

### 4.3 Cross-User Isolation Techniques

**Database layer isolation** (PostgreSQL RLS):
```sql
-- Enable RLS on user_models table
ALTER TABLE user_models ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see their own data
CREATE POLICY user_isolation ON user_models
  FOR ALL
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- Set current user in session
SET app.current_user_id = '550e8400-e29b-41d4-a716-446655440000';
```

**Application layer isolation**:
```typescript
// Middleware extracts user_id from JWT
app.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.verify(token, SECRET);
  req.user_id = decoded.user_id;
  next();
});

// All queries filtered by user_id
async function getUserModel(user_id: string) {
  return db.query('SELECT * FROM user_models WHERE user_id = $1', [user_id]);
}
```

**Network layer isolation**:
- Rate limiting: 100 requests/minute per user
- IP allowlist (optional): Enterprise users can restrict to specific IPs
- DDoS protection: Cloudflare (optional)

---

## Question 5: Encryption and Sync Design

### 5.1 Local → Cloud Push Encryption

**Two approaches**:

**Approach A: End-to-end encryption (E2EE)**
- User password derives encryption key (PBKDF2/Argon2)
- Encrypt user_model.json before upload
- Cloud stores ciphertext blob
- Cloud cannot read plaintext data
- **Trade-off**: Cloud cannot do semantic search (encrypted data is opaque)

**Approach B: Transport encryption only (HTTPS)**
- Upload plaintext user_model.json over HTTPS
- Cloud stores plaintext in database
- Cloud can do semantic search and analytics
- **Trade-off**: Cloud can read user data (privacy concern)

**Approach C: Hybrid (Recommended)**
- Sensitive fields encrypted (e.g., API keys, passwords in preferences)
- Non-sensitive fields plaintext (e.g., "prefer TypeScript")
- Cloud can search non-sensitive data
- Sensitive data protected
- **Best of both worlds**

**Encryption algorithm**: AES-256-GCM (authenticated encryption)

**Key derivation**: Argon2id (password → encryption key)
```typescript
const key = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,  // 64 MB
  timeCost: 3,
  parallelism: 4
});
```

### 5.2 User Model Storage Format on Cloud

**Hybrid approach schema**:
```typescript
interface CloudUserModel {
  user_id: string;
  plaintext_data: {
    preferences: Array<{
      label: string;
      description: string;
      source: string;
      // ... non-sensitive fields
    }>;
  };
  encrypted_data: string;  // AES-256-GCM ciphertext
  encryption_metadata: {
    algorithm: 'AES-256-GCM';
    key_derivation: 'Argon2id';
    nonce: string;  // Random nonce for GCM
  };
  updated_at: string;
}
```

**Sensitive field detection**:
- Heuristic: Contains "password", "token", "key", "secret"
- User-marked: User can mark specific preferences as sensitive
- Default: All plaintext unless marked sensitive

### 5.3 Key Management

**Option A: User-managed key (zero-knowledge)**
- User password derives encryption key
- Cloud never sees key
- User must remember password (no recovery if forgotten)
- **Most secure, but worst UX**

**Option B: Cloud-managed key (convenience)**
- Cloud generates and stores encryption key
- User doesn't need to remember anything
- Cloud can decrypt data (not zero-knowledge)
- **Best UX, but less secure**

**Option C: Hybrid (Recommended)**
- Non-sensitive data: Cloud-managed (no encryption needed)
- Sensitive data: User-managed key (zero-knowledge)
- **Balance security and UX**

**Recommendation**: Start with Option C (hybrid)

### 5.4 `cortex push` Command Implementation

**Command**: `cortex push [--encrypt]`

**Flow**:
1. Load local `~/.cortex/user_model.json`
2. If `--encrypt`: Prompt for password, derive key, encrypt sensitive fields
3. Upload to `mcp.kiwiai.cloud/api/sync`
4. Server validates JWT token, extracts user_id
5. Server upserts user_model in database
6. Return success/failure

**Conflict resolution**: Last-write-wins (cloud timestamp vs local timestamp)

**Future optimization**: Incremental sync (only upload changed entries)

---

## Question 6: Lessons from Existing MCP Ecosystem

### 6.1 Similar Products Analysis

**Product 1: Mem.ai**
- **What it is**: Personal memory layer, stores notes/conversations/web clips
- **MCP integration**: Yes, exposes `search_memories` tool
- **Architecture**: Cloud-first, mobile + web + MCP
- **Authentication**: OAuth 2.0
- **Pricing**: Freemium ($8/month for unlimited)

**Lessons**:
- MCP is not their primary interface (mobile app is)
- MCP adds value for power users (Claude Desktop, Cursor)
- Authentication must be simple (OAuth, not manual API key)

**Product 2: Rewind**
- **What it is**: Local screen recording + AI search
- **MCP integration**: No (privacy-focused, local-only)
- **Architecture**: Local-first, macOS app
- **Privacy**: All data stays local, no cloud sync

**Lessons**:
- Local-first is a valid product strategy
- Users value privacy (no cloud upload)
- MCP can work purely locally (Stdio transport)

**Product 3: Notion AI**
- **What it is**: Knowledge base + AI assistant
- **MCP integration**: Yes, exposes `search_pages` and `create_page` tools
- **Architecture**: Cloud-first, web + mobile + MCP
- **Authentication**: OAuth 2.0
- **Write tools**: Yes, but with user confirmation UI

**Lessons**:
- Write tools need confirmation (Notion shows preview before creating page)
- MCP is complementary to main product (not replacement)
- Search is most common use case (read > write)

### 6.2 Five Key Lessons

**Lesson 1: Keep authentication simple**
- OAuth 2.0 is standard for cloud MCP servers
- API key is acceptable for MVP (simpler than OAuth)
- Don't invent custom auth schemes

**Lesson 2: Optimize for query performance**
- Most MCP tool calls are searches (not writes)
- Index frequently queried fields (user_id, created_at)
- Cache common queries (e.g., "get all preferences")
- Response time < 500ms is critical (AI waits for tool result)

**Lesson 3: Privacy is a feature**
- Users care about data privacy (especially for personal preferences)
- Local-first is a valid strategy (Rewind proves this)
- If cloud sync, offer E2EE option (even if it limits features)

**Lesson 4: User experience over features**
- Simple setup > complex features
- One-click OAuth > manual API key configuration
- Clear error messages > cryptic protocol errors

**Lesson 5: Rate limiting and abuse prevention**
- AI clients can make many rapid tool calls
- Rate limit per user (100 req/min is reasonable)
- Monitor for abuse (e.g., scraping all users' data)
- Implement exponential backoff on errors

### 6.3 Pitfalls to Avoid

**Pitfall 1: Performance issues**
- **Problem**: Slow query response (> 1s) breaks AI flow
- **Solution**: Index database, cache common queries, optimize query logic

**Pitfall 2: Privacy leaks**
- **Problem**: Cross-user data leakage due to missing isolation
- **Solution**: Three-layer isolation (app + database + network)

**Pitfall 3: Complex setup**
- **Problem**: Users can't figure out how to configure MCP server
- **Solution**: Clear documentation, automatic configuration where possible

**Pitfall 4: No error handling**
- **Problem**: Cryptic errors when tool fails (e.g., "Internal server error")
- **Solution**: Return user-friendly error messages in tool response

**Pitfall 5: Over-engineering**
- **Problem**: Building complex features before validating basic use case
- **Solution**: Start with read-only, single tool, local-only (Stage 22 approach)

---

## Recommended Approach

### Stage 22 Scope (Local MCP Server Prototype)

**What to build**:
1. Local MCP server using official TypeScript SDK
2. Stdio transport (zero network overhead)
3. Single tool: `get_preferences` (query/type/limit filtering)
4. Read `~/.cortex/user_model.json` (no cloud sync)
5. Claude Desktop integration (manual configuration)

**What NOT to build** (defer to Stage 23+):
- Cloud MCP server deployment
- Authentication (OAuth/API key)
- Write tools (add_preference, update_preference)
- Encryption and sync (cortex push)
- ChatGPT integration

**Estimated effort**: 2-3 days

**Success criteria**:
- Claude Desktop can query cortex preferences
- Query results match user_model.json contents
- Response time < 500ms for typical queries

### Stage 23+ Scope (Cloud Deployment)

**Phase 1: Cloud read-only MCP server**
- Deploy to kiwiai.cloud
- API key authentication (simpler than OAuth)
- PostgreSQL storage with RLS
- `cortex push` command (upload local model to cloud)

**Phase 2: Write tools with confirmation queue**
- `add_preference` tool (AI can suggest new preferences)
- Pending confirmation queue (user must approve before writing)
- `cortex review-pending` command (review and approve/reject)

**Phase 3: ChatGPT integration**
- Test MCP server with ChatGPT
- Document setup instructions for ChatGPT users

**Phase 4: Encryption and advanced features**
- Hybrid encryption (sensitive fields encrypted)
- Incremental sync (only upload changes)
- Conflict resolution (merge local + cloud changes)

---

## Technical Debt and Future Work

**Known limitations of Stage 22 approach**:
1. **No build script**: Manual `tsc` compilation required
2. **Simple query algorithm**: String matching, not semantic search
3. **No logging**: Only startup logs, no debug logs
4. **Weak error handling**: File not found, JSON parse errors not handled gracefully
5. **No unit tests**: Only manual testing in Claude Desktop

**Future optimizations**:
1. **Semantic search**: Use embedding similarity instead of string matching
2. **Relevance ranking**: Sort results by relevance score
3. **Query caching**: Cache common queries for faster response
4. **Incremental loading**: Stream results for large datasets
5. **Health monitoring**: Expose health check endpoint for monitoring

---

## References

1. Model Context Protocol Official Documentation - https://modelcontextprotocol.io/
2. MCP TypeScript SDK Documentation - https://ts.sdk.modelcontextprotocol.io/
3. MCP Specification - https://modelcontextprotocol.io/specification/latest
4. Claude Desktop MCP Configuration Guide - https://claude.ai/docs/connectors/building
5. MCP Official Example Servers - https://github.com/modelcontextprotocol/servers
6. MCP TypeScript SDK Source Code - https://github.com/modelcontextprotocol/typescript-sdk
7. MCP Inspector Testing Tool - https://github.com/modelcontextprotocol/inspector
8. Anthropic: Introducing MCP - https://www.anthropic.com/news/model-context-protocol
9. Building MCP Servers: Best Practices - https://modelcontextprotocol.io/docs/develop/best-practices
10. Mem.ai MCP Server - https://mem.ai/mcp
11. Rewind AI - https://www.rewind.ai/
12. Notion API Documentation - https://developers.notion.com/
13. OWASP API Security Top 10 - https://owasp.org/www-project-api-security/
14. Node.js Crypto Module - https://nodejs.org/api/crypto.html
15. PostgreSQL Row-Level Security - https://www.postgresql.org/docs/current/ddl-rowsecurity.html

---

## Conclusion

MCP protocol provides a mature, well-supported standard for making cortex queryable by AI clients. The recommended approach is to start with a local read-only prototype (Stage 22) to validate product value, then expand to cloud deployment with authentication and write tools (Stage 23+).

Key success factors:
1. Use official SDK (don't reinvent protocol)
2. Start simple (single tool, read-only, local-only)
3. Optimize for query performance (< 500ms response time)
4. Prioritize privacy (local-first, optional E2EE for cloud)
5. Keep setup simple (clear documentation, automatic configuration)

The local MCP server prototype can be completed in 2-3 days and will immediately provide value to Claude Desktop users. Cloud deployment and advanced features can be added incrementally based on user feedback.
