# Outlook OAuth MCP Server

A minimal, spec-compliant MCP server for Microsoft Outlook with OAuth2 delegated access for corporate multi-user environments.

## Features

- **100% MCP Spec Compliant**: Implements RFC 9728 (Protected Resource Metadata) and RFC 8414 (Authorization Server Metadata)
- **OAuth2 Delegated Access**: Users authenticate with their own Microsoft accounts
- **Cryptographic Token Validation**: Full JWT signature verification using Microsoft's JWKS keys
- **Stateless Design**: No token storage - tokens passed per-request for horizontal scalability
- **Corporate Ready**: Multi-user support with proper request isolation
- **Rate Limiting**: Configurable per-user rate limiting to prevent abuse
- **Multi-Tenant Support**: Works with Keycloak broker setups and multiple Azure AD tenants
- **Minimal Attack Surface**: Only Outlook (Mail + Calendar) tools exposed

## Quick Start

### Prerequisites

- Node.js >= 20
- Azure AD App Registration with delegated permissions

### Installation

```bash
npm install
npm run build
```

### Configuration

Create a `.env` file:

```bash
MS365_MCP_CLIENT_ID=your-azure-ad-client-id
MS365_MCP_TENANT_ID=your-tenant-id  # or 'common' for multi-tenant
MS365_MCP_CORS_ORIGIN=https://your-librechat-domain.com  # IMPORTANT: Set this in production
```

### Run

```bash
npm start
```

Server will be available at `http://localhost:3000`

## Azure AD Setup

### 1. Create App Registration

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to Azure Active Directory → App registrations → New registration
3. Name: "Outlook MCP Server"
4. Supported account types: Choose based on your needs (see Multi-Tenant section below)
5. Click Register

### 2. Configure API Permissions

Add the following delegated permissions:

| Permission | Type | Admin Consent | Description |
|------------|------|---------------|-------------|
| `User.Read` | Delegated | No | Sign in and read user profile |
| `Mail.Read` | Delegated | No | Read user mail |
| `Mail.ReadWrite` | Delegated | **Recommended** | Read and write user mail |
| `Mail.Send` | Delegated | **Recommended** | Send mail as user |
| `Calendars.Read` | Delegated | No | Read user calendars |
| `Calendars.ReadWrite` | Delegated | No | Read and write user calendars |
| `offline_access` | Delegated | No | Maintain access to data |

### 3. Configure Admin Consent (Recommended for Enterprise)

To require admin approval before users can access sensitive features like sending emails:

#### Option A: Require Admin Consent for Specific Permissions

1. Go to **Azure AD → Enterprise Applications → Your App → Permissions**
2. Click **Grant admin consent for [Your Organization]** for permissions you want pre-approved
3. For permissions you want to restrict:
   - Go to **Azure AD → Enterprise Applications → Consent and permissions → User consent settings**
   - Select **"Do not allow user consent"** or **"Allow user consent for apps from verified publishers, for selected permissions"**

#### Option B: Configure Conditional Access (Recommended)

1. Go to **Azure AD → Security → Conditional Access**
2. Create a new policy:
   - **Users**: All users (or specific groups)
   - **Cloud apps**: Select your MCP app
   - **Conditions**: Configure as needed (e.g., require compliant device)
   - **Grant**: Require MFA, compliant device, or other controls

#### Option C: App-level Consent Configuration

In your App Registration:

1. Go to **API permissions**
2. For sensitive permissions (`Mail.Send`, `Mail.ReadWrite`):
   - Note: These are delegated permissions, so the user must consent
   - To require admin consent, use the Enterprise Applications settings above

### 4. Configure Redirect URIs

Add platform: Web

Redirect URIs:
- `http://localhost:6274/oauth/callback` (MCP Inspector)
- `https://your-production-app.com/callback` (Production)

### 5. Get Credentials

