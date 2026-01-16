# Security Review

## Overview

This document provides a comprehensive security audit of the Outlook OAuth MCP Server implementation, covering token handling, multi-user isolation, logging requirements, and threat mitigation strategies.

---

## 1. Token Handling Security

### 1.1 Token Flow Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TOKEN LIFECYCLE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Token Issuance (by Azure AD)                                           │
│     └── User authenticates with Azure AD                                   │
│     └── Token issued with Graph API scopes                                 │
│     └── Token contains: aud, iss, exp, scp, upn/email                     │
│                                                                             │
│  2. Token Transmission (Client → MCP Server)                               │
│     └── Bearer token in Authorization header                               │
│     └── TLS encryption required                                            │
│     └── Token NOT logged (redacted in logs)                               │
│                                                                             │
│  3. Token Validation (MCP Server)                                          │
│     └── Format validation (JWT structure)                                  │
│     └── NOT cryptographic validation (delegated to Graph API)             │
│     └── User identity extraction for audit logging                        │
│                                                                             │
│  4. Token Usage (MCP Server → Graph API)                                   │
│     └── Same token forwarded to Graph API                                  │
│     └── Graph API performs full validation                                 │
│     └── Errors returned to client                                          │
│                                                                             │
│  5. Token Storage                                                           │
│     └── Server: NONE (stateless design)                                    │
│     └── Client: Responsible for secure storage                            │
│     └── Per-request context via AsyncLocalStorage                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Token Validation Strategy

| Validation Type | Implementation | Security Rationale |
|----------------|----------------|-------------------|
| Format validation | Check JWT structure (3 parts) | Prevent malformed requests |
| Expiration check | Delegated to Graph API | Graph API authoritative source |
| Signature validation | Delegated to Graph API | Avoids key management complexity |
| Audience validation | Delegated to Graph API | Graph API checks `aud` claim |
| Scope validation | Delegated to Graph API | Graph API enforces permissions |

**Design Decision**: We use a "passthrough" validation model where the MCP server performs basic format checks but relies on Microsoft Graph API for full token validation. This is secure because:

1. Graph API is the authoritative token validator
2. Invalid tokens will fail at Graph API call
3. Reduces complexity and potential for validation bugs
4. No need to manage JWKS key rotation

### 1.3 Token Security Measures

```typescript
// Implemented in src/auth/middleware.ts

// 1. Format validation
const parts = token.split('.');
if (parts.length !== 3) {
  // Reject malformed tokens early
}

// 2. No token storage
req.auth = { token, userId };  // Stored only for request duration

// 3. Per-request isolation
await runWithContext({ accessToken: token }, async () => {
  // Token scoped to this request only
});

// 4. Token never logged
logger.info('Request', { userId: req.auth.userId }); // Token NOT included
```

### 1.4 Token Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Token interception | High | Require TLS/HTTPS |
| Token logging | High | Redact tokens in all logs |
| Token replay | Medium | Short token lifetime (Azure AD default ~1 hour) |
| Token theft from client | Medium | Out of scope - client responsibility |
| Expired token usage | Low | Graph API rejects expired tokens |

---

## 2. Multi-User Isolation

### 2.1 Request Isolation Architecture

```typescript
// src/utils/context.ts
import { AsyncLocalStorage } from 'async_hooks';

const requestStorage = new AsyncLocalStorage<RequestContext>();

// Each request gets isolated context
export function runWithContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return requestStorage.run(context, fn);
}
```

**How It Works:**

1. Each HTTP request creates a new `RequestContext`
2. Context stored in Node.js `AsyncLocalStorage`
3. All async operations in request chain access SAME context
4. Concurrent requests have ISOLATED contexts
5. Context destroyed when request completes

### 2.2 Isolation Verification

```
Request A (User: alice@company.com)     Request B (User: bob@company.com)
─────────────────────────────────────   ─────────────────────────────────
│                                   │   │                                │
│  runWithContext({ token: A })     │   │  runWithContext({ token: B })  │
│         │                         │   │         │                      │
│         ▼                         │   │         ▼                      │
│  ┌─────────────────────────┐      │   │  ┌─────────────────────────┐   │
│  │ AsyncLocalStorage       │      │   │  │ AsyncLocalStorage       │   │
│  │ Store A: { token: A }   │      │   │  │ Store B: { token: B }   │   │
│  └─────────────────────────┘      │   │  └─────────────────────────┘   │
│         │                         │   │         │                      │
│         ▼                         │   │         ▼                      │
│  getContextToken() → token A      │   │  getContextToken() → token B   │
│         │                         │   │         │                      │
│         ▼                         │   │         ▼                      │
│  Graph API call with token A      │   │  Graph API call with token B   │
│                                   │   │                                │
└───────────────────────────────────┘   └────────────────────────────────┘
```

