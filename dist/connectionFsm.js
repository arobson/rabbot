import mfsm from 'mfsm';
import { format } from 'util';
import log from './log.js';
import defer from './defer.js';
import createConnection from './amqp/connection.js';
import createChannel from './amqp/channel.js';
const logger = log('rabbot.connection');
export default function Connection(options, connectionFn, channelFn) {
    const _channelFn = channelFn || createChannel;
    const _connectionFn = connectionFn || createConnection;
    let connection;
    let queues = [];
    let exchanges = [];
    const channels = {};
    function _getChannel(name, confirm, context) {
        let channel = channels[name];
        if (!channel || /releas/.test(channel.state)) {
            return new Promise((resolve) => {
                channel = _channelFn.create(connection, name, confirm);
                channels[name] = channel;
                channel.once('acquired', () => {
                    logger.debug("Acquired channel '%s' on '%s' successfully for '%s'", name, machine.name, context);
                    resolve(channel);
                });
                channel.on('return', (raw) => {
                    machine.emit('return', raw);
                });
            });
        }
        else {
            return Promise.resolve(channel);
        }
    }
    function _closer() {
        connection.release();
    }
    function _reconnect() {
        const keys = Object.keys(channels);
        const reacquisitions = keys.map((channelName) => new Promise((resolve) => {
            const channel = channels[channelName];
            channel.once('acquired', () => {
                resolve(channel);
            });
            channel.acquire().catch(() => { });
        }));
        Promise.all(reacquisitions)
            .then(() => {
            machine.emit('reconnected');
        }, (err) => {
            logger.error("Could not complete reconnection of '%s' due to %s", machine.name, err);
            machine.next('failed');
            machine.handle('failed', err);
        });
    }
    const machine = mfsm({
        init: {
            name: options.name || 'default',
            connected: false,
            consecutiveFailures: 0,
            connectionTimeout: undefined,
            failAfter: ((options.failAfter || 60) * 1000),
            uri: undefined,
            default: 'initializing',
        },
        api: {
            addQueue(...args) {
                const queue = args[0];
                queues.push(queue);
            },
            addExchange(...args) {
                const exchange = args[0];
                exchanges.push(exchange);
            },
            clearConnectionTimeout() {
                const m = this;
                if (m.connectionTimeout) {
                    clearTimeout(m.connectionTimeout);
                    m.connectionTimeout = undefined;
                }
            },
            setConnectionTimeout() {
                const m = this;
                if (!m.connectionTimeout) {
                    m.connectionTimeout = setTimeout(() => {
                        machine.next('unreachable');
                    }, m.failAfter);
                }
            },
            getChannel(...args) {
                const name = args[0];
                const confirm = args[1];
                const context = args[2];
                const deferred = defer();
                machine.handle('channel', { name, confirm, context, deferred });
                return deferred.promise;
            },
            close(...args) {
                const reset = args[0];
                logger.info("Close initiated on connection '%s'", machine.name);
                const deferred = defer();
                machine.handle('close', deferred);
                return deferred.promise.then(() => {
                    if (reset) {
                        queues = [];
                        exchanges = [];
                    }
                });
            },
            connect(...args) {
                machine.consecutiveFailures = 0;
                const deferred = defer();
                machine.handle('connect', deferred);
                return deferred.promise;
            },
            lastError(...args) {
                return connection.lastError;
            },
            // Expose state as 'state' property for backward compatibility - removed getter, state accessible via currentState
        },
        states: {
            initializing: {
                onEntry() {
                    options.name = machine.name;
                    connection = _connectionFn(options);
                    machine.setConnectionTimeout();
                    connection.on('acquiring', () => machine.handle('acquiring'));
                    connection.on('acquired', () => machine.handle('acquired'));
                    connection.on('failed', (err) => machine.handle('failed', err));
                    connection.on('closed', (reason) => machine.handle('closed', reason));
                    connection.on('released', () => machine.handle('released'));
                },
                acquiring() {
                    machine.next('connecting');
                },
                acquired() {
                    machine.next('connected');
                },
                channel: { deferUntil: 'connected' },
                close(data) {
                    // defer until connected, then handle close
                    machine.once('connected', () => machine.handle('close', data));
                    machine.next('connecting');
                },
                connect(data) {
                    machine.once('connected', () => machine.handle('connect', data));
                    machine.next('connecting');
                },
                failed(data) {
                    // defer until connecting, then replay failed there
                    machine.once('connecting', () => machine.handle('failed', data));
                    machine.next('connecting');
                },
                released() {
                    // ignore
                },
            },
            connecting: {
                onEntry() {
                    machine.setConnectionTimeout();
                    connection.acquire().catch(() => { });
                    machine.emit('connecting');
                },
                acquired() {
                    machine.next('connected');
                },
                channel: { deferUntil: 'connected' },
                close(data) {
                    // defer until we know what happens (connected or failed)
                    const subs = [];
                    const handler = () => {
                        subs.forEach(s => s.off());
                        machine.handle('close', data);
                    };
                    subs.push(machine.on('connected', handler));
                    subs.push(machine.on('failed', handler));
                },
                connect: { deferUntil: 'connected' },
                failed: { forward: 'failed' },
                released() {
                    // ignore
                },
            },
            connected: {
                onEntry() {
                    const m = this;
                    m.clearConnectionTimeout();
                    m.uri = connection.item?.uri;
                    m.consecutiveFailures = 0;
                    if (m.connected) {
                        _reconnect();
                    }
                    m.connected = true;
                    machine.emit('connected', connection);
                },
                acquired: { deferUntil: 'connecting' },
                channel(data) {
                    const request = data;
                    _getChannel(request.name, request.confirm, request.context)
                        .then(request.deferred.resolve, request.deferred.reject);
                },
                close(data) {
                    const deferred = data;
                    machine.once('closed', () => deferred.resolve());
                    machine.next('closing');
                },
                connect(data) {
                    const deferred = data;
                    deferred.resolve();
                    machine.emit('already-connected', connection);
                },
                failed: { forward: 'failed' },
                closed() {
                    machine.next('connecting');
                },
                released() {
                    // ignore
                },
            },
            closed: {
                onEntry() {
                    const m = this;
                    m.clearConnectionTimeout();
                    logger.info("Close on connection '%s' resolved", machine.name);
                    machine.emit('closed', {});
                },
                acquiring() {
                    machine.next('connecting');
                },
                channel() {
                    logger.warn("Channel was requested on a connection that was closed by user - request deferred until reconnection");
                    // Can't deferUntil here via declarative since we don't know when user reconnects
                },
                close(data) {
                    const deferred = data;
                    deferred.resolve();
                    connection.release();
                    machine.emit('closed');
                },
                connect(data) {
                    machine.once('connected', () => machine.handle('connect', data));
                    machine.next('connecting');
                },
                failed: { forward: 'failed' },
                released() {
                    // ignore
                },
            },
            closing: {
                onEntry() {
                    machine.emit('closing');
                    const closeList = queues.concat(exchanges);
                    if (closeList.length) {
                        Promise
                            .all(closeList.map((ch) => ch.release()))
                            .then(() => _closer());
                    }
                    else {
                        _closer();
                    }
                },
                channel(data) {
                    const request = data;
                    logger.warn("Channel was requested during user initiated connection close - request rejected");
                    request.deferred.reject(new Error(format("Illegal request for channel '%s' during close of connection '%s' initiated by user", request.name, machine.name)));
                },
                connect: { deferUntil: 'closed' },
                close: { deferUntil: 'closed' },
                closed() {
                    machine.next('closed');
                },
                released() {
                    machine.next('closed');
                },
            },
            failed: {
                onEntry() {
                    const m = this;
                    m.setConnectionTimeout();
                    m.consecutiveFailures++;
                    const tooManyFailures = m.consecutiveFailures >= (options.retryLimit || 3);
                    if (tooManyFailures) {
                        machine.next('unreachable');
                    }
                },
                failed(err) {
                    machine.emit('failed', err);
                },
                acquiring() {
                    machine.next('connecting');
                },
                channel: { deferUntil: 'connected' },
                close(data) {
                    const deferred = data;
                    deferred.resolve();
                    connection.release();
                    machine.emit('closed');
                },
                connect(data) {
                    machine.once('connected', () => machine.handle('connect', data));
                    machine.next('connecting');
                },
                released() {
                    // ignore - expected after error
                },
            },
            unreachable: {
                onEntry() {
                    const m = this;
                    m.clearConnectionTimeout();
                    connection.release().then(() => {
                        machine.emit('unreachable');
                    });
                },
                close(data) {
                    const deferred = data;
                    deferred.resolve();
                    machine.emit('closed');
                },
                connect() {
                    const m = this;
                    m.consecutiveFailures = 0;
                    machine.next('connecting');
                },
            },
        },
    });
    return machine;
}
//# sourceMappingURL=connectionFsm.js.map