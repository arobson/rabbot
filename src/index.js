import dispatcher from 'topic-dispatch';
import { v1 as uuidv1 } from 'uuid';
import connectionFn from './connectionFsm.js';
import topologyFn from './topology.js';
import { dispatchChannel, responseChannel, ackChannel } from './dispatchChannels.js';
import createLog from './log.js';
import configureBroker from './config.js';
import { safeEmit } from './eventUtils.js';

const log = createLog;

const DEFAULT = 'default';

const unhandledStrategies = {
  nackOnUnhandled: function (message) {
    message.nack();
  },
  rejectOnUnhandled: function (message) {
    message.reject();
  },
  customOnUnhandled: function () {}
};

const returnedStrategies = {
  customOnReturned: function () {}
};

unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;
returnedStrategies.onReturned = returnedStrategies.customOnReturned;

const serializers = {
  'application/json': {
    deserialize: (bytes, encoding) => {
      return JSON.parse(bytes.toString(encoding || 'utf8'));
    },
    serialize: (object) => {
      const json = (typeof object === 'string')
        ? object
        : JSON.stringify(object);
      return Buffer.from(json, 'utf8');
    }
  },
  'application/octet-stream': {
    deserialize: (bytes) => {
      return bytes;
    },
    serialize: (bytes) => {
      if (Buffer.isBuffer(bytes)) {
        return bytes;
      } else if (Array.isArray(bytes)) {
        return Buffer.from(bytes);
      } else {
        throw new Error('Cannot serialize unknown data type');
      }
    }
  },
  'text/plain': {
    deserialize: (bytes, encoding) => {
      return bytes.toString(encoding || 'utf8');
    },
    serialize: (string) => {
      return Buffer.from(string, 'utf8');
    }
  }
};

const Broker = function () {
  Object.assign(this, dispatcher());
  this.connections = {};
  this.hasHandles = false;
  this.autoNack = false;
  this.serializers = serializers;
  this.configurations = {};
  this.configuring = {};
  this.log = log;
};

Broker.prototype.addConnection = function (opts) {
  const self = this;

  const options = Object.assign({}, {
    name: DEFAULT,
    retryLimit: 3,
    failAfter: 60
  }, opts);
  const name = options.name;
  let connection;

  const connectionPromise = new Promise((resolve, reject) => {
    if (!self.connections[name]) {
      connection = connectionFn(options);
      const topology = topologyFn(connection, options, serializers, unhandledStrategies, returnedStrategies);

      connection.on('connected', () => {
        safeEmit(self, 'connected', connection);
        safeEmit(self, connection.name + '.connection.opened', connection);
        self.setAckInterval(500);
        resolve(topology);
      });

      connection.on('closed', () => {
        safeEmit(self, 'closed', connection);
        safeEmit(self, connection.name + '.connection.closed', connection);
        reject(new Error('connection closed'));
      });

      connection.on('failed', (err) => {
        safeEmit(self, 'failed', connection);
        safeEmit(self, name + '.connection.failed', err);
        reject(err);
      });

      connection.on('unreachable', () => {
        safeEmit(self, 'unreachable', connection);
        safeEmit(self, name + '.connection.unreachable');
        self.clearAckInterval();
        reject(new Error('connection unreachable'));
      });

      connection.on('return', (raw) => {
        safeEmit(self, 'return', raw);
      });
      self.connections[name] = topology;
    } else {
      connection = self.connections[name];
      connection.connection.connect();
      resolve(connection);
    }
  });

  // always replace the cached promise - a stale, already-settled promise
  // from a prior failed attempt must not be handed out to callers made
  // after a successful retry/reconnect (#177/#158)
  this.connections[name].promise = connectionPromise;
  return connectionPromise;
};

Broker.prototype.addExchange = function (name, type, options = {}, connectionName = DEFAULT) {
  if (typeof name === 'object') {
    options = name;
    options.connectionName = options.connectionName || type || connectionName;
  } else {
    options.name = name;
    options.type = type;
    options.connectionName = options.connectionName || connectionName;
  }
  return this.connections[options.connectionName].createExchange(options);
};

Broker.prototype.addQueue = function (name, options = {}, connectionName = DEFAULT) {
  options.name = name;
  if (options.subscribe && !this.hasHandles) {
    console.warn("Subscription to '" + name + "' was started without any handlers. This will result in lost messages!");
  }
  return this.connections[connectionName].createQueue(options, connectionName);
};

Broker.prototype.addSerializer = function (contentType, serializer) {
  serializers[contentType] = serializer;
};

