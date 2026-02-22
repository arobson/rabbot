import mfsm from 'mfsm';
import { format } from 'util';
import log from './log.js';
import createQueueAmqp from './amqp/queue.js';
const logger = log('rabbot.queue');
function unhandle(handlers) {
    handlers.forEach((handle) => handle.off());
}
export default function Factory(options, connection, topology, serializers, queueFn) {
    const _queueFn = (queueFn || createQueueAmqp);
    const unsubscribers = [];
    const releasers = [];
    function _define(queue) {
        queue.define()
            .then((defined) => {
            if (!options.name) {
                const newName = defined.queue || '';
                options.name = newName;
                machine.name = newName;
                queue.messages.changeName(newName);
                topology.renameQueue(newName);
            }
            machine.next('ready');
        }, (err) => {
            machine.failedWith = err;
            machine.next('failed');
        });
    }
    function _listen(queue) {
        const handlers = [];
        const unsubscriber = () => queue.unsubscribe();
        const purger = () => queue.purge()
            .then((messageCount) => {
            logger.info(`Purged ${messageCount} queue ${options.name} - ${connection.name}`);
            machine.handle('purged', messageCount);
        })
            .catch((err) => {
            machine.emit('purgeFailed', err);
        });
        const subscriber = (exclusive) => queue.subscribe(!!exclusive)
            .then(() => {
            logger.info('Subscription to (%s) queue %s - %s started with consumer tag %s', options.noAck ? 'untracked' : 'tracked', options.name, connection.name, queue.channel.tag);
            unsubscribers.push(unsubscriber);
            machine.handle('subscribed');
        })
            .catch((err) => {
            machine.emit('subscribeFailed', err);
        });
        const releaser = (closed) => {
            unhandle(handlers);
            if (queue && queue.getMessageCount() > 0) {
                logger.warn('!!! Queue %s - %s was released with %d pending messages !!!', options.name, connection.name, queue.getMessageCount());
            }
            else if (queue) {
                logger.info('Released queue %s - %s', options.name, connection.name);
            }
            if (!closed) {
                queue.release()
                    .then(() => machine.handle('released'));
            }
        };
        machine.subscriber = subscriber;
        releasers.push(releaser);
        machine.purger = purger;
        handlers.push(queue.channel.on('acquired', () => _define(queue)));
        handlers.push(queue.channel.on('released', () => machine.handle('released', queue)));
        handlers.push(queue.channel.on('closed', () => machine.handle('closed', queue)));
        handlers.push(connection.on('unreachable', (_err) => {
            machine.handle('unreachable', queue);
        }));
        if (options.subscribe) {
            machine.handle('subscribe');
        }
    }
    function _release(closed) {
        const release = releasers.shift();
        if (release) {
            release(closed);
        }
    }
    const machine = mfsm({
        init: {
            name: options.name,
            uniqueName: options.uniqueName,
            subscribed: false,
            subscriber: undefined,
            purger: undefined,
            failedWith: undefined,
            default: 'initializing',
        },
        api: {
            check(...args) {
                const d = { resolve: () => { }, reject: (_err) => { } };
                const promise = new Promise((resolve, reject) => {
                    d.resolve = resolve;
                    d.reject = reject;
                });
                machine.handle('check', d);
                return promise;
            },
            purge(...args) {
                return new Promise((resolve, reject) => {
                    const handlers = [];
                    function cleanResolve(result) {
                        unhandle(handlers);
                        resolve(result);
                    }
                    function cleanReject(err) {
                        unhandle(handlers);
                        machine.next('failed');
                        reject(err);
                    }
                    if (options.subscribe) {
                        // When queue is auto-subscribed, wait for resubscription to complete
                        // so callers can rely on the queue being back in 'subscribed' state.
                        // Register 'subscribed' listener from within 'purged' to avoid races.
                        handlers.push(machine.on('purged', (result) => {
                            const count = result;
                            handlers.push(machine.on('subscribed', () => cleanResolve(count)));
                            handlers.push(machine.on('subscribeFailed', () => cleanResolve(count)));
                        }));
                    }
                    else {
                        handlers.push(machine.on('purged', cleanResolve));
                    }
                    handlers.push(machine.on('purgeFailed', cleanReject));
                    handlers.push(machine.on('failed', cleanReject));
                    machine.handle('purge');
                });
            },
            reconnect(...args) {
                if (/releas/.test(machine.currentState)) {
                    machine.next('initializing');
                }
                return machine.check();
            },
            release(...args) {
                return new Promise((resolve, reject) => {
                    const handlers = [];
                    function cleanResolve() {
                        unhandle(handlers);
                        resolve();
                    }
                    function cleanReject(err) {
                        unhandle(handlers);
                        reject(err);
                    }
                    handlers.push(machine.on('released', cleanResolve));
                    handlers.push(machine.on('failed', cleanReject));
                    handlers.push(machine.on('unreachable', cleanReject));
                    handlers.push(machine.on('noqueue', cleanResolve));
                    machine.handle('release');
                });
            },
            retry(...args) {
                return machine.next('initializing');
            },
            subscribe(...args) {
                const exclusive = args[0];
                options.subscribe = true;
                options.exclusive = exclusive;
                return new Promise((resolve, reject) => {
                    const handlers = [];
                    function cleanResolve() {
                        unhandle(handlers);
                        resolve();
                    }
                    function cleanReject(err) {
                        unhandle(handlers);
                        machine.next('failed');
                        reject(err);
                    }
                    handlers.push(machine.on('subscribed', cleanResolve));
                    handlers.push(machine.on('subscribeFailed', cleanReject));
                    handlers.push(machine.on('failed', cleanReject));
                    machine.handle('subscribe');
                });
            },
            unsubscribe(...args) {
                options.subscribe = false;
                const unsubscriber = unsubscribers.shift();
                if (unsubscriber) {
                    return unsubscriber();
                }
                else {
                    return Promise.reject(new Error('No active subscription presently exists on the queue'));
                }
            },
        },
        states: {
            closed: {
                onEntry() {
                    machine.subscribed = false;
                    _release(true);
                    machine.emit('closed');
                },
                check: { forward: 'initializing' },
                purge: { deferUntil: 'ready' },
                subscribe: { deferUntil: 'ready' },
            },
            failed: {
                onEntry() {
                    machine.subscribed = false;
                    machine.emit('failed', machine.failedWith);
                },
                check(data) {
                    const deferred = data;
                    if (deferred) {
                        deferred.reject(machine.failedWith);
                    }
                    machine.emit('failed', machine.failedWith);
                },
                release(data) {
                    const queue = data;
                    if (queue) {
                        queue.release()
                            .then(() => machine.handle('released', queue));
                    }
                },
                released() {
                    machine.next('released');
                },
                purge() {
                    machine.emit('purgeFailed', machine.failedWith);
                },
                subscribe() {
                    machine.emit('subscribeFailed', machine.failedWith);
                },
            },
            initializing: {
                onEntry() {
                    _queueFn(options, topology, serializers)
                        .then((queue) => {
                        machine.lastQueue = queue;
                        machine.handle('acquired', queue);
                    }, (err) => {
                        machine.failedWith = err;
                        machine.next('failed');
                    });
                },
                acquired(data) {
                    const queue = data;
                    machine.receivedMessages = queue.messages;
                    _define(queue);
                    _listen(queue);
                },
                check: { deferUntil: 'ready' },
                release: { deferUntil: 'ready' },
                closed: { deferUntil: 'ready' },
                purge: { deferUntil: 'ready' },
                subscribe: { deferUntil: 'ready' },
            },
            ready: {
                onEntry() {
                    machine.emit('defined');
                },
                check(data) {
                    const deferred = data;
                    deferred.resolve();
                },
                closed() {
                    machine.next('closed');
                },
                purge() {
                    const purger = machine.purger;
                    if (purger) {
                        machine.next('purging');
                        purger();
                    }
                },
                release() {
                    machine.next('releasing');
                    machine.handle('release');
                },
                released() {
                    _release(true);
                    machine.next('initializing');
                },
                subscribe() {
                    const subscriber = machine.subscriber;
                    if (subscriber) {
                        machine.next('subscribing');
                        subscriber(!!options.exclusive);
                    }
                },
            },
            purging: {
                closed() {
                    machine.next('closed');
                },
                purged(data) {
                    machine.next('purged', data);
                    machine.handle('purged', data);
                },
                release() {
                    machine.next('releasing');
                    machine.handle('release');
                },
                released() {
                    _release(true);
                    machine.next('initializing');
                },
                subscribe: { deferUntil: 'subscribed' },
            },
            purged: {
                check(data) {
                    const deferred = data;
                    deferred.resolve();
                },
                closed() {
                    machine.next('closed');
                },
                release() {
                    machine.next('releasing');
                    machine.handle('release');
                },
                released() {
                    _release(true);
                    machine.next('initializing');
                },
                purged(data) {
                    const result = data;
                    machine.emit('purged', result);
                    if (options.subscribe && machine.subscriber) {
                        machine.subscribe()
                            .catch(() => { });
                    }
                    else {
                        machine.next('ready');
                    }
                },
                subscribe() {
                    machine.next('ready');
                    machine.handle('subscribe');
                },
            },
            releasing: {
                release() {
                    _release(false);
                },
                released() {
                    machine.next('released');
                },
            },
            released: {
                onEntry() {
                    machine.subscribed = false;
                    machine.emit('released');
                },
                check(data) {
                    const deferred = data;
                    deferred.reject(new Error(format("Cannot establish queue '%s' after intentionally closing its connection", options.name)));
                },
                purge() {
                    machine.emit('purgeFailed', new Error(format("Cannot purge to queue '%s' after intentionally closing its connection", options.name)));
                },
                release() {
                    machine.emit('released');
                },
                subscribe() {
                    machine.emit('subscribeFailed', new Error(format("Cannot subscribe to queue '%s' after intentionally closing its connection", options.name)));
                },
            },
            subscribing: {
                closed() {
                    machine.next('closed');
                },
                purge: { deferUntil: 'ready' },
                release() {
                    machine.next('releasing');
                    machine.handle('release');
                },
                released() {
                    _release(true);
                    machine.next('initializing');
                },
                subscribed() {
                    machine.next('subscribed');
                },
            },
            subscribed: {
                check(data) {
                    const deferred = data;
                    deferred.resolve();
                },
                closed() {
                    machine.next('closed');
                },
                purge() {
                    machine.next('ready');
                    machine.handle('purge');
                },
                release() {
                    machine.next('releasing');
                    machine.handle('release');
                },
                released() {
                    _release(true);
                    machine.next('initializing');
                },
                subscribed() {
                    machine.subscribed = true;
                    machine.emit('subscribed', {});
                },
            },
            unreachable: {
                check(data) {
                    const deferred = data;
                    deferred.reject(new Error(format("Cannot establish queue '%s' when no nodes can be reached", options.name)));
                },
                purge() {
                    machine.emit('purgeFailed', new Error(format("Cannot purge queue '%s' when no nodes can be reached", options.name)));
                },
                subscribe() {
                    machine.emit('subscribeFailed', new Error(format("Cannot subscribe to queue '%s' when no nodes can be reached", options.name)));
                },
            },
        },
    });
    Object.defineProperty(machine, 'state', {
        get() { return machine.currentState; },
        enumerable: true,
        configurable: true,
    });
    connection.addQueue(machine);
    return machine;
}
//# sourceMappingURL=queueFsm.js.map