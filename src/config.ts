/**
 * Configuration management for the Outlook OAuth MCP Server
 */

export interface Config {
  /** Azure AD Application (client) ID */
  clientId: string;
  /** Azure AD client secret (optional, for confidential clients) */
  clientSecret?: string;
  /** Azure AD tenant ID (default: 'common' for multi-tenant) */
  tenantId: string;
  /** Server port */
  port: number;
  /** Server bind address */
  host: string;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** CORS allowed origins */
  corsOrigin: string;
}

let cachedConfig: Config | null = null;

/**
 * Load configuration from environment variables
 */
export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const clientId = process.env.MS365_MCP_CLIENT_ID;
  
  if (!clientId) {
    throw new Error('MS365_MCP_CLIENT_ID environment variable is required');
  }

  cachedConfig = {
    clientId,
    clientSecret: process.env.MS365_MCP_CLIENT_SECRET || undefined,
    tenantId: process.env.MS365_MCP_TENANT_ID || 'common',
    port: parseInt(process.env.MS365_MCP_PORT || '3000', 10),
    host: process.env.MS365_MCP_HOST || '0.0.0.0',
    logLevel: (process.env.MS365_MCP_LOG_LEVEL || 'info') as Config['logLevel'],
    corsOrigin: process.env.MS365_MCP_CORS_ORIGIN || '*',
  };

  return cachedConfig;
}

/**
 * Microsoft Entra ID endpoints
 */
export function getAuthEndpoints(tenantId: string) {
  const authority = 'https://login.microsoftonline.com';
  
  return {
    authority,
    authorizationEndpoint: `${authority}/${tenantId}/oauth2/v2.0/authorize`,
    tokenEndpoint: `${authority}/${tenantId}/oauth2/v2.0/token`,
  };
}

/**
 * Microsoft Graph API base URL
 */
export const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Supported OAuth scopes for Outlook access
 */
export const SUPPORTED_SCOPES = [
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'Calendars.ReadWrite',
  'offline_access',
  'User.Read',
] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];
