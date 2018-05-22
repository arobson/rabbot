const Monologue = require('monologue.js');
const connectionFn = require('./connectionFsm.js');
const topologyFn = require('./topology.js');
const postal = require('postal');
const uuid = require('uuid');
const dispatch = postal.channel('rabbit.dispatch');
const responses = postal.channel('rabbit.responses');
const signal = postal.channel('rabbit.ack');
const log = require('./log');

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

var Broker = function () {
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
    if (!self.connections[ name ]) {
      connection = connectionFn(options);
      const topology = topologyFn(connection, options, serializers, unhandledStrategies, returnedStrategies);

      connection.on('connected', () => {
        self.emit('connected', connection);
        self.emit(connection.name + '.connection.opened', connection);
        self.setAckInterval(500);
        resolve(topology);
      });

      connection.on('closed', () => {
        self.emit('closed', connection);
        self.emit(connection.name + '.connection.closed', connection);
        reject(new Error('connection closed'));
      });

      connection.on('failed', (err) => {
        self.emit('failed', connection);
        self.emit(name + '.connection.failed', err);
        reject(err);
      });

      connection.on('unreachable', () => {
        self.emit('unreachable', connection);
        self.emit(name + '.connection.unreachable');
        self.clearAckInterval();
        reject(new Error('connection unreachable'));
      });

      connection.on('return', (raw) => {
        self.emit('return', raw);
      });
      self.connections[ name ] = topology;
    } else {
      connection = self.connections[ name ];
      connection.connection.connect();
      resolve(connection);
    }
  });

  if (!this.connections[ name ].promise) {
    this.connections[ name ].promise = connectionPromise;
  }
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
  return this.connections[ options.connectionName ].createExchange(options);
};

Broker.prototype.addQueue = function (name, options = {}, connectionName = DEFAULT) {
  options.name = name;
  if (options.subscribe && !this.hasHandles) {
    console.warn("Subscription to '" + name + "' was started without any handlers. This will result in lost messages!");
  }
  return this.connections[ connectionName ].createQueue(options, connectionName);
};

Broker.prototype.addSerializer = function (contentType, serializer) {
  serializers[ contentType ] = serializer;
};

Broker.prototype.batchAck = function () {
  signal.publish('ack', {});
};

Broker.prototype.bindExchange = function (source, target, keys, connectionName = DEFAULT) {
  return this.connections[ connectionName ].createBinding({ source: source, target: target, keys: keys });
};

Broker.prototype.bindQueue = function (source, target, keys, connectionName = DEFAULT) {
  return this.connections[ connectionName ].createBinding(
    { source: source, target: target, keys: keys, queue: true },
    connectionName
  );
};

