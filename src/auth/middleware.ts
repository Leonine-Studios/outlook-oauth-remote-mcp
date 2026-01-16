/**
 * Bearer token authentication middleware
 * 
 * Validates the Authorization header and extracts the access token.
 * The token is NOT validated cryptographically here - we let Microsoft Graph
 * validate it when we make API calls. This is the "passthrough" pattern.
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';

/**
 * Extended request type with auth information
 */
export interface AuthenticatedRequest extends Request {
  auth?: {
    token: string;
    userId?: string;
  };
}

/**
 * Middleware that requires a valid Bearer token in the Authorization header
 */
export function bearerAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.warn('Missing Authorization header', { path: req.path });
    res.status(401).json({
      error: 'invalid_request',
      error_description: 'Missing Authorization header',
    });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    logger.warn('Invalid Authorization header format', { path: req.path });
    res.status(401).json({
      error: 'invalid_request',
      error_description: 'Authorization header must use Bearer scheme',
    });
    return;
  }

  const token = authHeader.substring(7).trim();

  if (!token) {
    logger.warn('Empty Bearer token', { path: req.path });
    res.status(401).json({
      error: 'invalid_token',
      error_description: 'Bearer token is empty',
    });
    return;
  }

  // Basic JWT structure validation (three base64url parts separated by dots)
  const parts = token.split('.');
  if (parts.length !== 3) {
    logger.warn('Invalid token format', { path: req.path });
    res.status(401).json({
      error: 'invalid_token',
      error_description: 'Token format is invalid',
    });
    return;
  }

  // Try to extract user info from token payload (optional, for logging)
  let userId: string | undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );
    userId = payload.preferred_username || payload.upn || payload.email || payload.sub;
  } catch {
    // Token payload parsing failed - not critical, continue without userId
    logger.debug('Could not parse token payload for user ID');
  }

  // Store auth info in request
  req.auth = { token, userId };

  logger.debug('Bearer token validated', { userId, path: req.path });
  next();
}

/**
 * Optional middleware that allows unauthenticated requests
 * but still extracts auth info if present
 */
export function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) {
      const parts = token.split('.');
      let userId: string | undefined;
      
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8')
          );
          userId = payload.preferred_username || payload.upn || payload.email || payload.sub;
        } catch {
          // Ignore parsing errors
        }
      }
      
      req.auth = { token, userId };
    }
  }

  next();
}
