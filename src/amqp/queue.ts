import AckBatch from '../ackBatch.js';
import Dispatch from 'topic-dispatch';
import info from '../info.js';
import log from '../log.js';
import { format } from 'util';

const dispatch = Dispatch();
const responses = Dispatch();

const logger = log('rabbot.queue');
const topLog = log('rabbot.topology');
const unhandledLog = log('rabbot.unhandled');

const noop = () => {};

export { dispatch, responses };

interface QueueOptions {
  name: string;
  uniqueName?: string;
  subscribe?: boolean;
  exclusive?: boolean;
  noAck?: boolean;
  noBatch?: boolean;
  noCacheKeys?: boolean;
  poison?: boolean;
  autoDelete?: boolean;
  contentType?: string;
  consumerTag?: string;
  limit?: number;
  queuelimit?: number;
  queueLimit?: number;
  deadletter?: string;
  deadLetter?: string;
  deadLetterRoutingKey?: string;
  [key: string]: unknown;
}

interface Serializer {
  serialize: (body: unknown) => Buffer;
  deserialize: (bytes: Buffer, encoding?: string) => unknown;
}

interface Serializers {
  [contentType: string]: Serializer;
}

interface Topology {
  connection: { name: string };
  replyQueue: { name: string | false };
  onUnhandled: (message: unknown) => void;
}

function aliasOptions(options: Record<string, unknown>, aliases: Record<string, string>, ...omit: string[]): Record<string, unknown> {
  return Object.keys(options).reduce<Record<string, unknown>>((result, key) => {
    const alias = aliases[key] ?? key;
    if (!omit.includes(key)) {
      result[alias] = options[key];
    }
    return result;
  }, {});
}

function define(channel: unknown, options: QueueOptions, _subscriber: unknown, connectionName: string): Promise<{ queue?: string; messageCount?: number }> {
  const ch = channel as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const valid = aliasOptions(options as Record<string, unknown>, {
    queuelimit: 'maxLength',
    queueLimit: 'maxLength',
    deadletter: 'deadLetterExchange',
    deadLetter: 'deadLetterExchange',
    deadLetterRoutingKey: 'deadLetterRoutingKey',
  }, 'subscribe', 'limit', 'noBatch', 'unique');
  topLog.info("Declaring queue '%s' on connection '%s' with the options: %s",
    options.uniqueName, connectionName, JSON.stringify(options));
  return ch.assertQueue(options.uniqueName!, valid).then((q) => {
    if (options.limit) {
      ch.prefetch(options.limit);
    }
    return q as { queue?: string; messageCount?: number };
  });
}

function finalize(channel: unknown, messages: AckBatch): void {
  messages.reset();
  messages.ignoreSignal();
  (channel as { release: () => void }).release();
}

function getContentType(body: unknown, options?: { contentType?: string }): string {
  if (options?.contentType) return options.contentType;
  if (typeof body === 'string') return 'text/plain';
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body) && !Array.isArray(body)) return 'application/json';
  return 'application/octet-stream';
}

function getCount(messages: AckBatch | undefined): number {
  return messages?.messages.length ?? 0;
}

interface MessageOps {
  ack: () => void;
  nack: () => void;
  reject: () => void;
}

