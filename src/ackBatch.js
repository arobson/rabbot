const postal = require('postal');
const Monologue = require('monologue.js');
const signal = postal.channel('rabbit.ack');
const log = require('./log.js')('rabbot.acknack');

/* log
  * `rabbot.acknack`
    * `debug`
      * resolution operation on a series of tags
      * resolution operation on ALL tags
      * queue has no pending tags
      * new pending tag added
      * user performed message operation
    * `error`
      * message operation failed
*/

const calls = {
  ack: '_ack',
  nack: '_nack',
  reject: '_reject'
};

const AckBatch = function (name, connectionName, resolver) {
  this.name = name;
  this.connectionName = connectionName;
  this.resolver = resolver;
  this.reset();
};

AckBatch.prototype._ack = function (tag, inclusive) {
  this.lastAck = tag;
  this._resolveTag(tag, 'ack', inclusive);
};

AckBatch.prototype._ackOrNackSequence = function () {
  // try {
  const firstMessage = this.messages[ 0 ];
  if (firstMessage === undefined) {
    return;
  }
  const firstStatus = firstMessage.status;
  let sequenceEnd = firstMessage.tag;
  const call = calls[ firstStatus ];
  if (firstStatus === 'pending') {
  } else {
    for (let i = 1; i < this.messages.length - 1; i++) {
      if (this.messages[ i ].status !== firstStatus) {
        break;
      }
      sequenceEnd = this.messages[ i ].tag;
    }
    if (call) {
      this[ call ](sequenceEnd, true);
    }
  }
};

AckBatch.prototype._firstByStatus = function (status) {
  for (var i = 0; i < this.messages.length; i++) {
    if (this.messages[ i ].status === status) {
      return this.messages[ i ];
    }
  }
  return undefined;
};

AckBatch.prototype._findIndex = function (status) {
  for (var i = 0; i < this.messages.length; i++) {
    if (this.messages[ i ].status === status) {
      return i;
    }
  }
  return -1;
};

AckBatch.prototype._lastByStatus = function (status) {
  for (var i = this.messages.length - 1; i >= 0; i--) {
    if (this.messages[ i ].status === status) {
      return this.messages[ i ];
    }
  }
  return undefined;
};

AckBatch.prototype._nack = function (tag, inclusive) {
  this.lastNack = tag;
  this._resolveTag(tag, 'nack', inclusive);
};

AckBatch.prototype._reject = function (tag, inclusive) {
  this.lastReject = tag;
  this._resolveTag(tag, 'reject', inclusive);
};

AckBatch.prototype._processBatch = function () {
  this.acking = this.acking !== undefined ? this.acking : false;
  if (!this.acking) {
    this.acking = true;
    const hasPending = (this._findIndex('pending') >= 0);
    const hasAck = this.firstAck !== undefined;
    const hasNack = this.firstNack !== undefined;
    const hasReject = this.firstReject !== undefined;
    if (!hasPending && !hasNack && hasAck && !hasReject) {
      // just acks
      this._resolveAll('ack', 'firstAck', 'lastAck');
    } else if (!hasPending && hasNack && !hasAck && !hasReject) {
      // just nacks
      this._resolveAll('nack', 'firstNack', 'lastNack');
    } else if (!hasPending && !hasNack && !hasAck && hasReject) {
      // just rejects
      this._resolveAll('reject', 'firstReject', 'lastReject');
    } else if (hasNack || hasAck || hasReject) {
      // acks, nacks or rejects
      this._ackOrNackSequence();
      this.acking = false;
    } else {
      // nothing to do
      this.resolver('waiting');
      this.acking = false;
    }
  }
};