### 2.3 Isolation Security Properties

| Property | Status | Implementation |
|----------|--------|----------------|
| Token isolation per request | ✅ | AsyncLocalStorage |
| No shared state between requests | ✅ | Stateless design |
| No token caching | ✅ | Tokens never stored |
| Concurrent request safety | ✅ | Node.js event loop + AsyncLocalStorage |
| Cross-user data access prevention | ✅ | Graph API enforces per-user access |

### 2.4 Potential Isolation Risks

| Risk | Mitigation |
|------|------------|
| Global variable leakage | No global state for tokens |
| Module-level caching | No token caching implemented |
| Error handler token exposure | Tokens redacted in error responses |
| Memory leak with context | AsyncLocalStorage auto-cleanup |

---

## 3. Logging and Audit Requirements

### 3.1 Audit Log Structure

```json
{
  "timestamp": "2026-01-16T10:30:00.000Z",
  "level": "info",
  "event": "tool_call",
  "user": {
    "id": "alice@company.com",
    "oid": "12345-abcde-67890"
  },
  "tool": "send-mail",
  "request": {
    "to_count": 1,
    "subject_preview": "Meeting request..."
  },
  "response": {
    "status": "success",
    "duration_ms": 234
  },
  "metadata": {
    "request_id": "req_abc123",
    "client_ip": "192.168.1.100",
    "user_agent": "MCP-Inspector/1.0"
  }
}
```

### 3.2 What Gets Logged

| Data | Logged | Format | Rationale |
|------|--------|--------|-----------|
| User identity | Yes | Email/UPN | Audit trail |
| Tool name | Yes | Full name | Audit trail |
| Request parameters | Partial | Sanitized | Audit without sensitive data |
| Email body | No | Redacted | Privacy |
| Access token | No | Never | Security |
| Response data | No | Only status | Privacy |
| Timestamps | Yes | ISO 8601 | Compliance |
| Request duration | Yes | Milliseconds | Performance monitoring |
| Error details | Yes | Sanitized | Debugging |

### 3.3 Log Levels

| Level | When Used | Example |
|-------|-----------|---------|
| `error` | Failures, exceptions | Token validation failed |
| `warn` | Suspicious activity | Unknown tool requested |
| `info` | Normal operations | Tool called successfully |
| `debug` | Development only | Request/response details |

### 3.4 Compliance Considerations

| Requirement | Status | Notes |
|-------------|--------|-------|
| GDPR | Partial | User email logged, content not logged |
| SOC 2 | Supported | Audit logs with timestamps |
| HIPAA | Configurable | Disable debug logging in production |
| PCI DSS | N/A | No payment data |

### 3.5 Log Security

```typescript
// Implemented safeguards:

// 1. Token redaction
logger.info('Request', { 
  userId: context.userId,
  // token: context.accessToken  // NEVER LOG
});

// 2. Content truncation
logger.info('Tool: send-mail', {
  subject: params.subject.substring(0, 50),  // Truncate
  to: params.to.length,  // Only count, not addresses
});

// 3. Error sanitization
logger.error('Graph API error', {
  error: response.error.message,  // Generic message
  // NOT: full response body with potential PII
});
```

---

## 4. Threat Model

### 4.1 STRIDE Analysis

| Threat | Category | Risk | Mitigation |
|--------|----------|------|------------|
| Token theft in transit | Spoofing | High | TLS required |
| Malformed token injection | Tampering | Medium | Format validation |
| Unauthorized tool access | Elevation | High | Bearer auth required |
| Token replay | Repudiation | Medium | Short token lifetime |
| Log injection | Information Disclosure | Low | Structured logging |
| DoS via large requests | Denial of Service | Medium | Request size limits |

