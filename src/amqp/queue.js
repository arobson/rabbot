const AckBatch = require('../ackBatch.js')
const info = require('../info')
const log = require('../log')('rabbot.queue')
const topLog = require('../log')('rabbot.topology')
const unhandledLog = require('../log')('rabbot.unhandled')
const noOp = function () {}
const { received, replies, signal } = require('../dispatch')

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
  const keys = Object.keys(options)
  return keys.reduce((result, key) => {
    const alias = aliases[key] || key
    if (omit.indexOf(key) < 0) {
      result[alias] = options[key]
    }
    return result
  }, {})
}

function define (channel, options, subscriber, connectionName) {
  const valid = aliasOptions(options, {
    queuelimit: 'maxLength',
    queueLimit: 'maxLength',
    deadletter: 'deadLetterExchange',
    deadLetter: 'deadLetterExchange',
    deadLetterRoutingKey: 'deadLetterRoutingKey'
  }, 'subscribe', 'limit', 'noBatch', 'unique')
  topLog.info(
    `Declaring queue '${options.uniqueName}' on connection '${connectionName}' with the options: ${JSON.stringify(options)}`
  )
  return channel.assertQueue(options.uniqueName, valid)
    .then(function (q) {
      if (options.limit) {
        channel.prefetch(options.limit)
      }
      return q
    })
}

function finalize (channel, messages) {
  messages.reset()
  messages.ignoreSignal()
  channel.release()
  channel = undefined
}

function getContentType (body, options) {
  if (options && options.contentType) {
    return options.contentType
  } else if (typeof body === 'string') {
    return 'text/plain'
  } else if (typeof body === 'object' && !body.length) {
    return 'application/json'
  } else {
    return 'application/octet-stream'
  }
}

function getCount (messages) {
  if (messages) {
    return messages.messages.length
  } else {
    return 0
  }
}

function getNoBatchOps (channel, raw, messages, noAck) {
  messages.receivedCount += 1

  let ack, nack, reject
  if (noAck) {
    ack = noOp
    nack = function () {
      log.error(
        `Tag ${raw.fields.deliveryTag} on '${messages.name}' - '${messages.connectionName}' cannot be nacked in noAck mode - message will be lost!`
      )
    }
    reject = function () {
      log.error(
        `Tag ${raw.fields.deliveryTag} on '${messages.name}' - '${messages.connectionName}' cannot be rejected in noAck mode - message will be lost!`
      )
    }
  } else {
    ack = function () {
      log.debug(
        `Acking tag ${raw.fields.deliveryTag} on '${messages.name}' - '${messages.connectionName}'`
      )
      channel.ack({ fields: { deliveryTag: raw.fields.deliveryTag } }, false)
    }
    nack = function () {
      log.debug(
        `Nacking tag ${raw.fields.deliveryTag} on '${messages.name}' - '${messages.connectionName}'`
      )
      channel.nack({ fields: { deliveryTag: raw.fields.deliveryTag } }, false)
    }
    reject = function () {
      log.debug(
        `Rejecting tag ${raw.fields.deliveryTag} on '${messages.name}' - '${messages.connectionName}'`
      )
      channel.reject({ fields: { deliveryTag: raw.fields.deliveryTag } }, false, false)
    }
  }

  return {
    ack,
    nack,
    reject
  }
}

function getReply (channel, serializers, raw, replyQueue, connectionName) {
  let position = 0
  return function (reply, options) {
    const defaultReplyType = raw.type + '.reply'
    const replyType = options ? (options.replyType || defaultReplyType) : defaultReplyType
    const contentType = getContentType(reply, options)
    const serializer = serializers[contentType]
    if (!serializer) {
      const message =
        `Failed to publish message with contentType ${contentType} - no serializer defined`
      log.error(message)
      return Promise.reject(new Error(message))
    }
    const payload = serializer.serialize(reply)

    const replyTo = raw.properties.replyTo
    raw.ack()
    if (replyTo) {
      const publishOptions = {
        type: replyType,
        contentType,
        contentEncoding: 'utf8',
        correlationId: raw.properties.messageId,
        timestamp: options && options.timestamp ? options.timestamp : Date.now(),
        replyTo: replyQueue === false ? undefined : replyQueue,
        headers: options && options.headers ? options.headers : {}
      }
      if (options && options.more) {
        publishOptions.headers.position = (position++)
      } else {
        publishOptions.headers.sequence_end = true // jshint ignore:line
      }
      log.debug(
        `Replying to message ${raw.properties.messageId} on '${replyTo}' - '${connectionName}' with type '${publishOptions.type}'`
      )
      if (raw.properties.headers && raw.properties.headers['direct-reply-to']) {
        return channel.publish(
          '',
          replyTo,
          payload,
          publishOptions
        )
      } else {
        return channel.sendToQueue(replyTo, payload, publishOptions)
      }
    } else {
      return Promise.reject(new Error('Cannot reply to a message that has no return address'))
    }
  }
}

