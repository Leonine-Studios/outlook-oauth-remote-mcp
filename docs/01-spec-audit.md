# MCP Authorization Specification Audit

## Overview

This document provides a comprehensive audit of the MCP Authorization specification requirements, OAuth 2.1 standards, and Microsoft Graph API requirements for building a compliant Outlook-focused MCP server.

---

## MCP Specification Requirements (2025-11-25)

### Core Concepts

The MCP spec defines the following roles in the authorization flow:

| Role | Description | In Your Case |
|------|-------------|--------------|
| **MCP Client** | The agent/application requesting tool access | Claude, VS Code, MCP Inspector |
| **MCP Server** | OAuth 2.1 Resource Server that exposes tools | Your Outlook MCP Server |
| **Authorization Server** | Issues tokens to clients | Azure AD / Microsoft Entra ID |
| **Resource Server** | The downstream API being accessed | Microsoft Graph API |

### MUST Requirements (Mandatory)

| Requirement | RFC/Spec | Description | Implementation Notes |
|-------------|----------|-------------|---------------------|
| **Protected Resource Metadata** | RFC 9728 | Server MUST provide `/.well-known/oauth-protected-resource` | Returns resource identifier, auth server URLs, supported scopes |
| **Bearer Token Authentication** | RFC 6750 | Server MUST accept Bearer tokens in Authorization header | `Authorization: Bearer <token>` |
| **Token Validation** | OAuth 2.1 | Server MUST validate token issuer, audience, and expiration | Validate `iss`, `aud`, `exp` claims |
| **HTTPS Transport** | OAuth 2.1 | All OAuth endpoints MUST use TLS | Required for production |
| **PKCE Support** | RFC 7636 | Public clients MUST use PKCE | `code_challenge` and `code_verifier` |
| **Error Responses** | RFC 6749 | MUST return proper OAuth error responses | `invalid_token`, `insufficient_scope`, etc. |

### SHOULD Requirements (Recommended)

| Requirement | RFC/Spec | Description | Implementation Notes |
|-------------|----------|-------------|---------------------|
| **Authorization Server Metadata** | RFC 8414 | SHOULD provide `/.well-known/oauth-authorization-server` | Discovery endpoint for auth server capabilities |
| **Scope Enforcement** | OAuth 2.1 | SHOULD enforce scopes on tool access | Map Graph scopes to MCP tools |
| **Token Refresh** | RFC 6749 | SHOULD support refresh tokens | `offline_access` scope for Microsoft |
| **State Parameter** | RFC 6749 | SHOULD use state parameter for CSRF protection | Random string, validated on callback |

### MAY Requirements (Optional)

| Requirement | RFC/Spec | Description | Decision for Your Server |
|-------------|----------|-------------|-------------------------|
| **Dynamic Client Registration** | RFC 7591 | MAY support DCR | **SKIP** - Use fixed client registration |
| **Client ID Metadata Documents** | Draft | MAY support CIMD | **SKIP** - Not yet widely adopted |
| **Token Introspection** | RFC 7662 | MAY support introspection endpoint | **SKIP** - Not needed for passthrough |
| **Token Revocation** | RFC 7009 | MAY support revocation endpoint | **OPTIONAL** - Can proxy to Microsoft |

---

## RFC 9728: Protected Resource Metadata

### Required Response Format

```json
{
  "resource": "https://your-server.com/mcp",
  "authorization_servers": ["https://your-server.com"],
  "scopes_supported": [
    "Mail.Read",
    "Mail.Send",
    "Mail.ReadWrite",
    "Calendars.Read",
    "Calendars.ReadWrite",
    "offline_access"
  ],
  "bearer_methods_supported": ["header"],
  "resource_documentation": "https://your-server.com/docs"
}
```

### Required Fields

| Field | Required | Description |
|-------|----------|-------------|
| `resource` | Yes | The protected resource identifier (your MCP endpoint URL) |
| `authorization_servers` | Yes | Array of authorization server URLs |
| `scopes_supported` | No | Array of supported OAuth scopes |
| `bearer_methods_supported` | No | How tokens are passed (always "header" for MCP) |

---

## RFC 8414: Authorization Server Metadata

### Required Response Format

```json
{
  "issuer": "https://your-server.com",
  "authorization_endpoint": "https://your-server.com/authorize",
  "token_endpoint": "https://your-server.com/token",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": [
    "Mail.Read",
    "Mail.Send",
    "Mail.ReadWrite",
    "Calendars.Read",
    "Calendars.ReadWrite",
    "offline_access"
  ]
}
```

### Key Fields

| Field | Required | Description |
|-------|----------|-------------|
| `issuer` | Yes | URL of the authorization server |
| `authorization_endpoint` | Yes | URL for authorization requests |
| `token_endpoint` | Yes | URL for token requests |
| `response_types_supported` | Yes | Must include "code" |
| `grant_types_supported` | Yes | Must include "authorization_code" |
| `code_challenge_methods_supported` | Recommended | PKCE support, should include "S256" |