### 4.2 Attack Surface

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ATTACK SURFACE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Public Endpoints (No Auth):                                               │
│  ├── GET /                     → Server info (low risk)                    │
│  ├── GET /health               → Health check (low risk)                   │
│  ├── GET /.well-known/*        → OAuth metadata (low risk)                 │
│  ├── GET /authorize            → Redirect to Microsoft (low risk)          │
│  └── POST /token               → Token proxy (medium risk)                 │
│                                                                             │
│  Protected Endpoints (Bearer Auth):                                         │
│  └── POST /mcp                 → MCP tools (HIGH RISK - requires auth)     │
│                                                                             │
│  Internal (Not Exposed):                                                    │
│  └── Microsoft Graph API       → Backend only                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Token Endpoint Security

The `/token` endpoint proxies to Microsoft and requires additional security:

```typescript
// Implemented protections:

// 1. Grant type validation
if (!['authorization_code', 'refresh_token'].includes(body.grant_type)) {
  return res.status(400).json({ error: 'unsupported_grant_type' });
}

// 2. Required parameter validation
if (body.grant_type === 'authorization_code') {
  if (!body.code || !body.redirect_uri) {
    return res.status(400).json({ error: 'invalid_request' });
  }
}

// 3. Response passthrough (no modification)
// Microsoft's response returned as-is
```

---

## 5. Security Recommendations

### 5.1 Production Deployment Checklist

- [ ] **TLS/HTTPS**: Configure TLS termination (nginx, cloud load balancer)
- [ ] **CORS**: Set `MS365_MCP_CORS_ORIGIN` to specific origins, not `*`
- [ ] **Log Level**: Set `MS365_MCP_LOG_LEVEL=info` (not debug)
- [ ] **Client Secret**: Use confidential client with secret for production
- [ ] **Tenant ID**: Set specific tenant ID, not `common`, if possible
- [ ] **Rate Limiting**: Add rate limiting at reverse proxy level
- [ ] **Health Monitoring**: Monitor `/health` endpoint
- [ ] **Log Aggregation**: Ship logs to centralized logging system

### 5.2 Azure AD Configuration

| Setting | Recommended Value | Reason |
|---------|-------------------|--------|
| Supported account types | Single tenant | Limit to organization |
| ID tokens | Disabled | Not needed |
| Implicit grant | Disabled | Use authorization code flow |
| Public client | No (if using secret) | More secure |
| Redirect URIs | Exact match only | Prevent redirect attacks |

### 5.3 Scope Recommendations

| Use Case | Recommended Scopes |
|----------|-------------------|
| Read-only mail | `User.Read Mail.Read offline_access` |
| Full mail access | `User.Read Mail.ReadWrite Mail.Send offline_access` |
| Read-only calendar | `User.Read Calendars.Read offline_access` |
| Full calendar access | `User.Read Calendars.ReadWrite offline_access` |
| Full Outlook access | All above scopes |

### 5.4 Monitoring Alerts

Set up alerts for:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Auth failures | > 10/min | Investigate potential attack |
| Error rate | > 5% | Investigate service issues |
| Latency P99 | > 5s | Scale or investigate |
| Token validation failures | > 5/min | Potential token issues |

---

## 6. Compliance Matrix

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| Token encryption in transit | TLS required | ✅ |
| Token encryption at rest | Not stored | ✅ (N/A) |
| Audit logging | Structured JSON logs | ✅ |
| User identity tracking | UPN/email in logs | ✅ |
| PII minimization | Content not logged | ✅ |
| Access control | Bearer token auth | ✅ |
| Session management | Stateless | ✅ |
| Error handling | Sanitized responses | ✅ |
| Input validation | Zod schemas | ✅ |
| Dependency security | Minimal deps | ✅ |

---

## 7. Security Testing Recommendations

### 7.1 Pre-deployment Tests

```bash
# 1. Verify no token logging
npm run dev 2>&1 | grep -i "token\|bearer"  # Should find nothing

# 2. Test auth required
curl http://localhost:3000/mcp  # Should return 401

# 3. Test invalid token
curl -H "Authorization: Bearer invalid" http://localhost:3000/mcp  # Should return 401

# 4. Test CORS
curl -H "Origin: http://evil.com" http://localhost:3000/mcp  # Check headers
```

### 7.2 Ongoing Security Practices

- [ ] Regular dependency updates (`npm audit`)
- [ ] Review logs for anomalies
- [ ] Rotate Azure AD client secrets periodically
- [ ] Monitor Microsoft Security advisories
- [ ] Conduct periodic security reviews
