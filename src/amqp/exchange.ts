import defer from '../defer.js';
import info from '../info.js';
import log from '../log.js';
import { format } from 'util';
import type { IOMonad } from './iomonad.js';

const exLog = log('rabbot.exchange');
const topLog = log('rabbot.topology');

const DIRECT_REPLY_TO = 'amq.rabbitmq.reply-to';
const DIRECT_REGEX = /^rabbit(mq)?$/i;

interface ExchangeOptions {
  name: string;
  type: string;
  alternate?: string;
  limit?: number;
  persistent?: boolean;
  publishTimeout?: number;
  noConfirm?: boolean;
  passive?: boolean;
  [key: string]: unknown;
}

interface Message {
  correlationId?: string;
  headers?: Record<string, unknown>;
  contentType?: string;
  body: unknown;
  type?: string;
  replyTo?: string;
  messageId?: string;
  id?: string;
  timestamp?: number;
  appId?: string;
  expiresAfter?: string;
  mandatory?: boolean;
  sequenceNo?: string | number;
  routingKey?: string;
  persistent?: boolean;
  timeout?: number;
  connectionPublishTimeout?: number;
}

interface Topology {
  replyQueue: { name: string | false };
  connection: { name: string };
}

interface Serializer {
  serialize: (body: unknown) => Buffer;
  deserialize: (bytes: Buffer, encoding?: string) => unknown;
}

interface PublishLog {
  add: (message: Message) => void;
  remove: (message: Message) => void;
}

function aliasOptions(options: Record<string, unknown>, aliases: Record<string, string>, ...omit: string[]): Record<string, unknown> {
  const keys = Object.keys(options);
  return keys.reduce<Record<string, unknown>>((result, key) => {
    const alias = aliases[key] || key;
    if (omit.indexOf(key) < 0) {
      result[alias] = options[key];
    }
    return result;
  }, {});
}

function define(channel: IOMonad, options: ExchangeOptions, connectionName: string): Promise<unknown> {
  const valid = aliasOptions(options as Record<string, unknown>, {
    alternate: 'alternateExchange'
  }, 'limit', 'persistent', 'publishTimeout');
  topLog.info("Declaring %s exchange '%s' on connection '%s' with the options: %s",
    options.type,
    options.name,
    connectionName,
    JSON.stringify(valid)
  );
  if (options.name === '') {
    return Promise.resolve(true);
  } else if (options.passive) {
    const ch = channel as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    return ch['checkExchange'](options.name);
  } else {
    const ch = channel as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    return ch['assertExchange'](options.name, options.type, valid);
  }
}

function getContentType(message: Message): string {
  if (message.contentType) {
    return message.contentType as string;
  } else if (typeof message.body === 'string') {
    return 'text/plain';
  } else if (typeof message.body === 'object' && !Buffer.isBuffer(message.body)) {
    return 'application/json';
  } else {
    return 'application/octet-stream';
  }
}

function publish(channel: IOMonad, options: ExchangeOptions, topology: Topology, log: PublishLog, serializers: Record<string, Serializer>, message: Message): Promise<unknown> {
  const channelName = options.name;
  const type = options.type;
  const baseHeaders: Record<string, unknown> = {
    CorrelationId: message.correlationId
  };
  message.headers = Object.assign(baseHeaders, message.headers);
  const contentType = getContentType(message);
  const serializer = serializers[contentType];
  if (!serializer) {
    const errMessage = format("Failed to publish message with contentType '%s' - no serializer defined", contentType);
    exLog.error(errMessage);
    return Promise.reject(new Error(errMessage));
  }
  const payload = serializer.serialize(message.body);
  const publishOptions: Record<string, unknown> = {
    type: message.type || '',
    contentType: contentType,
    contentEncoding: 'utf8',
    correlationId: message.correlationId || '',
    replyTo: message.replyTo || (topology.replyQueue.name || ''),
    messageId: message.messageId || message.id || '',
    timestamp: message.timestamp || Date.now(),
    appId: message.appId || info.id,
    headers: message.headers || {},
    expiration: message.expiresAfter || undefined,
    mandatory: message.mandatory || false
  };
  if (publishOptions.replyTo === DIRECT_REPLY_TO || DIRECT_REGEX.test(publishOptions.replyTo as string)) {
    (publishOptions.headers as Record<string, unknown>)['direct-reply-to'] = 'true';
  }
  if (!options.noConfirm && !message.sequenceNo) {
    log.add(message);
  }
  if (options.persistent || message.persistent) {
    publishOptions.persistent = true;
  }

  const effectiveKey = message.routingKey === '' ? '' : message.routingKey || (publishOptions.type as string);
  exLog.debug("Publishing message ( type: '%s' topic: '%s', sequence: '%s', correlation: '%s', replyTo: '%s' ) to %s exchange '%s' on connection '%s'",
    publishOptions.type,
    effectiveKey,
    message.sequenceNo,
    publishOptions.correlationId,
    JSON.stringify(publishOptions),
    type,
    channelName,
    topology.connection.name);

  function onRejected(err: unknown): never {
    log.remove(message);
    throw err;
  }

  function onConfirmed(sequence: unknown): unknown {
    log.remove(message);
    return sequence;
  }

  if (options.noConfirm) {
    const chPub = channel as unknown as Record<string, (...args: unknown[]) => unknown>;
    chPub['publish'](
      channelName,
      effectiveKey,
      payload,
      publishOptions
    );
    return Promise.resolve();
  } else {
    const deferred = defer<unknown>();
    const promise = deferred.promise;

    const chConf = channel as unknown as Record<string, (...args: unknown[]) => unknown>;
    chConf['publish'](
      channelName,
      effectiveKey,
      payload,
      publishOptions,
      function (err: unknown, i: unknown) {
        if (err) {
          deferred.reject(err);
        } else {
          deferred.resolve(i);
        }
      }
    );
    return promise.then(onConfirmed, onRejected);
  }
}

interface ExchangeAdapter {
  channel: IOMonad;
  define: () => Promise<unknown>;
  release: () => Promise<boolean>;
  publish: (message: Message) => Promise<unknown>;
}

export default function createExchange(options: ExchangeOptions, topology: Topology, publishLog: PublishLog, serializers: Record<string, Serializer>): Promise<ExchangeAdapter> {
  return (topology.connection as unknown as { getChannel: (name: string, confirm: boolean, context: string) => Promise<IOMonad> })
    .getChannel(options.name, !options.noConfirm, 'exchange channel for ' + options.name)
    .then(function (channel) {
      return {
        channel: channel,
        define: define.bind(undefined, channel, options, (topology.connection as { name: string }).name),
        release: function () {
          if (channel) {
            channel.release();
          }
          return Promise.resolve(true);
        },
        publish: publish.bind(undefined, channel, options, topology, publishLog, serializers)
      };
    });
}
