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
import log from './log.js';
import createQueueAmqp from './amqp/queue.js';

const logger = log('rabbot.queue');

interface QueueOptions {
  name: string;
  uniqueName?: string;
  subscribe?: boolean;
  exclusive?: boolean;
  noAck?: boolean;
  [key: string]: unknown;
}

interface Subscription {
  off: () => void;
}

interface QueueAmqp {
  channel: {
    on: (event: string, fn: (data?: unknown) => void) => Subscription;
    once: (event: string, fn: (data?: unknown) => void) => Subscription;
    tag?: string;
  };
  messages: {
    changeName: (name: string) => void;
  };
  define: () => Promise<{ queue?: string }>;
  subscribe: (exclusive: boolean) => Promise<unknown>;
  unsubscribe: () => Promise<unknown>;
  purge: () => Promise<number>;
  release: () => Promise<unknown>;
  getMessageCount: () => number;
}

type QueueFn = (options: QueueOptions, topology: unknown, serializers: unknown) => Promise<QueueAmqp>;

function unhandle(handlers: Subscription[]): void {
  handlers.forEach((handle) => handle.off());
}

export default function Factory(
  options: QueueOptions,
  connection: Machine,
  topology: { renameQueue: (name: string) => void },
  serializers: unknown,
  queueFn?: QueueFn
): Record<string, unknown> {
  const _queueFn = (queueFn || createQueueAmqp) as QueueFn;

  const unsubscribers: (() => Promise<unknown>)[] = [];
  const releasers: ((closed?: boolean) => void)[] = [];

  function _define(queue: QueueAmqp): void {
    queue.define()
      .then(
        (defined) => {
          if (!options.name) {
            const newName = defined.queue || '';
            options.name = newName;
            machine.name = newName;
            queue.messages.changeName(newName);
            topology.renameQueue(newName);
          }
          machine.next('ready');
        },
        (err: unknown) => {
          (machine as unknown as Machine & { failedWith: unknown }).failedWith = err;
          machine.next('failed');
        }
      );
  }

  function _listen(queue: QueueAmqp): void {
    const handlers: Subscription[] = [];

    const unsubscriber = () => queue.unsubscribe();

    const purger = () =>
      queue.purge()
        .then((messageCount: number) => {
          logger.info(`Purged ${messageCount} queue ${options.name} - ${(connection as unknown as Machine & { name: string }).name}`);
          machine.handle('purged', messageCount);
        })
        .catch((err: unknown) => {
          machine.emit('purgeFailed', err);
        });

    const subscriber = (exclusive: boolean) =>
      queue.subscribe(!!exclusive)
        .then(() => {
          logger.info('Subscription to (%s) queue %s - %s started with consumer tag %s',
            options.noAck ? 'untracked' : 'tracked',
            options.name,
            (connection as unknown as Machine & { name: string }).name,
            queue.channel.tag);
          unsubscribers.push(unsubscriber);
          machine.handle('subscribed');
        })
        .catch((err: unknown) => {
          machine.emit('subscribeFailed', err);
        });

    const releaser = (closed?: boolean) => {
      unhandle(handlers);
      if (queue && queue.getMessageCount() > 0) {
        logger.warn('!!! Queue %s - %s was released with %d pending messages !!!',
          options.name, (connection as unknown as Machine & { name: string }).name, queue.getMessageCount());
      } else if (queue) {
        logger.info('Released queue %s - %s', options.name, (connection as unknown as Machine & { name: string }).name);
      }

      if (!closed) {
        queue.release()
          .then(() => machine.handle('released'));
      }
    };

    (machine as unknown as Machine & { subscriber: (exclusive: boolean) => Promise<unknown> }).subscriber = subscriber;
    releasers.push(releaser);
    (machine as unknown as Machine & { purger: () => Promise<unknown> }).purger = purger;

    handlers.push(queue.channel.on('acquired', () => _define(queue)));
    handlers.push(queue.channel.on('released', () => machine.handle('released', queue)));
    handlers.push(queue.channel.on('closed', () => machine.handle('closed', queue)));
    handlers.push(connection.on('unreachable', (_err?: unknown) => {
      machine.handle('unreachable', queue);
    }) as unknown as { off: () => void });

    if (options.subscribe) {
      machine.handle('subscribe');
    }
  }

  function _release(closed?: boolean): void {
    const release = releasers.shift();
    if (release) {
      release(closed);
    }
  }

  const machine = mfsm({
    init: {
      name: options.name,
      uniqueName: options.uniqueName,
      subscribed: false,
      subscriber: undefined as ((exclusive: boolean) => Promise<unknown>) | undefined,
      purger: undefined as (() => Promise<unknown>) | undefined,
      failedWith: undefined as unknown,
      default: 'initializing',
    },
    api: {
      check(...args: unknown[]): unknown {
        const d = { resolve: () => {}, reject: (_err?: unknown) => {} };
        const promise = new Promise<void>((resolve, reject) => {
          d.resolve = resolve;
          d.reject = reject as (err?: unknown) => void;
        });
        machine.handle('check', d);
        return promise;
      },
      purge(...args: unknown[]): unknown {
        return new Promise<number>((resolve, reject) => {
          const handlers: { off: () => void }[] = [];
          function cleanResolve(result: unknown) {
            unhandle(handlers);
            resolve(result as number);
          }
          function cleanReject(err: unknown) {
            unhandle(handlers);
            machine.next('failed');
            reject(err as Error);
          }
          if (options.subscribe) {
            // When queue is auto-subscribed, wait for resubscription to complete
            // so callers can rely on the queue being back in 'subscribed' state.
            // Register 'subscribed' listener from within 'purged' to avoid races.
            handlers.push(machine.on('purged', (result: unknown) => {
              const count = result as number;
              handlers.push(machine.on('subscribed', () => cleanResolve(count)) as unknown as { off: () => void });
              handlers.push(machine.on('subscribeFailed', () => cleanResolve(count)) as unknown as { off: () => void });
            }) as unknown as { off: () => void });
          } else {
            handlers.push(machine.on('purged', cleanResolve) as unknown as { off: () => void });
          }
          handlers.push(machine.on('purgeFailed', cleanReject) as unknown as { off: () => void });
          handlers.push(machine.on('failed', cleanReject) as unknown as { off: () => void });
          machine.handle('purge');
        });
      },
      reconnect(...args: unknown[]): unknown {
        if (/releas/.test(machine.currentState)) {
          machine.next('initializing');
        }
        return (machine as unknown as Machine & { check: () => Promise<void> }).check();
      },
      release(...args: unknown[]): unknown {
        return new Promise<void>((resolve, reject) => {
          const handlers: { off: () => void }[] = [];
          function cleanResolve() {
            unhandle(handlers);
            resolve();
          }
          function cleanReject(err: unknown) {
            unhandle(handlers);
            reject(err as Error);
          }
          handlers.push(machine.on('released', cleanResolve) as unknown as { off: () => void });
          handlers.push(machine.on('failed', cleanReject) as unknown as { off: () => void });
          handlers.push(machine.on('unreachable', cleanReject) as unknown as { off: () => void });
          handlers.push(machine.on('noqueue', cleanResolve) as unknown as { off: () => void });
          machine.handle('release');
        });
      },
      retry(...args: unknown[]): unknown {
        return machine.next('initializing');
      },
      subscribe(...args: unknown[]): unknown {
        const exclusive = args[0] as boolean | undefined;
        options.subscribe = true;
        options.exclusive = exclusive;
        return new Promise<void>((resolve, reject) => {
          const handlers: { off: () => void }[] = [];
          function cleanResolve() {
            unhandle(handlers);
            resolve();
          }
          function cleanReject(err: unknown) {
            unhandle(handlers);
            machine.next('failed');
            reject(err as Error);
          }
          handlers.push(machine.on('subscribed', cleanResolve) as unknown as { off: () => void });
          handlers.push(machine.on('subscribeFailed', cleanReject) as unknown as { off: () => void });
          handlers.push(machine.on('failed', cleanReject) as unknown as { off: () => void });
          machine.handle('subscribe');
        });
      },
      unsubscribe(...args: unknown[]): unknown {
        options.subscribe = false;
        const unsubscriber = unsubscribers.shift();
        if (unsubscriber) {
          return unsubscriber();
        } else {
          return Promise.reject(new Error('No active subscription presently exists on the queue'));
        }
      },
    },
    states: {
      closed: {
        onEntry() {
          (machine as unknown as Machine & { subscribed: boolean }).subscribed = false;
          _release(true);
          machine.emit('closed');
        },
        check: { forward: 'initializing' },
        purge: { deferUntil: 'ready' },
        subscribe: { deferUntil: 'ready' },
      },
      failed: {
        onEntry() {
          (machine as unknown as Machine & { subscribed: boolean }).subscribed = false;
          machine.emit('failed', (machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
        check(data?: unknown) {
          const deferred = data as { reject: (err: unknown) => void } | undefined;
          if (deferred) {
            deferred.reject((machine as unknown as Machine & { failedWith: unknown }).failedWith);
          }
          machine.emit('failed', (machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
        release(data?: unknown) {
          const queue = data as QueueAmqp | undefined;
          if (queue) {
            queue.release()
              .then(() => machine.handle('released', queue));
          }
        },
        released() {
          machine.next('released');
        },
        purge() {
          machine.emit('purgeFailed', (machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
        subscribe() {
          machine.emit('subscribeFailed', (machine as unknown as Machine & { failedWith: unknown }).failedWith);
        },
      },
      initializing: {
        onEntry() {
          _queueFn(options, topology, serializers)
            .then(
              (queue) => {
                (machine as unknown as Machine & { lastQueue: QueueAmqp }).lastQueue = queue;
                machine.handle('acquired', queue);
              },
              (err: unknown) => {
                (machine as unknown as Machine & { failedWith: unknown }).failedWith = err;
                machine.next('failed');
              }
            );
        },
        acquired(data?: unknown) {
          const queue = data as QueueAmqp;
          (machine as unknown as Machine & { receivedMessages: QueueAmqp['messages'] }).receivedMessages = queue.messages;
          _define(queue);
          _listen(queue);
        },
        check: { deferUntil: 'ready' },
        release: { deferUntil: 'ready' },
        closed: { deferUntil: 'ready' },
        purge: { deferUntil: 'ready' },
        subscribe: { deferUntil: 'ready' },
      },
      ready: {
        onEntry() {
          machine.emit('defined');
        },
        check(data?: unknown) {
          const deferred = data as { resolve: () => void };
          deferred.resolve();
        },
        closed() {
          machine.next('closed');
        },
        purge() {
          const purger = (machine as unknown as Machine & { purger?: () => Promise<unknown> }).purger;
          if (purger) {
            machine.next('purging');
            purger();
          }
        },
        release() {
          machine.next('releasing');
          machine.handle('release');
        },
        released() {
          _release(true);
          machine.next('initializing');
        },
        subscribe() {
          const subscriber = (machine as unknown as Machine & { subscriber?: (exclusive: boolean) => Promise<unknown> }).subscriber;
          if (subscriber) {
            machine.next('subscribing');
            subscriber(!!options.exclusive);
          }
        },
      },
      purging: {
        closed() {
          machine.next('closed');
        },
        purged(data?: unknown) {
          machine.next('purged', data as string);
          machine.handle('purged', data);
        },
        release() {
          machine.next('releasing');
          machine.handle('release');
        },
        released() {
          _release(true);
          machine.next('initializing');
        },
        subscribe: { deferUntil: 'subscribed' },
      },
      purged: {
        check(data?: unknown) {
          const deferred = data as { resolve: () => void };
          deferred.resolve();
        },
        closed() {
          machine.next('closed');
        },
        release() {
          machine.next('releasing');
          machine.handle('release');
        },
        released() {
          _release(true);
          machine.next('initializing');
        },
        purged(data?: unknown) {
          const result = data;
          machine.emit('purged', result);
          if (options.subscribe && (machine as unknown as Machine & { subscriber?: unknown }).subscriber) {
            (machine as unknown as Machine & { subscribe: (exclusive?: boolean) => Promise<void> }).subscribe()
              .catch(() => {});
          } else {
            machine.next('ready');
          }
        },
        subscribe() {
          machine.next('ready');
          machine.handle('subscribe');
        },
      },
      releasing: {
        release() {
          _release(false);
        },
        released() {
          machine.next('released');
        },
      },
      released: {
        onEntry() {
          (machine as unknown as Machine & { subscribed: boolean }).subscribed = false;
          machine.emit('released');
        },
        check(data?: unknown) {
          const deferred = data as { reject: (err: Error) => void };
          deferred.reject(new Error(format("Cannot establish queue '%s' after intentionally closing its connection", options.name)));
        },
        purge() {
          machine.emit('purgeFailed', new Error(format("Cannot purge to queue '%s' after intentionally closing its connection", options.name)));
        },
        release() {
          machine.emit('released');
        },
        subscribe() {
          machine.emit('subscribeFailed', new Error(format("Cannot subscribe to queue '%s' after intentionally closing its connection", options.name)));
        },
      },
      subscribing: {
        closed() {
          machine.next('closed');
        },
        purge: { deferUntil: 'ready' },
        release() {
          machine.next('releasing');
          machine.handle('release');
        },
        released() {
          _release(true);
          machine.next('initializing');
        },
        subscribed() {
          machine.next('subscribed');
        },
      },
      subscribed: {
        check(data?: unknown) {
          const deferred = data as { resolve: () => void };
          deferred.resolve();
        },
        closed() {
          machine.next('closed');
        },
        purge() {
          machine.next('ready');
          machine.handle('purge');
        },
        release() {
          machine.next('releasing');
          machine.handle('release');
        },
        released() {
          _release(true);
          machine.next('initializing');
        },
        subscribed() {
          (machine as unknown as Machine & { subscribed: boolean }).subscribed = true;
          machine.emit('subscribed', {});
        },
      },
      unreachable: {
        check(data?: unknown) {
          const deferred = data as { reject: (err: Error) => void };
          deferred.reject(new Error(format("Cannot establish queue '%s' when no nodes can be reached", options.name)));
        },
        purge() {
          machine.emit('purgeFailed', new Error(format("Cannot purge queue '%s' when no nodes can be reached", options.name)));
        },
        subscribe() {
          machine.emit('subscribeFailed', new Error(format("Cannot subscribe to queue '%s' when no nodes can be reached", options.name)));
        },
      },
    },
  });

  Object.defineProperty(machine, 'state', {
    get() { return machine.currentState; },
    enumerable: true,
    configurable: true,
  });

  (connection as unknown as { addQueue: (m: unknown) => void }).addQueue(machine);
  return machine;
}
