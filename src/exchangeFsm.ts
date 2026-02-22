import mfsm from 'mfsm';

type Machine = Record<string, unknown> & {
  currentState: string;
  emit: (event: string, data?: unknown) => unknown;
  handle: (event: string, data?: unknown) => void;
  next: (state: string) => Promise<void>;
  once: (event: string, fn: (data?: unknown) => void) => void;
  on: (event: string, fn: (data?: unknown) => void) => unknown;
  after: (state: string) => Promise<void>;
  name?: unknown;
};
import { format } from 'util';
import publishLog from './publishLog.js';
import log from './log.js';
import createExchangeAmqp from './amqp/exchange.js';

const exLog = log('rabbot.exchange');

interface ExchangeOptions {
  name: string;
  type: string;
  publishTimeout?: number;
  replyTimeout?: number;
  limit?: number;
  [key: string]: unknown;
}

interface Subscription {
  off: () => void;
}

interface Exchange {
  channel: {
    once: (event: string, fn: (data?: unknown) => void) => Subscription;
    on: (event: string, fn: (data?: unknown) => void) => Subscription;
  };
  define: () => Promise<unknown>;
  publish: (message: unknown) => Promise<unknown>;
  release: () => Promise<unknown>;
}

type ExchangeFn = (options: ExchangeOptions, topology: unknown, log: ReturnType<typeof publishLog>, serializers: unknown) => Promise<Exchange>;

function unhandle(handlers: Subscription[]): void {
  handlers.forEach((handle) => handle.off());
}

