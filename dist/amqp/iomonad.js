import mfsm from 'mfsm';
import log from '../log.js';
const logger = log('rabbot.io');
let staticId = 0;
export default function createIOMonad(options, type, factory, target, close) {
    const id = staticId++;
    let retryTimer;
    // We cast to unknown first to bypass strict type checking for the mfsm definition object
    const machine = mfsm({
        init: {
            id: String(id),
            name: options.name,
            waitInterval: options.waitMin ?? 0,
            waitMin: options.waitMin ?? 0,
            waitMax: options.waitMax ?? 5000,
            waitIncrement: options.waitIncrement ?? 100,
            item: undefined,
            closeReason: undefined,
            default: 'acquiring',
        },
        states: {
            acquiring: {
                onEntry() {
                    _acquire(this);
                },
                blocked: { deferUntil: 'acquired' },
                failed: { next: 'failed' },
                operate: { deferUntil: 'acquired' },
                release: { next: 'released' },
                released: { next: 'released' },
            },
            acquired: {
                acquire() {
                    const m = this;
                    m.emit('acquired');
                },
                return(data) {
                    const m = this;
                    m.emit('return', data);
                },
                blocked: { next: 'blocked' },
                failed: { next: 'failed' },
                operate(data) {
                    const m = this;
                    const call = data;
                    try {
                        const item = m.item;
                        const result = item[call.operation](...call.argList);
                        if (result && typeof result.then === 'function') {
                            result.then(call.resolve, call.reject);
                        }
                        else {
                            call.resolve(result);
                        }
                    }
                    catch (err) {
                        call.reject(err);
                    }
                },
                release() {
                    const m = this;
                    logger.info(`${type} '${m.name}' was closed by the user`);
                    m.next('releasing');
                },
                released(data) {
                    const m = this;
                    const reason = data;
                    logger.warn(`${type} '${m.name}' was closed by the broker with reason '${reason}'`);
                    m.closeReason = reason;
                    m.next('closed');
                },
            },
            blocked: {
                failed: { next: 'failed' },
                operate: { deferUntil: 'acquired' },
                release() {
                    const m = this;
                    logger.info(`${type} '${m.name}' was closed by the user`);
                    m.next('releasing');
                },
                released(data) {
                    const m = this;
                    const reason = data;
                    logger.warn(`${type} '${m.name}' was closed by the broker with reason '${reason}'`);
                    m.closeReason = reason;
                    m.next('closed');
                },
                unblocked: { next: 'acquired' },
            },
            closed: {
                onEntry() {
                    const m = this;
                    if (retryTimer) {
                        clearTimeout(retryTimer);
                        retryTimer = undefined;
                    }
                    m.emit('closed', m.closeReason);
                    m.item = null;
                    m.closeReason = undefined;
                },
                acquire: { next: 'acquiring' },
                operate(data) {
                    const m = this;
                    const call = data;
                    logger.info(`Operation '${call.operation}' invoked on closed ${type} '${m.name}'`);
                    m.once('acquired', () => m.handle('operate', call));
                    m.next('acquiring');
                },
                release: { next: 'released' },
                released: { next: 'released' },
            },
            failed: {
                onEntry() {
                    const m = this;
                    retryTimer = setTimeout(() => {
                        const wi = m.waitInterval;
                        const winc = m.waitIncrement;
                        const wmax = m.waitMax;
                        if ((wi + winc) < wmax) {
                            m.waitInterval = wi + winc;
                        }
                        m.next('acquiring');
                    }, m.waitInterval);
                },
                acquire() {
                    if (retryTimer) {
                        clearTimeout(retryTimer);
                        retryTimer = undefined;
                    }
                    const m = this;
                    m.next('acquiring');
                },
                operate: { deferUntil: 'acquired' },
                release: { next: 'released' },
                released() {
                    // expected - close event fires after error event on a channel
                },
            },
            releasing: {
                onEntry() {
                    _release(this);
                },
                acquire: { forward: 'released' },
                operate: { forward: 'released' },
                release: { forward: 'released' },
                released: { next: 'released' },
            },
            released: {
                onEntry() {
                    const m = this;
                    if (m.item && m.item.removeAllListeners) {
                        m.item.removeAllListeners();
                    }
                    m.item = null;
                    m.emit('released', id);
                },
                acquire: { next: 'acquiring' },
                operate(data) {
                    const m = this;
                    const call = data;
                    logger.warn(`Operation '${call.operation}' invoked on released ${type} '${m.name}' - reacquisition is required.`);
                    call.reject(new Error(`Cannot invoke operation '${call.operation}' on released ${type} '${m.name}'`));
                },
                release() {
                    const m = this;
                    m.emit('released');
                },
                released() {
                    const m = this;
                    m.emit('released');
                },
            },
        },
        api: {
            acquire(..._args) {
                const m = this;
                m.handle('acquire');
                return new Promise((resolve, reject) => {
                    m.once('acquired', () => resolve(m));
                    m.once('released', () => reject(new Error(`Cannot reacquire released ${type} '${m.name}'`)));
                });
            },
            operate(...args) {
                const m = this;
                const call = args[0];
                const argList = args[1];
                const op = { operation: call, argList, resolve: null, reject: null };
                const promise = new Promise((resolve, reject) => {
                    op.resolve = resolve;
                    op.reject = reject;
                });
                m.handle('operate', op);
                return promise;
            },
            release(..._args) {
                const m = this;
                if (retryTimer) {
                    clearTimeout(retryTimer);
                    retryTimer = undefined;
                }
                return new Promise((resolve) => {
                    m.once('released', () => resolve());
                    m.handle('release');
                });
            },
        },
    });
    // Wrap on/once to provide EventEmitter-style API (handler gets only data, not (data, topic))
    // and to return Subscription objects with .off()
    const rawOn = machine.on.bind(machine);
    const wrappedOn = (event, handler) => {
        return rawOn(event, (data) => handler(data));
    };
    const wrappedOnce = (event, handler) => {
        let sub;
        const wrapper = (data) => {
            sub?.off();
            handler(data);
        };
        sub = rawOn(event, wrapper);
        return sub;
    };
    machine.on = wrappedOn;
    machine.once = wrappedOnce;
    function _acquire(m) {
        process.nextTick(() => {
            m.emit('acquiring');
        });
        logger.debug(`Attempting acquisition of ${type} '${m.name}'`);
        factory()
            .then((instance) => _onAcquisition(m, instance), (err) => _onAcquisitionError(m, err));
    }
    function _onAcquisition(m, instance) {
        m.item = instance;
        m.waitInterval = m.waitMin;
        logger.debug(`Acquired ${type} '${m.name}' successfully`);
        const item = instance;
        item.on('return', (raw) => {
            m.handle('return', raw);
        });
        item.once('close', (info) => {
            const reason = info || 'No information provided';
            item.removeAllListeners('blocked');
            item.removeAllListeners('unblocked');
            m.handle('released', reason);
        });
        item.on('error', (err) => {
            logger.error(`Error emitted by ${type} '${m.name}' - '${err.stack}'`);
            item.removeAllListeners('blocked');
            item.removeAllListeners('unblocked');
            m.emit('failed', err);
            m.handle('failed', err);
        });
        item.on('unblocked', () => {
            logger.warn(`${type} '${m.name}' was unblocked by the broker`);
            m.emit('unblocked');
            m.handle('unblocked');
        });
        item.on('blocked', () => {
            logger.warn(`${type} '${m.name}' was blocked by the broker`);
            m.emit('blocked');
            m.handle('blocked');
        });
        m.next('acquired');
    }
    function _onAcquisitionError(m, err) {
        logger.error(`Acquisition of ${type} '${m.name}' failed with '${err}'`);
        m.emit('failed', err);
        m.handle('failed');
    }
    function _release(m) {
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
        }
        if (m.item) {
            if (close) {
                try {
                    close(m.item);
                }
                catch (ex) {
                    logger.warn(`${type} '${m.name}' threw an exception on close: ${ex}`);
                    m.handle('released');
                }
            }
            else {
                try {
                    m.item.close();
                }
                catch (ex) {
                    logger.warn(`${type} '${m.name}' threw an exception on close: ${ex}`);
                    m.handle('released');
                }
            }
        }
        else {
            m.handle('released');
        }
    }
    // Proxy target prototype methods through operate()
    const names = Object.getOwnPropertyNames(target.prototype);
    names.forEach((name) => {
        const prop = target.prototype[name];
        if (typeof prop === 'function' && name !== 'constructor') {
            machine[name] = (...args) => machine.operate(name, args);
        }
    });
    // Add state getter for backward compatibility
    Object.defineProperty(machine, 'state', {
        get() { return machine.currentState; },
        enumerable: true,
        configurable: true,
    });
    return machine;
}
//# sourceMappingURL=iomonad.js.map