Broker.prototype.bulkPublish = function (set, connectionName = DEFAULT) {
  if (set.connectionName) {
    connectionName = set.connectionName;
  }
  if (!this.connections[ connectionName ]) {
    return Promise.reject(new Error(`BulkPublish failed - no connection ${connectionName} has been configured`));
  }

  const publish = (exchange, options) => {
    options.appId = options.appId || this.appId;
    options.timestamp = options.timestamp || Date.now();
    if (this.connections[ connectionName ] && this.connections[ connectionName ].options.publishTimeout) {
      options.connectionPublishTimeout = this.connections[ connectionName ].options.publishTimeout;
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

  let exchangeNames = Array.isArray(set)
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
  const connection = this.connections[ connectionName ].connection;
  if (connection !== undefined && connection !== null) {
    if (reset) {
      this.connections[ connectionName ].reset();
    }
    delete this.configuring[ connectionName ];
    return connection.close(reset);
  } else {
    return Promise.resolve(true);
  }
};

Broker.prototype.deleteExchange = function (name, connectionName = DEFAULT) {
  return this.connections[ connectionName ].deleteExchange(name);
};

Broker.prototype.deleteQueue = function (name, connectionName = DEFAULT) {
  return this.connections[ connectionName ].deleteQueue(name);
};

Broker.prototype.getExchange = function (name, connectionName = DEFAULT) {
  return this.connections[ connectionName ].channels[ `exchange:${name}` ];
};

Broker.prototype.getQueue = function (name, connectionName = DEFAULT) {
  return this.connections[ connectionName ].channels[ `queue:${name}` ];
};

Broker.prototype.handle = function (messageType, handler, queueName, context) {
  this.hasHandles = true;
  var options;
  if (typeof messageType === 'string') {
    options = {
      type: messageType,
      queue: queueName || '*',
      context: context,
      autoNack: this.autoNack,
      handler: handler
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
  const subscription = dispatch.subscribe(target, options.handler.bind(options.context));
  if (options.autoNack) {
    subscription.catch(function (err, msg) {
      console.log("Handler for '" + target + "' failed with:", err.stack);
      msg.nack();
    });
  }
  subscription.remove = subscription.unsubscribe;
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
    this.connections[ connectionName ].promise,
    this.connections[ connectionName ].promises[`exchange:${exchangeName}`]
  ];
  if (this.configuring[ connectionName ]) {
    promises.push(this.configuring[ connectionName ]);
  }
  return Promise.all(promises)
    .then(
      () => this.getExchange(exchangeName, connectionName)
    );
};

Broker.prototype.onExchanges = function (exchanges, connectionName = DEFAULT) {
  const connectionPromises = [this.connections[ connectionName ].promise];
  if (this.configuring[ connectionName ]) {
    connectionPromises.push(this.configuring[ connectionName ]);
  }
  const set = {};
  return Promise.all(connectionPromises)
    .then(
      () => {
        const exchangePromises = exchanges.map(exchangeName =>
          this.connections[ connectionName ].promises[`exchange:${exchangeName}`]
            .then(() => {
              return { name: exchangeName, exchange: true };
            })
        );
        return Promise.all(exchangePromises);
      }
    ).then(
      list => {
        list.map(item => {
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
      timestamp: timestamp,
      connectionName: connectionName
    }, options);
    connectionName = options.connectionName;
  } else {
    connectionName = connectionName || message.connectionName || DEFAULT;
    options = {
      appId: this.appId,
      type: type,
      body: message,
      routingKey: routingKey,
      correlationId: correlationId,
      sequenceNo: sequenceNo,
      timestamp: timestamp,
      headers: {},
      connectionName: connectionName
    };
  }
  if (!this.connections[ connectionName ]) {
    return Promise.reject(new Error(`Publish failed - no connection ${connectionName} has been configured`));
  }
  if (this.connections[ connectionName ] && this.connections[ connectionName ].options.publishTimeout) {
    options.connectionPublishTimeout = this.connections[ connectionName ].options.publishTimeout;
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
  if (!this.connections[ connectionName ]) {
    return Promise.reject(new Error(`Queue purge failed - no connection ${connectionName} has been configured`));
  }
  return this.connections[ connectionName ].promise
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
  const requestId = uuid.v1();
  options.messageId = requestId;
  options.connectionName = options.connectionName || connectionName;

  if (!this.connections[ options.connectionName ]) {
    return Promise.reject(new Error(`Request failed - no connection ${options.connectionName} has been configured`));
  }

  return this.onExchange(exchangeName, options.connectionName)
    .then(exchange => {
      const connection = this.connections[ options.connectionName ].options;
      const publishTimeout = options.timeout || exchange.publishTimeout || connection.publishTimeout || 500;
      const replyTimeout = options.replyTimeout || exchange.replyTimeout || connection.replyTimeout || (publishTimeout * 2);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(function () {
          subscription.unsubscribe();
          reject(new Error('No reply received within the configured timeout of ' + replyTimeout + ' ms'));
        }, replyTimeout);
        const scatter = options.expect;
        let remaining = options.expect;
        const subscription = responses.subscribe(requestId, message => {
          const end = scatter
            ? --remaining <= 0
            : message.properties.headers[ 'sequence_end' ];
          if (end) {
            clearTimeout(timeout);
            if (!scatter || remaining === 0) {
              resolve(message);
            }
            subscription.unsubscribe();
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
  var config = this.configurations[ connectionName ];
  return this.configure(config);
};

Broker.prototype.setAckInterval = function (interval) {
  if (this.ackIntervalId) {
    this.clearAckInterval();
  }
  this.ackIntervalId = setInterval(this.batchAck, interval);
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
  var queue = this.getQueue(queueName, connectionName);
  if (queue) {
    return queue.subscribe(exclusive);
  } else {
    throw new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Subscription failed.");
  }
};

Broker.prototype.stopSubscription = function (queueName, connectionName = DEFAULT) {
  var queue = this.getQueue(queueName, connectionName);
  if (queue) {
    queue.unsubscribe();
    return queue;
  } else {
    throw new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Unsubscribe failed.");
  }
};

Broker.prototype.unbindExchange = function (source, target, keys, connectionName = DEFAULT) {
  return this.connections[ connectionName ].removeBinding({ source: source, target: target, keys: keys });
};

Broker.prototype.unbindQueue = function (source, target, keys, connectionName = DEFAULT) {
  return this.connections[ connectionName ].removeBinding(
    { source: source, target: target, keys: keys, queue: true },
    connectionName
  );
};

require('./config.js')(Broker);

Monologue.mixInto(Broker);

var broker = new Broker();

module.exports = broker;
