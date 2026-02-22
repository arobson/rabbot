import mfsm from 'mfsm';
import log from '../log.js';

const logger = log('rabbot.io');

let staticId = 0;

/* state definitions
  acquiring - waiting to get back a connection or channel
  acquired - an open connection or channel was established
  closed - the broker closed the channel or connection
  failed - a temporary state between retries
  released - release happens due to user action _or_ after all attempts to connect are exhausted
*/

export interface IOMonadOptions {
  name: string;
  waitMin?: number;
  waitMax?: number;
  waitIncrement?: number;
}

export interface Subscription {
  off: () => void;
  remove: () => void;
}

// Runtime type: mfsm machine with topic-dispatch (not EventEmitter)
// We use Record<string,unknown> to allow property access
type Machine = Record<string, unknown> & {
  name: unknown;
  item: unknown;
  waitInterval: unknown;
  waitMin: unknown;
  waitMax: unknown;
  waitIncrement: unknown;
  closeReason: unknown;
  currentState: string;
  emit: (event: string, data?: unknown) => unknown;
  handle: (event: string, data?: unknown) => void;
  next: (state: string) => Promise<void>;
  once: (event: string, fn: (data?: unknown) => void) => void;
  // on returns a topic-dispatch Subscription at runtime
  on: (event: string, fn: (data?: unknown) => void) => Subscription;
  after: (state: string) => Promise<void>;
  operate: (call: string, args: unknown[]) => Promise<unknown>;
};

