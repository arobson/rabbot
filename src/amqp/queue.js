import AckBatch from '../ackBatch.js';
import { dispatchChannel, responseChannel } from '../dispatchChannels.js';
import info from '../info.js';
import createLog from '../log.js';
import { format } from 'node:util';

const log = createLog('rabbot.queue');
const topLog = createLog('rabbot.topology');
const unhandledLog = createLog('rabbot.unhandled');
const noOp = function () {};

/* log
  * `rabbot.amqp-queue`
    * `debug`
      * for all message operations - ack, nack, reply & reject
    * `info`
      * subscribing
      * unsubscribing
    * `warn`
      * no message handlers for message received
    * `error`
      * no serializer defined for outgoing message
      * no serializer defined for incoming message
      * message nacked/rejected when consumer is set to no-ack
  * `rabbot.topology`
    * `info`
      * queue declaration
*/

function aliasOptions (options, aliases, ...omit) {
  const keys = Object.keys(options);
  return keys.reduce((result, key) => {
    const alias = aliases[key] || key;
    if (omit.indexOf(key) < 0) {
      result[alias] = options[key];
    }
    return result;
  }, {});
}

function define (channel, options, subscriber, connectionName) {
  const valid = aliasOptions(options, {
    queuelimit: 'maxLength',
    queueLimit: 'maxLength',
    deadletter: 'deadLetterExchange',
    deadLetter: 'deadLetterExchange',
    deadLetterRoutingKey: 'deadLetterRoutingKey'
  }, 'subscribe', 'limit', 'noBatch', 'unique');
  topLog.info("Declaring queue '%s' on connection '%s' with the options: %s",
    options.uniqueName, connectionName, JSON.stringify(options));
  const assertion = options.passive
    ? channel.checkQueue(options.uniqueName)
    : channel.assertQueue(options.uniqueName, valid);
  return assertion
    .then(function (q) {
      if (options.limit) {
        channel.prefetch(options.limit);
      }
      return q;
    });
}

function finalize (channel, messages) {
  messages.reset();
  messages.ignoreSignal();
  channel.release();
  channel = undefined;
}

function getContentType (body, options) {
  if (options && options.contentType) {
    return options.contentType;
  } else if (typeof body === 'string') {
    return 'text/plain';
  } else if (typeof body === 'object' && !body.length) {
    return 'application/json';
  } else {
    return 'application/octet-stream';
  }
}

function getCount (messages) {
  if (messages) {
    return messages.messages.length;
  } else {
    return 0;
  }
}

