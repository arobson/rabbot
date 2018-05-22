const Monologue = require('monologue.js');
const log = require('./log')('rabbot.topology');
const info = require('./info');
var Exchange, Queue;
var replyId;

/* log
  * `rabbot.topology`
    * `info`
      * creating a binding
      * deleting an exchange
      * deleting a queue
      * reconnection established
      * topology rebuilt (after reconnection)
    * `error`
      * failed to create reply queue
*/

const DIRECT_REPLY_TO = 'amq.rabbitmq.reply-to';
const noop = () => {};

function getKeys (keys) {
  var actualKeys = [ '' ];
  if (keys && keys.length > 0) {
    actualKeys = Array.isArray(keys) ? keys : [ keys ];
  }
  return actualKeys;
}

function isUndefined (value) {
  return value === null || value === undefined;
}

function isEmpty (value) {
  return value === null || value === undefined || value === '' || value === {};
}

function isObject (value) {
  return typeof value === 'object';
}

function has (obj, property) {
  return obj && obj[ property ] != null;
}

function toArray (x, list) {
  if (Array.isArray(x)) {
    return x;
  }
  if (isObject(x) && list) {
    const keys = Object.keys(x);
    return keys.map((key) => x[ key ]);
  }
  if (x === null || x === undefined || x === '') {
    return [];
  }
  return [ x ];
}

var Topology = function (connection, options, serializers, unhandledStrategies, returnedStrategies) {
  const autoReplyTo = { name: `${replyId}.response.queue`, autoDelete: true, subscribe: true };
  const rabbitReplyTo = { name: 'amq.rabbitmq.reply-to', subscribe: true, noAck: true };
  const userReplyTo = isObject(options.replyQueue) ? options.replyQueue : { name: options.replyQueue, autoDelete: true, subscribe: true };
  this.name = options.name;
  this.connection = connection;
  this.channels = {};
  this.promises = {};
  this.definitions = {
    bindings: {},
    exchanges: {},
    queues: {}
  };
  this.options = options;
  this.replyQueue = { name: false };
  this.serializers = serializers;
  this.onUnhandled = (message) => unhandledStrategies.onUnhandled(message);
  this.onReturned = (message) => returnedStrategies.onReturned(message);
  let replyQueueName = '';

  if (has(options, 'replyQueue')) {
    replyQueueName = options.replyQueue.name || options.replyQueue;
    if (replyQueueName === false) {
      this.replyQueue = { name: false };
    } else if (replyQueueName) {
      this.replyQueue = userReplyTo;
    } else if (/^rabbit(mq)?$/i.test(replyQueueName) || replyQueueName === undefined) {
      this.replyQueue.name = DIRECT_REPLY_TO;
      this.replyQueue = rabbitReplyTo;
    }
  } else {
    this.replyQueue = autoReplyTo;
  }

  connection.on('reconnected', this.onReconnect.bind(this));
  connection.on('return', this.handleReturned.bind(this));

  this.createDefaultExchange().then(null, noop);
  // delay creation to allow for subscribers to attach a handler
  process.nextTick(() => {
    this.createReplyQueue().then(null, this.onReplyQueueFailed.bind(this));
  });
};

Topology.prototype.completeRebuild = function () {
  return this.configureBindings(this.definitions.bindings, true)
    .then(() => {
      log.info("Topology rebuilt for connection '%s'", this.connection.name);
      this.emit('bindings.completed', this.definitions);
      this.emit(this.connection.name + '.connection.configured', this.connection);
    });
};

Topology.prototype.configureBindings = function (bindingDef, list) {
  if (isUndefined(bindingDef)) {
    return Promise.resolve(true);
  } else {
    const actualDefinitions = toArray(bindingDef, list);
    const bindings = actualDefinitions.map((def) => {
      const q = this.definitions.queues[ def.queueAlias ? def.queueAlias : def.target ];
      return this.createBinding(
        {
          source: def.exchange || def.source,
          target: q ? q.uniqueName : def.target,
          keys: def.keys,
          queue: q !== undefined,
          queueAlias: q ? q.name : undefined
        });
    });
    if (bindings.length === 0) {
      return Promise.resolve(true);
    } else {
      return Promise.all(bindings);
    }
  }
};

Topology.prototype.configureQueues = function (queueDef, list) {
  if (isUndefined(queueDef)) {
    return Promise.resolve(true);
  } else {
    const actualDefinitions = toArray(queueDef, list);
    const queues = actualDefinitions.map((def) => this.createQueue(def));
    return Promise.all(queues);
  }
};

