/**
 * Outlook OAuth MCP Server
 * 
 * A minimal, spec-compliant MCP server for Microsoft Outlook
 * with OAuth2 delegated access for corporate multi-user environments.
 */

import 'dotenv/config';
import { startServer } from './server.js';
import logger from './utils/logger.js';

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { 
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  process.exit(1);
});

// Start the server
startServer().catch((error) => {
  logger.error('Failed to start server', { error: error.message });
  process.exit(1);
});
