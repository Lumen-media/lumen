import type { LoggerAPI } from '../types';

/** Console logger that prefixes every line with the calling module's id. */
export function createLoggerAPI(moduleId: string): LoggerAPI {
  const prefix = `[${moduleId}]`;
  return {
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
