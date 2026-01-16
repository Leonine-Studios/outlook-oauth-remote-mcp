# Implementation Specification

## Overview

This document provides the complete technical specification for implementing a minimal, spec-compliant Outlook MCP server with OAuth2 delegated access.

---

## Project Structure

```
outlook-oauth-remote-mcp/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Express server setup
│   ├── config.ts             # Configuration management
│   ├── auth/
│   │   ├── middleware.ts     # Bearer token validation
│   │   ├── metadata.ts       # OAuth discovery endpoints
│   │   └── proxy.ts          # Token endpoint proxy
│   ├── mcp/
│   │   ├── handler.ts        # MCP request handler
│   │   └── transport.ts      # Streamable HTTP transport
│   ├── tools/
│   │   ├── index.ts          # Tool registry
│   │   ├── mail.ts           # Mail tools
│   │   └── calendar.ts       # Calendar tools
│   ├── graph/
│   │   └── client.ts         # Microsoft Graph API client
│   └── utils/
│       ├── logger.ts         # Structured logging
│       └── context.ts        # Per-request context (AsyncLocalStorage)
├── docs/
│   ├── 01-spec-audit.md
│   ├── 02-architecture-decisions.md
│   └── 03-implementation-spec.md
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

---

## HTTP Endpoints

### 1. Protected Resource Metadata

**Endpoint:** `GET /.well-known/oauth-protected-resource`

**Purpose:** RFC 9728 compliance - tells MCP clients how to authenticate

**Response:**
```typescript
interface ProtectedResourceMetadata {
  resource: string;           // MCP endpoint URL
  authorization_servers: string[];  // Auth server URLs
  scopes_supported?: string[];      // Supported OAuth scopes
  bearer_methods_supported?: string[];  // Always ["header"]
  resource_documentation?: string;  // Docs URL
}
```

**Implementation:**
```typescript
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const baseUrl = getBaseUrl(req);
  
  res.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: [
      'Mail.Read',
      'Mail.ReadWrite', 
      'Mail.Send',
      'Calendars.Read',
      'Calendars.ReadWrite',
      'offline_access',
      'User.Read'
    ],
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrl}/docs`
  });
});
```

---

### 2. Authorization Server Metadata

**Endpoint:** `GET /.well-known/oauth-authorization-server`

**Purpose:** RFC 8414 compliance - describes authorization server capabilities

**Response:**
```typescript
interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  response_types_supported: string[];
  response_modes_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
}
```

**Implementation:**
```typescript
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const baseUrl = getBaseUrl(req);
  
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [
      'Mail.Read',
      'Mail.ReadWrite',
      'Mail.Send',
      'Calendars.Read',
      'Calendars.ReadWrite',
      'offline_access',
      'User.Read'
    ]
  });
});
```

---

### 3. Authorization Endpoint (Proxy)

**Endpoint:** `GET /authorize`

**Purpose:** Redirect to Microsoft Entra ID authorization endpoint

**Query Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `response_type` | Yes | Must be "code" |
| `client_id` | Yes | Azure AD app client ID |
| `redirect_uri` | Yes | Callback URL |
| `scope` | Yes | Space-separated scopes |
| `state` | Yes | CSRF protection |
| `code_challenge` | Yes | PKCE challenge |
| `code_challenge_method` | Yes | Must be "S256" |

