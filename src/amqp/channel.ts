import createIOMonad from './iomonad.js';
import log from '../log.js';

const logger = log('rabbot.channel');

// Placeholder target for prototype proxying
class AmqpChannelTarget {
  [key: string]: unknown;
  ack(_message: unknown, _allUpTo?: boolean): void {}
  nack(_message: unknown, _allUpTo?: boolean, _requeue?: boolean): void {}
  reject(_message: unknown, _requeue?: boolean): void {}
  prefetch(_count: number): void {}
  publish(_exchange: string, _routingKey: string, _content: Buffer, _options?: unknown, _callback?: unknown): boolean { return false; }
  sendToQueue(_queue: string, _content: Buffer, _options?: unknown): boolean { return false; }
  assertQueue(_queue: string, _options?: unknown): Promise<unknown> { return Promise.resolve(); }
  assertExchange(_exchange: string, _type: string, _options?: unknown): Promise<unknown> { return Promise.resolve(); }
  checkExchange(_exchange: string): Promise<unknown> { return Promise.resolve(); }
  deleteExchange(_exchange: string, _options?: unknown): Promise<unknown> { return Promise.resolve(); }
  deleteQueue(_queue: string, _options?: unknown): Promise<unknown> { return Promise.resolve(); }
  bindQueue(_queue: string, _source: string, _pattern: string, _args?: unknown): Promise<unknown> { return Promise.resolve(); }
  unbindQueue(_queue: string, _source: string, _pattern: string, _args?: unknown): Promise<unknown> { return Promise.resolve(); }
  bindExchange(_destination: string, _source: string, _pattern: string, _args?: unknown): Promise<unknown> { return Promise.resolve(); }
  unbindExchange(_destination: string, _source: string, _pattern: string, _args?: unknown): Promise<unknown> { return Promise.resolve(); }
  purgeQueue(_queue: string): Promise<unknown> { return Promise.resolve(); }
  consume(_queue: string, _onMessage: unknown, _options?: unknown): Promise<unknown> { return Promise.resolve(); }
  cancel(_consumerTag: string): Promise<unknown> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }
  get consumers(): Map<string, unknown> { return new Map(); }
  tag?: string;
}

function closeChannel(name: string, channel: unknown): void {
  const ch = channel as { close?: () => Promise<void> };
  if (ch.close) {
    ch.close().catch((err) => {
      logger.debug('Error during close of channel `%s` - `%s`', name, err);
    });
  }
}

export default {
  create(connection: { createChannel: () => Promise<unknown>; createConfirmChannel: () => Promise<unknown> }, name: string, confirm: boolean) {
    const method = confirm ? 'createConfirmChannel' : 'createChannel';
    const factory = () => connection[method]();
    return createIOMonad(
      { name },
      'channel',
      factory,
      AmqpChannelTarget,
      closeChannel.bind(null, name)
    );
  },
};