Broker.prototype.batchAck = function () {
  safeEmit(ackChannel, 'ack', {});
};

Broker.prototype.bindExchange = function (source, target, keys, connectionName = DEFAULT) {
  return this.connections[connectionName].createBinding({ source, target, keys });
};

Broker.prototype.bindQueue = function (source, target, keys, connectionName = DEFAULT) {
  return this.connections[connectionName].createBinding(
    { source, target, keys, queue: true },
    connectionName
  );
};

Broker.prototype.bulkPublish = function (set, connectionName = DEFAULT) {
  if (set.connectionName) {
    connectionName = set.connectionName;
  }
  if (!this.connections[connectionName]) {
    return Promise.reject(new Error(`BulkPublish failed - no connection ${connectionName} has been configured`));
  }

  const publish = (exchange, options) => {
    options.appId = options.appId || this.appId;
    options.timestamp = options.timestamp || Date.now();
    if (this.connections[connectionName] && this.connections[connectionName].options.publishTimeout) {
      options.connectionPublishTimeout = this.connections[connectionName].options.publishTimeout;
    }
    if (typeof options.body === 'number') {
      options.body = options.body.toString();
    }
    return exchange.publish(options)
      .then(
        () => options,
        err => { return { err, message: options }; }
      );
  };

  const exchangeNames = Array.isArray(set)
    ? set.reduce((acc, m) => {
      if (acc.indexOf(m.exchange) < 0) {
        acc.push(m.exchange);
      }
      return acc;
    }, [])
    : Object.keys(set);

  return this.onExchanges(exchangeNames, connectionName)
    .then(exchanges => {
      if (!Array.isArray(set)) {
        const keys = Object.keys(set);
        return Promise.all(keys.map(exchangeName => {
          return Promise.all(set[exchangeName].map(message => {
            const exchange = exchanges[exchangeName];
            if (exchange) {
              return publish(exchange, message);
            } else {
              return Promise.reject(new Error(`Publish failed - no exchange ${exchangeName} on connection ${connectionName} is defined`));
            }
          }));
        }));
      } else {
        return Promise.all(set.map(message => {
          const exchange = exchanges[message.exchange];
          if (exchange) {
            return publish(exchange, message);
          } else {
            return Promise.reject(new Error(`Publish failed - no exchange ${message.exchange} on connection ${connectionName} is defined`));
          }
        }));
      }
    });
};

Broker.prototype.clearAckInterval = function () {
  clearInterval(this.ackIntervalId);
};

Broker.prototype.closeAll = function (reset) {
  // COFFEE IS FOR CLOSERS
  const connectionNames = Object.keys(this.connections);
  const closers = connectionNames.map((connection) =>
    this.close(connection, reset)
  );
  return Promise.all(closers);
};

Broker.prototype.close = function (connectionName = DEFAULT, reset = false) {
  const connection = this.connections[connectionName].connection;
  if (connection !== undefined && connection !== null) {
    if (reset) {
      this.connections[connectionName].reset();
    }
    delete this.configuring[connectionName];
    return connection.close(reset);
  } else {
    return Promise.resolve(true);
  }
};

Broker.prototype.deleteExchange = function (name, connectionName = DEFAULT) {
  return this.connections[connectionName].deleteExchange(name);
};

Broker.prototype.deleteQueue = function (name, connectionName = DEFAULT) {
  return this.connections[connectionName].deleteQueue(name);
};

Broker.prototype.getExchange = function (name, connectionName = DEFAULT) {
  return this.connections[connectionName].channels[`exchange:${name}`];
};

Broker.prototype.getQueue = function (name, connectionName = DEFAULT) {
  return this.connections[connectionName].channels[`queue:${name}`];
};