**Implementation:**
```typescript
app.get('/authorize', (req, res) => {
  const config = getConfig();
  const tenantId = config.tenantId || 'common';
  
  const microsoftAuthUrl = new URL(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`
  );
  
  // Forward allowed parameters
  const allowedParams = [
    'response_type', 'redirect_uri', 'scope', 'state',
    'code_challenge', 'code_challenge_method', 'prompt', 'login_hint'
  ];
  
  allowedParams.forEach(param => {
    const value = req.query[param];
    if (value) {
      microsoftAuthUrl.searchParams.set(param, String(value));
    }
  });
  
  // Always use our registered client_id
  microsoftAuthUrl.searchParams.set('client_id', config.clientId);
  
  res.redirect(microsoftAuthUrl.toString());
});
```

---

### 4. Token Endpoint (Proxy)

**Endpoint:** `POST /token`

**Purpose:** Exchange authorization code for tokens, or refresh tokens

**Request Body (Authorization Code):**
```typescript
interface TokenRequest {
  grant_type: 'authorization_code';
  code: string;
  redirect_uri: string;
  code_verifier: string;
  client_id?: string;
}
```

**Request Body (Refresh):**
```typescript
interface RefreshRequest {
  grant_type: 'refresh_token';
  refresh_token: string;
  client_id?: string;
}
```

**Response:**
```typescript
interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
}
```

**Implementation:**
```typescript
app.post('/token', express.urlencoded({ extended: true }), async (req, res) => {
  const config = getConfig();
  const tenantId = config.tenantId || 'common';
  
  const params = new URLSearchParams({
    grant_type: req.body.grant_type,
    client_id: config.clientId
  });
  
  if (req.body.grant_type === 'authorization_code') {
    params.set('code', req.body.code);
    params.set('redirect_uri', req.body.redirect_uri);
    params.set('code_verifier', req.body.code_verifier);
  } else if (req.body.grant_type === 'refresh_token') {
    params.set('refresh_token', req.body.refresh_token);
  }
  
  // Add client_secret if configured (confidential client)
  if (config.clientSecret) {
    params.set('client_secret', config.clientSecret);
  }
  
  try {
    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      res.status(response.status).json(data);
      return;
    }
    
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: 'server_error',
      error_description: 'Token exchange failed'
    });
  }
});
```

---

### 5. MCP Endpoint

**Endpoint:** `POST /mcp` and `GET /mcp` (SSE)

**Purpose:** Main MCP protocol endpoint

**Headers Required:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Implementation:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

app.all('/mcp', bearerAuthMiddleware, async (req, res) => {
  const context = {
    accessToken: req.auth.token,
    userId: req.auth.userId
  };
  
  await runWithContext(context, async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined  // Stateless mode
    });
    
    res.on('close', () => transport.close());
    
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
});
```

---

### 6. Health Check

**Endpoint:** `GET /health`