AckBatch.prototype._resolveAll = function (status, first, last) {
  const count = this.messages.length;
  const emitEmpty = function () {
    // process.nextTick( function() {
    setTimeout(function () {
      this.emit('empty');
    }.bind(this), 10);
  }.bind(this);
  if (this.messages.length > 0) {
    const lastTag = this._lastByStatus(status).tag;
    log.debug('%s ALL (%d) tags on %s up to %d - %s.',
      status,
      this.messages.length,
      this.name,
      lastTag,
      this.connectionName);
    this.resolver(status, { tag: lastTag, inclusive: true })
      .then(function () {
        this[ last ] = lastTag;
        this._removeByStatus(status);
        this[ first ] = undefined;
        if (count > 0 && this.messages.length === 0) {
          log.debug('No pending tags remaining on queue %s - %s', this.name, this.connectionName);
          // The following setTimeout is the only thing between an insideous heisenbug and your sanity:
          // The promise for ack/nack will resolve on the channel before the server has processed it.
          // Without the setTimeout, if there is a pending cleanup/shutdown on the channel from the queueFsm,
          // the channel close will complete and cause the server to ignore the outstanding ack/nack command.
          // I lost HOURS on this because doing things that slow down the processing of the close cause
          // the bug to disappear.
          // Hackfully yours,
          // Alex
          emitEmpty();
        }
        this.acking = false;
      }.bind(this));
  }
};

AckBatch.prototype._resolveTag = function (tag, operation, inclusive) {
  const removed = this._removeUpToTag(tag);
  const nextAck = this._firstByStatus('ack');
  const nextNack = this._firstByStatus('nack');
  const nextReject = this._firstByStatus('reject');
  this.firstAck = nextAck ? nextAck.tag : undefined;
  this.firstNack = nextNack ? nextNack.tag : undefined;
  this.firstReject = nextReject ? nextReject.tag : undefined;
  log.debug('%s %d tags (%s) on %s - %s. (Next ack: %d, Next nack: %d, Next reject: %d)',
    operation,
    removed.length,
    inclusive ? 'inclusive' : 'individual',
    this.name,
    this.connectionName,
    this.firstAck || 0,
    this.firstNack || 0,
    this.firstReject || 0);
  this.resolver(operation, { tag: tag, inclusive: inclusive });
};

AckBatch.prototype._removeByStatus = function (status) {
  this.messages = this.messages.reduce((acc, message) => {
    if (message.status !== status) {
      acc.push(message);
    }
    return acc;
  }, []);
};

AckBatch.prototype._removeUpToTag = function (tag) {
  let removed = 0;
  this.messages = this.messages.reduce((acc, message) => {
    if (message.tag > tag) {
      acc.push(message);
    } else {
      removed++;
    }
    return acc;
  }, []);
  return removed;
};

AckBatch.prototype.addMessage = function (message) {
  this.receivedCount++;
  const status = message;
  this.messages.push(status);
  log.debug('New pending tag %d on queue %s - %s', status.tag, this.name, this.connectionName);
};

AckBatch.prototype.changeName = function (name) {
  this.name = name;
};

AckBatch.prototype.getMessageOps = function (tag) {
  return new TrackedMessage(tag, this);
};

class TrackedMessage {
  constructor (tag, batch) {
    this.tag = tag;
    this.status = 'pending';
    this.batch = batch;
  }

  ack () {
    this.status = 'ack';
    this.batch.firstAck = this.batch.firstAck || this.tag;
    log.debug("Marking tag %d as %s'd on queue %s - %s", this.tag, this.status, this.batch.name, this.batch.connectionName);
  }

  nack () {
    this.status = 'nack';
    this.batch.firstNack = this.batch.firstNack || this.tag;
    log.debug("Marking tag %d as %s'd on queue %s - %s", this.tag, this.status, this.batch.name, this.batch.connectionName);
  }

  reject () {
    this.status = 'reject';
    this.batch.firstReject = this.batch.firstReject || this.tag;
    log.debug('Marking tag %d as %sed on queue %s - %s', this.tag, this.status, this.batch.name, this.batch.connectionName);
  }
}

AckBatch.prototype.ignoreSignal = function () {
  if (this.signalSubscription) {
    this.signalSubscription.unsubscribe();
  }
};

AckBatch.prototype.listenForSignal = function () {
  if (!this.signalSubscription) {
    this.signalSubscription = signal.subscribe('#', () => {
      this._processBatch();
    });
  }
};

AckBatch.prototype.reset = function () {
  this.lastAck = -1;
  this.lastNack = -1;
  this.lastReject = -1;
  this.firstAck = undefined;
  this.firstNack = undefined;
  this.firstReject = undefined;
  this.messages = [];
  this.receivedCount = 0;
};

Monologue.mixInto(AckBatch);

module.exports = AckBatch;