---

## Microsoft Graph API Requirements

### Delegated Permissions for Outlook

| Scope | Description | Required For |
|-------|-------------|--------------|
| `Mail.Read` | Read user's mail | list-mail-messages, get-mail-message |
| `Mail.Send` | Send mail as user | send-mail |
| `Mail.ReadWrite` | Read/write mail | delete-mail-message, move-mail-message |
| `Calendars.Read` | Read calendars | list-calendars, list-calendar-events |
| `Calendars.ReadWrite` | Read/write calendars | create/update/delete calendar events |
| `offline_access` | Refresh tokens | Required for token refresh |
| `User.Read` | Read user profile | Token validation, user identity |

### Microsoft Entra ID Constraints

| Constraint | Description | Impact |
|------------|-------------|--------|
| **No DCR Support** | Azure AD does not support Dynamic Client Registration | Must use fixed client registration |
| **Tenant Configuration** | Single-tenant or multi-tenant app | Choose based on deployment model |
| **Admin Consent** | Some scopes require admin consent | Mail.ReadWrite.Shared, etc. |
| **Redirect URIs** | Must be pre-registered | Add all callback URLs to app registration |
| **Token Lifetime** | Access tokens ~1 hour, refresh tokens ~90 days | Must handle refresh flow |

### Token Claims to Validate

```json
{
  "aud": "https://graph.microsoft.com",
  "iss": "https://login.microsoftonline.com/{tenant}/v2.0",
  "exp": 1705430400,
  "iat": 1705426800,
  "scp": "Mail.Read Mail.Send Calendars.Read offline_access"
}
```

| Claim | Validation | Notes |
|-------|------------|-------|
| `aud` | Must match expected audience | `https://graph.microsoft.com` for Graph tokens |
| `iss` | Must match expected issuer | Azure AD issuer URL |
| `exp` | Must not be expired | Unix timestamp |
| `scp` | Must include required scopes | Space-separated list |

---

## OAuth 2.1 Security Requirements

### Mandatory Security Features

| Feature | Description | Implementation |
|---------|-------------|----------------|
| **PKCE** | Proof Key for Code Exchange | Generate `code_verifier`, send `code_challenge` |
| **State Parameter** | CSRF protection | Random string, validate on callback |
| **Redirect URI Validation** | Exact match required | No wildcards, strict validation |
| **Token Binding** | Tokens bound to client | Validate `client_id` in token request |
| **Short Token Lifetime** | Access tokens expire quickly | Use refresh tokens for long sessions |

### PKCE Flow

```
1. Client generates:
   - code_verifier: Random 43-128 character string
   - code_challenge: BASE64URL(SHA256(code_verifier))

2. Authorization request includes:
   - code_challenge
   - code_challenge_method=S256

3. Token request includes:
   - code_verifier (server validates against stored challenge)
```

---

## Compliance Checklist

### Phase 1: Core Requirements

- [ ] Implement `/.well-known/oauth-protected-resource` (RFC 9728)
- [ ] Implement `/.well-known/oauth-authorization-server` (RFC 8414)
- [ ] Implement `/authorize` endpoint (proxy to Azure AD)
- [ ] Implement `/token` endpoint (proxy to Azure AD)
- [ ] Implement Bearer token validation middleware
- [ ] Validate token claims (iss, aud, exp, scp)
- [ ] Implement PKCE support (S256)
- [ ] Enforce HTTPS for all endpoints

### Phase 2: Tool Implementation

- [ ] Implement MCP `/mcp` endpoint with SSE support
- [ ] Implement mail tools (list, get, send, delete, move)
- [ ] Implement calendar tools (list, get, create, update, delete)
- [ ] Enforce scope requirements per tool
- [ ] Return proper MCP error responses

### Phase 3: Security Hardening

- [ ] Implement request logging with user identity
- [ ] Validate redirect URIs strictly
- [ ] Implement token refresh handling
- [ ] Add rate limiting
- [ ] Implement proper error responses (no sensitive data leakage)

---

## Decision Matrix: Your Server Architecture

| Decision | Options | Recommended | Rationale |
|----------|---------|-------------|-----------|
| Auth Server | Own vs Proxy Microsoft | **Proxy** | Leverage Azure AD, no custom auth server |
| Client Registration | DCR vs Fixed | **Fixed** | Azure AD doesn't support DCR, simpler |
| Token Storage | Server vs Client | **Client** | Stateless server, tokens passed per-request |
| Transport | stdio + HTTP vs HTTP only | **HTTP only** | Corporate deployment, remote access |
| Tools | All 90+ vs Outlook only | **Outlook only** | Minimal attack surface, focused scope |

---

## References

- [MCP Specification - Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [RFC 9728 - OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 8414 - OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 7591 - Dynamic Client Registration](https://datatracker.ietf.org/doc/html/rfc7591)
- [Microsoft Graph Auth Concepts](https://learn.microsoft.com/en-us/graph/auth/auth-concepts)
- [Microsoft Graph Permissions Reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