**Purpose:** Load balancer health checks

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-01-16T10:30:00.000Z"
}
```

---

## Tool Specifications

### Mail Tools

#### 1. list-mail-folders

**Description:** List all mail folders for the authenticated user

**Parameters:** None

**Graph API:** `GET /me/mailFolders`

**Required Scope:** `Mail.Read`

**Response Schema:**
```typescript
interface MailFolder {
  id: string;
  displayName: string;
  parentFolderId: string | null;
  childFolderCount: number;
  unreadItemCount: number;
  totalItemCount: number;
}
```

---

#### 2. list-mail-messages

**Description:** List mail messages, optionally filtered

**Parameters:**
```typescript
interface ListMailMessagesParams {
  folderId?: string;    // Folder ID (default: Inbox)
  top?: number;         // Max results (default: 10, max: 50)
  skip?: number;        // Pagination offset
  filter?: string;      // OData filter
  search?: string;      // Search query
  orderBy?: string;     // Sort order (default: receivedDateTime desc)
}
```

**Graph API:** `GET /me/messages` or `GET /me/mailFolders/{folderId}/messages`

**Required Scope:** `Mail.Read`

---

#### 3. get-mail-message

**Description:** Get a single mail message by ID

**Parameters:**
```typescript
interface GetMailMessageParams {
  messageId: string;    // Required: Message ID
}
```

**Graph API:** `GET /me/messages/{messageId}`

**Required Scope:** `Mail.Read`

---

#### 4. send-mail

**Description:** Send an email message

**Parameters:**
```typescript
interface SendMailParams {
  to: string[];         // Required: Recipient email addresses
  subject: string;      // Required: Email subject
  body: string;         // Required: Email body (HTML or plain text)
  bodyType?: 'html' | 'text';  // Default: 'html'
  cc?: string[];        // CC recipients
  bcc?: string[];       // BCC recipients
  importance?: 'low' | 'normal' | 'high';  // Default: 'normal'
  saveToSentItems?: boolean;  // Default: true
}
```

**Graph API:** `POST /me/sendMail`

**Required Scope:** `Mail.Send`

**Request Body:**
```json
{
  "message": {
    "subject": "Meeting Tomorrow",
    "body": {
      "contentType": "HTML",
      "content": "<p>Let's meet at 10am.</p>"
    },
    "toRecipients": [
      { "emailAddress": { "address": "recipient@example.com" } }
    ]
  },
  "saveToSentItems": true
}
```

---

#### 5. create-draft-email

**Description:** Create a draft email message

**Parameters:** Same as `send-mail` except no `saveToSentItems`

**Graph API:** `POST /me/messages`

**Required Scope:** `Mail.ReadWrite`

---

#### 6. delete-mail-message

**Description:** Delete an email message (moves to Deleted Items)

**Parameters:**
```typescript
interface DeleteMailMessageParams {
  messageId: string;    // Required: Message ID
}
```

**Graph API:** `DELETE /me/messages/{messageId}`

**Required Scope:** `Mail.ReadWrite`

---

#### 7. move-mail-message

**Description:** Move a message to a different folder

**Parameters:**
```typescript
interface MoveMailMessageParams {
  messageId: string;       // Required: Message ID
  destinationFolderId: string;  // Required: Target folder ID
}
```

**Graph API:** `POST /me/messages/{messageId}/move`

**Required Scope:** `Mail.ReadWrite`

---

### Calendar Tools

#### 8. list-calendars

**Description:** List all calendars for the authenticated user

**Parameters:** None

**Graph API:** `GET /me/calendars`

**Required Scope:** `Calendars.Read`

---

#### 9. list-calendar-events

**Description:** List events from a calendar

**Parameters:**
```typescript
interface ListCalendarEventsParams {
  calendarId?: string;  // Calendar ID (default: primary)
  top?: number;         // Max results (default: 10, max: 50)
  skip?: number;        // Pagination offset
  filter?: string;      // OData filter
  orderBy?: string;     // Sort order
}
```

**Graph API:** `GET /me/calendars/{calendarId}/events` or `GET /me/events`

**Required Scope:** `Calendars.Read`

---

#### 10. get-calendar-event

**Description:** Get a single calendar event by ID

**Parameters:**
```typescript
interface GetCalendarEventParams {
  eventId: string;      // Required: Event ID
}
```

**Graph API:** `GET /me/events/{eventId}`

**Required Scope:** `Calendars.Read`

---

#### 11. get-calendar-view

**Description:** Get calendar events within a time range

**Parameters:**
```typescript
interface GetCalendarViewParams {
  startDateTime: string;  // Required: ISO 8601 start time
  endDateTime: string;    // Required: ISO 8601 end time
  calendarId?: string;    // Calendar ID (default: primary)
  top?: number;           // Max results
}
```

**Graph API:** `GET /me/calendarView?startDateTime={start}&endDateTime={end}`

**Required Scope:** `Calendars.Read`

---

#### 12. create-calendar-event

**Description:** Create a new calendar event

**Parameters:**
```typescript
interface CreateCalendarEventParams {
  subject: string;        // Required: Event title
  start: string;          // Required: ISO 8601 start time
  end: string;            // Required: ISO 8601 end time
  timeZone?: string;      // Default: 'UTC'
  body?: string;          // Event description
  bodyType?: 'html' | 'text';
  location?: string;      // Location name
  attendees?: Array<{
    email: string;
    type?: 'required' | 'optional';
  }>;
  isAllDay?: boolean;
  reminder?: number;      // Minutes before event
  calendarId?: string;    // Target calendar ID
}
```

**Graph API:** `POST /me/calendars/{calendarId}/events` or `POST /me/events`

**Required Scope:** `Calendars.ReadWrite`

---

#### 13. update-calendar-event

**Description:** Update an existing calendar event

**Parameters:**
```typescript
interface UpdateCalendarEventParams {
  eventId: string;        // Required: Event ID
  subject?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  body?: string;
  location?: string;
  attendees?: Array<{ email: string; type?: 'required' | 'optional' }>;
}
```

**Graph API:** `PATCH /me/events/{eventId}`

**Required Scope:** `Calendars.ReadWrite`

---

#### 14. delete-calendar-event

**Description:** Delete a calendar event

**Parameters:**
```typescript
interface DeleteCalendarEventParams {
  eventId: string;        // Required: Event ID
}
```

**Graph API:** `DELETE /me/events/{eventId}`

**Required Scope:** `Calendars.ReadWrite`

---

## Configuration

### Environment Variables

```bash
# Required
MS365_MCP_CLIENT_ID=your-azure-ad-client-id