Broker.prototype.handle = function (messageType, handler, queueName, context) {
  this.hasHandles = true;
  let options;
  if (typeof messageType === 'string') {
    options = {
      type: messageType,
      queue: queueName || '*',
      context,
      autoNack: this.autoNack,
      handler
    };
  } else {
    options = messageType;
    options.autoNack = options.autoNack !== false;
    options.queue = options.queue || (options.type ? '*' : '#');
    options.handler = options.handler || handler;
  }
  const parts = [];
  if (options.queue === '#') {
    parts.push('#');
  } else {
    parts.push(options.queue.replace(/[.]/g, '-'));
    if (options.type !== '') {
      parts.push(options.type || '#');
    }
  }

  const target = parts.join('.');
  const boundHandler = options.handler.bind(options.context);
  // topic-dispatch's subscription.catch(onErr) only passes the rejection
  // reason (unlike postal's (err, msg) => {} callback), so there's no way
  // to recover `msg` from that callback to nack it. Wrapping the handler
  // instead gives autoNack access to the message directly, and covers
  // both synchronous throws and async rejections.
  const dispatchedHandler = !options.autoNack
    ? boundHandler
    : (msg, topic) => {
        const onHandlerError = (err) => {
          console.log("Handler for '" + target + "' failed with:", err.stack);
          msg.nack();
        };
        try {
          const result = boundHandler(msg, topic);
          if (result && typeof result.catch === 'function') {
            result.catch(onHandlerError);
          }
          return result;
        } catch (err) {
          onHandlerError(err);
        }
      };
  const subscription = dispatchChannel.on(target, dispatchedHandler);
  return subscription;
};

Broker.prototype.ignoreHandlerErrors = function () {
  this.autoNack = false;
};

Broker.prototype.nackOnError = function () {
  this.autoNack = true;
};

Broker.prototype.nackUnhandled = function () {
  unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;
};

Broker.prototype.onUnhandled = function (handler) {
  unhandledStrategies.onUnhandled = unhandledStrategies.customOnUnhandled = handler;
};

Broker.prototype.rejectUnhandled = function () {
  unhandledStrategies.onUnhandled = unhandledStrategies.rejectOnUnhandled;
};

Broker.prototype.onExchange = function (exchangeName, connectionName = DEFAULT) {
  const promises = [
    this.connections[connectionName].promise,
    this.connections[connectionName].promises[`exchange:${exchangeName}`]
  ];
  if (this.configuring[connectionName]) {
    promises.push(this.configuring[connectionName]);
  }
  return Promise.all(promises)
    .then(
      () => this.getExchange(exchangeName, connectionName)
    );
};

Broker.prototype.onExchanges = function (exchanges, connectionName = DEFAULT) {
  const connectionPromises = [this.connections[connectionName].promise];
  if (this.configuring[connectionName]) {
    connectionPromises.push(this.configuring[connectionName]);
  }
  const set = {};
  return Promise.all(connectionPromises)
    .then(
      () => {
        const exchangePromises = exchanges.map(exchangeName =>
          this.connections[connectionName].promises[`exchange:${exchangeName}`]
            .then(() => {
              return { name: exchangeName, exchange: true };
            })
        );
        return Promise.all(exchangePromises);
      }
    ).then(
      list => {
        list.forEach(item => {
          if (item && item.exchange) {
            const exchange = this.getExchange(item.name, connectionName);
            set[item.name] = exchange;
          }
        });
        return set;
      }
    );
};

Broker.prototype.onReturned = function (handler) {
  returnedStrategies.onReturned = returnedStrategies.customOnReturned = handler;
};

Broker.prototype.publish = function (exchangeName, type, message, routingKey, correlationId, connectionName, sequenceNo) {
  const timestamp = Date.now();
  let options;
  if (typeof type === 'object') {
    options = type;
    connectionName = message || DEFAULT;
    options = Object.assign({
      appId: this.appId,
      timestamp,
      connectionName
    }, options);
    connectionName = options.connectionName;
  } else {
    connectionName = connectionName || message.connectionName || DEFAULT;
    options = {
      appId: this.appId,
      type,
      body: message,
      routingKey,
      correlationId,
      sequenceNo,
      timestamp,
      headers: {},
      connectionName
    };
  }
  if (!this.connections[connectionName]) {
    return Promise.reject(new Error(`Publish failed - no connection ${connectionName} has been configured`));
  }
  if (this.connections[connectionName] && this.connections[connectionName].options.publishTimeout) {
    options.connectionPublishTimeout = this.connections[connectionName].options.publishTimeout;
  }
  if (typeof options.body === 'number') {
    options.body = options.body.toString();
  }

  return this.onExchange(exchangeName, connectionName)
    .then(exchange => {
      if (exchange) {
        return exchange.publish(options);
      } else {
        return Promise.reject(new Error(`Publish failed - no exchange ${exchangeName} on connection ${connectionName} is defined`));
      }
    });
};

Broker.prototype.purgeQueue = function (queueName, connectionName = DEFAULT) {
  if (!this.connections[connectionName]) {
    return Promise.reject(new Error(`Queue purge failed - no connection ${connectionName} has been configured`));
  }
  return this.connections[connectionName].promise
    .then(() => {
      const queue = this.getQueue(queueName, connectionName);
      if (queue) {
        return queue.purge();
      } else {
        return Promise.reject(new Error(`Queue purge failed - no queue ${queueName} on connection ${connectionName} is defined`));
      }
    });
};

