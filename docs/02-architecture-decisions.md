# Architecture Decision Records (ADRs)

## Overview

This document captures key architectural decisions for building a minimal, spec-compliant Outlook MCP server with OAuth2 delegated access for corporate multi-user environments.

---

## ADR-001: Transport Protocol

### Decision: HTTP/SSE Only (No stdio)

**Status:** Accepted

**Context:**
The existing `ms-365-mcp-server` supports both stdio (for local CLI use) and HTTP (for remote deployment). This adds complexity and maintenance burden.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| stdio + HTTP | Local testing, backwards compatibility | Complexity, different auth flows per transport |
| **HTTP/SSE only** | Simpler, consistent OAuth flow, corporate-ready | No local CLI mode |
| WebSocket | Real-time, bidirectional | More complex, less MCP client support |

**Decision:**
HTTP with Server-Sent Events (SSE) only. This aligns with:
- MCP Streamable HTTP transport specification
- Corporate deployment requirements (remote access)
- Consistent OAuth authentication flow

**Consequences:**
- Cannot run as local stdio server
- All clients must support HTTP transport
- Simplified codebase (single transport)

---

## ADR-002: Authorization Server Pattern

### Decision: Proxy to Microsoft Entra ID

**Status:** Accepted

**Context:**
MCP servers can either implement their own Authorization Server or proxy to an external one. Microsoft Graph requires tokens from Azure AD.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| **Proxy to Azure AD** | Leverages existing IdP, no token management | Dependent on Microsoft flows |
| Own Auth Server + OBO | Full control | Complex, must implement OBO flow |
| Own Auth Server (separate tokens) | Decoupled | Two separate token flows, confusing |

**Decision:**
Proxy pattern - the MCP server acts as a transparent proxy to Microsoft Entra ID:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MCP Client  │────▶│  MCP Server  │────▶│   Azure AD   │     │  MS Graph    │
│  (Claude)    │◀────│  (Proxy)     │◀────│  (IdP)       │     │  (Outlook)   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                            │                                         ▲
                            │         Token (same token)              │
                            └─────────────────────────────────────────┘
```

**Flow:**
1. Client discovers auth endpoints via `/.well-known/oauth-protected-resource`
2. MCP Server returns Azure AD as the authorization server
3. Client authenticates directly with Azure AD (Authorization Code + PKCE)
4. Client receives token with Graph scopes (Mail.Read, etc.)
5. Client sends requests to MCP Server with Bearer token
6. MCP Server validates token and forwards to Graph API

**Consequences:**
- No On-Behalf-Of (OBO) flow needed
- Token already has Graph permissions
- Simpler implementation
- Microsoft handles all token issuance

---

## ADR-003: Client Registration Approach

### Decision: DCR for MCP Clients + Fixed Azure AD Registration

**Status:** Accepted (Updated)

**Context:**
There are TWO separate registration relationships:
1. **MCP Client → MCP Server**: How Cursor/Claude identify themselves to your server
2. **MCP Server → Microsoft**: How your server identifies itself to Azure AD

**Key Insight:**
MCP clients like Cursor **require** Dynamic Client Registration (RFC 7591) to connect. This is separate from Azure AD registration.

**Architecture:**

```
┌──────────────┐    DCR      ┌──────────────┐   Fixed    ┌──────────────┐
│  MCP Client  │────────────▶│  MCP Server  │───────────▶│  Azure AD    │
│  (Cursor)    │  /register  │              │  client_id │              │
│              │◀────────────│              │◀───────────│              │
│              │  client_id  │              │   tokens   │              │
└──────────────┘             └──────────────┘            └──────────────┘
```

**Decision:**

1. **DCR Enabled** for MCP clients:
   - `POST /register` endpoint (RFC 7591)
   - In-memory client storage (can be upgraded to database)
   - Each MCP client gets unique `client_id` for tracking

2. **Fixed Registration** with Azure AD:
   - `MS365_MCP_CLIENT_ID` from environment
   - Pre-registered in Azure portal
   - Used for all Microsoft OAuth operations

```yaml
# MCP Client Registration (Dynamic)
mcp_clients:
  registration: dynamic  # POST /register
  storage: in-memory     # Or database for production

# Azure AD Registration (Fixed)
azure_ad:
  client_id: "your-app-client-id"  # From Azure portal
  tenant_id: "your-tenant-id"       # Single or "common"
  client_secret: "required"         # For remote servers
```

**Consequences:**
- MCP clients can self-register (required by Cursor, etc.)
- Azure AD app is fixed and controlled
- Supports multi-user environments
- Client tracking possible via DCR client_id

---

## ADR-004: Token Storage Strategy

### Decision: Stateless (Per-Request Token Passing)

**Status:** Accepted

**Context:**
The MCP server needs access to user tokens to call Graph API. Options include server-side storage or client-managed tokens passed per request.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| **Stateless (per-request)** | Simple, scalable, no storage | Client must manage tokens |
| Server-side storage (Redis) | Server can refresh tokens | State management, scaling issues |
| Encrypted cookies | Browser-compatible | Not suitable for API clients |

**Decision:**
Stateless architecture - tokens passed in Authorization header per request:

```typescript
// Request flow
POST /mcp HTTP/1.1
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI...
Content-Type: application/json

{"jsonrpc": "2.0", "method": "tools/call", ...}
```

**Token Lifecycle:**
1. Client obtains tokens from Azure AD (Authorization Code + PKCE)
2. Client stores tokens locally (access + refresh)
3. Client includes access token in each MCP request
4. Client handles token refresh when expired
5. Server validates token per-request, never stores

**Implementation:**
```typescript
// Per-request context using AsyncLocalStorage
const requestStorage = new AsyncLocalStorage<{ accessToken: string }>();