function getNoBatchOps(channel: unknown, raw: { fields: { deliveryTag: number } }, messages: AckBatch, noAck: boolean): MessageOps {
  messages.receivedCount += 1;
  const ch = channel as Record<string, (msg: unknown, allUpTo: boolean, requeue?: boolean) => void>;

  if (noAck) {
    return {
      ack: noop,
      nack: () => logger.error("Tag %d on '%s' - '%s' cannot be nacked in noAck mode", raw.fields.deliveryTag, messages.name, messages.connectionName),
      reject: () => logger.error("Tag %d on '%s' - '%s' cannot be rejected in noAck mode", raw.fields.deliveryTag, messages.name, messages.connectionName),
    };
  }
  return {
    ack: () => {
      logger.debug("Acking tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName);
      ch.ack({ fields: { deliveryTag: raw.fields.deliveryTag } }, false);
    },
    nack: () => {
      logger.debug("Nacking tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName);
      ch.nack({ fields: { deliveryTag: raw.fields.deliveryTag } }, false);
    },
    reject: () => {
      logger.debug("Rejecting tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName);
      ch.nack({ fields: { deliveryTag: raw.fields.deliveryTag } }, false, false);
    },
  };
}

function getReply(channel: unknown, serializers: Serializers, raw: Record<string, unknown>, replyQueue: string | false, connectionName: string) {
  let position = 0;
  return (reply: unknown, options?: { replyType?: string; contentType?: string; timestamp?: number; headers?: Record<string, unknown>; more?: boolean }) => {
    const props = raw.properties as Record<string, unknown>;
    const fields = raw.fields as Record<string, unknown>;
    const defaultReplyType = `${raw.type}.reply`;
    const replyType = options?.replyType ?? defaultReplyType;
    const contentType = getContentType(reply, options);
    const serializer = serializers[contentType];
    if (!serializer) {
      const message = format('Failed to publish message with contentType %s - no serializer defined', contentType);
      logger.error(message);
      return Promise.reject(new Error(message));
    }
    const payload = serializer.serialize(reply);
    const replyTo = props.replyTo as string;
    (raw as { ack: () => void }).ack();
    if (replyTo) {
      const publishOptions: Record<string, unknown> = {
        type: replyType,
        contentType,
        contentEncoding: 'utf8',
        correlationId: props.messageId,
        timestamp: options?.timestamp ?? Date.now(),
        replyTo: replyQueue === false ? undefined : replyQueue,
        headers: options?.headers ?? {},
      };
      if (options?.more) {
        (publishOptions.headers as Record<string, unknown>).position = position++;
      } else {
        (publishOptions.headers as Record<string, unknown>).sequence_end = true;
      }
      logger.debug("Replying to message %s on '%s' - '%s' with type '%s'",
        props.messageId, replyTo, connectionName, publishOptions.type);
      const ch = channel as { publish: (...args: unknown[]) => Promise<void>; sendToQueue: (...args: unknown[]) => Promise<void> };
      const hdrs = props.headers as Record<string, unknown> | undefined;
      if (hdrs?.['direct-reply-to']) {
        return ch.publish('', replyTo, payload, publishOptions);
      } else {
        return ch.sendToQueue(replyTo, payload, publishOptions);
      }
    }
    return Promise.reject(new Error('Cannot reply to a message that has no return address'));
  };
}

function getResolutionOperations(channel: unknown, raw: Record<string, unknown>, messages: AckBatch, options: QueueOptions): MessageOps {
  const rawMsg = raw as { fields: { deliveryTag: number } };
  if (options.noBatch) {
    return getNoBatchOps(channel, rawMsg, messages, options.noAck ?? false);
  }
  if (options.noAck) {
    return getUntrackedOps(rawMsg, messages);
  }
  return getTrackedOps(rawMsg, messages);
}

function getTrackedOps(raw: { fields: { deliveryTag: number } }, messages: AckBatch): MessageOps {
  return messages.getMessageOps(raw.fields.deliveryTag);
}

function getUntrackedOps(raw: { fields: { deliveryTag: number } }, messages: AckBatch): MessageOps {
  messages.receivedCount += 1;
  return {
    ack: noop,
    nack: () => logger.error("Tag %d cannot be nacked in noAck mode", raw.fields.deliveryTag),
    reject: () => logger.error("Tag %d cannot be rejected in noAck mode", raw.fields.deliveryTag),
  };
}

function purgeADQueue(channel: unknown, connectionName: string, options: QueueOptions, messages: AckBatch): Promise<number> {
  const name = options.uniqueName ?? options.name;
  const ch = channel as { purgeQueue: (name: string) => Promise<{ messageCount: number }> };
  return new Promise((resolve, reject) => {
    const messageCount = messages.messages.length;
    if (messageCount > 0) {
      logger.info(`Purge waiting for ${messageCount} messages on '${options.name}' - '${connectionName}'`);
      messages.once('empty', () => {
        ch.purgeQueue(name).then((r) => resolve(r.messageCount), reject);
      });
    } else {
      ch.purgeQueue(name).then((r) => resolve(r.messageCount), reject);
    }
  });
}

function purgeQueue(channel: unknown, connectionName: string, options: QueueOptions, messages: AckBatch): Promise<number> {
  const name = options.uniqueName ?? options.name;
  const ch = channel as { purgeQueue: (name: string) => Promise<{ messageCount: number }>; cancel: (tag: string) => Promise<void> };
  return new Promise((resolve, reject) => {
    const onUnsubscribed = () => {
      const messageCount = messages.messages.length;
      if (messageCount > 0) {
        logger.info(`Purge waiting for ${messageCount} messages on '${options.name}' - '${connectionName}'`);
        messages.once('empty', () => {
          ch.purgeQueue(name).then((r) => resolve(r.messageCount), reject);
        });
      } else {
        ch.purgeQueue(name).then((r) => resolve(r.messageCount), reject);
      }
    };
    logger.info(`Stopping subscription on '${options.name}' on '${connectionName}' before purging`);
    unsubscribe(channel, options).then(onUnsubscribed, onUnsubscribed);
  });
}

function purge(channel: unknown, connectionName: string, options: QueueOptions, messages: AckBatch, definer: () => Promise<{ messageCount?: number }>): Promise<number> {
  logger.info(`Checking queue length on '${options.name}' on '${connectionName}' before purging`);
  return definer().then((q) => {
    if ((q.messageCount ?? 0) > 0) {
      const promise = options.autoDelete
        ? purgeADQueue(channel, connectionName, options, messages)
        : purgeQueue(channel, connectionName, options, messages);
      return promise.then((count) => {
        logger.info(`Purged ${count} messages from '${options.name}' on '${connectionName}'`);
        return count;
      });
    } else {
      logger.info(`'${options.name}' on '${connectionName}' was already empty`);
      return 0;
    }
  });
}

function release(channel: unknown, options: QueueOptions, messages: AckBatch, released?: boolean): Promise<void> {
  const onUnsubscribed = (): Promise<void> => {
    return new Promise((resolve) => {
      const messageCount = messages.messages.length;
      if (messageCount > 0 && !released) {
        logger.info(`Release waiting for ${messageCount} messages on '${options.name}'`);
        messages.once('empty', () => {
          finalize(channel, messages);
          resolve();
        });
      } else {
        finalize(channel, messages);
        resolve();
      }
    });
  };
  return unsubscribe(channel, options).then(onUnsubscribed, onUnsubscribed);
}

function resolveTags(channel: unknown, queue: string, connection: string) {
  const ch = channel as { ack: (msg: unknown, allUpTo: boolean) => void; nack: (msg: unknown, allUpTo: boolean, requeue?: boolean) => void };
  return (op: string, data?: { tag: number; inclusive: boolean }): Promise<void> => {
    switch (op) {
      case 'ack':
        logger.debug("Acking tag %d on '%s' - '%s'", data!.tag, queue, connection);
        ch.ack({ fields: { deliveryTag: data!.tag } }, data!.inclusive);
        return Promise.resolve();
      case 'nack':
        logger.debug("Nacking tag %d on '%s' - '%s'", data!.tag, queue, connection);
        ch.nack({ fields: { deliveryTag: data!.tag } }, data!.inclusive);
        return Promise.resolve();
      case 'reject':
        logger.debug("Rejecting tag %d on '%s' - '%s'", data!.tag, queue, connection);
        ch.nack({ fields: { deliveryTag: data!.tag } }, data!.inclusive, false);
        return Promise.resolve();
      default:
        return Promise.resolve();
    }
  };
}

function subscribe(
  channelName: string,
  channel: unknown,
  topology: Topology,
  serializers: Serializers,
  messages: AckBatch,
  options: QueueOptions,
  exclusive?: boolean
): Promise<unknown> {
  const shouldAck = !options.noAck;
  const shouldBatch = !options.noBatch;
  const shouldCacheKeys = !options.noCacheKeys;
  channelName = channelName || options.name;
  if (shouldAck && shouldBatch) {
    messages.listenForSignal();
  }
  options.consumerTag = info.createTag(channelName);
  const ch = channel as { item: { consumers: Map<string, unknown> }; consume: (queue: string, handler: (raw: unknown) => void, opts: unknown) => Promise<{ consumerTag: string }>; tag?: string };
  if (ch.item.consumers.size > 0) {
    logger.info('Duplicate subscription to queue %s ignored', channelName);
    return Promise.resolve(options.consumerTag);
  }
  logger.info("Starting subscription to queue '%s' on '%s'", channelName, topology.connection.name);

  return ch.consume(channelName, (rawMsg) => {
    const raw = rawMsg as Record<string, unknown>;
    if (!raw) {
      logger.warn("Queue '%s' was sent a consumer cancel notification", channelName);
      throw new Error('Broker cancelled the consumer remotely');
    }
    const props = raw.properties as Record<string, unknown>;
    const fields = raw.fields as Record<string, unknown>;
    const correlationId = props.correlationId as string;
    const ops = getResolutionOperations(channel, raw, messages, options);

    raw.ack = ops.ack.bind(ops);
    raw.reject = ops.reject.bind(ops);
    raw.nack = ops.nack.bind(ops);
    raw.reply = getReply(channel, serializers, raw, topology.replyQueue.name, topology.connection.name);
    raw.type = props.type || fields.routingKey;
    if (exclusive) {
      options.exclusive = true;
    }
    raw.queue = channelName;

    const parts = [options.name.replace(/[.]/g, '-')];
    if (raw.type) {
      parts.push(raw.type as string);
    }
    let topic = parts.join('.');

    const contentType = (props.contentType as string) || 'application/octet-stream';
    const serializer = serializers[contentType];

    const track = () => {
      if (shouldAck && shouldBatch) {
        messages.addMessage(ops as import('../ackBatch.js').TrackedMessage);
      }
    };

    if (!serializer) {
      if (options.poison) {
        raw.body = raw.content;
        raw.contentEncoding = props.contentEncoding;
        raw.quarantined = true;
        topic = `${topic}.quarantined`;
      } else {
        logger.error("Could not deserialize message id %s on queue '%s', connection '%s' - no serializer defined",
          props.messageId, channelName, topology.connection.name);
        track();
        ops.reject();
        return;
      }
    } else {
      try {
        raw.body = serializer.deserialize(raw.content as Buffer, props.contentEncoding as string);
      } catch {
        if (options.poison) {
          raw.quarantined = true;
          raw.body = raw.content;
          raw.contentEncoding = props.contentEncoding;
          topic = `${topic}.quarantined`;
        } else {
          track();
          ops.reject();
          return;
        }
      }
    }

    if (fields.routingKey === topology.replyQueue.name) {
      responses.emit(correlationId, raw, (hasHandlers) => {
        track();
        if (!hasHandlers) {
          unhandledLog.warn("Response message %s was not handled on '%s'", correlationId, topology.connection.name);
          topology.onUnhandled(raw);
        }
      });
    } else {
      dispatch.emit(topic, raw, (hasHandlers) => {
        track();
        if (!hasHandlers) {
          unhandledLog.warn("Message of %s on queue '%s', connection '%s' was not processed by any handlers",
            raw.type, channelName, topology.connection.name);
          topology.onUnhandled(raw);
        }
      });
    }
  }, options)
    .then((result) => {
      ch.tag = result.consumerTag;
      return result;
    })
    .catch((err) => {
      logger.error('Error on channel consume', options);
      throw err;
    });
}

function unsubscribe(channel: unknown, options: QueueOptions): Promise<void> {
  const ch = channel as { tag?: string; cancel: (tag: string) => Promise<void> };
  if (ch.tag) {
    logger.info("Unsubscribing from queue '%s' with tag %s", options.name, ch.tag);
    return ch.cancel(ch.tag).then(() => undefined);
  }
  return Promise.resolve();
}

export default function createQueue(options: QueueOptions, topology: Topology, serializers: Serializers) {
  const channelName = ['queue', options.uniqueName].join(':');
  const connection = topology.connection as unknown as { getChannel: (name: string, confirm: boolean, context: string) => Promise<unknown> };
  return connection.getChannel(channelName, false, `queue channel for ${options.name}`)
    .then((channel) => {
      const messages = new AckBatch(
        options.name,
        topology.connection.name,
        resolveTags(channel, options.name, topology.connection.name) as import('../ackBatch.js').Resolver
      );
      const subscriber = subscribe.bind(undefined, options.uniqueName!, channel, topology, serializers, messages, options);
      const definer = define.bind(undefined, channel, options, subscriber, topology.connection.name);
      return {
        channel,
        messages,
        define: definer,
        finalize: finalize.bind(undefined, channel, messages),
        getMessageCount: getCount.bind(undefined, messages),
        purge: purge.bind(undefined, channel, topology.connection.name, options, messages, definer),
        release: release.bind(undefined, channel, options, messages),
        subscribe: subscriber,
        unsubscribe: unsubscribe.bind(undefined, channel, options),
      };
    });
}
