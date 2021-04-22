const defer = require('../defer')
const info = require('../info')
const exLog = require('../log.js')('rabbot.exchange')
const topLog = require('../log.js')('rabbot.topology')

/* log
  * `rabbot.exchange`
    * `debug`
      * details for message publish - very verbose
    * `info`
    * `error`
      * no serializer is defined for message's content type
  * `rabbot.topology`
    * `info`
      * exchange declaration
*/

const DIRECT_REPLY_TO = 'amq.rabbitmq.reply-to'
const DIRECT_REGEX = /^rabbit(mq)?$/i

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

function define (channel, options, connectionName) {
  const valid = aliasOptions(options, {
    alternate: 'alternateExchange'
  }, 'limit', 'persistent', 'publishTimeout')
  topLog.info(
    `Declaring ${options.type} exchange '${options.name}' on connection '${connectionName}' with the options: ${JSON.stringify(valid)}`
  )
  if (options.name === '') {
    return Promise.resolve(true)
  } else if (options.passive) {
    return channel.checkExchange(options.name)
  } else {
    return channel.assertExchange(options.name, options.type, valid)
  }
}

function getContentType (message) {
  if (message.contentType) {
    return message.contentType
  } else if (typeof message.body === 'string') {
    return 'text/plain'
  } else if (typeof message.body === 'object' && !Buffer.isBuffer(message.body)) {
    return 'application/json'
  } else {
    return 'application/octet-stream'
  }
}

function publish (channel, options, topology, log, serializers, message) {
  const channelName = options.name
  const type = options.type
  const baseHeaders = {
    CorrelationId: message.correlationId
  }
  message.headers = Object.assign(baseHeaders, message.headers)
  const contentType = getContentType(message)
  const serializer = serializers[contentType]
  if (!serializer) {
    const errMessage =
      `Failed to publish message with contentType '${contentType}' - no serializer defined`
    exLog.error(errMessage)
    return Promise.reject(new Error(errMessage))
  }
  const payload = serializer.serialize(message.body)
  const publishOptions = {
    type: message.type || '',
    contentType: contentType,
    contentEncoding: 'utf8',
    correlationId: message.correlationId || '',
    replyTo: message.replyTo || topology.replyQueue.name || '',
    messageId: message.messageId || message.id || '',
    timestamp: message.timestamp || Date.now(),
    appId: message.appId || info.id,
    headers: message.headers || {},
    expiration: message.expiresAfter || undefined,
    mandatory: message.mandatory || false
  }
  if (publishOptions.replyTo === DIRECT_REPLY_TO || DIRECT_REGEX.test(publishOptions.replyTo)) {
    publishOptions.headers['direct-reply-to'] = 'true'
    publishOptions.replyTo = DIRECT_REPLY_TO
  }
  if (!options.noConfirm && !message.sequenceNo) {
    log.add(message)
  }
  if (options.persistent || message.persistent) {
    publishOptions.persistent = true
  }

  const effectiveKey = message.routingKey === '' ? '' : message.routingKey || publishOptions.type
  exLog.debug(
    `Publishing message ( type: '${publishOptions.type}' topic: '${effectiveKey}', sequence: '${message.sequenceNo}', correlation: '${publishOptions.correlationId}', replyTo: '${JSON.stringify(publishOptions)}' ) to ${type} exchange '${channelName}' on connection '${topology.connection.name}'`
  )
  function onRejected (err) {
    exLog.warn(`oops`)
    log.remove(message)
    throw err
  }

  function onConfirmed (sequence) {
    log.remove(message)
    return sequence
  }

  if (options.noConfirm) {
    channel.publish(
      channelName,
      effectiveKey,
      payload,
      publishOptions
    )
    return Promise.resolve()
  } else {
    const deferred = defer()
    const promise = deferred.promise

    channel.publish(
      channelName,
      effectiveKey,
      payload,
      publishOptions,
      function (err, i) {
        if (err) {
          deferred.reject(err)
        } else {
          deferred.resolve(i)
        }
      }
    )
    return promise
      .then(onConfirmed, onRejected)
  }
}

module.exports = function (options, topology, publishLog, serializers) {
  return topology.connection.getChannel(options.name, !options.noConfirm, 'exchange channel for ' + options.name)
    .then(function (channel) {
      return {
        channel: channel,
        define: define.bind(undefined, channel, options, topology.connection.name),
        release: function () {
          if (channel) {
            channel.release()
            channel = undefined
          }
          return Promise.resolve(true)
        },
        publish: publish.bind(undefined, channel, options, topology, publishLog, serializers)
      }
    })
}
