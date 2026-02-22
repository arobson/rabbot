import { EventEmitter } from 'events';
import { v1 as uuidV1 } from 'uuid';
import connectionFn from './connectionFsm.js';
import topologyFn from './topology.js';
import { dispatch, responses } from './amqp/queue.js';
import { AckBatch } from './ackBatch.js';
import log from './log.js';
const DEFAULT = 'default';
const unhandledStrategies = {
    nackOnUnhandled(message) {
        message.nack();
    },
    rejectOnUnhandled(message) {
        message.reject();
    },
    customOnUnhandled(_message) { },
    onUnhandled(message) {
        unhandledStrategies.nackOnUnhandled(message);
    }
};
const returnedStrategies = {
    customOnReturned() { },
    onReturned(message) {
        returnedStrategies.customOnReturned(message);
    }
};
const serializers = {
    'application/json': {
        deserialize: (bytes, encoding) => {
            return JSON.parse(bytes.toString((encoding || 'utf8')));
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
            }
            else if (Array.isArray(bytes)) {
                return Buffer.from(bytes);
            }
            else {
                throw new Error('Cannot serialize unknown data type');
            }
        }
    },
    'text/plain': {
        deserialize: (bytes, encoding) => {
            return bytes.toString((encoding || 'utf8'));
        },
        serialize: (string) => {
            return Buffer.from(string, 'utf8');
        }
    }
};
class Broker extends EventEmitter {
    connections = {};
    hasHandles = false;
    autoNack = false;
    serializers = serializers;
    configurations = {};
    configuring = {};
    log = log;
    appId;
    ackIntervalId;
    addConnection(opts) {
        const options = Object.assign({}, {
            name: DEFAULT,
            retryLimit: 3,
            failAfter: 60
        }, opts);
        const name = options.name;
        const connectionPromise = new Promise((resolve, reject) => {
            if (!this.connections[name]) {
                const connection = connectionFn(options);
                const topology = topologyFn(connection, options, serializers, unhandledStrategies, returnedStrategies);
                connection.on('connected', () => {
                    this.emit('connected', connection);
                    this.emit(connection.name + '.connection.opened', connection);
                    this.setAckInterval(500);
                    resolve(topology);
                });
                connection.on('closed', () => {
                    this.emit('closed', connection);
                    this.emit(connection.name + '.connection.closed', connection);
                    reject(new Error('connection closed'));
                });
                connection.on('failed', (err) => {
                    this.emit('failed', connection);
                    this.emit(name + '.connection.failed', err);
                    reject(err);
                });
                connection.on('unreachable', () => {
                    this.emit('unreachable', connection);
                    this.emit(name + '.connection.unreachable');
                    this.clearAckInterval();
                    reject(new Error('connection unreachable'));
                });
                connection.on('return', (raw) => {
                    this.emit('return', raw);
                });
                this.connections[name] = topology;
            }
            else {
                const existing = this.connections[name];
                existing.connection.connect();
                resolve(existing);
            }
        });
        if (this.connections[name] && !this.connections[name].promise) {
            this.connections[name].promise = connectionPromise;
        }
        return connectionPromise;
    }
    addExchange(name, type, options = {}, connectionName = DEFAULT) {
        if (typeof name === 'object') {
            options = name;
            options.connectionName = (options.connectionName || type || connectionName);
        }
        else {
            options.name = name;
            options.type = type;
            options.connectionName = options.connectionName || connectionName;
        }
        return this.connections[options.connectionName].createExchange(options);
    }
    addQueue(name, options = {}, connectionName = DEFAULT) {
        options.name = name;
        if (options.subscribe && !this.hasHandles) {
            console.warn("Subscription to '" + name + "' was started without any handlers. This will result in lost messages!");
        }
        return this.connections[connectionName].createQueue(options);
    }
    addSerializer(contentType, serializer) {
        serializers[contentType] = serializer;
    }
    batchAck() {
        AckBatch.triggerSignal();
    }
    bindExchange(source, target, keys, connectionName = DEFAULT) {
        return this.connections[connectionName].createBinding({ source, target, keys });
    }
    bindQueue(source, target, keys, connectionName = DEFAULT) {
        return this.connections[connectionName].createBinding({ source, target, keys, queue: true });
    }
    bulkPublish(set, connectionName = DEFAULT) {
        if (set.connectionName) {
            connectionName = set.connectionName;
        }
        if (!this.connections[connectionName]) {
            return Promise.reject(new Error(`BulkPublish failed - no connection ${connectionName} has been configured`));
        }
        const publish = (exchange, options) => {
            options.appId = options.appId || this.appId;
            options.timestamp = options.timestamp || Date.now();
            if (this.connections[connectionName]?.options.publishTimeout) {
                options.connectionPublishTimeout = this.connections[connectionName].options.publishTimeout;
            }
            if (typeof options.body === 'number') {
                options.body = options.body.toString();
            }
            return exchange.publish(options)
                .then(() => options, (err) => ({ err, message: options }));
        };
        let exchangeNames;
        if (Array.isArray(set)) {
            exchangeNames = set.reduce((acc, m) => {
                if (m.exchange && acc.indexOf(m.exchange) < 0) {
                    acc.push(m.exchange);
                }
                return acc;
            }, []);
        }
        else {
            exchangeNames = Object.keys(set);
        }
        return this.onExchanges(exchangeNames, connectionName)
            .then((exchanges) => {
            if (!Array.isArray(set)) {
                const keys = Object.keys(set);
                return Promise.all(keys.map((exchangeName) => Promise.all((set[exchangeName]).map((message) => {
                    const exchange = exchanges[exchangeName];
                    if (exchange) {
                        return publish(exchange, message);
                    }
                    else {
                        return Promise.reject(new Error(`Publish failed - no exchange ${exchangeName} on connection ${connectionName} is defined`));
                    }
                }))));
            }
            else {
                return Promise.all(set.map((message) => {
                    const exchange = exchanges[message.exchange];
                    if (exchange) {
                        return publish(exchange, message);
                    }
                    else {
                        return Promise.reject(new Error(`Publish failed - no exchange ${message.exchange} on connection ${connectionName} is defined`));
                    }
                }));
            }
        });
    }
    clearAckInterval() {
        if (this.ackIntervalId) {
            clearInterval(this.ackIntervalId);
            this.ackIntervalId = undefined;
        }
    }
    closeAll(reset = false) {
        const connectionNames = Object.keys(this.connections);
        const closers = connectionNames.map((name) => this.close(name, reset));
        return Promise.all(closers);
    }
    close(connectionName = DEFAULT, reset = false) {
        const conn = this.connections[connectionName];
        if (!conn)
            return Promise.resolve(true);
        const connection = conn.connection;
        if (connection !== undefined && connection !== null) {
            if (reset) {
                conn.reset();
            }
            delete this.configuring[connectionName];
            return connection.close(reset);
        }
        else {
            return Promise.resolve(true);
        }
    }
    deleteExchange(name, connectionName = DEFAULT) {
        return this.connections[connectionName].deleteExchange(name);
    }
    deleteQueue(name, connectionName = DEFAULT) {
        return this.connections[connectionName].deleteQueue(name);
    }
    getExchange(name, connectionName = DEFAULT) {
        return this.connections[connectionName]?.channels[`exchange:${name}`];
    }
    getQueue(name, connectionName = DEFAULT) {
        return this.connections[connectionName]?.channels[`queue:${name}`];
    }
    handle(messageType, handler, queueName, context) {
        this.hasHandles = true;
        let options;
        if (typeof messageType === 'string') {
            options = {
                type: messageType,
                queue: queueName || '*',
                context: context,
                autoNack: this.autoNack,
                handler: handler
            };
        }
        else {
            options = messageType;
            options.autoNack = options.autoNack !== false;
            options.queue = options.queue || (options.type ? '*' : '#');
            options.handler = options.handler || handler;
        }
        const parts = [];
        if (options.queue === '#') {
            parts.push('#');
        }
        else {
            parts.push((options.queue || '').replace(/[.]/g, '-'));
            if (options.type !== '') {
                parts.push(options.type || '#');
            }
        }
        const target = parts.join('.');
        const boundHandler = options.handler.bind(options.context);
        const subscription = dispatch.on(target, (raw) => {
            try {
                boundHandler(raw);
            }
            catch (err) {
                if (options.autoNack) {
                    console.log("Handler for '" + target + "' failed with:", err.stack);
                    raw.nack();
                }
            }
        });
        return subscription;
    }
    ignoreHandlerErrors() {
        this.autoNack = false;
    }
    nackOnError() {
        this.autoNack = true;
    }
    nackUnhandled() {
        unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;
    }
    onUnhandled(handler) {
        const wrapped = (message) => handler(message);
        unhandledStrategies.onUnhandled = unhandledStrategies.customOnUnhandled = wrapped;
    }
    rejectUnhandled() {
        unhandledStrategies.onUnhandled = unhandledStrategies.rejectOnUnhandled;
    }
    onExchange(exchangeName, connectionName = DEFAULT) {
        const conn = this.connections[connectionName];
        const promises = [];
        if (conn.promise)
            promises.push(conn.promise);
        const ep = conn.promises[`exchange:${exchangeName}`];
        if (ep)
            promises.push(ep);
        const cp = this.configuring[connectionName];
        if (cp)
            promises.push(cp);
        return Promise.all(promises)
            .then(() => this.getExchange(exchangeName, connectionName));
    }
    onExchanges(exchanges, connectionName = DEFAULT) {
        const conn = this.connections[connectionName];
        const connectionPromises = [];
        if (conn.promise)
            connectionPromises.push(conn.promise);
        const cp = this.configuring[connectionName];
        if (cp)
            connectionPromises.push(cp);
        const set = {};
        return Promise.all(connectionPromises)
            .then(() => {
            const exchangePromises = exchanges.map((exchangeName) => {
                const ep = conn.promises[`exchange:${exchangeName}`];
                return ep
                    ? ep.then(() => ({ name: exchangeName, exchange: true }))
                    : Promise.resolve({ name: exchangeName, exchange: false });
            });
            return Promise.all(exchangePromises);
        })
            .then((list) => {
            list.forEach((item) => {
                if (item && item.exchange) {
                    const exchange = this.getExchange(item.name, connectionName);
                    if (exchange)
                        set[item.name] = exchange;
                }
            });
            return set;
        });
    }
    onReturned(handler) {
        returnedStrategies.onReturned = returnedStrategies.customOnReturned = handler;
    }
    publish(exchangeName, type, message, routingKey, correlationId, connectionName = DEFAULT, sequenceNo) {
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
            connectionName = options.connectionName || DEFAULT;
        }
        else {
            connectionName = connectionName || message?.connectionName || DEFAULT;
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
        if (this.connections[connectionName]?.options.publishTimeout) {
            options.connectionPublishTimeout = this.connections[connectionName].options.publishTimeout;
        }
        if (typeof options.body === 'number') {
            options.body = options.body.toString();
        }
        return this.onExchange(exchangeName, connectionName)
            .then((exchange) => {
            if (exchange) {
                return exchange.publish(options);
            }
            else {
                return Promise.reject(new Error(`Publish failed - no exchange ${exchangeName} on connection ${connectionName} is defined`));
            }
        });
    }
    purgeQueue(queueName, connectionName = DEFAULT) {
        if (!this.connections[connectionName]) {
            return Promise.reject(new Error(`Queue purge failed - no connection ${connectionName} has been configured`));
        }
        const conn = this.connections[connectionName];
        const p = conn.promise || Promise.resolve(conn);
        return p.then(() => {
            const queue = this.getQueue(queueName, connectionName);
            if (queue) {
                return queue.purge();
            }
            else {
                return Promise.reject(new Error(`Queue purge failed - no queue ${queueName} on connection ${connectionName} is defined`));
            }
        });
    }
    request(exchangeName, options = {}, notify, connectionName = DEFAULT) {
        const requestId = uuidV1();
        options.messageId = requestId;
        options.connectionName = options.connectionName || connectionName;
        if (!this.connections[options.connectionName]) {
            return Promise.reject(new Error(`Request failed - no connection ${options.connectionName} has been configured`));
        }
        return this.onExchange(exchangeName, options.connectionName)
            .then((exchange) => {
            const conn = this.connections[options.connectionName];
            const ex = exchange;
            const publishTimeout = options.timeout || ex?.publishTimeout || conn.options.publishTimeout || 500;
            const replyTimeout = options.replyTimeout || ex?.replyTimeout || conn.options.replyTimeout || (publishTimeout * 2);
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    subscription.off();
                    reject(new Error('No reply received within the configured timeout of ' + replyTimeout + ' ms'));
                }, replyTimeout);
                const scatter = options.expect;
                let remaining = options.expect;
                const subscription = responses.on(requestId, (message) => {
                    const msg = message;
                    const end = scatter
                        ? --remaining <= 0
                        : msg.properties.headers['sequence_end'];
                    if (end) {
                        clearTimeout(timeout);
                        if (!scatter || remaining === 0) {
                            resolve(message);
                        }
                        subscription.off();
                    }
                    else if (notify) {
                        notify(message);
                    }
                });
                this.publish(exchangeName, options);
            });
        });
    }
    reset() {
        this.connections = {};
        this.configurations = {};
        this.configuring = {};
    }
    retry(connectionName = DEFAULT) {
        const config = this.configurations[connectionName];
        return this.configure(config);
    }
    setAckInterval(interval) {
        if (this.ackIntervalId) {
            this.clearAckInterval();
        }
        this.ackIntervalId = setInterval(() => this.batchAck(), interval);
    }
    shutdown() {
        return this.closeAll(true)
            .then(() => {
            this.clearAckInterval();
        });
    }
    startSubscription(queueName, exclusive = false, connectionName = DEFAULT) {
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
        }
        else {
            throw new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Subscription failed.");
        }
    }
    stopSubscription(queueName, connectionName = DEFAULT) {
        const queue = this.getQueue(queueName, connectionName);
        if (queue) {
            queue.unsubscribe();
            return queue;
        }
        else {
            throw new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Unsubscribe failed.");
        }
    }
    unbindExchange(source, target, keys, connectionName = DEFAULT) {
        return this.connections[connectionName].removeBinding({ source, target, keys });
    }
    unbindQueue(source, target, keys, connectionName = DEFAULT) {
        return this.connections[connectionName].removeBinding({ source, target, keys, queue: true });
    }
}
// Apply config mixin
import configMixin from './config.js';
configMixin(Broker);
const broker = new Broker();
export default broker;
export { Broker };
//# sourceMappingURL=index.js.map