/**
 * Structured JSON logging with pino.
 *
 * Features:
 * - JSON format in production, pretty in development
 * - Log level configurable via LOG_LEVEL env var
 * - Request correlation IDs (X-Request-Id header or auto-generated)
 */

import pino from 'pino';
import { getConfig } from '../config.js';

let _logger: pino.Logger | null = null;

/**
 * Initialize the global logger from config.
 * Call once at startup after config is available.
 */
export function initLogger(): pino.Logger {
  const config = getConfig();
  _logger = pino({
    level: config.logLevel || 'info',
    transport:
      config.logFormat === 'pretty'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    // In JSON mode (no transport), pino outputs structured JSON by default
  });
  return _logger;
}

/**
 * Get the global logger instance (lazy-initialized if needed).
 */
export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = initLogger();
  }
  return _logger;
}

/**
 * Create a child logger with a request correlation ID.
 */
export function createRequestLogger(requestId: string): pino.Logger {
  return getLogger().child({ requestId });
}
