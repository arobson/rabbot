const _ = require('fauxdash')
const log = require('./log')('rabbot.topology')
const info = require('./info')
const Dispatcher = require('topic-dispatch')
let Exchange, Queue
let replyId

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

const DIRECT_REPLY_TO = 'amq.rabbitmq.reply-to'
const noop = () => {}

function getKeys (keys) {
  let actualKeys = ['']
  if (keys && keys.length > 0) {
    actualKeys = Array.isArray(keys) ? keys : [keys]
  }
  return actualKeys
}

function isUndefined (value) {
  return value === null || value === undefined
}

function isEmpty (value) {
  return value === null || value === undefined || value === '' || value === {}
}

function isObject (value) {
  return typeof value === 'object'
}

function has (obj, property) {
  return obj && obj[property] != null
}

function toArray (x, list) {
  if (Array.isArray(x)) {
    return x
  }
  if (isObject(x) && list) {
    const keys = Object.keys(x)
    return keys.map((key) => x[key])
  }
  if (x === null || x === undefined || x === '') {
    return []
  }
  return [x]
}

const Topology = function (connection, options, serializers, unhandledStrategies, returnedStrategies) {
  const autoReplyTo = { name: `${replyId}.response.queue`, autoDelete: true, subscribe: true }
  const rabbitReplyTo = { name: DIRECT_REPLY_TO, subscribe: true, noAck: true }
  const userReplyTo = isObject(options.replyQueue) ? options.replyQueue : { name: options.replyQueue, autoDelete: true, subscribe: true }

  this.name = options.name
  this.connection = connection
  this.primitives = {}
  this.promises = {}
  this.definitions = {
    bindings: {},
    exchanges: {},
    queues: {}
  }
  this.options = options
  this.replyQueue = { name: false }
  this.serializers = serializers
  this.onUnhandled = m => unhandledStrategies.onUnhandled(m)
  this.onReturned = m => {
    returnedStrategies.onReturned(m)
  }
  let replyQueueName = ''

  if (has(options, 'replyQueue')) {
    replyQueueName = options.replyQueue.name || options.replyQueue
    if (replyQueueName === false) {
      this.replyQueue = { name: false }
    } else if (/^rabbit(mq)?$/i.test(replyQueueName) || replyQueueName === undefined) {
      this.replyQueue = rabbitReplyTo
    } else if (replyQueueName) {
      this.replyQueue = userReplyTo
    }
  } else {
    this.replyQueue = autoReplyTo
  }

  connection.on('reconnected', this.onReconnect.bind(this))
  connection.on('return', this.handleReturned.bind(this))
}

Topology.prototype.completeRebuild = function () {
  return this.configureBindings(this.definitions.bindings, true)
    .then(() => {
      log.info(`Topology rebuilt for connection '${this.connection.name}'`)
      this.connection.emit('bindings.completed', this.definitions)
      this.connection.emit(this.connection.name + '.connection.configured', this.connection)
    })
}

Topology.prototype.configureBindings = function (bindingDef, list) {
  if (isUndefined(bindingDef)) {
    return Promise.resolve(true)
  } else {
    const actualDefinitions = toArray(bindingDef, list)
    const bindings = actualDefinitions.map((def) => {
      const q = this.definitions.queues[def.queueAlias ? def.queueAlias : def.target]
      return this.createBinding(
        {
          source: def.exchange || def.source,
          target: q ? q.uniqueName : def.target,
          keys: def.keys,
          queue: q !== undefined,
          queueAlias: q ? q.name : undefined
        })
    })
    if (bindings.length === 0) {
      return Promise.resolve(true)
    } else {
      return Promise.all(bindings)
    }
  }
}

Topology.prototype.configureQueues = function (queueDef, list) {
  if (isUndefined(queueDef)) {
    return Promise.resolve(true)
  } else {
    const actualDefinitions = toArray(queueDef, list)
    const queues = actualDefinitions.map((def) => this.createQueue(def))
    return Promise.all(queues)
  }
}

Topology.prototype.configureExchanges = function (exchangeDef, list) {
  if (isUndefined(exchangeDef)) {
    return Promise.resolve(true)
  } else {
    const actualDefinitions = toArray(exchangeDef, list)
    const exchanges = actualDefinitions.map((def) => this.createExchange(def))
    return Promise.all(exchanges)
  }
}

