import { EventEmitter } from 'events';
import Dispatch from 'topic-dispatch';
import log from './log.js';
const logger = log('rabbot.acknack');
// Shared signal channel for triggering batch processing
const signal = Dispatch();
const calls = {
    ack: '_ack',
    nack: '_nack',
    reject: '_reject',
};
export class TrackedMessage {
    tag;
    status;
    batch;
    constructor(tag, batch) {
        this.tag = tag;
        this.status = 'pending';
        this.batch = batch;
    }
    ack() {
        this.status = 'ack';
        this.batch.firstAck = this.batch.firstAck ?? this.tag;
        logger.debug("Marking tag %d as %s'd on queue %s - %s", this.tag, this.status, this.batch.name, this.batch.connectionName);
    }
    nack() {
        this.status = 'nack';
        this.batch.firstNack = this.batch.firstNack ?? this.tag;
        logger.debug("Marking tag %d as %s'd on queue %s - %s", this.tag, this.status, this.batch.name, this.batch.connectionName);
    }
    reject() {
        this.status = 'reject';
        this.batch.firstReject = this.batch.firstReject ?? this.tag;
        logger.debug('Marking tag %d as %sed on queue %s - %s', this.tag, this.status, this.batch.name, this.batch.connectionName);
    }
}
export class AckBatch extends EventEmitter {
    name;
    connectionName;
    resolver;
    lastAck = -1;
    lastNack = -1;
    lastReject = -1;
    firstAck = undefined;
    firstNack = undefined;
    firstReject = undefined;
    messages = [];
    receivedCount = 0;
    signalSubscription;
    acking = false;
    constructor(name, connectionName, resolver) {
        super();
        this.name = name;
        this.connectionName = connectionName;
        this.resolver = resolver;
    }
    _ack(tag, inclusive) {
        this.lastAck = tag;
        this._resolveTag(tag, 'ack', inclusive);
    }
    _nack(tag, inclusive) {
        this.lastNack = tag;
        this._resolveTag(tag, 'nack', inclusive);
    }
    _reject(tag, inclusive) {
        this.lastReject = tag;
        this._resolveTag(tag, 'reject', inclusive);
    }
    _ackOrNackSequence() {
        const firstMessage = this.messages[0];
        if (firstMessage === undefined) {
            return;
        }
        const firstStatus = firstMessage.status;
        let sequenceEnd = firstMessage.tag;
        const call = calls[firstStatus];
        if (firstStatus === 'pending') {
            return;
        }
        for (let i = 1; i < this.messages.length - 1; i++) {
            if (this.messages[i].status !== firstStatus) {
                break;
            }
            sequenceEnd = this.messages[i].tag;
        }
        if (call) {
            this[call](sequenceEnd, true);
        }
    }
    _firstByStatus(status) {
        for (let i = 0; i < this.messages.length; i++) {
            if (this.messages[i].status === status) {
                return this.messages[i];
            }
        }
        return undefined;
    }
    _findIndex(status) {
        for (let i = 0; i < this.messages.length; i++) {
            if (this.messages[i].status === status) {
                return i;
            }
        }
        return -1;
    }
    _lastByStatus(status) {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].status === status) {
                return this.messages[i];
            }
        }
        return undefined;
    }
    _processBatch() {
        this.acking = this.acking !== undefined ? this.acking : false;
        if (!this.acking) {
            this.acking = true;
            const hasPending = this._findIndex('pending') >= 0;
            const hasAck = this.firstAck !== undefined;
            const hasNack = this.firstNack !== undefined;
            const hasReject = this.firstReject !== undefined;
            if (!hasPending && !hasNack && hasAck && !hasReject) {
                this._resolveAll('ack', 'firstAck', 'lastAck');
            }
            else if (!hasPending && hasNack && !hasAck && !hasReject) {
                this._resolveAll('nack', 'firstNack', 'lastNack');
            }
            else if (!hasPending && !hasNack && !hasAck && hasReject) {
                this._resolveAll('reject', 'firstReject', 'lastReject');
            }
            else if (hasNack || hasAck || hasReject) {
                this._ackOrNackSequence();
                this.acking = false;
            }
            else {
                this.resolver('waiting');
                this.acking = false;
            }
        }
    }
    _resolveAll(status, first, last) {
        const count = this.messages.length;
        const emitEmpty = () => {
            setTimeout(() => {
                this.emit('empty');
            }, 10);
        };
        if (this.messages.length > 0) {
            const lastMsg = this._lastByStatus(status);
            if (!lastMsg) {
                this.acking = false;
                return;
            }
            const lastTag = lastMsg.tag;
            logger.debug('%s ALL (%d) tags on %s up to %d - %s.', status, this.messages.length, this.name, lastTag, this.connectionName);
            Promise.resolve(this.resolver(status, { tag: lastTag, inclusive: true }))
                .then(() => {
                this[last] = lastTag;
                this._removeByStatus(status);
                this[first] = undefined;
                if (count > 0 && this.messages.length === 0) {
                    logger.debug('No pending tags remaining on queue %s - %s', this.name, this.connectionName);
                    emitEmpty();
                }
                this.acking = false;
            });
        }
    }
    _resolveTag(tag, operation, inclusive) {
        const removed = this._removeUpToTag(tag);
        const nextAck = this._firstByStatus('ack');
        const nextNack = this._firstByStatus('nack');
        const nextReject = this._firstByStatus('reject');
        this.firstAck = nextAck ? nextAck.tag : undefined;
        this.firstNack = nextNack ? nextNack.tag : undefined;
        this.firstReject = nextReject ? nextReject.tag : undefined;
        logger.debug('%s %d tags (%s) on %s - %s. (Next ack: %d, Next nack: %d, Next reject: %d)', operation, removed, inclusive ? 'inclusive' : 'individual', this.name, this.connectionName, this.firstAck ?? 0, this.firstNack ?? 0, this.firstReject ?? 0);
        this.resolver(operation, { tag, inclusive });
    }
    _removeByStatus(status) {
        this.messages = this.messages.filter((m) => m.status !== status);
    }
    _removeUpToTag(tag) {
        let removed = 0;
        this.messages = this.messages.reduce((acc, message) => {
            if (message.tag > tag) {
                acc.push(message);
            }
            else {
                removed++;
            }
            return acc;
        }, []);
        return removed;
    }
    addMessage(message) {
        this.receivedCount++;
        this.messages.push(message);
        logger.debug('New pending tag %d on queue %s - %s', message.tag, this.name, this.connectionName);
    }
    changeName(name) {
        this.name = name;
    }
    getMessageOps(tag) {
        return new TrackedMessage(tag, this);
    }
    ignoreSignal() {
        if (this.signalSubscription) {
            this.signalSubscription.off();
            this.signalSubscription = undefined;
        }
    }
    listenForSignal() {
        if (!this.signalSubscription) {
            this.signalSubscription = signal.on('#', () => {
                this._processBatch();
            });
        }
    }
    reset() {
        this.lastAck = -1;
        this.lastNack = -1;
        this.lastReject = -1;
        this.firstAck = undefined;
        this.firstNack = undefined;
        this.firstReject = undefined;
        this.messages = [];
        this.receivedCount = 0;
    }
    static triggerSignal() {
        signal.emit('ack', {});
    }
}
export { signal as ackSignal };
export default AckBatch;
//# sourceMappingURL=ackBatch.js.map