Topology.prototype.configureExchanges = function (exchangeDef, list) {
  if (isUndefined(exchangeDef)) {
    return Promise.resolve(true);
  } else {
    const actualDefinitions = toArray(exchangeDef, list);
    const exchanges = actualDefinitions.map((def) => this.createExchange(def));
    return Promise.all(exchanges);
  }
};

Topology.prototype.createBinding = function (options) {
  let id = `${options.source}->${options.target}`;
  const keys = getKeys(options.keys);
  if (keys[0] !== '') {
    id += ':' + keys.join(':');
  }
  let promise = this.promises[ id ];
  if (!promise) {
    this.definitions.bindings[ id ] = options;
    const call = options.queue ? 'bindQueue' : 'bindExchange';
    const source = options.source;
    let target = options.target;
    if (options.queue) {
      const queue = this.definitions.queues[ options.target ];
      if (queue && queue.uniqueName) {
        target = queue.uniqueName;
      }
    }
    this.promises[ id ] = promise = this.connection.getChannel('control', false, 'control channel for bindings')
      .then((channel) => {
        log.info("Binding %s '%s' to '%s' on '%s' with keys: %s",
          (options.queue ? 'queue' : 'exchange'), target, source, this.connection.name, JSON.stringify(keys));
        return Promise.all(
          keys.map((key) => channel[ call ](target, source, key))
        );
      });
  }
  return promise;
};

Topology.prototype.createPrimitive = function (Primitive, primitiveType, options) {
  var errorFn = function (err) {
    return new Error('Failed to create ' + primitiveType + " '" + options.name +
      "' on connection '" + this.connection.name +
      "' with '" + (err ? (err.stack || err) : 'N/A') + "'");
  }.bind(this);
  const definitions = primitiveType === 'exchange' ? this.definitions.exchanges : this.definitions.queues;
  const channelName = `${primitiveType}:${options.name}`;
  let promise = this.promises[ channelName ];
  if (!promise) {
    this.promises[ channelName ] = promise = new Promise((resolve, reject) => {
      definitions[ options.name ] = options;
      const primitive = this.channels[ channelName ] = new Primitive(options, this.connection, this, this.serializers);
      const onConnectionFailed = function (connectionError) {
        reject(errorFn(connectionError));
      };
      if (this.connection.state === 'failed') {
        onConnectionFailed(this.connection.lastError());
      } else {
        var onFailed = this.connection.on('failed', function (err) {
          onConnectionFailed(err);
        });
        primitive.once('defined', function () {
          onFailed.unsubscribe();
          resolve(primitive);
        });
      }
      primitive.once('failed', function (err) {
        delete definitions[ options.name ];
        delete this.channels[ channelName ];
        delete this.promises[ channelName ];
        reject(errorFn(err));
      }.bind(this));
    });
  }
  return promise;
};

Topology.prototype.createDefaultExchange = function () {
  return this.createExchange({ name: '', passive: true });
};

Topology.prototype.createExchange = function (options) {
  return this.createPrimitive(Exchange, 'exchange', options);
};

Topology.prototype.createQueue = function (options) {
  options.uniqueName = this.getUniqueName(options);
  return this.createPrimitive(Queue, 'queue', options);
};

Topology.prototype.createReplyQueue = function () {
  if (this.replyQueue.name === false) {
    return Promise.resolve();
  }
  var key = 'queue:' + this.replyQueue.name;
  var promise;
  if (!this.channels[ key ]) {
    promise = this.createQueue(this.replyQueue);
    promise.then(
      (channel) => {
        this.channels[ key ] = channel;
        this.emit('replyQueue.ready', this.replyQueue);
      },
      this.onReplyQueueFailed.bind(this)
    );
  } else {
    promise = Promise.resolve(this.channels[ key ]);
    this.emit('replyQueue.ready', this.replyQueue);
  }
  return promise;
};

Topology.prototype.deleteExchange = function (name) {
  var key = 'exchange:' + name;
  var channel = this.channels[ key ];
  if (channel) {
    channel.release();
    delete this.channels[ key ];
    delete this.promises[ key ];
    log.info("Deleting %s exchange '%s' on connection '%s'", channel.type, name, this.connection.name);
  }
  return this.connection.getChannel('control', false, 'control channel for bindings')
    .then(function (channel) {
      return channel.deleteExchange(name);
    });
};

