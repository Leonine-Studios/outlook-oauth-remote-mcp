/**
 * Per-request context using AsyncLocalStorage
 * 
 * This provides request-scoped storage for the access token,
 * ensuring proper isolation between concurrent requests.
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Context data stored per-request
 */
export interface RequestContext {
  /** OAuth access token for Microsoft Graph API */
  accessToken: string;
  /** User identifier (email or object ID) */
  userId?: string;
}

/**
 * AsyncLocalStorage instance for request-scoped context
 */
const requestStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run a function within a request context.
 * All async operations within the callback will have access to this context.
 */
export function runWithContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return requestStorage.run(context, fn);
}

/**
 * Get the current request context
 */
export function getContext(): RequestContext | undefined {
  return requestStorage.getStore();
}

/**
 * Get the access token from the current request context
 */
export function getContextToken(): string | undefined {
  return requestStorage.getStore()?.accessToken;
}

/**
 * Get the user ID from the current request context
 */
export function getContextUserId(): string | undefined {
  return requestStorage.getStore()?.userId;
}

/**
 * Check if code is running within a request context
 */
export function hasRequestContext(): boolean {
  return requestStorage.getStore() !== undefined;
}