app.use('/mcp', (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  requestStorage.run({ accessToken: token }, () => next());
});
```

**Consequences:**
- Horizontally scalable (no shared state)
- No token storage security concerns
- Client responsible for refresh
- Works with all MCP clients

---

## ADR-005: Tool Scope

### Decision: Outlook Only (Mail + Calendar)

**Status:** Accepted

**Context:**
The existing `ms-365-mcp-server` has 90+ tools covering all of Microsoft 365. This creates a large attack surface and complex permission requirements.

**Options Considered:**

| Option | Tools | Scopes Required | Complexity |
|--------|-------|-----------------|------------|
| **Outlook only** | ~15 | Mail.*, Calendars.* | Low |
| Personal (Outlook + OneDrive + Tasks) | ~40 | + Files.*, Tasks.* | Medium |
| Full MS 365 | 90+ | Many admin scopes | High |

**Decision:**
Outlook-focused implementation with minimal scope:

```
Tools Included (15):
├── Mail
│   ├── list-mail-folders
│   ├── list-mail-messages
│   ├── get-mail-message
│   ├── send-mail
│   ├── create-draft-email
│   ├── delete-mail-message
│   └── move-mail-message
└── Calendar
    ├── list-calendars
    ├── list-calendar-events
    ├── get-calendar-event
    ├── get-calendar-view
    ├── create-calendar-event
    ├── update-calendar-event
    └── delete-calendar-event
```

**Required Microsoft Graph Scopes:**
```
Mail.Read
Mail.ReadWrite
Mail.Send
Calendars.Read
Calendars.ReadWrite
offline_access
User.Read
```

**Consequences:**
- Minimal permission requirements
- Smaller attack surface
- Easier to audit and maintain
- Focused user experience

---

## ADR-006: Error Handling Strategy

### Decision: Structured MCP + OAuth Error Responses

**Status:** Accepted

**Context:**
Errors can occur at multiple levels: OAuth, MCP protocol, Graph API. Need consistent error handling.

**Decision:**
Three-tier error handling:

**1. OAuth Errors (HTTP 401/403)**
```json
{
  "error": "invalid_token",
  "error_description": "Token has expired"
}
```

**2. MCP Protocol Errors (JSON-RPC)**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Invalid request"
  },
  "id": null
}
```

**3. Tool Execution Errors (MCP Response)**
```json
{
  "content": [{
    "type": "text",
    "text": "{\"error\": \"Mail not found\"}"
  }],
  "isError": true
}
```

**Error Code Mapping:**

| Error Source | HTTP Status | MCP Code | Action |
|--------------|-------------|----------|--------|
| Missing token | 401 | - | Return WWW-Authenticate |
| Invalid token | 401 | - | Return error_description |
| Insufficient scope | 403 | - | Return required scope |
| Tool not found | 200 | -32601 | Method not found |
| Invalid params | 200 | -32602 | Invalid params |
| Graph API error | 200 | - | isError: true |

---

## ADR-007: Logging and Audit Strategy

### Decision: Structured JSON Logging with User Context

**Status:** Accepted

**Context:**
Corporate environments require audit trails for compliance. Need to log who did what, when.

**Decision:**
Structured logging with user identity extracted from token:

```typescript
// Log structure
{
  "timestamp": "2026-01-16T10:30:00.000Z",
  "level": "info",
  "event": "tool_call",
  "user": {
    "id": "user@company.com",
    "oid": "12345-abcde-..."  // Azure AD object ID
  },
  "tool": "send-mail",
  "params": {
    "to": "recipient@example.com",
    "subject": "Meeting request"
    // Body redacted for privacy
  },
  "duration_ms": 234,
  "status": "success"
}
```

**Log Levels:**

| Level | When | Example |
|-------|------|---------|
| `error` | Failures | Token validation failed |
| `warn` | Concerning | Token near expiry |
| `info` | Normal operations | Tool called successfully |
| `debug` | Development | Request/response details |

**Sensitive Data Handling:**
- Never log full tokens
- Redact email bodies
- Log only metadata (subject, recipient count)
- Configurable redaction rules

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Client (Claude, VS Code)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ 1. Discover auth endpoints
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Outlook OAuth MCP Server                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  /.well-known/oauth-protected-resource                               │   │
│  │  /.well-known/oauth-authorization-server                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ 2. Get authorization server URL
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Microsoft Entra ID (Azure AD)                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  /oauth2/v2.0/authorize                                              │   │
│  │  /oauth2/v2.0/token                                                  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ 3. User authenticates, gets token
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Client                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Stores: access_token, refresh_token                                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ 4. Call tools with Bearer token
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Outlook OAuth MCP Server                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  POST /mcp                                                           │   │
│  │  Authorization: Bearer <token>                                       │   │
│  │                                                                      │   │
│  │  - Validate token                                                    │   │
│  │  - Extract user identity                                             │   │
│  │  - Execute tool                                                      │   │
│  │  - Log audit trail                                                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ 5. Call Graph API with same token
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Microsoft Graph API                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  GET /v1.0/me/messages                                               │   │
│  │  POST /v1.0/me/sendMail                                              │   │
│  │  GET /v1.0/me/calendar/events                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary of Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport | HTTP/SSE only | Corporate deployment, consistent auth |
| Auth Pattern | Proxy to Azure AD | Simple, no OBO needed |
| Client Registration | Fixed | Azure AD limitation, better control |
| Token Storage | Stateless | Scalable, client manages tokens |
| Tool Scope | Outlook only | Minimal permissions, focused |
| Error Handling | Tiered (OAuth/MCP/Tool) | Clear error attribution |
| Logging | Structured JSON with user context | Audit compliance |