Copy from Overview page:
- Application (client) ID → `MS365_MCP_CLIENT_ID`
- Directory (tenant) ID → `MS365_MCP_TENANT_ID`

Optional: Create client secret for confidential client flow.

## Multi-Tenant Configuration with Keycloak

If you're using Keycloak as an identity broker with multiple Azure AD tenants:

### Tenant Allowlist

Configure allowed tenants to restrict which Azure AD tenants can access the server:

```bash
# Allow specific tenants (comma-separated tenant IDs)
MS365_MCP_ALLOWED_TENANTS=tenant-id-1,tenant-id-2,tenant-id-3
```

If not set, tokens from any tenant will be accepted (validated against Microsoft's JWKS).

### App Registration for Multi-Tenant

1. In App Registration, set **Supported account types** to:
   - "Accounts in any organizational directory (Any Azure AD directory - Multitenant)"
2. Set `MS365_MCP_TENANT_ID=common` in your environment
3. Configure `MS365_MCP_ALLOWED_TENANTS` with your federated tenant IDs

## Rate Limiting

Rate limiting is enabled by default to prevent abuse:

| Variable | Default | Description |
|----------|---------|-------------|
| `MS365_MCP_RATE_LIMIT_REQUESTS` | `30` | Max requests per window per user |
| `MS365_MCP_RATE_LIMIT_WINDOW_MS` | `60000` | Window size in ms (default: 1 minute) |

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Seconds until the window resets
- `Retry-After`: Seconds to wait (only on 429 responses)

## Security Features

### Token Validation

All tokens are cryptographically validated:
- JWT signature verified against Microsoft's JWKS keys
- Audience (`aud`) must match your Azure AD app's client ID
- Issuer (`iss`) must be a valid Microsoft endpoint
- Token expiration is enforced
- Tenant allowlist checked (if configured)

### Request Isolation

Each request runs in isolated context:
- Tokens stored only for request duration using `AsyncLocalStorage`
- No cross-request token leakage
- Concurrent requests are fully isolated

### Audit Logging

All tool calls are logged with:
- User identity (from validated token claims)
- Tool name and sanitized parameters
- Timestamp and request duration
- No sensitive data (tokens, email content) in logs

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /` | No | Server info |
| `GET /health` | No | Health check with rate limit stats |
| `GET /.well-known/oauth-protected-resource` | No | RFC 9728 metadata |
| `GET /.well-known/oauth-authorization-server` | No | RFC 8414 metadata |
| `GET /authorize` | No | OAuth authorization (redirects to Microsoft) |
| `POST /token` | No | OAuth token exchange |
| `GET/POST /mcp` | **Yes** | MCP endpoint (requires Bearer token) |

## Available Tools

### Mail Tools

| Tool | Description |
|------|-------------|
| `list-mail-folders` | List all mail folders |
| `list-mail-messages` | List mail messages from a folder |
| `get-mail-message` | Get a single message by ID |
| `send-mail` | Send an email |
| `delete-mail-message` | Delete a message |
| `move-mail-message` | Move a message to another folder |

### Calendar Tools

| Tool | Description |
|------|-------------|
| `list-calendars` | List all calendars |
| `list-calendar-events` | List events from a calendar |
| `get-calendar-event` | Get a single event by ID |
| `get-calendar-view` | Get events in a time range |
| `create-calendar-event` | Create a new event |
| `update-calendar-event` | Update an existing event |
| `delete-calendar-event` | Delete an event |

## OAuth Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MCP Client  │────▶│  MCP Server  │────▶│   Azure AD   │
│              │◀────│              │◀────│              │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                     │
       │  1. Discover       │                     │
       │─────────────────▶ │                     │
       │  ◀─────────────────│ (metadata)         │
       │                    │                     │
       │  2. Auth redirect  │                     │
       │────────────────────│────────────────────▶│
       │                    │                     │
       │  3. User login     │                     │
       │◀───────────────────│◀────────────────────│
       │  (auth code)       │                     │
       │                    │                     │
       │  4. Token exchange │                     │
       │────────────────────│────────────────────▶│
       │  ◀─────────────────│◀────────────────────│
       │  (access token)    │  ✓ Validated via JWKS
       │                    │                     │
       │  5. Call tools     │                     │
       │───────────────────▶│                     │
       │  (Bearer token)    │  ✓ Rate limited     │
       │                    │  6. Graph API call  │
       │                    │────────────────────▶│
       │  ◀─────────────────│◀────────────────────│
       │  (tool response)   │                     │
       └──────────────────────────────────────────┘
```

## Testing with MCP Inspector

```bash
# Start the server
npm run dev

# In another terminal, run MCP Inspector
npx @modelcontextprotocol/inspector
```

Configure the inspector:
- Server URL: `http://localhost:3000/mcp`
- OAuth: Use the discovery endpoints

## Docker

### Build

```bash
npm run build
docker build -t outlook-oauth-mcp .
```

### Run

```bash
docker run -p 3000:3000 \
  -e MS365_MCP_CLIENT_ID=your-client-id \
  -e MS365_MCP_TENANT_ID=your-tenant-id \
  -e MS365_MCP_CORS_ORIGIN=https://your-app.com \
  outlook-oauth-mcp
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MS365_MCP_CLIENT_ID` | Yes | - | Azure AD client ID |
| `MS365_MCP_CLIENT_SECRET` | No | - | Azure AD client secret (for confidential clients) |
| `MS365_MCP_TENANT_ID` | No | `common` | Azure AD tenant ID |
| `MS365_MCP_PORT` | No | `3000` | Server port |
| `MS365_MCP_HOST` | No | `0.0.0.0` | Bind address |
| `MS365_MCP_LOG_LEVEL` | No | `info` | Log level (debug, info, warn, error) |
| `MS365_MCP_CORS_ORIGIN` | No | `*` | CORS allowed origins (**set in production!**) |
| `MS365_MCP_RATE_LIMIT_REQUESTS` | No | `30` | Max requests per window per user |
| `MS365_MCP_RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in milliseconds |
| `MS365_MCP_ALLOWED_TENANTS` | No | - | Comma-separated list of allowed tenant IDs |

## Production Deployment Checklist

- [ ] **TLS/HTTPS**: Deploy behind a reverse proxy with TLS termination
- [ ] **CORS**: Set `MS365_MCP_CORS_ORIGIN` to your specific domain(s)
- [ ] **Tenant Restriction**: Set `MS365_MCP_ALLOWED_TENANTS` if using multi-tenant
- [ ] **Admin Consent**: Configure admin consent for sensitive permissions in Azure AD
- [ ] **Log Level**: Set `MS365_MCP_LOG_LEVEL=info` (not debug)
- [ ] **Monitoring**: Monitor `/health` endpoint and set up alerts
- [ ] **Log Aggregation**: Ship logs to a centralized logging system
- [ ] **Client Secret**: Use a confidential client with secret for production
- [ ] **Rate Limits**: Tune rate limits based on your usage patterns

## Architecture

This server follows a **stateless proxy pattern**:

1. **No token storage**: Access tokens are passed per-request via Bearer authentication
2. **Cryptographic validation**: All tokens verified against Microsoft's JWKS
3. **Per-request isolation**: Uses AsyncLocalStorage for request context
4. **Fixed client registration**: Uses pre-configured Azure AD app

## Security Considerations

- Always use HTTPS in production (deploy behind TLS-terminating reverse proxy)
- Configure `MS365_MCP_CORS_ORIGIN` to restrict origins
- Use the principle of least privilege for Graph API scopes
- Consider requiring admin consent for `Mail.Send` and `Mail.ReadWrite`
- Use a confidential client (with client secret) for production
- Monitor and audit tool usage via structured logs
- Configure tenant allowlist when using multi-tenant with Keycloak

## License

MIT
