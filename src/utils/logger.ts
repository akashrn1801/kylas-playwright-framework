type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS';

const colors = {
  INFO: '\x1b[36m',    // Cyan
  WARN: '\x1b[33m',    // Yellow
  ERROR: '\x1b[31m',   // Red
  DEBUG: '\x1b[35m',   // Magenta
  SUCCESS: '\x1b[32m', // Green
  RESET: '\x1b[0m',    // Reset
};

function getTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, data?: unknown): void {
  const timestamp = getTimestamp();
  const color = colors[level];
  const reset = colors.RESET;
  const prefix = `${color}[${timestamp}] [${level}]${reset}`;

  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export const logger = {
  info: (message: string, data?: unknown) => log('INFO', message, data),
  warn: (message: string, data?: unknown) => log('WARN', message, data),
  error: (message: string, data?: unknown) => log('ERROR', message, data),
  debug: (message: string, data?: unknown) => log('DEBUG', message, data),
  success: (message: string, data?: unknown) => log('SUCCESS', message, data),
};