function getResolutionOperations (channel, raw, messages, options) {
  if (options.noBatch) {
    return getNoBatchOps(channel, raw, messages, options.noAck)
  }

  if (options.noAck || options.noBatch) {
    return getUntrackedOps(channel, raw, messages)
  }

  return getTrackedOps(raw, messages)
}

function getTrackedOps (raw, messages) {
  return messages.getMessageOps(raw.fields.deliveryTag)
}

function getUntrackedOps (channel, raw, messages) {
  messages.receivedCount += 1
  return {
    ack: noOp,
    nack: function () {
      log.error(
        `Tag ${raw.fields.deliveryTag} on '${messages.name}' - '${messages.connectionName}' cannot be nacked in noAck mode - message will be lost!`
      )
    },
    reject: function () {
      log.error(
        `Tag ${raw.fields.deliveryTag} on '${messages.name}' - '${messages.connectionName}' cannot be rejected in noAck mode - message will be lost!`
      )
    }
  }
}

// purging an auto-delete queue means unsubscribing is not
// an option as it will cause the queue, binding and possibly
// upstream auto-delete exchanges to be deleted as well
function purgeADQueue (channel, connectionName, options, messages) {
  const name = options.uniqueName || options.name
  return new Promise(function (resolve, reject) {
    const messageCount = messages.messages.length
    if (messageCount > 0) {
      log.info(`Purge operation for queue '${options.name}' on '${connectionName}' is waiting for resolution on ${messageCount} messages`)
      messages.once('empty', function () {
        channel.purgeQueue(name)
          .then(
            result => resolve(result.messageCount),
            reject
          )
      })
    } else {
      channel.purgeQueue(name)
        .then(
          result => resolve(result.messageCount),
          reject
        )
    }
  })
}

// queues not marked auto-delete should be unsubscribed from
// in order to stop incoming messages while the purge is
// taking place and avoid arrival of additional new messages
function purgeQueue (channel, connectionName, options, messages) {
  const name = options.uniqueName || options.name
  return new Promise(function (resolve, reject) {
    function onUnsubscribed () {
      const messageCount = messages.messages.length
      if (messageCount > 0) {
        log.info(`Purge operation for queue '${options.name}' on '${connectionName}' is waiting for resolution on ${messageCount} messages`)
        messages.once('empty', function () {
          channel.purgeQueue(name)
            .then(
              result => resolve(result.messageCount),
              reject
            )
        })
      } else {
        channel.purgeQueue(name)
          .then(
            result => resolve(result.messageCount),
            reject
          )
      }
    }
    log.info(`Stopping subscription on '${options.name}' on '${connectionName}' before purging`)
    unsubscribe(channel, options)
      .then(onUnsubscribed, onUnsubscribed)
  })
}

function purge (channel, connectionName, options, messages, definer) {
  log.info(`Checking queue length on '${options.name}' on '${connectionName}' before purging`)
  return definer()
    .then(
      q => {
        if (q.messageCount > 0) {
          const promise = options.autoDelete
            ? purgeADQueue(channel, connectionName, options, messages)
            : purgeQueue(channel, connectionName, options, messages)
          return promise
            .then(
              count => {
                log.info(`Purged ${count} messages from '${options.name}' on '${connectionName}'`)
                return count
              }
            )
        } else {
          log.info(`'${options.name}' on '${connectionName}' was already empty when purge was called`)
          return Promise.resolve(0)
        }
      },
      Promise.reject
    )
}

function release (channel, options, messages, released) {
  function onUnsubscribed () {
    return new Promise(function (resolve) {
      const messageCount = messages.messages.length
      if (messageCount > 0 && !released) {
        log.info(`Release operation for queue '${options.name}' is waiting for resolution on ${messageCount} messages`)
        messages.once('empty', function () {
          finalize(channel, messages)
          resolve()
        })
      } else {
        finalize(channel, messages)
        resolve()
      }
    })
  }
  return unsubscribe(channel, options)
    .then(onUnsubscribed, onUnsubscribed)
}

function resolveTags (channel, queue, connection) {
  return function (op, data) {
    switch (op) {
      case 'ack':
        log.debug(`Acking tag ${data.tag} on '${queue}' - '${connection}'`)
        return channel.ack({ fields: { deliveryTag: data.tag } }, data.inclusive)
      case 'nack':
        log.debug(`Nacking tag ${data.tag} on '${queue}' - '${connection}'`)
        return channel.nack({ fields: { deliveryTag: data.tag } }, data.inclusive)
      case 'reject':
        log.debug(`Rejecting tag ${data.tag} on '${queue}' - '${connection}'`)
        return channel.nack({ fields: { deliveryTag: data.tag } }, data.inclusive, false)
      default:
        return Promise.resolve(true)
    }
  }
}

