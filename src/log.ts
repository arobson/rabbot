import createDebug from 'debug';

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export default function log(namespace: string): Logger {
  return {
    debug: createDebug(`${namespace}:debug`),
    info: createDebug(`${namespace}:info`),
    warn: createDebug(`${namespace}:warn`),
    error: createDebug(`${namespace}:error`),
  };
}
