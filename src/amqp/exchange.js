const defer = require('../defer');
const info = require('../info');
const exLog = require('../log.js')('rabbot.exchange');
const topLog = require('../log.js')('rabbot.topology');
const format = require('util').format;

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

const DIRECT_REPLY_TO = 'amq.rabbitmq.reply-to';
const DIRECT_REGEX = /^rabbit(mq)?$/i;

function aliasOptions (options, aliases, ...omit) {
  const keys = Object.keys(options);
  return keys.reduce((result, key) => {
    const alias = aliases[ key ] || key;
    if (omit.indexOf(key) < 0) {
      result[ alias ] = options[ key ];
    }
    return result;
  }, {});
}

function define (channel, options, connectionName) {
  var valid = aliasOptions(options, {
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
    return channel.checkExchange(options.name);
  } else {
    return channel.assertExchange(options.name, options.type, valid);
  }
}

function getContentType (message) {
  if (message.contentType) {
    return message.contentType;
  } else if (typeof message.body === 'string') {
    return 'text/plain';
  } else if (typeof message.body === 'object' && !Buffer.isBuffer(message.body)) {
    return 'application/json';
  } else {
    return 'application/octet-stream';
  }
}

function publish (channel, options, topology, log, serializers, message) {
  var channelName = options.name;
  var type = options.type;
  var baseHeaders = {
    'CorrelationId': message.correlationId
  };
  message.headers = Object.assign(baseHeaders, message.headers);
  var contentType = getContentType(message);
  var serializer = serializers[ contentType ];
  if (!serializer) {
    var errMessage = format("Failed to publish message with contentType '%s' - no serializer defined", contentType);
    exLog.error(errMessage);
    return Promise.reject(new Error(errMessage));
  }
  var payload = serializer.serialize(message.body);
  var publishOptions = {
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
  };
  if (publishOptions.replyTo === DIRECT_REPLY_TO || DIRECT_REGEX.test(publishOptions.replyTo)) {
    publishOptions.headers[ 'direct-reply-to' ] = 'true';
  }
  if (!options.noConfirm && !message.sequenceNo) {
    log.add(message);
  }
  if (options.persistent || message.persistent) {
    publishOptions.persistent = true;
  }

  var effectiveKey = message.routingKey === '' ? '' : message.routingKey || publishOptions.type;
  exLog.debug("Publishing message ( type: '%s' topic: '%s', sequence: '%s', correlation: '%s', replyTo: '%s' ) to %s exchange '%s' on connection '%s'",
    publishOptions.type,
    effectiveKey,
    message.sequenceNo,
    publishOptions.correlationId,
    JSON.stringify(publishOptions),
    type,
    channelName,
    topology.connection.name);

  function onRejected (err) {
    log.remove(message);
    throw err;
  }

  function onConfirmed (sequence) {
    log.remove(message);
    return sequence;
  }

  if (options.noConfirm) {
    channel.publish(
      channelName,
      effectiveKey,
      payload,
      publishOptions
    );
    return Promise.resolve();
  } else {
    var deferred = defer();
    var promise = deferred.promise;

    channel.publish(
      channelName,
      effectiveKey,
      payload,
      publishOptions,
      function (err, i) {
        if (err) {
          deferred.reject(err);
        } else {
          deferred.resolve(i);
        }
      }
    );
    return promise
      .then(onConfirmed, onRejected);
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
            channel.release();
            channel = undefined;
          }
          return Promise.resolve(true);
        },
        publish: publish.bind(undefined, channel, options, topology, publishLog, serializers)
      };
    });
};