function getNoBatchOps (channel, raw, messages, noAck) {
  messages.receivedCount += 1;
  // captured at receipt time - if the channel has reconnected by the time
  // this message's handler resolves, the delivery tag below is either
  // meaningless or, worse, coincidentally reused by an unrelated message
  // on the new channel (amqp delivery tags restart from 1 per channel),
  // so a stale generation means the broker has already requeued this
  // message and any resolution attempt here must be skipped (#47, #155)
  const generation = channel.generation;
  const isStale = () => channel.generation !== generation;

  let ack, nack, reject;
  if (noAck) {
    ack = noOp;
    nack = function () {
      log.error("Tag %d on '%s' - '%s' cannot be nacked in noAck mode - message will be lost!", raw.fields.deliveryTag, messages.name, messages.connectionName);
    };
    reject = function () {
      log.error("Tag %d on '%s' - '%s' cannot be rejected in noAck mode - message will be lost!", raw.fields.deliveryTag, messages.name, messages.connectionName);
    };
  } else {
    ack = function () {
      if (isStale()) {
        log.warn("Ignoring stale ack for tag %d on '%s' - '%s' (channel reconnected since this message was received)", raw.fields.deliveryTag, messages.name, messages.connectionName);
        return;
      }
      log.debug("Acking tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName);
      channel.ack({ fields: { deliveryTag: raw.fields.deliveryTag } }, false);
    };
    nack = function () {
      if (isStale()) {
        log.warn("Ignoring stale nack for tag %d on '%s' - '%s' (channel reconnected since this message was received)", raw.fields.deliveryTag, messages.name, messages.connectionName);
        return;
      }
      log.debug("Nacking tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName);
      channel.nack({ fields: { deliveryTag: raw.fields.deliveryTag } }, false);
    };
    reject = function () {
      if (isStale()) {
        log.warn("Ignoring stale reject for tag %d on '%s' - '%s' (channel reconnected since this message was received)", raw.fields.deliveryTag, messages.name, messages.connectionName);
        return;
      }
      log.debug("Rejecting tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName);
      channel.reject({ fields: { deliveryTag: raw.fields.deliveryTag } }, false, false);
    };
  }

  return {
    ack,
    nack,
    reject
  };
}

function getReply (channel, serializers, raw, replyQueue, connectionName) {
  let position = 0;
  return function (reply, options) {
    const defaultReplyType = raw.type + '.reply';
    const replyType = options ? (options.replyType || defaultReplyType) : defaultReplyType;
    const contentType = getContentType(reply, options);
    const serializer = serializers[contentType];
    if (!serializer) {
      const message = format('Failed to publish message with contentType %s - no serializer defined', contentType);
      log.error(message);
      return Promise.reject(new Error(message));
    }
    const payload = serializer.serialize(reply);

    const replyTo = raw.properties.replyTo;
    const isFinalReply = !(options && options.more);
    // #192: only ack the original message on the terminal reply. Acking
    // on every intermediate `more: true` reply meant a crash between
    // streamed replies lost the original message with no chance of
    // redelivery, even though more work on it was still outstanding.
    if (isFinalReply) {
      raw.ack();
    }
    if (replyTo) {
      const publishOptions = {
        type: replyType,
        contentType,
        contentEncoding: 'utf8',
        correlationId: raw.properties.messageId,
        timestamp: options && options.timestamp ? options.timestamp : Date.now(),
        replyTo: replyQueue === false ? undefined : replyQueue,
        headers: options && options.headers ? options.headers : {}
      };
      if (!isFinalReply) {
        publishOptions.headers.position = (position++);
      } else {
        publishOptions.headers.sequence_end = true; // jshint ignore:line
      }
      log.debug("Replying to message %s on '%s' - '%s' with type '%s'",
        raw.properties.messageId,
        replyTo,
        connectionName,
        publishOptions.type);
      if (raw.properties.headers && raw.properties.headers['direct-reply-to']) {
        return channel.publish(
          '',
          replyTo,
          payload,
          publishOptions
        );
      } else {
        return channel.sendToQueue(replyTo, payload, publishOptions);
      }
    } else {
      return Promise.reject(new Error('Cannot reply to a message that has no return address'));
    }
  };
}

function getResolutionOperations (channel, raw, messages, options) {
  if (options.noBatch) {
    return getNoBatchOps(channel, raw, messages, options.noAck);
  }

  if (options.noAck || options.noBatch) {
    return getUntrackedOps(channel, raw, messages);
  }

  return getTrackedOps(raw, messages);
}

function getTrackedOps (raw, messages) {
  return messages.getMessageOps(raw.fields.deliveryTag);
}

function getUntrackedOps (channel, raw, messages) {
  messages.receivedCount += 1;
  return {
    ack: noOp,
    nack: function () {
      log.error("Tag %d on '%s' - '%s' cannot be nacked in noAck mode - message will be lost!", raw.fields.deliveryTag, messages.name, messages.connectionName);
    },
    reject: function () {
      log.error("Tag %d on '%s' - '%s' cannot be rejected in noAck mode - message will be lost!", raw.fields.deliveryTag, messages.name, messages.connectionName);
    }
  };
}

// purging an auto-delete queue means unsubscribing is not
// an option as it will cause the queue, binding and possibly
// upstream auto-delete exchanges to be deleted as well
function purgeADQueue (channel, connectionName, options, messages) {
  const name = options.uniqueName || options.name;
  return new Promise(function (resolve, reject) {
    const messageCount = messages.messages.length;
    if (messageCount > 0) {
      log.info(`Purge operation for queue '${options.name}' on '${connectionName}' is waiting for resolution on ${messageCount} messages`);
      messages.once('empty', function () {
        channel.purgeQueue(name)
          .then(
            result => resolve(result.messageCount),
            reject
          );
      });
    } else {
      channel.purgeQueue(name)
        .then(
          result => resolve(result.messageCount),
          reject
        );
    }
  });
}

// queues not marked auto-delete should be unsubscribed from
// in order to stop incoming messages while the purge is
// taking place and avoid arrival of additional new messages
function purgeQueue (channel, connectionName, options, messages) {
  const name = options.uniqueName || options.name;
  return new Promise(function (resolve, reject) {
    function onUnsubscribed () {
      const messageCount = messages.messages.length;
      if (messageCount > 0) {
        log.info(`Purge operation for queue '${options.name}' on '${connectionName}' is waiting for resolution on ${messageCount} messages`);
        messages.once('empty', function () {
          channel.purgeQueue(name)
            .then(
              result => resolve(result.messageCount),
              reject
            );
        });
      } else {
        channel.purgeQueue(name)
          .then(
            result => resolve(result.messageCount),
            reject
          );
      }
    }
    log.info(`Stopping subscription on '${options.name}' on '${connectionName}' before purging`);
    unsubscribe(channel, options)
      .then(onUnsubscribed, onUnsubscribed);
  });
}

function purge (channel, connectionName, options, messages, definer) {
  log.info(`Checking queue length on '${options.name}' on '${connectionName}' before purging`);
  return definer()
    .then(
      q => {
        if (q.messageCount > 0) {
          const promise = options.autoDelete
            ? purgeADQueue(channel, connectionName, options, messages)
            : purgeQueue(channel, connectionName, options, messages);
          return promise
            .then(
              count => {
                log.info(`Purged ${count} messages from '${options.name}' on '${connectionName}'`);
                return count;
              }
            );
        } else {
          log.info(`'${options.name}' on '${connectionName}' was already empty when purge was called`);
          return Promise.resolve(0);
        }
      },
      Promise.reject
    );
}

function release (channel, options, messages, released) {
  function onUnsubscribed () {
    return new Promise(function (resolve) {
      const messageCount = messages.messages.length;
      if (messageCount > 0 && !released) {
        log.info(`Release operation for queue '${options.name}' is waiting for resolution on ${messageCount} messages`);
        messages.once('empty', function () {
          finalize(channel, messages);
          resolve();
        });
      } else {
        finalize(channel, messages);
        resolve();
      }
    });
  }
  return unsubscribe(channel, options)
    .then(onUnsubscribed, onUnsubscribed);
}

function resolveTags (channel, queue, connection) {
  return function (op, data) {
    switch (op) {
      case 'ack':
        log.debug("Acking tag %d on '%s' - '%s'", data.tag, queue, connection);
        return channel.ack({ fields: { deliveryTag: data.tag } }, data.inclusive);
      case 'nack':
        log.debug("Nacking tag %d on '%s' - '%s'", data.tag, queue, connection);
        return channel.nack({ fields: { deliveryTag: data.tag } }, data.inclusive);
      case 'reject':
        log.debug("Rejecting tag %d on '%s' - '%s'", data.tag, queue, connection);
        return channel.nack({ fields: { deliveryTag: data.tag } }, data.inclusive, false);
      default:
        return Promise.resolve(true);
    }
  };
}

function subscribe (channelName, channel, topology, serializers, messages, options, exclusive) {
  const shouldAck = !options.noAck;
  const shouldBatch = !options.noBatch;
  // this is done to support rabbit-assigned queue names
  channelName = channelName || options.name;
  if (shouldAck && shouldBatch) {
    messages.listenForSignal();
  }

  options.consumerTag = info.createTag(channelName);
  // amqplib 2.x's Channel#consumers is a Map (was a plain object pre-2.0)
  if (channel.item.consumers.size > 0) {
    log.info('Duplicate subscription to queue %s ignored', channelName);
    return Promise.resolve(options.consumerTag);
  }
  log.info("Starting subscription to queue '%s' on '%s'", channelName, topology.connection.name);
  return channel.consume(channelName, function (raw) {
    if (!raw) {
      // this happens when the consumer has been cancelled
      log.warn("Queue '%s' was sent a consumer cancel notification");
      throw new Error('Broker cancelled the consumer remotely');
    }
    const correlationId = raw.properties.correlationId;
    const ops = getResolutionOperations(channel, raw, messages, options);

    raw.ack = ops.ack.bind(ops);
    raw.reject = ops.reject.bind(ops);
    raw.nack = ops.nack.bind(ops);
    raw.reply = getReply(channel, serializers, raw, topology.replyQueue.name, topology.connection.name);
    raw.type = raw.properties.type || raw.fields.routingKey;
    if (exclusive) {
      options.exclusive = true;
    }
    raw.queue = channelName;
    const parts = [options.name.replace(/[.]/g, '-')];
    if (raw.type) {
      parts.push(raw.type);
    }
    let topic = parts.join('.');
    const contentType = raw.properties.contentType || 'application/octet-stream';
    const serializer = serializers[contentType];
    const track = () => {
      if (shouldAck && shouldBatch) {
        messages.addMessage(ops);
      }
    };
    if (!serializer) {
      if (options.poison) {
        raw.body = raw.content;
        raw.contentEncoding = raw.properties.contentEncoding;
        raw.quarantined = true;
        topic = `${topic}.quarantined`;
      } else {
        log.error("Could not deserialize message id %s on queue '%s', connection '%s' - no serializer defined",
          raw.properties.messageId, channelName, topology.connection.name);
        track();
        ops.reject();
        return;
      }
    } else {
      try {
        raw.body = serializer.deserialize(raw.content, raw.properties.contentEncoding);
      } catch (err) {
        if (options.poison) {
          raw.quarantined = true;
          raw.body = raw.content;
          raw.contentEncoding = raw.properties.contentEncoding;
          topic = `${topic}.quarantined`;
        } else {
          track();
          ops.reject();
          return;
        }
      }
    }

    const onPublish = (activated) => {
      track();

      if (!activated) {
        unhandledLog.warn("Message of %s on queue '%s', connection '%s' was not processed by any registered handlers",
          raw.type,
          channelName,
          topology.connection.name
        );
        topology.onUnhandled(raw);
      }
    };

    if (raw.fields.routingKey === topology.replyQueue.name) {
      responseChannel.emit(correlationId, raw, onPublish);
    } else {
      dispatchChannel.emit(topic, raw, onPublish);
    }
  }, options)
    .then(function (result) {
      channel.tag = result.consumerTag;
      return result;
    }, function (err) {
      log.error('Error on channel consume', options);
      throw err;
    });
}

function unsubscribe (channel, options) {
  if (channel.tag) {
    log.info("Unsubscribing from queue '%s' with tag %s", options.name, channel.tag);
    return channel.cancel(channel.tag);
  } else {
    return Promise.resolve();
  }
}

export default function (options, topology, serializers) {
  const channelName = ['queue', options.uniqueName].join(':');
  return topology.connection.getChannel(channelName, false, 'queue channel for ' + options.name)
    .then(function (channel) {
      const messages = new AckBatch(
        options.name,
        topology.connection.name,
        resolveTags(channel, options.name, topology.connection.name),
        () => channel.generation
      );
      // any message tracked (or pending being tracked) against a prior
      // channel generation is already meaningless to the broker - it was
      // requeued the moment the old channel dropped, and will arrive
      // again as a fresh delivery once the consumer resubscribes, so
      // discard rather than let stale tags accumulate here (#47, #155)
      channel.on('acquired', () => messages.reset());
      const subscriber = subscribe.bind(undefined, options.uniqueName, channel, topology, serializers, messages, options);
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
        unsubscribe: unsubscribe.bind(undefined, channel, options, messages)
      };
    });
}