export interface IOMonad {
  state: string;
  name: string;
  waitInterval: number;
  waitMin: number;
  waitMax: number;
  waitIncrement: number;
  item: unknown;
  on: (event: string, handler: (data?: unknown) => void) => Subscription;
  once: (event: string, handler: (data?: unknown) => void) => Subscription;
  emit: (event: string, data?: unknown) => void;
  acquire: () => Promise<IOMonad>;
  release: () => Promise<void>;
  operate: (call: string, args: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
}

export default function createIOMonad(
  options: IOMonadOptions,
  type: string,
  factory: () => Promise<unknown>,
  target: { prototype: Record<string, unknown> },
  close?: (item: unknown) => void
): IOMonad {
  const id = staticId++;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  // We cast to unknown first to bypass strict type checking for the mfsm definition object
  const machine = mfsm({
    init: {
      id: String(id),
      name: options.name,
      waitInterval: options.waitMin ?? 0,
      waitMin: options.waitMin ?? 0,
      waitMax: options.waitMax ?? 5000,
      waitIncrement: options.waitIncrement ?? 100,
      item: undefined as unknown,
      closeReason: undefined as unknown,
      default: 'acquiring',
    },
    states: {
      acquiring: {
        onEntry() {
          _acquire(this as unknown as Machine);
        },
        blocked: { deferUntil: 'acquired' },
        failed: { next: 'failed' },
        operate: { deferUntil: 'acquired' },
        release: { next: 'released' },
        released: { next: 'released' },
      },
      acquired: {
        acquire() {
          const m = this as unknown as Machine;
          m.emit('acquired');
        },
        return(data?: unknown) {
          const m = this as unknown as Machine;
          m.emit('return', data);
        },
        blocked: { next: 'blocked' },
        failed: { next: 'failed' },
        operate(data?: unknown) {
          const m = this as unknown as Machine;
          const call = data as { operation: string; argList: unknown[]; resolve: (v: unknown) => void; reject: (e: unknown) => void };
          try {
            const item = m.item as Record<string, (...args: unknown[]) => unknown>;
            const result = item[call.operation](...call.argList);
            if (result && typeof (result as Promise<unknown>).then === 'function') {
              (result as Promise<unknown>).then(call.resolve, call.reject);
            } else {
              call.resolve(result);
            }
          } catch (err) {
            call.reject(err);
          }
        },
        release() {
          const m = this as unknown as Machine;
          logger.info(`${type} '${m.name}' was closed by the user`);
          m.next('releasing');
        },
        released(data?: unknown) {
          const m = this as unknown as Machine;
          const reason = data as string;
          logger.warn(`${type} '${m.name}' was closed by the broker with reason '${reason}'`);
          m.closeReason = reason;
          m.next('closed');
        },
      },
      blocked: {
        failed: { next: 'failed' },
        operate: { deferUntil: 'acquired' },
        release() {
          const m = this as unknown as Machine;
          logger.info(`${type} '${m.name}' was closed by the user`);
          m.next('releasing');
        },
        released(data?: unknown) {
          const m = this as unknown as Machine;
          const reason = data as string;
          logger.warn(`${type} '${m.name}' was closed by the broker with reason '${reason}'`);
          m.closeReason = reason;
          m.next('closed');
        },
        unblocked: { next: 'acquired' },
      },
      closed: {
        onEntry() {
          const m = this as unknown as Machine;
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
          }
          m.emit('closed', m.closeReason);
          m.item = null;
          m.closeReason = undefined;
        },
        acquire: { next: 'acquiring' },
        operate(data?: unknown) {
          const m = this as unknown as Machine;
          const call = data as { operation: string; resolve: (v: unknown) => void; reject: (e: unknown) => void };
          logger.info(`Operation '${call.operation}' invoked on closed ${type} '${m.name}'`);
          m.once('acquired', () => m.handle('operate', call));
          m.next('acquiring');
        },
        release: { next: 'released' },
        released: { next: 'released' },
      },
      failed: {
        onEntry() {
          const m = this as unknown as Machine;
          retryTimer = setTimeout(() => {
            const wi = m.waitInterval as number;
            const winc = m.waitIncrement as number;
            const wmax = m.waitMax as number;
            if ((wi + winc) < wmax) {
              m.waitInterval = wi + winc;
            }
            m.next('acquiring');
          }, m.waitInterval as number);
        },
        acquire() {
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
          }
          const m = this as unknown as Machine;
          m.next('acquiring');
        },
        operate: { deferUntil: 'acquired' },
        release: { next: 'released' },
        released() {
          // expected - close event fires after error event on a channel
        },
      },
      releasing: {
        onEntry() {
          _release(this as unknown as Machine);
        },
        acquire: { forward: 'released' },
        operate: { forward: 'released' },
        release: { forward: 'released' },
        released: { next: 'released' },
      },
      released: {
        onEntry() {
          const m = this as unknown as Machine;
          if (m.item && (m.item as { removeAllListeners?: () => void }).removeAllListeners) {
            (m.item as { removeAllListeners: () => void }).removeAllListeners();
          }
          m.item = null;
          m.emit('released', id);
        },
        acquire: { next: 'acquiring' },
        operate(data?: unknown) {
          const m = this as unknown as Machine;
          const call = data as { operation: string; reject: (e: unknown) => void };
          logger.warn(`Operation '${call.operation}' invoked on released ${type} '${m.name}' - reacquisition is required.`);
          call.reject(new Error(`Cannot invoke operation '${call.operation}' on released ${type} '${m.name}'`));
        },
        release() {
          const m = this as unknown as Machine;
          m.emit('released');
        },
        released() {
          const m = this as unknown as Machine;
          m.emit('released');
        },
      },
    },
    api: {
      acquire(..._args: unknown[]): Promise<unknown> {
        const m = this as unknown as Machine;
        m.handle('acquire');
        return new Promise((resolve, reject) => {
          m.once('acquired', () => resolve(m));
          m.once('released', () => reject(new Error(`Cannot reacquire released ${type} '${m.name}'`)));
        });
      },
      operate(...args: unknown[]): Promise<unknown> {
        const m = this as unknown as Machine;
        const call = args[0] as string;
        const argList = args[1] as unknown[];
        const op = { operation: call, argList, resolve: null as unknown as (v: unknown) => void, reject: null as unknown as (e: unknown) => void };
        const promise = new Promise<unknown>((resolve, reject) => {
          op.resolve = resolve;
          op.reject = reject;
        });
        m.handle('operate', op);
        return promise;
      },
      release(..._args: unknown[]): Promise<void> {
        const m = this as unknown as Machine;
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = undefined;
        }
        return new Promise((resolve) => {
          m.once('released', () => resolve());
          m.handle('release');
        });
      },
    },
  }) as unknown as Machine;

  // Wrap on/once to provide EventEmitter-style API (handler gets only data, not (data, topic))
  // and to return Subscription objects with .off()
  const rawOn = (machine as unknown as { on: (event: string, fn: (data: unknown) => void) => Subscription }).on.bind(machine);

  const wrappedOn = (event: string, handler: (data?: unknown) => void): Subscription => {
    return rawOn(event, (data: unknown) => handler(data));
  };

  const wrappedOnce = (event: string, handler: (data?: unknown) => void): Subscription => {
    let sub: Subscription;
    const wrapper = (data: unknown) => {
      sub?.off();
      handler(data);
    };
    sub = rawOn(event, wrapper);
    return sub;
  };

  (machine as Record<string, unknown>).on = wrappedOn;
  (machine as Record<string, unknown>).once = wrappedOnce;

  function _acquire(m: Machine): void {
    process.nextTick(() => {
      m.emit('acquiring');
    });
    logger.debug(`Attempting acquisition of ${type} '${m.name}'`);
    factory()
      .then(
        (instance) => _onAcquisition(m, instance),
        (err) => _onAcquisitionError(m, err)
      );
  }

  function _onAcquisition(m: Machine, instance: unknown): void {
    m.item = instance;
    m.waitInterval = m.waitMin as number;
    logger.debug(`Acquired ${type} '${m.name}' successfully`);

    const item = instance as {
      on: (event: string, handler: (...args: unknown[]) => void) => unknown;
      once: (event: string, handler: (...args: unknown[]) => void) => unknown;
      removeAllListeners: (event?: string) => void;
    };

    item.on('return', (raw: unknown) => {
      m.handle('return', raw);
    });
    item.once('close', (info: unknown) => {
      const reason = (info as string) || 'No information provided';
      (item as { removeAllListeners: (event?: string) => void }).removeAllListeners('blocked');
      (item as { removeAllListeners: (event?: string) => void }).removeAllListeners('unblocked');
      m.handle('released', reason);
    });
    item.on('error', (err: unknown) => {
      logger.error(`Error emitted by ${type} '${m.name}' - '${(err as Error).stack}'`);
      (item as { removeAllListeners: (event?: string) => void }).removeAllListeners('blocked');
      (item as { removeAllListeners: (event?: string) => void }).removeAllListeners('unblocked');
      m.emit('failed', err);
      m.handle('failed', err);
    });
    item.on('unblocked', () => {
      logger.warn(`${type} '${m.name}' was unblocked by the broker`);
      m.emit('unblocked');
      m.handle('unblocked');
    });
    item.on('blocked', () => {
      logger.warn(`${type} '${m.name}' was blocked by the broker`);
      m.emit('blocked');
      m.handle('blocked');
    });
    m.next('acquired');
  }

  function _onAcquisitionError(m: Machine, err: unknown): void {
    logger.error(`Acquisition of ${type} '${m.name}' failed with '${err}'`);
    m.emit('failed', err);
    m.handle('failed');
  }

  function _release(m: Machine): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    if (m.item) {
      if (close) {
        try {
          close(m.item);
        } catch (ex) {
          logger.warn(`${type} '${m.name}' threw an exception on close: ${ex}`);
          m.handle('released');
        }
      } else {
        try {
          (m.item as { close: () => void }).close();
        } catch (ex) {
          logger.warn(`${type} '${m.name}' threw an exception on close: ${ex}`);
          m.handle('released');
        }
      }
    } else {
      m.handle('released');
    }
  }

  // Proxy target prototype methods through operate()
  const names = Object.getOwnPropertyNames(target.prototype);
  names.forEach((name) => {
    const prop = target.prototype[name];
    if (typeof prop === 'function' && name !== 'constructor') {
      (machine as Record<string, unknown>)[name] = (...args: unknown[]) =>
        (machine.operate as (call: string, args: unknown[]) => Promise<unknown>)(name, args);
    }
  });

  // Add state getter for backward compatibility
  Object.defineProperty(machine, 'state', {
    get() { return machine.currentState; },
    enumerable: true,
    configurable: true,
  });

  return machine as unknown as IOMonad;
}
