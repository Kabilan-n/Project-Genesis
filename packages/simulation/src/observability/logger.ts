/**
 * Structured logger for the simulation package.
 *
 * Production: JSON-per-line via pino. Development (NODE_ENV=development):
 * pretty-printed via pino-pretty when LOG_PRETTY=true is also set, so the
 * dev console stays human-readable.
 *
 * Use child loggers per engine: `const log = logger.child({ engine: 'X' })`.
 * Standard fields to include: worldId, tick, agentId, operation, durationMs.
 *
 * Sensitive keys (password, token, api_key, apiKey) are redacted at the
 * pino level — defence in depth in case a caller forgets.
 */
import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';
const usePretty = isDev && process.env.LOG_PRETTY === 'true';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      '*.password',
      '*.token',
      '*.api_key',
      '*.apiKey',
      '*.secret',
      'password',
      'token',
      'api_key',
      'apiKey',
      'secret',
    ],
    remove: false,
    censor: '[REDACTED]',
  },
  ...(usePretty
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

/**
 * Convenience: a child logger tagged with the calling engine name.
 * Engines should call this once at module load:
 *
 *   const log = engineLogger('AgentEngine');
 *   log.info({ agentId, tick }, 'agent_decision_start');
 */
export function engineLogger(engine: string) {
  return logger.child({ engine });
}