Broker.prototype.request = function (exchangeName, options = {}, notify, connectionName = DEFAULT) {
  const requestId = uuidv1();
  options.messageId = requestId;
  options.connectionName = options.connectionName || connectionName;

  if (!this.connections[options.connectionName]) {
    return Promise.reject(new Error(`Request failed - no connection ${options.connectionName} has been configured`));
  }

  const topology = this.connections[options.connectionName];
  // opt-in alternate response destination (#148, #191): lets a responder
  // (often cross-language) that publishes replies to a known
  // exchange/routing key of its own - rather than honoring `replyTo` -
  // still be heard, by binding a queue there and treating its deliveries
  // as RPC responses correlated by correlationId
  const responseQueue = options.responseQueue
    ? topology.getResponseQueue(options.responseQueue.exchange, options.responseQueue.key, options.responseQueue.name)
    : Promise.resolve();

  return Promise.all([this.onExchange(exchangeName, options.connectionName), responseQueue])
    .then(([exchange, responseQueueName]) => {
      if (responseQueueName) {
        options.replyTo = options.replyTo || responseQueueName;
      }
      const connection = topology.options;
      const publishTimeout = options.timeout || exchange.publishTimeout || connection.publishTimeout || 500;
      const replyTimeout = options.replyTimeout || exchange.replyTimeout || connection.replyTimeout || (publishTimeout * 2);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(function () {
          subscription.off();
          reject(new Error('No reply received within the configured timeout of ' + replyTimeout + ' ms'));
        }, replyTimeout);
        const scatter = options.expect;
        let remaining = options.expect;
        const subscription = responseChannel.on(requestId, message => {
          // a `notify` callback means the caller expects a stream of
          // messages before a final one - rely on the `sequence_end`
          // header req.reply() sets on the terminal reply. Without one,
          // the caller only expects a single reply, so any message
          // resolves it - this matters for a responder (often
          // cross-language, #148/#191) publishing straight to a custom
          // responseQueue rather than through req.reply(), which won't
          // know to set that header
          const headers = message.properties.headers || {};
          const end = scatter
            ? --remaining <= 0
            : (notify ? headers.sequence_end : true);
          if (end) {
            clearTimeout(timeout);
            if (!scatter || remaining === 0) {
              resolve(message);
            }
            subscription.off();
          } else if (notify) {
            notify(message);
          }
        });
        this.publish(exchangeName, options);
      });
    });
};

Broker.prototype.reset = function () {
  this.connections = {};
  this.configurations = {};
  this.configuring = {};
};

Broker.prototype.retry = function (connectionName = DEFAULT) {
  const config = this.configurations[connectionName];
  return this.configure(config);
};

Broker.prototype.setAckInterval = function (interval) {
  if (this.ackIntervalId) {
    this.clearAckInterval();
  }
  this.ackIntervalId = setInterval(this.batchAck.bind(this), interval);
};

Broker.prototype.shutdown = function () {
  return this.closeAll(true)
    .then(() => {
      this.clearAckInterval();
    });
};

Broker.prototype.startSubscription = function (queueName, exclusive = false, connectionName = DEFAULT) {
  if (!this.hasHandles) {
    console.warn("Subscription to '" + queueName + "' was started without any handlers. This will result in lost messages!");
  }
  if (typeof exclusive === 'string') {
    connectionName = exclusive;
    exclusive = false;
  }
  const queue = this.getQueue(queueName, connectionName);
  if (queue) {
    return queue.subscribe(exclusive);
  } else {
    throw new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Subscription failed.");
  }
};

Broker.prototype.stopSubscription = function (queueName, connectionName = DEFAULT) {
  const queue = this.getQueue(queueName, connectionName);
  if (queue) {
    return queue.unsubscribe();
  } else {
    throw new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Unsubscribe failed.");
  }
};

Broker.prototype.unbindExchange = function (source, target, keys, connectionName = DEFAULT) {
  return this.connections[connectionName].removeBinding({ source, target, keys });
};

Broker.prototype.unbindQueue = function (source, target, keys, connectionName = DEFAULT) {
  return this.connections[connectionName].removeBinding(
    { source, target, keys, queue: true },
    connectionName
  );
};

configureBroker(Broker);

const broker = new Broker();

export default broker;