Topology.prototype.createBinding = function (options) {
  let id = `${options.source}->${options.target}`
  const keys = getKeys(options.keys)
  if (keys[0] !== '') {
    id += ':' + keys.join(':')
  }
  let promise = this.promises[id]
  if (!promise) {
    this.definitions.bindings[id] = options
    const call = options.queue ? 'bindQueue' : 'bindExchange'
    const source = options.source
    let target = options.target
    if (options.queue) {
      const queue = this.definitions.queues[options.target]
      if (queue && queue.uniqueName) {
        target = queue.uniqueName
      }
    }
    this.promises[id] = promise = this.connection.getChannel('control', false, 'control channel for bindings')
      .then((channel) => {
        log.info(
          `Binding ${options.queue ? 'queue' : 'exchange'} '${target}' to '${source}' on '${this.connection.name}' with keys: ${JSON.stringify(keys)}`,
        )
        return Promise.all(
          keys.map((key) => channel[call](target, source, key))
        )
      })
  }
  return promise.then(results => {
    return results;
  })
}

Topology.prototype.createPrimitive = function (Primitive, options) {
  const definitions = Primitive.type === 'exchange' ? this.definitions.exchanges : this.definitions.queues
  const primitiveName = `${Primitive.type}:${options.name}`
  let promise = this.promises[primitiveName]
  if (!promise) {
    const future = _.future()
    promise = future.promise
    this.promises[primitiveName] = future.promise
    definitions[options.name] = options
    const primitive = this.primitives[primitiveName] = new Primitive(options, this.connection, this, this.serializers)
    const onConnectionFailed = err => {
      future.reject(new Error(
        `Failed to create ${Primitive.type} '${options.name}' on connection '${this.connection.name}' with ${err ? (err.stack || err) : 'N/A'}`
      ))
    }
    if (this.connection.currentState === 'failed' || this.connection.currentState === 'unreachable') {
      onConnectionFailed(this.connection.lastError())
    } else {
      const onFailed = this.connection.on('failed', function (err) {
        onConnectionFailed(err)
      })
      primitive.once('defined', () => {
        onFailed.remove()
        future.resolve(primitive)
        log.debug(`${Primitive.type} '${options.name}' created on '${this.connection.name}'`)
      })
    }
    primitive.once('failed', err => {
      delete definitions[options.name]
      delete this.primitives[primitiveName]
      delete this.promises[primitiveName]
      future.reject(new Error(
        `Failed to create ${Primitive.type} '${options.name}' on connection '${this.connection.name}' with ${err ? (err.stack || err) : 'N/A'}`
      ))
    })
  }
  return promise
}

Topology.prototype.createDefaultExchange = function () {
  return this.createExchange({ name: '', passive: true })
}

Topology.prototype.createExchange = function (options) {
  return this.createPrimitive(Exchange, options)
}

Topology.prototype.createQueue = function (options) {
  options.uniqueName = this.getUniqueName(options)
  return this.createPrimitive(Queue, options)
}

Topology.prototype.createReplyQueue = function () {
  if (this.replyQueue.name === false) {
    return Promise.resolve()
  }
  const key = 'queue:' + this.replyQueue.name
  let promise
  if (!this.primitives[key]) {
    promise = this.createQueue(this.replyQueue)
    promise.then(
      (channel) => {
        this.primitives[key] = channel
        this.connection.emit('replyQueue.ready', this.replyQueue)
      },
      this.onReplyQueueFailed.bind(this)
    )
  } else {
    promise = Promise.resolve(this.primitives[key])
    this.connection.emit('replyQueue.ready', this.replyQueue)
  }
  return promise
}

Topology.prototype.deleteExchange = function (name) {
  const key = 'exchange:' + name
  const primitive = this.primitives[key]
  if (primitive) {
    primitive.release()
    delete this.primitives[key]
    delete this.promises[key]
    log.info(
      `Deleting ${primitive.type} exchange '${name}' on connection '${this.connection.name}'`
    )
  }
  return this.connection.getChannel('control', false, 'control channel for bindings')
    .then(function (channel) {
      return channel.deleteExchange(name)
    })
}

Topology.prototype.deleteQueue = function (name) {
  const key = 'queue:' + name
  const primitive = this.primitives[key]
  if (primitive) {
    primitive.release()
    delete this.primitives[key]
    delete this.promises[key]
    log.info(`Deleting queue '${name}' on connection '${this.connection.name}'`)
  }
  return this.connection.getChannel('control', false, 'control channel for bindings')
    .then(function (channel) {
      return channel.deleteQueue(name)
    })
}