function subscribe (channelName, channel, topology, serializers, messages, options, exclusive) {
  const shouldAck = !options.noAck
  const shouldBatch = !options.noBatch
  const shouldCacheKeys = !options.noCacheKeys
  // this is done to support rabbit-assigned queue names
  channelName = channelName || options.name
  if (shouldAck && shouldBatch) {
    messages.listenForSignal()
  }

  options.consumerTag = info.createTag(channelName)
  if (Object.keys(channel.item.consumers).length > 0) {
    log.info(`Duplicate subscription to queue '${channelName}' ignored`)
    return Promise.resolve(options.consumerTag)
  }
  log.info(`Starting subscription to queue '${channelName}' on '${topology.connection.name}'`)
  return channel.consume(channelName, function (raw) {
    if (!raw) {
      // this happens when the consumer has been cancelled
      log.warn(`Queue '${channelName}' was sent a consumer cancel notification`)
      throw new Error('Broker cancelled the consumer remotely')
    }
    const correlationId = raw.properties.correlationId
    const ops = getResolutionOperations(channel, raw, messages, options)

    raw.ack = ops.ack.bind(ops)
    raw.reject = ops.reject.bind(ops)
    raw.nack = ops.nack.bind(ops)
    raw.reply = getReply(channel, serializers, raw, topology.replyQueue.name, topology.connection.name)
    raw.type = raw.properties.type || raw.fields.routingKey
    if (exclusive) {
      options.exclusive = true
    }
    raw.queue = channelName
    const parts = [options.name.replace(/[.]/g, '-')]
    if (raw.type) {
      parts.push(raw.type)
    }
    let topic = parts.join('.')
    const contentType = raw.properties.contentType || 'application/octet-stream'
    const serializer = serializers[contentType]
    const track = () => {
      if (shouldAck && shouldBatch) {
        messages.addMessage(ops)
      }
    }
    if (!serializer) {
      if (options.poison) {
        raw.body = raw.content
        raw.contentEncoding = raw.properties.contentEncoding
        raw.quarantined = true
        topic = `${topic}.quarantined`
      } else {
        log.error(
          `Could not deserialize message id '${raw.properties.messageId}' on queue '${channelName}', connection '${topology.connection.name}' - no serializer defined`
        )
        track()
        ops.reject()
        return
      }
    } else {
      try {
        raw.body = serializer.deserialize(raw.content, raw.properties.contentEncoding)
      } catch (err) {
        if (options.poison) {
          raw.quarantined = true
          raw.body = raw.content
          raw.contentEncoding = raw.properties.contentEncoding
          topic = `${topic}.quarantined`
        } else {
          track()
          ops.reject()
          return
        }
      }
    }

    const onPublish = function (activated) {
      let handled
      if (activated) {
        handled = true
      }
      track()

      if (!handled) {
        unhandledLog.warn(
          `Message of ${raw.type} on queue '${channelName}', connection '${topology.connection.name}' was not processed by any registered handlers`
        )
        topology.onUnhandled(raw)
      }
    }

    if (raw.fields.routingKey === topology.replyQueue.name) {
      raw.topic = correlationId
      raw.headers = {
        resolverNoCache: true
      }
      replies.emit(raw.topic, raw, onPublish)
    } else {
      raw.topic = topic
      raw.headers = {
        resolverNoCache: !shouldCacheKeys
      }
      process.nextTick(() => {
        received.emit(topic, raw, onPublish)
      })
    }
  }, options)
    .then(function (result) {
      channel.tag = result.consumerTag
      return result
    }, function (err) {
      log.error('Error on channel consume', options)
      throw err
    })
}

function unsubscribe (channel, options) {
  if (channel.tag) {
    log.info(
      `Unsubscribing from queue '${options.name}' with tag ${channel.tag}`
    )
    return channel.cancel(channel.tag)
  } else {
    return Promise.resolve()
  }
}

module.exports = function (options, topology, serializers) {
  const channelName = ['queue', options.uniqueName].join(':')
  return topology.connection.getChannel(channelName, false, 'queue channel for ' + options.name)
    .then(function (channel) {
      const messages = new AckBatch(
        options.name,
        topology.connection.name,
        resolveTags(channel, options.name, topology.connection.name),
        signal
      )
      const subscriber = subscribe.bind(
        undefined,
        options.uniqueName,
        channel,
        topology,
        serializers,
        messages,
        options
      )
      const definer = define.bind(
        undefined,
        channel,
        options,
        subscriber,
        topology.connection.name
      )
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
      }
    })
}