# Optional (defaults shown)
MS365_MCP_TENANT_ID=common          # Or specific tenant ID
MS365_MCP_CLIENT_SECRET=            # For confidential clients
MS365_MCP_PORT=3000                 # Server port
MS365_MCP_HOST=0.0.0.0              # Bind address
MS365_MCP_LOG_LEVEL=info            # debug|info|warn|error
MS365_MCP_CORS_ORIGIN=*             # CORS allowed origins
```

### Configuration Interface

```typescript
interface Config {
  clientId: string;
  clientSecret?: string;
  tenantId: string;
  port: number;
  host: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  corsOrigin: string;
}

function getConfig(): Config {
  if (!process.env.MS365_MCP_CLIENT_ID) {
    throw new Error('MS365_MCP_CLIENT_ID is required');
  }
  
  return {
    clientId: process.env.MS365_MCP_CLIENT_ID,
    clientSecret: process.env.MS365_MCP_CLIENT_SECRET,
    tenantId: process.env.MS365_MCP_TENANT_ID || 'common',
    port: parseInt(process.env.MS365_MCP_PORT || '3000'),
    host: process.env.MS365_MCP_HOST || '0.0.0.0',
    logLevel: (process.env.MS365_MCP_LOG_LEVEL || 'info') as Config['logLevel'],
    corsOrigin: process.env.MS365_MCP_CORS_ORIGIN || '*'
  };
}
```

---

## Dependencies

### Production Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.0",
    "express": "^5.2.0",
    "zod": "^3.24.0"
  }
}
```

### Development Dependencies

```json
{
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0",
    "tsx": "^4.19.0",
    "vitest": "^3.0.0"
  }
}
```

### Dependency Rationale

| Package | Purpose | Why Not Alternatives |
|---------|---------|---------------------|
| `@modelcontextprotocol/sdk` | MCP server SDK | Official SDK |
| `express` | HTTP server | Mature, well-supported |
| `zod` | Schema validation | Type-safe, small bundle |

**Notably NOT included:**
- `@azure/msal-node` - Not needed (proxy pattern, no token management)
- `keytar` - Not needed (stateless, no local storage)
- `winston` - Optional (can use console for simplicity)

---

## Docker Configuration

### Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built code
COPY dist/ ./dist/

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcp -u 1001
USER mcp

# Environment
ENV NODE_ENV=production
ENV MS365_MCP_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

### Docker Compose (Development)

```yaml
version: '3.8'
services:
  mcp-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - MS365_MCP_CLIENT_ID=${MS365_MCP_CLIENT_ID}
      - MS365_MCP_TENANT_ID=${MS365_MCP_TENANT_ID}
      - MS365_MCP_CLIENT_SECRET=${MS365_MCP_CLIENT_SECRET}
      - MS365_MCP_LOG_LEVEL=debug
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

---

## Testing Strategy

### Unit Tests

```typescript
// src/tools/mail.test.ts
import { describe, it, expect, vi } from 'vitest';
import { listMailMessages } from './mail';

describe('listMailMessages', () => {
  it('should return mail messages', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        value: [{ id: '1', subject: 'Test' }]
      })
    });
    
    global.fetch = mockFetch;
    
    const result = await listMailMessages({ top: 10 });
    
    expect(result.content[0].text).toContain('Test');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/me/messages'),
      expect.any(Object)
    );
  });
});
```

### Integration Tests

```typescript
// test/integration/oauth-flow.test.ts
import { describe, it, expect } from 'vitest';

describe('OAuth Discovery', () => {
  it('should return protected resource metadata', async () => {
    const res = await fetch('http://localhost:3000/.well-known/oauth-protected-resource');
    const data = await res.json();
    
    expect(data.resource).toBeDefined();
    expect(data.authorization_servers).toHaveLength(1);
    expect(data.scopes_supported).toContain('Mail.Read');
  });
});
```

---

## Metrics and Monitoring

### Key Metrics to Track

| Metric | Type | Description |
|--------|------|-------------|
| `mcp_requests_total` | Counter | Total MCP requests |
| `mcp_request_duration_seconds` | Histogram | Request latency |
| `mcp_tool_calls_total` | Counter | Tool invocations by name |
| `mcp_auth_failures_total` | Counter | Authentication failures |
| `graph_api_calls_total` | Counter | Graph API calls |
| `graph_api_errors_total` | Counter | Graph API errors by status |

### Health Endpoint Response

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "timestamp": "2026-01-16T10:30:00.000Z",
  "checks": {
    "graph_api": "ok"
  }
}
```
