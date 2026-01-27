/**
 * Rate Limiting Middleware
 * 
 * Implements per-user rate limiting using a sliding window counter.
 * Configurable via environment variables.
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config.js';
import logger from '../utils/logger.js';

/**
 * Rate limit entry for a user
 */
interface RateLimitEntry {
  /** Timestamps of requests within the current window */
  requests: number[];
  /** Last time this entry was accessed (for cleanup) */
  lastAccess: number;
}

/**
 * In-memory store for rate limit tracking
 * Key: user identifier (from validated token)
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Cleanup interval for stale entries (5 minutes)
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Start periodic cleanup of stale rate limit entries
 */
let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    const config = getConfig();
    const now = Date.now();
    const staleThreshold = now - (config.rateLimitWindowMs * 2);
    
    let cleaned = 0;
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.lastAccess < staleThreshold) {
        rateLimitStore.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug('Rate limit cleanup', { entriesRemoved: cleaned, remaining: rateLimitStore.size });
    }
  }, CLEANUP_INTERVAL_MS);
  
  // Don't prevent Node.js from exiting
  cleanupInterval.unref();
}

/**
 * Check if a user is rate limited
 * 
 * @param userId - User identifier from validated token
 * @returns Object with isLimited flag and remaining requests
 */
export function checkRateLimit(userId: string): { 
  isLimited: boolean; 
  remaining: number; 
  resetMs: number;
} {
  const config = getConfig();
  const now = Date.now();
  const windowStart = now - config.rateLimitWindowMs;
  
  // Start cleanup if not already running
  startCleanup();
  
  // Get or create entry for this user
  let entry = rateLimitStore.get(userId);
  if (!entry) {
    entry = { requests: [], lastAccess: now };
    rateLimitStore.set(userId, entry);
  }
  
  // Remove requests outside the current window
  entry.requests = entry.requests.filter(timestamp => timestamp > windowStart);
  entry.lastAccess = now;
  
  const remaining = Math.max(0, config.rateLimitRequests - entry.requests.length);
  const isLimited = entry.requests.length >= config.rateLimitRequests;
  
  // Calculate reset time (when the oldest request in window expires)
  let resetMs = config.rateLimitWindowMs;
  if (entry.requests.length > 0) {
    const oldestRequest = Math.min(...entry.requests);
    resetMs = Math.max(0, (oldestRequest + config.rateLimitWindowMs) - now);
  }
  
  return { isLimited, remaining, resetMs };
}

/**
 * Record a request for rate limiting
 * 
 * @param userId - User identifier from validated token
 */
export function recordRequest(userId: string): void {
  const now = Date.now();
  
  let entry = rateLimitStore.get(userId);
  if (!entry) {
    entry = { requests: [], lastAccess: now };
    rateLimitStore.set(userId, entry);
  }
  
  entry.requests.push(now);
  entry.lastAccess = now;
}

/**
 * Express request with user ID for rate limiting
 */
interface RateLimitedRequest extends Request {
  rateLimitUserId?: string;
}

/**
 * Rate limiting middleware factory
 * 
 * Must be used AFTER authentication middleware that sets rateLimitUserId
 * 
 * @returns Express middleware function
 */
export function rateLimitMiddleware() {
  return (req: RateLimitedRequest, res: Response, next: NextFunction): void => {
    const userId = req.rateLimitUserId;
    
    if (!userId) {
      // No user ID - skip rate limiting (will be caught by auth middleware)
      next();
      return;
    }
    
    const { isLimited, remaining, resetMs } = checkRateLimit(userId);
    
    // Set rate limit headers
    const config = getConfig();
    res.setHeader('X-RateLimit-Limit', config.rateLimitRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetMs / 1000));
    
    if (isLimited) {
      logger.warn('Rate limit exceeded', { 
        userId, 
        limit: config.rateLimitRequests,
        windowMs: config.rateLimitWindowMs 
      });
      
      res.setHeader('Retry-After', Math.ceil(resetMs / 1000));
      res.status(429).json({
        error: 'rate_limit_exceeded',
        error_description: 'Too many requests. Please try again later.',
        retry_after_seconds: Math.ceil(resetMs / 1000),
      });
      return;
    }
    
    // Record this request
    recordRequest(userId);
    
    next();
  };
}

/**
 * Get current rate limit statistics (for monitoring)
 */
export function getRateLimitStats(): {
  activeUsers: number;
  totalTrackedRequests: number;
} {
  let totalTrackedRequests = 0;
  for (const entry of rateLimitStore.values()) {
    totalTrackedRequests += entry.requests.length;
  }
  
  return {
    activeUsers: rateLimitStore.size,
    totalTrackedRequests,
  };
}

/**
 * IP-based rate limit store for registration endpoint
 * Separate from user rate limits to prevent abuse of /register
 */
const registrationLimitStore = new Map<string, RateLimitEntry>();

/** Registration rate limit: 5 requests per minute per IP */
const REGISTRATION_LIMIT = 5;
const REGISTRATION_WINDOW_MS = 60 * 1000;

/**
 * Rate limiting middleware for /register endpoint
 * 
 * Uses IP-based limiting (5 requests/minute) to prevent abuse
 * of dynamic client registration.
 */
export function registrationRateLimitMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - REGISTRATION_WINDOW_MS;
    
    // Get or create entry for this IP
    let entry = registrationLimitStore.get(ip);
    if (!entry) {
      entry = { requests: [], lastAccess: now };
      registrationLimitStore.set(ip, entry);
    }
    
    // Remove requests outside the current window
    entry.requests = entry.requests.filter(timestamp => timestamp > windowStart);
    entry.lastAccess = now;
    
    const remaining = Math.max(0, REGISTRATION_LIMIT - entry.requests.length);
    const isLimited = entry.requests.length >= REGISTRATION_LIMIT;
    
    // Calculate reset time
    let resetMs = REGISTRATION_WINDOW_MS;
    if (entry.requests.length > 0) {
      const oldestRequest = Math.min(...entry.requests);
      resetMs = Math.max(0, (oldestRequest + REGISTRATION_WINDOW_MS) - now);
    }
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', REGISTRATION_LIMIT);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetMs / 1000));
    
    if (isLimited) {
      logger.warn('Registration rate limit exceeded', { ip });
      
      res.setHeader('Retry-After', Math.ceil(resetMs / 1000));
      res.status(429).json({
        error: 'rate_limit_exceeded',
        error_description: 'Too many registration requests. Please try again later.',
        retry_after_seconds: Math.ceil(resetMs / 1000),
      });
      return;
    }
    
    // Record this request
    entry.requests.push(now);
    
    next();
  };
}
