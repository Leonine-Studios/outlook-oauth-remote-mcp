# Outlook OAuth MCP Server

A minimal, spec-compliant MCP server for Microsoft Outlook with OAuth2 delegated access for corporate multi-user environments.

## Features

- **100% MCP Spec Compliant**: Implements RFC 9728 (Protected Resource Metadata) and RFC 8414 (Authorization Server Metadata)
- **OAuth2 Delegated Access**: Users authenticate with their own Microsoft accounts
- **Stateless Design**: No token storage - tokens passed per-request for horizontal scalability
- **Corporate Ready**: Multi-user support with proper request isolation
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
4. Supported account types: Choose based on your needs
5. Click Register

### 2. Configure API Permissions

Add the following delegated permissions:

| Permission | Type | Description |
|------------|------|-------------|
| `User.Read` | Delegated | Sign in and read user profile |
| `Mail.Read` | Delegated | Read user mail |
| `Mail.ReadWrite` | Delegated | Read and write user mail |
| `Mail.Send` | Delegated | Send mail as user |
| `Calendars.Read` | Delegated | Read user calendars |
| `Calendars.ReadWrite` | Delegated | Read and write user calendars |
| `offline_access` | Delegated | Maintain access to data |

### 3. Configure Redirect URIs

Add platform: Web

Redirect URIs:
- `http://localhost:6274/oauth/callback` (MCP Inspector)
- `https://your-production-app.com/callback` (Production)

### 4. Get Credentials

Copy from Overview page:
- Application (client) ID → `MS365_MCP_CLIENT_ID`
- Directory (tenant) ID → `MS365_MCP_TENANT_ID`

Optional: Create client secret for confidential client flow.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Server info |
| `GET /health` | Health check |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 metadata |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata |
| `GET /authorize` | OAuth authorization (redirects to Microsoft) |
| `POST /token` | OAuth token exchange |
| `GET/POST /mcp` | MCP endpoint (requires Bearer token) |

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
       │  (access token)    │                     │
       │                    │                     │
       │  5. Call tools     │                     │
       │───────────────────▶│                     │
       │  (Bearer token)    │                     │
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
  outlook-oauth-mcp
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MS365_MCP_CLIENT_ID` | Yes | - | Azure AD client ID |
| `MS365_MCP_CLIENT_SECRET` | No | - | Azure AD client secret |
| `MS365_MCP_TENANT_ID` | No | `common` | Azure AD tenant ID |
| `MS365_MCP_PORT` | No | `3000` | Server port |
| `MS365_MCP_HOST` | No | `0.0.0.0` | Bind address |
| `MS365_MCP_LOG_LEVEL` | No | `info` | Log level |
| `MS365_MCP_CORS_ORIGIN` | No | `*` | CORS allowed origins |

## Architecture

This server follows a **stateless proxy pattern**:

1. **No token storage**: Access tokens are passed per-request via Bearer authentication
2. **No OBO flow**: Tokens are issued directly with Graph API scopes
3. **Per-request isolation**: Uses AsyncLocalStorage for request context
4. **Fixed client registration**: No Dynamic Client Registration (DCR) - uses pre-configured Azure AD app

## Security Considerations

- Always use HTTPS in production
- Configure `MS365_MCP_CORS_ORIGIN` to restrict origins
- Use the principle of least privilege for Graph API scopes
- Consider using a confidential client (with client secret) for production
- Monitor and audit tool usage via structured logs

## License

MIT