export default function Factory(
  options: ExchangeOptions,
  connection: Machine,
  topology: unknown,
  serializers: unknown,
  exchangeFn?: ExchangeFn
): Record<string, unknown> {
  const _exchangeFn = (exchangeFn || createExchangeAmqp) as ExchangeFn;
  const published = publishLog();

  let publisher: ((message: unknown) => Promise<unknown>) | undefined;
  const releasers: (() => Promise<unknown>)[] = [];
  const deferred: ((err?: unknown) => void)[] = [];

  function _define(exchange: Exchange, stateOnDefined: string): void {
    exchange.define()
      .then(
        () => machine.next(stateOnDefined),
        (err: unknown) => {
          (machine as unknown as Machine & { failedWith: unknown }).failedWith = err;
          machine.next('failed');
        }
      );
  }

  function _listen(): void {
    connection.on('unreachable', (err: unknown) => {
      const error = err || new Error('Could not establish a connection to any known nodes.');
      _onFailure(error);
      machine.next('unreachable');
    });
  }

  function _onAcquisition(transitionTo: string, exchange: Exchange): void {
    const handlers: Subscription[] = [];

    handlers.push(exchange.channel.once('released', () => {
      machine.handle('released', exchange);
    }));

    handlers.push(exchange.channel.once('closed', () => {
      machine.handle('closed', exchange);
    }));

    function cleanup(): void {
      unhandle(handlers);
      exchange.release()
        .then(() => machine.next('released'));
    }

    function onCleanupError(): void {
      const count = published.count();
      if (count > 0) {
        exLog.warn("%s exchange '%s', connection '%s' was released with %d messages unconfirmed",
          options.type,
          options.name,
          (connection as unknown as Machine & { name: string }).name,
          count);
      }
      cleanup();
    }

    const releaser = () =>
      published.onceEmptied()
        .then(cleanup, onCleanupError);

    publisher = (message: unknown) => exchange.publish(message);
    releasers.push(releaser);
    _define(exchange, transitionTo);
  }

  function _onClose(): void {
    exLog.info(`Rejecting ${published.count()} published messages`);
    published.reset();
  }

  function _onFailure(err: unknown): void {
    (machine as unknown as Machine & { failedWith: unknown }).failedWith = err;
    deferred.forEach((x) => x(err));
    deferred.length = 0;
    published.reset();
  }

  function _removeDeferred(reject: (err?: unknown) => void): void {
    const index = deferred.indexOf(reject);
    if (index >= 0) {
      deferred.splice(index, 1);
    }
  }

  function _release(closed?: boolean): Promise<unknown> {
    const release = releasers.shift();
    if (release) {
      return release();
    } else {
      return Promise.resolve();
    }
  }

  const machine = mfsm({
    init: {
      name: options.name,
      type: options.type,
      publishTimeout: options.publishTimeout || 0,
      replyTimeout: options.replyTimeout || 0,
      limit: options.limit || 100,
      failedWith: undefined as unknown,
      default: 'initializing',
    },
    api: {
      check(...args: unknown[]): unknown {
        const deferred = { resolve: () => {}, reject: (_err?: unknown) => {} };
        const promise = new Promise<void>((resolve, reject) => {
          deferred.resolve = resolve;
          deferred.reject = reject;
        });
        machine.handle('check', deferred);
        return promise;
      },
      reconnect(...args: unknown[]): unknown {
        if (/releas/.test(machine.currentState)) {
          machine.next('initializing');
        }
        return (machine as unknown as Machine & { check: () => Promise<void> }).check();
      },
      release(...args: unknown[]): unknown {
        exLog.debug('Release called on exchange %s - %s (%d messages pending)', options.name, (connection as unknown as Machine & { name: string }).name, published.count());
        return new Promise<void>((resolve) => {
          machine.once('released', () => resolve());
          machine.handle('release');
        });
      },
      publish(...args: unknown[]): unknown {
        const message = args[0];
        if (machine.currentState !== 'ready' && published.count() >= (machine as unknown as Machine & { limit: number }).limit) {
          exLog.warn("Exchange '%s' has reached the limit of %d messages waiting on a connection",
            options.name,
            (machine as unknown as Machine & { limit: number }).limit
          );
          return Promise.reject(new Error('Exchange has reached the limit of messages waiting on a connection'));
        }
        const msg = message as { timeout?: number; connectionPublishTimeout?: number };
        const publishTimeout = msg.timeout || options.publishTimeout || msg.connectionPublishTimeout || 0;
        return new Promise<void>((resolve, reject) => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          let timedOut = false;
          let failedSub: { off: () => void } | undefined;
          let closedSub: { off: () => void } | undefined;

          if (publishTimeout > 0) {
            timeout = setTimeout(() => {
              timedOut = true;
              onRejected(new Error('Publish took longer than configured timeout'));
            }, publishTimeout);
          }

          function onPublished(): void {
            resolve();
            _removeDeferred(reject);
            failedSub?.off();
            closedSub?.off();
          }

          function onRejected(err: unknown): void {
            reject(err as Error);
            _removeDeferred(reject);
            failedSub?.off();
            closedSub?.off();
          }

          const op = (err?: unknown) => {
            if (err) {
              onRejected(err);
            } else {
              if (timeout) {
                clearTimeout(timeout);
                timeout = undefined;
              }
              if (!timedOut) {
                publisher!(message)
                  .then(onPublished, onRejected);
              }
            }
          };

          failedSub = machine.on('failed', (err: unknown) => onRejected(err)) as unknown as { off: () => void };
          closedSub = machine.on('closed', (err: unknown) => onRejected(err)) as unknown as { off: () => void };
          deferred.push(reject);
          machine.handle('publish', op);
        });
      },
      retry(...args: unknown[]): unknown {
        return machine.next('initializing');
      },
    },
    states: {
      closed: {
        onEntry() {
          _onClose();
          machine.emit('closed');
        },
        check: { forward: 'initializing' },
        publish: { forward: 'initializing' },
      },
      failed: {
        onEntry() {
          _onFailure((machine as unknown as Machine & { failedWith: unknown }).failedWith);
          machine.emit('failed', (machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
        check(data?: unknown) {
          const deferred = data as { resolve: () => void; reject: (err: unknown) => void };
          deferred.reject((machine as unknown as Machine & { failedWith: unknown }).failedWith);
          machine.emit('failed', (machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
        release(data?: unknown) {
          _release(data as boolean)
            .then(() => machine.next('released'));
        },
        publish(data?: unknown) {
          const op = data as (err?: unknown) => void;
          op((machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
      },
      initializing: {
        onEntry() {
          _exchangeFn(options, topology, published, serializers)
            .then((exchange: Exchange) => machine.handle('acquired', exchange));
        },
        acquired(data?: unknown) {
          _onAcquisition('ready', data as Exchange);
        },
        check: { deferUntil: 'ready' },
        closed: { deferUntil: 'ready' },
        release: { deferUntil: 'ready' },
        released() {
          machine.next('initializing');
        },
        publish: { deferUntil: 'ready' },
      },
      ready: {
        onEntry() {
          machine.emit('defined');
        },
        check(data?: unknown) {
          const deferred = data as { resolve: () => void };
          deferred.resolve();
          machine.emit('defined');
        },
        release() {
          machine.once('released', () => {});  // ensure listener exists
          machine.next('releasing');
        },
        closed() {
          machine.next('closed');
        },
        released: { deferUntil: 'releasing' },
        publish(data?: unknown) {
          const op = data as (err?: unknown) => void;
          op();
        },
      },
      releasing: {
        onEntry() {
          _release()
            .then(() => machine.next('released'));
        },
        publish: { deferUntil: 'released' },
        release: { deferUntil: 'released' },
      },
      released: {
        onEntry() {
          machine.emit('released');
        },
        check() {
          // no-op - defer handled by caller
        },
        release() {
          machine.emit('released');
        },
        publish(data?: unknown) {
          const op = data as (err?: unknown) => void;
          exLog.warn("Publish called on exchange '%s' after connection was released intentionally.", options.name);
          op(new Error(format("Cannot publish to exchange '%s' after intentionally closing its connection", options.name)));
        },
      },
      unreachable: {
        onEntry() {
          machine.emit('failed', (machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
        check(data?: unknown) {
          const deferred = data as { reject: (err: unknown) => void };
          deferred.reject((machine as unknown as Machine & { failedWith: unknown }).failedWith);
          machine.emit('failed', (machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
        publish(data?: unknown) {
          const op = data as (err?: unknown) => void;
          op((machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
      },
    },
  });

  _listen();
  (connection as unknown as { addExchange: (m: unknown) => void }).addExchange(machine);
  (machine as Record<string, unknown>).published = published;
  return machine;
}
