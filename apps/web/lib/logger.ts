/**
 * Lightweight logger for Retivox development.
 *
 * This logger emits structured JSON output for easier debugging during development
 * and can be replaced with a production-grade service like Sentry later.
 */

type LogData = Record<string, unknown>;

type LogPayload = {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: LogData;
  timestamp: string;
  environment: string;
};

const isProduction = process.env.NODE_ENV === 'production';

const formatLog = (level: LogPayload['level'], message: string, data?: LogData): LogPayload => ({
  level,
  message,
  data,
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV ?? 'development',
});

const logger = {
  info(message: string, data?: LogData): void {
    console.log(JSON.stringify(formatLog('info', message, data)));
  },

  warn(message: string, data?: LogData): void {
    console.warn(JSON.stringify(formatLog('warn', message, data)));
  },

  error(message: string, data?: LogData): void {
    console.error(JSON.stringify(formatLog('error', message, data)));
  },

  debug(message: string, data?: LogData): void {
    if (isProduction) {
      return;
    }
    console.debug(JSON.stringify(formatLog('debug', message, data)));
  },
};

export default logger;
