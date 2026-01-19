/**
 * Token Parser for Microsoft Graph API Access Tokens
 * 
 * NOTE: Microsoft Graph API access tokens use a proprietary format and
 * CANNOT be cryptographically validated by third parties. Microsoft's
 * documentation explicitly states: "You can't validate tokens for 
 * Microsoft Graph according to these rules due to their proprietary format."
 * 
 * This module parses tokens to extract user identity for:
 * - Audit logging
 * - Rate limiting
 * - Tenant allowlist enforcement
 * 
 * The actual token validation is performed by Microsoft Graph API when
 * we make API calls. Invalid tokens will be rejected by Graph API.
 * 
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens
 */

import { getConfig } from '../config.js';
import logger from '../utils/logger.js';

/**
 * Parsed token payload with extracted claims
 */
export interface ParsedToken {
  /** User's unique identifier (object ID) */
  oid: string;
  /** User's preferred username (email or UPN) */
  preferredUsername?: string;
  /** User's email address */
  email?: string;
  /** User Principal Name */
  upn?: string;
  /** Subject claim */
  sub: string;
  /** Tenant ID the token was issued for */
  tid: string;
  /** Token audience */
  aud: string;
  /** Token issuer */
  iss: string;
  /** Token expiration (Unix timestamp) */
  exp: number;
}

/**
 * Token validation error with specific error type
 */
export class TokenValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_token' | 'expired_token' | 'tenant_not_allowed'
  ) {
    super(message);
    this.name = 'TokenValidationError';
  }
}

/**
 * Parse and validate a JWT access token
 * 
 * This extracts claims from the token for logging and access control.
 * It does NOT cryptographically verify the signature (not possible for Graph tokens).
 * Graph API will validate the token when we make API calls.
 * 
 * @param token - The raw JWT token string
 * @returns Parsed token payload with extracted claims
 * @throws TokenValidationError if parsing fails or tenant not allowed
 */
export function parseToken(token: string): ParsedToken {
  const config = getConfig();
  
  // Validate JWT structure (three base64url parts separated by dots)
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenValidationError('Token format is invalid', 'invalid_token');
  }
  
  // Decode the payload (middle part)
  let payload: Record<string, unknown>;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    payload = JSON.parse(payloadJson);
  } catch {
    throw new TokenValidationError('Token payload is not valid JSON', 'invalid_token');
  }
  
  // Extract required claims
  const iss = payload.iss as string;
  const aud = payload.aud as string;
  const exp = payload.exp as number;
  const tid = payload.tid as string;
  const oid = payload.oid as string;
  const sub = payload.sub as string;
  
  // Basic validation
  if (!iss || !aud) {
    throw new TokenValidationError('Token missing required claims (iss, aud)', 'invalid_token');
  }
  
  if (!oid && !sub) {
    throw new TokenValidationError('Token missing user identifier (oid or sub)', 'invalid_token');
  }
  
  if (!tid) {
    throw new TokenValidationError('Token missing tenant ID (tid)', 'invalid_token');
  }
  
  // Check expiration (with 60 second tolerance for clock skew)
  const now = Math.floor(Date.now() / 1000);
  if (exp && exp < now - 60) {
    throw new TokenValidationError('Token has expired', 'expired_token');
  }
  
  // Check tenant allowlist if configured
  if (config.allowedTenants.length > 0) {
    if (!config.allowedTenants.includes(tid)) {
      logger.warn('Token from non-allowed tenant rejected', { tid });
      throw new TokenValidationError(
        `Tenant ${tid} is not in the allowed tenants list`,
        'tenant_not_allowed'
      );
    }
  }
  
  const parsedToken: ParsedToken = {
    oid: oid || sub,
    sub: sub || oid,
    tid,
    aud,
    iss,
    exp,
    preferredUsername: payload.preferred_username as string | undefined,
    email: payload.email as string | undefined,
    upn: payload.upn as string | undefined,
  };
  
  logger.debug('Token parsed', {
    oid: parsedToken.oid,
    tid: parsedToken.tid,
    preferredUsername: parsedToken.preferredUsername,
  });
  
  return parsedToken;
}

/**
 * Get a user-friendly identifier from parsed token claims
 */
export function getUserIdentifier(token: ParsedToken): string {
  return token.preferredUsername || token.upn || token.email || token.oid;
}

// Re-export for backwards compatibility with middleware
export { ParsedToken as ValidatedToken };
