import mfsm from 'mfsm';
import { format } from 'util';
import publishLog from './publishLog.js';
import log from './log.js';
import createExchangeAmqp from './amqp/exchange.js';
const exLog = log('rabbot.exchange');
function unhandle(handlers) {
    handlers.forEach((handle) => handle.off());
}
export default function Factory(options, connection, topology, serializers, exchangeFn) {
    const _exchangeFn = (exchangeFn || createExchangeAmqp);
    const published = publishLog();
    let publisher;
    const releasers = [];
    const deferred = [];
    function _define(exchange, stateOnDefined) {
        exchange.define()
            .then(() => machine.next(stateOnDefined), (err) => {
            machine.failedWith = err;
            machine.next('failed');
        });
    }
    function _listen() {
        connection.on('unreachable', (err) => {
            const error = err || new Error('Could not establish a connection to any known nodes.');
            _onFailure(error);
            machine.next('unreachable');
        });
    }
    function _onAcquisition(transitionTo, exchange) {
        const handlers = [];
        handlers.push(exchange.channel.once('released', () => {
            machine.handle('released', exchange);
        }));
        handlers.push(exchange.channel.once('closed', () => {
            machine.handle('closed', exchange);
        }));
        function cleanup() {
            unhandle(handlers);
            exchange.release()
                .then(() => machine.next('released'));
        }
        function onCleanupError() {
            const count = published.count();
            if (count > 0) {
                exLog.warn("%s exchange '%s', connection '%s' was released with %d messages unconfirmed", options.type, options.name, connection.name, count);
            }
            cleanup();
        }
        const releaser = () => published.onceEmptied()
            .then(cleanup, onCleanupError);
        publisher = (message) => exchange.publish(message);
        releasers.push(releaser);
        _define(exchange, transitionTo);
    }
    function _onClose() {
        exLog.info(`Rejecting ${published.count()} published messages`);
        published.reset();
    }
    function _onFailure(err) {
        machine.failedWith = err;
        deferred.forEach((x) => x(err));
        deferred.length = 0;
        published.reset();
    }
    function _removeDeferred(reject) {
        const index = deferred.indexOf(reject);
        if (index >= 0) {
            deferred.splice(index, 1);
        }
    }
    function _release(closed) {
        const release = releasers.shift();
        if (release) {
            return release();
        }
        else {
            return Promise.resolve();
        }
    }
    const machine = mfsm({
        init: {
            name: options.name,
            type: options.type,
            publishTimeout: options.publishTimeout || 0,
            replyTimeout: options.replyTimeout || 0,
            limit: options.limit || 100,
            failedWith: undefined,
            default: 'initializing',
        },
        api: {
            check(...args) {
                const deferred = { resolve: () => { }, reject: (_err) => { } };
                const promise = new Promise((resolve, reject) => {
                    deferred.resolve = resolve;
                    deferred.reject = reject;
                });
                machine.handle('check', deferred);
                return promise;
            },
            reconnect(...args) {
                if (/releas/.test(machine.currentState)) {
                    machine.next('initializing');
                }
                return machine.check();
            },
            release(...args) {
                exLog.debug('Release called on exchange %s - %s (%d messages pending)', options.name, connection.name, published.count());
                return new Promise((resolve) => {
                    machine.once('released', () => resolve());
                    machine.handle('release');
                });
            },
            publish(...args) {
                const message = args[0];
                if (machine.currentState !== 'ready' && published.count() >= machine.limit) {
                    exLog.warn("Exchange '%s' has reached the limit of %d messages waiting on a connection", options.name, machine.limit);
                    return Promise.reject(new Error('Exchange has reached the limit of messages waiting on a connection'));
                }
                const msg = message;
                const publishTimeout = msg.timeout || options.publishTimeout || msg.connectionPublishTimeout || 0;
                return new Promise((resolve, reject) => {
                    let timeout;
                    let timedOut = false;
                    let failedSub;
                    let closedSub;
                    if (publishTimeout > 0) {
                        timeout = setTimeout(() => {
                            timedOut = true;
                            onRejected(new Error('Publish took longer than configured timeout'));
                        }, publishTimeout);
                    }
                    function onPublished() {
                        resolve();
                        _removeDeferred(reject);
                        failedSub?.off();
                        closedSub?.off();
                    }
                    function onRejected(err) {
                        reject(err);
                        _removeDeferred(reject);
                        failedSub?.off();
                        closedSub?.off();
                    }
                    const op = (err) => {
                        if (err) {
                            onRejected(err);
                        }
                        else {
                            if (timeout) {
                                clearTimeout(timeout);
                                timeout = undefined;
                            }
                            if (!timedOut) {
                                publisher(message)
                                    .then(onPublished, onRejected);
                            }
                        }
                    };
                    failedSub = machine.on('failed', (err) => onRejected(err));
                    closedSub = machine.on('closed', (err) => onRejected(err));
                    deferred.push(reject);
                    machine.handle('publish', op);
                });
            },
            retry(...args) {
                return machine.next('initializing');
            },
        },
        states: {
            closed: {
                onEntry() {
                    _onClose();
                    machine.emit('closed');
                },
                check: { forward: 'initializing' },
                publish: { forward: 'initializing' },
            },
            failed: {
                onEntry() {
                    _onFailure(machine.failedWith);
                    machine.emit('failed', machine.failedWith);
                },
                check(data) {
                    const deferred = data;
                    deferred.reject(machine.failedWith);
                    machine.emit('failed', machine.failedWith);
                },
                release(data) {
                    _release(data)
                        .then(() => machine.next('released'));
                },
                publish(data) {
                    const op = data;
                    op(machine.failedWith);
                },
            },
            initializing: {
                onEntry() {
                    _exchangeFn(options, topology, published, serializers)
                        .then((exchange) => machine.handle('acquired', exchange));
                },
                acquired(data) {
                    _onAcquisition('ready', data);
                },
                check: { deferUntil: 'ready' },
                closed: { deferUntil: 'ready' },
                release: { deferUntil: 'ready' },
                released() {
                    machine.next('initializing');
                },
                publish: { deferUntil: 'ready' },
            },
            ready: {
                onEntry() {
                    machine.emit('defined');
                },
                check(data) {
                    const deferred = data;
                    deferred.resolve();
                    machine.emit('defined');
                },
                release() {
                    machine.once('released', () => { }); // ensure listener exists
                    machine.next('releasing');
                },
                closed() {
                    machine.next('closed');
                },
                released: { deferUntil: 'releasing' },
                publish(data) {
                    const op = data;
                    op();
                },
            },
            releasing: {
                onEntry() {
                    _release()
                        .then(() => machine.next('released'));
                },
                publish: { deferUntil: 'released' },
                release: { deferUntil: 'released' },
            },
            released: {
                onEntry() {
                    machine.emit('released');
                },
                check() {
                    // no-op - defer handled by caller
                },
                release() {
                    machine.emit('released');
                },
                publish(data) {
                    const op = data;
                    exLog.warn("Publish called on exchange '%s' after connection was released intentionally.", options.name);
                    op(new Error(format("Cannot publish to exchange '%s' after intentionally closing its connection", options.name)));
                },
            },
            unreachable: {
                onEntry() {
                    machine.emit('failed', machine.failedWith);
                },
                check(data) {
                    const deferred = data;
                    deferred.reject(machine.failedWith);
                    machine.emit('failed', machine.failedWith);
                },
                publish(data) {
                    const op = data;
                    op(machine.failedWith);
                },
            },
        },
    });
    _listen();
    connection.addExchange(machine);
    machine.published = published;
    return machine;
}
//# sourceMappingURL=exchangeFsm.js.map