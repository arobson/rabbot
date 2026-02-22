import { EventEmitter } from 'events';
import log from './log.js';
import info from './info.js';
import ExchangeFsm from './exchangeFsm.js';
import QueueFsm from './queueFsm.js';
const logger = log('rabbot.topology');
const DIRECT_REPLY_TO = 'amq.rabbitmq.reply-to';
const noop = () => { };
function getKeys(keys) {
    if (keys && (Array.isArray(keys) ? keys.length > 0 : true)) {
        return Array.isArray(keys) ? keys : [keys];
    }
    return [''];
}
function isUndefined(value) {
    return value === null || value === undefined;
}
function isEmpty(value) {
    return value === null || value === undefined || value === '';
}
function isObject(value) {
    return typeof value === 'object';
}
function has(obj, property) {
    return obj && obj[property] != null;
}
function toArray(x, list) {
    if (Array.isArray(x)) {
        return x;
    }
    if (isObject(x) && list) {
        const keys = Object.keys(x);
        return keys.map((key) => x[key]);
    }
    if (x === null || x === undefined || x === '') {
        return [];
    }
    return [x];
}
class Topology extends EventEmitter {
    Exchange;
    Queue;
    replyId;
    name;
    connection;
    channels;
    promises;
    definitions;
    options;
    replyQueue;
    serializers;
    onUnhandled;
    onReturned;
    constructor(connection, options, serializers, unhandledStrategies, returnedStrategies, Exchange, Queue, replyId) {
        super();
        this.Exchange = Exchange;
        this.Queue = Queue;
        this.replyId = replyId;
        const autoReplyTo = { name: `${replyId}.response.queue`, autoDelete: true, subscribe: true };
        const rabbitReplyTo = { name: 'amq.rabbitmq.reply-to', subscribe: true, noAck: true };
        const userReplyTo = isObject(options.replyQueue)
            ? options.replyQueue
            : { name: options.replyQueue, autoDelete: true, subscribe: true };
        this.name = options.name || 'default';
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
            const rq = options.replyQueue;
            replyQueueName = (rq && isObject(rq) ? rq.name : rq);
            if (replyQueueName === false) {
                this.replyQueue = { name: false };
            }
            else if (replyQueueName) {
                this.replyQueue = userReplyTo;
            }
            else if (/^rabbit(mq)?$/i.test(replyQueueName) || replyQueueName === undefined) {
                this.replyQueue = rabbitReplyTo;
            }
        }
        else {
            this.replyQueue = autoReplyTo;
        }
        connection.on('reconnected', () => this.onReconnect());
        connection.on('return', (raw) => this.handleReturned(raw));
        this.createDefaultExchange().catch(noop);
        process.nextTick(() => {
            this.createReplyQueue().catch((err) => this.onReplyQueueFailed(err));
        });
    }
    completeRebuild() {
        return this.configureBindings(this.definitions.bindings, true)
            .then(() => {
            logger.info("Topology rebuilt for connection '%s'", this.connection.name);
            this.emit('bindings.completed', this.definitions);
            this.emit(this.connection.name + '.connection.configured', this.connection);
        });
    }
    configureBindings(bindingDef, list) {
        if (isUndefined(bindingDef)) {
            return Promise.resolve(true);
        }
        else {
            const actualDefinitions = toArray(bindingDef, list);
            const bindings = actualDefinitions.map((def) => {
                const q = this.definitions.queues[def.queueAlias ? def.queueAlias : def.target];
                return this.createBinding({
                    source: def.exchange || def.source || '',
                    target: q ? q.uniqueName || def.target : def.target,
                    keys: def.keys,
                    queue: q !== undefined,
                    queueAlias: q ? q.name : undefined
                });
            });
            if (bindings.length === 0) {
                return Promise.resolve(true);
            }
            else {
                return Promise.all(bindings);
            }
        }
    }
    configureQueues(queueDef, list) {
        if (isUndefined(queueDef)) {
            return Promise.resolve(true);
        }
        else {
            const actualDefinitions = toArray(queueDef, list);
            const queues = actualDefinitions.map((def) => this.createQueue(def));
            return Promise.all(queues);
        }
    }
    configureExchanges(exchangeDef, list) {
        if (isUndefined(exchangeDef)) {
            return Promise.resolve(true);
        }
        else {
            const actualDefinitions = toArray(exchangeDef, list);
            const exchanges = actualDefinitions.map((def) => this.createExchange(def));
            return Promise.all(exchanges);
        }
    }
    createBinding(options) {
        let id = `${options.source}->${options.target}`;
        const keys = getKeys(options.keys);
        if (keys[0] !== '') {
            id += ':' + keys.join(':');
        }
        let promise = this.promises[id];
        if (!promise) {
            this.definitions.bindings[id] = options;
            const call = options.queue ? 'bindQueue' : 'bindExchange';
            const source = options.source;
            let target = options.target;
            if (options.queue) {
                const queue = this.definitions.queues[options.target];
                if (queue && queue.uniqueName) {
                    target = queue.uniqueName;
                }
            }
            this.promises[id] = promise = this.connection.getChannel('control', false, 'control channel for bindings')
                .then((channel) => {
                logger.info("Binding %s '%s' to '%s' on '%s' with keys: %s", (options.queue ? 'queue' : 'exchange'), target, source, this.connection.name, JSON.stringify(keys));
                return Promise.all(keys.map((key) => channel[call](target, source, key)));
            });
        }
        return promise;
    }
    createPrimitive(Primitive, primitiveType, options) {
        const errorFn = (err) => new Error('Failed to create ' + primitiveType + " '" + options.name +
            "' on connection '" + this.connection.name +
            "' with '" + (err ? (err.stack || err) : 'N/A') + "'");
        const definitions = primitiveType === 'exchange' ? this.definitions.exchanges : this.definitions.queues;
        const channelName = `${primitiveType}:${options.name}`;
        let promise = this.promises[channelName];
        if (!promise) {
            this.promises[channelName] = promise = new Promise((resolve, reject) => {
                definitions[options.name] = options;
                const primitive = this.channels[channelName] = Primitive(options, this.connection, this, this.serializers);
                const onConnectionFailed = (connectionError) => {
                    reject(errorFn(connectionError));
                };
                const connState = this.connection.currentState || this.connection.state;
                if (connState === 'failed') {
                    onConnectionFailed(this.connection.lastError?.());
                }
                else {
                    const onFailed = this.connection.on('failed', (err) => {
                        onConnectionFailed(err);
                    });
                    primitive.once('defined', () => {
                        onFailed.off();
                        resolve(primitive);
                    });
                }
                primitive.once('failed', (err) => {
                    delete definitions[options.name];
                    delete this.channels[channelName];
                    delete this.promises[channelName];
                    reject(errorFn(err));
                });
            });
        }
        return promise;
    }
    createDefaultExchange() {
        return this.createExchange({ name: '', passive: true });
    }
    createExchange(options) {
        return this.createPrimitive(this.Exchange, 'exchange', options);
    }
    createQueue(options) {
        options.uniqueName = this.getUniqueName(options);
        return this.createPrimitive(this.Queue, 'queue', options);
    }
    createReplyQueue() {
        if (this.replyQueue.name === false) {
            return Promise.resolve();
        }
        const key = 'queue:' + this.replyQueue.name;
        let promise;
        if (!this.channels[key]) {
            promise = this.createQueue(this.replyQueue);
            promise.then((channel) => {
                this.channels[key] = channel;
                this.emit('replyQueue.ready', this.replyQueue);
            }, (err) => this.onReplyQueueFailed(err));
        }
        else {
            promise = Promise.resolve(this.channels[key]);
            this.emit('replyQueue.ready', this.replyQueue);
        }
        return promise;
    }
    deleteExchange(name) {
        const key = 'exchange:' + name;
        const channel = this.channels[key];
        if (channel) {
            channel.release?.();
            delete this.channels[key];
            delete this.promises[key];
            logger.info("Deleting %s exchange '%s' on connection '%s'", channel.type, name, this.connection.name);
        }
        return this.connection.getChannel('control', false, 'control channel for bindings')
            .then((ch) => ch.deleteExchange(name));
    }
    deleteQueue(name) {
        const key = 'queue:' + name;
        const channel = this.channels[key];
        if (channel) {
            channel.release?.();
            delete this.channels[key];
            delete this.promises[key];
            logger.info("Deleting queue '%s' on connection '%s'", name, this.connection.name);
        }
        return this.connection.getChannel('control', false, 'control channel for bindings')
            .then((ch) => ch.deleteQueue(name));
    }
    getUniqueName(options) {
        if (options.unique === 'id') {
            return `${info.id}-${options.name}`;
        }
        else if (options.unique === 'hash') {
            return `${options.name}-${info.createHash()}`;
        }
        else if (options.unique === 'consistent') {
            return `${options.name}-${info.createConsistentHash()}`;
        }
        else {
            return options.name;
        }
    }
    handleReturned(raw) {
        const msg = raw;
        msg.type = isEmpty(msg.properties.type) ? msg.fields.routingKey : msg.properties.type;
        const contentType = msg.properties.contentType || 'application/octet-stream';
        const serializer = this.serializers[contentType];
        if (!serializer) {
            logger.error("Could not deserialize message id %s, connection '%s' - no serializer defined", msg.properties.messageId, this.connection.name);
        }
        else {
            try {
                msg.body = serializer.deserialize(msg.content, msg.properties.contentEncoding);
            }
            catch {
                // ignore deserialization errors
            }
        }
        this.onReturned(msg);
    }
    onReconnect() {
        logger.info("Reconnection to '%s' established - rebuilding topology", this.name);
        this.promises = {};
        this.createReplyQueue().catch((err) => this.onReplyQueueFailed(err));
        this.createDefaultExchange().catch(noop);
        const channelPromises = this.reconnectChannels();
        Promise.all(channelPromises || [])
            .then(() => this.completeRebuild());
    }
    onReplyQueueFailed(err) {
        logger.error(`Failed to create reply queue for connection name '${this.connection.name}' with ${err}`);
    }
    reconnectChannels() {
        const channelNames = Object.keys(this.channels);
        return channelNames.map((channelName) => {
            const channel = this.channels[channelName];
            const reconnectable = channel;
            return reconnectable.reconnect ? reconnectable.reconnect() : Promise.resolve(true);
        });
    }
    reset() {
        this.channels = {};
        this.promises = {};
        this.definitions = {
            bindings: {},
            exchanges: {},
            queues: {}
        };
    }
    renameQueue(newQueueName) {
        const queue = this.definitions.queues[''];
        const channel = this.channels['queue:'];
        this.definitions.queues[newQueueName] = queue;
        this.channels[`queue:${newQueueName}`] = channel;
        delete this.definitions.queues[''];
        delete this.channels['queue:'];
    }
    removeBinding(options) {
        let id = `${options.source}->${options.target}`;
        const keys = getKeys(options.keys);
        if (keys[0] !== '') {
            id += ':' + keys.join(':');
        }
        let promise = this.promises[id];
        if (promise) {
            const call = options.queue ? 'unbindQueue' : 'unbindExchange';
            const source = options.source;
            let target = options.target;
            if (options.queue) {
                const queue = this.definitions.queues[options.target];
                if (queue && queue.uniqueName) {
                    target = queue.uniqueName;
                }
            }
            promise = this.connection.getChannel('control', false, 'control channel for bindings')
                .then((channel) => {
                logger.info(`Unbinding ${options.queue ? 'queue' : 'exchange'} '${target}' to '${source}' on '${this.connection.name}' with keys: ${JSON.stringify(keys)}`);
                return Promise.all(keys.map((key) => channel[call](target, source, key)));
            })
                .then(() => {
                delete this.promises[id];
                delete this.definitions.bindings[id];
            });
        }
        else {
            promise = Promise.resolve();
        }
        return promise;
    }
}
export default function createTopology(connection, options, serializers, unhandledStrategies, returnedStrategies, exchangeFsm, queueFsm, defaultId) {
    const Exchange = exchangeFsm || ExchangeFsm;
    const Queue = queueFsm || QueueFsm;
    const replyId = defaultId || info.id;
    return new Topology(connection, options, serializers, unhandledStrategies, returnedStrategies, Exchange, Queue, replyId);
}
//# sourceMappingURL=topology.js.map