Topology.prototype.deleteQueue = function (name) {
  var key = 'queue:' + name;
  var channel = this.channels[ key ];
  if (channel) {
    channel.release();
    delete this.channels[ key ];
    delete this.promises[ key ];
    log.info("Deleting queue '%s' on connection '%s'", name, this.connection.name);
  }
  return this.connection.getChannel('control', false, 'control channel for bindings')
    .then(function (channel) {
      return channel.deleteQueue(name);
    });
};

Topology.prototype.getUniqueName = function (options) {
  if (options.unique === 'id') {
    return `${info.id}-${options.name}`;
  } else if (options.unique === 'hash') {
    return `${options.name}-${info.createHash()}`;
  } else if (options.unique === 'consistent') {
    return `${options.name}-${info.createConsistentHash()}`;
  } else {
    return options.name;
  }
};

Topology.prototype.handleReturned = function (raw) {
  raw.type = isEmpty(raw.properties.type) ? raw.fields.routingKey : raw.properties.type;
  const contentType = raw.properties.contentType || 'application/octet-stream';
  const serializer = this.serializers[ contentType ];
  if (!serializer) {
    log.error("Could not deserialize message id %s, connection '%s' - no serializer defined",
      raw.properties.messageId, this.connection.name);
  } else {
    try {
      raw.body = serializer.deserialize(raw.content, raw.properties.contentEncoding);
    } catch (err) {
    }
  }

  this.onReturned(raw);
};

Topology.prototype.onReconnect = function () {
  log.info("Reconnection to '%s' established - rebuilding topology", this.name);
  this.promises = {};

  this.createReplyQueue().then(null, this.onReplyQueueFailed);
  this.createDefaultExchange().then(null, noop);
  const channelPromises = this.reconnectChannels();
  return Promise.all(channelPromises || [])
    .then(this.completeRebuild.bind(this));
};

Topology.prototype.onReplyQueueFailed = function (err) {
  log.error(`Failed to create reply queue for connection name ' ${this.connection.name}' with ${err}`);
};

// retrieves a promises to ensure the re-establishment for all
// underlying channels after a reconnect
Topology.prototype.reconnectChannels = function () {
  const channelNames = Object.keys(this.channels);
  const channelPromises = channelNames.map((channelName) => {
    const channel = this.channels[ channelName ];
    return channel.reconnect ? channel.reconnect() : Promise.resolve(true);
  });
  return channelPromises;
};

Topology.prototype.reset = function () {
  this.channels = {};
  this.definitions = {
    bindings: {},
    exchanges: {},
    queues: {},
    subscriptions: {}
  };
};

Topology.prototype.renameQueue = function (newQueueName) {
  const queue = this.definitions.queues[ '' ];
  const channel = this.channels[ 'queue:' ];
  this.definitions.queues[ newQueueName ] = queue;
  this.channels[ `queue:${newQueueName}` ] = channel;
  delete this.definitions.queues[ '' ];
  delete this.channels[ 'queue:' ];
};

Topology.prototype.removeBinding = function (options) {
  let id = `${options.source}->${options.target}`;
  const keys = getKeys(options.keys);
  if (keys[0] !== '') {
    id += ':' + keys.join(':');
  }
  let promise = this.promises[ id ];
  if (promise) {
    const call = options.queue ? 'unbindQueue' : 'unbindExchange';
    const source = options.source;
    let target = options.target;
    if (options.queue) {
      var queue = this.definitions.queues[ options.target ];
      if (queue && queue.uniqueName) {
        target = queue.uniqueName;
      }
    }
    promise = this.connection.getChannel('control', false, 'control channel for bindings')
      .then((channel) => {
        log.info(`Unbinding ${options.queue ? 'queue' : 'exchange'} '${target}' to '${source}' on '${this.connection.name}' with keys: ${JSON.stringify(keys)}`);
        return Promise.all(
          keys.map((key) => {
            return channel[ call ](target, source, key);
          }));
      })
      .then((channel) => {
        delete this.promises[ id ];
        delete this.definitions.bindings[ id ];
      });
  } else {
    promise = Promise.resolve();
  }
  return promise;
};

Monologue.mixInto(Topology);

module.exports = function (connection, options, serializers, unhandledStrategies, returnedStrategies, exchangeFsm, queueFsm, defaultId) {
  // allows us to optionally provide mocks and control the default queue name
  Exchange = exchangeFsm || require('./exchangeFsm.js');
  Queue = queueFsm || require('./queueFsm.js');
  replyId = defaultId || info.id;

  return new Topology(connection, options, serializers, unhandledStrategies, returnedStrategies);
};
