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
import defer from './defer.js';
import createConnection from './amqp/connection.js';
import createChannel from './amqp/channel.js';
import type { IOMonad } from './amqp/iomonad.js';

const logger = log('rabbot.connection');

/* events emitted:
  'closing' - close is initiated by user
  'closed' - initiated close has completed
  'connecting' - connection initiated
  'connected' - connection established
  'reconnected' - lost connection recovered
  'failed' - connection lost
  'unreachable' - no end points could be reached within threshold
  'return' - published message was returned by AMQP
*/

interface ConnectionOptions {
  name?: string;
  retryLimit?: number;
  failAfter?: number;
  [key: string]: unknown;
}

interface ChannelRequest {
  name: string;
  confirm: boolean;
  context: string;
  deferred: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
}

type ConnectionFn = (options: ConnectionOptions) => IOMonad;
type ChannelFn = typeof createChannel;

export default function Connection(options: ConnectionOptions, connectionFn?: ConnectionFn, channelFn?: ChannelFn): Record<string, unknown> {
  const _channelFn = channelFn || createChannel;
  const _connectionFn = connectionFn || createConnection;

  let connection: IOMonad;
  let queues: { release: () => Promise<unknown> }[] = [];
  let exchanges: { release: () => Promise<unknown> }[] = [];
  const channels: Record<string, IOMonad> = {};

  function _getChannel(name: string, confirm: boolean, context: string): Promise<IOMonad> {
    let channel = channels[name];
    if (!channel || /releas/.test(channel.state as string)) {
      return new Promise((resolve) => {
        channel = _channelFn.create(connection as unknown as { createChannel: () => Promise<unknown>; createConfirmChannel: () => Promise<unknown> }, name, confirm);
        channels[name] = channel;
        channel.once('acquired', () => {
          logger.debug("Acquired channel '%s' on '%s' successfully for '%s'", name, machine.name, context);
          resolve(channel);
        });
        channel.on('return', (raw: unknown) => {
          machine.emit('return', raw);
        });
      });
    } else {
      return Promise.resolve(channel);
    }
  }

  function _closer(): void {
    connection.release();
  }

  function _reconnect(): void {
    const keys = Object.keys(channels);
    const reacquisitions = keys.map((channelName) =>
      new Promise<IOMonad>((resolve) => {
        const channel = channels[channelName];
        channel.once('acquired', () => {
          resolve(channel);
        });
        channel.acquire().catch(() => {});
      })
    );

    Promise.all(reacquisitions)
      .then(
        () => {
          machine.emit('reconnected');
        },
        (err: unknown) => {
          logger.error("Could not complete reconnection of '%s' due to %s", machine.name, err);
          machine.next('failed');
          machine.handle('failed', err);
        }
      );
  }

  const machine = mfsm({
    init: {
      name: options.name || 'default',
      connected: false,
      consecutiveFailures: 0,
      connectionTimeout: undefined as ReturnType<typeof setTimeout> | undefined,
      failAfter: ((options.failAfter || 60) * 1000) as number,
      uri: undefined as string | undefined,
      default: 'initializing',
    },
    api: {
      addQueue(...args: unknown[]) {
        const queue = args[0] as { release: () => Promise<unknown> };
        queues.push(queue);
      },
      addExchange(...args: unknown[]) {
        const exchange = args[0] as { release: () => Promise<unknown> };
        exchanges.push(exchange);
      },
      clearConnectionTimeout() {
        const m = this as unknown as Machine & { connectionTimeout?: ReturnType<typeof setTimeout> };
        if (m.connectionTimeout) {
          clearTimeout(m.connectionTimeout);
          m.connectionTimeout = undefined;
        }
      },
      setConnectionTimeout() {
        const m = this as unknown as Machine & { connectionTimeout?: ReturnType<typeof setTimeout>; failAfter: number };
        if (!m.connectionTimeout) {
          m.connectionTimeout = setTimeout(() => {
            machine.next('unreachable');
          }, m.failAfter);
        }
      },
      getChannel(...args: unknown[]): unknown {
        const name = args[0] as string;
        const confirm = args[1] as boolean;
        const context = args[2] as string;
        const deferred = defer<unknown>();
        machine.handle('channel', { name, confirm, context, deferred });
        return deferred.promise;
      },
      close(...args: unknown[]): unknown {
        const reset = args[0] as boolean | undefined;
        logger.info("Close initiated on connection '%s'", machine.name);
        const deferred = defer<void>();
        machine.handle('close', deferred);
        return deferred.promise.then(() => {
          if (reset) {
            queues = [];
            exchanges = [];
          }
        });
      },
      connect(...args: unknown[]): unknown {
        (machine as unknown as Machine & { consecutiveFailures: number }).consecutiveFailures = 0;
        const deferred = defer<void>();
        machine.handle('connect', deferred);
        return deferred.promise;
      },
      lastError(...args: unknown[]): unknown {
        return (connection as unknown as { lastError: unknown }).lastError;
      },
      // Expose state as 'state' property for backward compatibility - removed getter, state accessible via currentState
    },
    states: {
      initializing: {
        onEntry() {
          options.name = machine.name as string;
          connection = _connectionFn(options);
          (machine as unknown as Machine & { setConnectionTimeout: () => void }).setConnectionTimeout();
          connection.on('acquiring', () => machine.handle('acquiring'));
          connection.on('acquired', () => machine.handle('acquired'));
          connection.on('failed', (err: unknown) => machine.handle('failed', err));
          connection.on('closed', (reason: unknown) => machine.handle('closed', reason));
          connection.on('released', () => machine.handle('released'));
        },
        acquiring() {
          machine.next('connecting');
        },
        acquired() {
          machine.next('connected');
        },
        channel: { deferUntil: 'connected' },
        close(data: unknown) {
          // defer until connected, then handle close
          machine.once('connected', () => machine.handle('close', data));
          machine.next('connecting');
        },
        connect(data: unknown) {
          machine.once('connected', () => machine.handle('connect', data));
          machine.next('connecting');
        },
        failed(data: unknown) {
          // defer until connecting, then replay failed there
          machine.once('connecting', () => machine.handle('failed', data));
          machine.next('connecting');
        },
        released() {
          // ignore
        },
      },
      connecting: {
        onEntry() {
          (machine as unknown as Machine & { setConnectionTimeout: () => void }).setConnectionTimeout();
          connection.acquire().catch(() => {});
          machine.emit('connecting');
        },
        acquired() {
          machine.next('connected');
        },
        channel: { deferUntil: 'connected' },
        close(data: unknown) {
          // defer until we know what happens (connected or failed)
          const subs: { off: () => void }[] = [];
          const handler = () => {
            subs.forEach(s => s.off());
            machine.handle('close', data);
          };
          subs.push(machine.on('connected', handler) as unknown as { off: () => void });
          subs.push(machine.on('failed', handler) as unknown as { off: () => void });
        },
        connect: { deferUntil: 'connected' },
        failed: { forward: 'failed' },
        released() {
          // ignore
        },
      },
      connected: {
        onEntry() {
          const m = this as unknown as Machine & { clearConnectionTimeout: () => void; connected: boolean; uri?: string; consecutiveFailures: number };
          m.clearConnectionTimeout();
          m.uri = (connection.item as { uri?: string })?.uri;
          m.consecutiveFailures = 0;
          if (m.connected) {
            _reconnect();
          }
          m.connected = true;
          machine.emit('connected', connection);
        },
        acquired: { deferUntil: 'connecting' },
        channel(data?: unknown) {
          const request = data as ChannelRequest;
          _getChannel(request.name, request.confirm, request.context)
            .then(request.deferred.resolve, request.deferred.reject);
        },
        close(data?: unknown) {
          const deferred = data as { resolve: () => void };
          machine.once('closed', () => deferred.resolve());
          machine.next('closing');
        },
        connect(data?: unknown) {
          const deferred = data as { resolve: () => void };
          deferred.resolve();
          machine.emit('already-connected', connection);
        },
        failed: { forward: 'failed' },
        closed() {
          machine.next('connecting');
        },
        released() {
          // ignore
        },
      },
      closed: {
        onEntry() {
          const m = this as unknown as Machine & { clearConnectionTimeout: () => void };
          m.clearConnectionTimeout();
          logger.info("Close on connection '%s' resolved", machine.name);
          machine.emit('closed', {});
        },
        acquiring() {
          machine.next('connecting');
        },
        channel() {
          logger.warn("Channel was requested on a connection that was closed by user - request deferred until reconnection");
          // Can't deferUntil here via declarative since we don't know when user reconnects
        },
        close(data?: unknown) {
          const deferred = data as { resolve: () => void };
          deferred.resolve();
          connection.release();
          machine.emit('closed');
        },
        connect(data: unknown) {
          machine.once('connected', () => machine.handle('connect', data));
          machine.next('connecting');
        },
        failed: { forward: 'failed' },
        released() {
          // ignore
        },
      },
      closing: {
        onEntry() {
          machine.emit('closing');
          const closeList = queues.concat(exchanges as unknown as typeof queues);
          if (closeList.length) {
            Promise
              .all(closeList.map((ch) => ch.release()))
              .then(() => _closer());
          } else {
            _closer();
          }
        },
        channel(data?: unknown) {
          const request = data as ChannelRequest;
          logger.warn("Channel was requested during user initiated connection close - request rejected");
          request.deferred.reject(new Error(
            format("Illegal request for channel '%s' during close of connection '%s' initiated by user",
              request.name,
              machine.name
            )
          ));
        },
        connect: { deferUntil: 'closed' },
        close: { deferUntil: 'closed' },
        closed() {
          machine.next('closed');
        },
        released() {
          machine.next('closed');
        },
      },
      failed: {
        onEntry() {
          const m = this as unknown as Machine & { setConnectionTimeout: () => void; consecutiveFailures: number };
          m.setConnectionTimeout();
          m.consecutiveFailures++;
          const tooManyFailures = m.consecutiveFailures >= (options.retryLimit as number || 3);
          if (tooManyFailures) {
            machine.next('unreachable');
          }
        },
        failed(err: unknown) {
          machine.emit('failed', err);
        },
        acquiring() {
          machine.next('connecting');
        },
        channel: { deferUntil: 'connected' },
        close(data?: unknown) {
          const deferred = data as { resolve: () => void };
          deferred.resolve();
          connection.release();
          machine.emit('closed');
        },
        connect(data: unknown) {
          machine.once('connected', () => machine.handle('connect', data));
          machine.next('connecting');
        },
        released() {
          // ignore - expected after error
        },
      },
      unreachable: {
        onEntry() {
          const m = this as unknown as Machine & { clearConnectionTimeout: () => void };
          m.clearConnectionTimeout();
          connection.release().then(() => {
            machine.emit('unreachable');
          });
        },
        close(data?: unknown) {
          const deferred = data as { resolve: () => void };
          deferred.resolve();
          machine.emit('closed');
        },
        connect() {
          const m = this as unknown as Machine & { consecutiveFailures: number };
          m.consecutiveFailures = 0;
          machine.next('connecting');
        },
      },
    },
  });

  return machine;
}