Topology.prototype.getUniqueName = function (options) {
  if (options.unique === 'id') {
    return `${info.id}-${options.name}`
  } else if (options.unique === 'hash') {
    return `${options.name}-${info.createHash()}`
  } else if (options.unique === 'consistent') {
    return `${options.name}-${info.createConsistentHash()}`
  } else {
    return options.name
  }
}

Topology.prototype.handleReturned = function (raw) {
  raw.type = isEmpty(raw.properties.type) ? raw.fields.routingKey : raw.properties.type
  const contentType = raw.properties.contentType || 'application/octet-stream'
  const serializer = this.serializers[contentType]
  if (!serializer) {
    log.error(
      `Could not deserialize message id ${raw.properties.messageId}, connection '${this.connection.name}' - no serializer defined`
    )
  } else {
    try {
      raw.body = serializer.deserialize(raw.content, raw.properties.contentEncoding)
    } catch (err) {
    }
  }

  this.onReturned(raw)
}

Topology.prototype.onReconnect = function () {
  log.info(`Reconnection to '${this.name}' established - rebuilding topology`)
  this.promises = {}
  const results = this.establishPrimitives()
  return Promise.all(results || [])
    .then(this.completeRebuild.bind(this))
}

Topology.prototype.onReplyQueueFailed = function (err) {
  log.error(`Failed to create reply queue for connection name '${this.connection.name}' with ${err}`)
}

// retrieves a promises to ensure the re-establishment for all
// underlying channels after a reconnect
Topology.prototype.establishPrimitives = function () {
  const primitiveNames = Object.keys(this.primitives)
  const channelPromises = primitiveNames.sort().map((primitiveName) => {
    const channel = this.primitives[primitiveName]
    return channel.reconnect ? channel.reconnect() : Promise.resolve(true)
  })
  return channelPromises
}

Topology.prototype.reset = function () {
  this.primitives = {}
  this.definitions = {
    bindings: {},
    exchanges: {},
    queues: {},
    subscriptions: {}
  }
}

Topology.prototype.renameQueue = function (newQueueName) {
  const queue = this.definitions.queues['']
  const channel = this.primitives['queue:']
  this.definitions.queues[newQueueName] = queue
  this.primitives[`queue:${newQueueName}`] = channel
  delete this.definitions.queues['']
  delete this.primitives['queue:']
}

Topology.prototype.removeBinding = function (options) {
  let id = `${options.source}->${options.target}`
  const keys = getKeys(options.keys)
  if (keys[0] !== '') {
    id += ':' + keys.join(':')
  }
  let promise = this.promises[id]
  if (promise) {
    const call = options.queue ? 'unbindQueue' : 'unbindExchange'
    const source = options.source
    let target = options.target
    if (options.queue) {
      const queue = this.definitions.queues[options.target]
      if (queue && queue.uniqueName) {
        target = queue.uniqueName
      }
    }
    promise = this.connection.getChannel('control', false, 'control channel for bindings')
      .then((channel) => {
        log.info(`Unbinding ${options.queue ? 'queue' : 'exchange'} '${target}' to '${source}' on '${this.connection.name}' with keys: ${JSON.stringify(keys)}`)
        return Promise.all(
          keys.map((key) => {
            return channel[call](target, source, key)
          }))
      })
      .then((channel) => {
        delete this.promises[id]
        delete this.definitions.bindings[id]
      })
  } else {
    promise = Promise.resolve()
  }
  return promise
}

module.exports = async function (connection, options, serializers, unhandledStrategies, returnedStrategies, exchangeFsm, queueFsm, defaultId) {
  // allows us to optionally provide mocks and control the default queue name
  Exchange = exchangeFsm || require('./exchangeFsm.js')
  Queue = queueFsm || require('./queueFsm.js')
  replyId = defaultId || info.id
  const topology = new Topology(connection, options, serializers, unhandledStrategies, returnedStrategies)
  const melt = _.melter({}, topology, Dispatcher())
  return melt.createReplyQueue()
    .catch(melt.onReplyQueueFailed.bind(melt))
    .then(() => melt.createDefaultExchange())
    .then(() => melt)
}
