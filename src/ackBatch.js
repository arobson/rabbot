var _ = require( 'lodash' );
var postal = require( 'postal' );
var Monologue = require( 'monologue.js' )( _ );
var signal = postal.channel( 'rabbit.ack' );
var log = require( './log.js' )( 'wascally:acknack' );

var calls = {
	ack: '_ack',
	nack: '_nack',
	reject: '_reject'
};

var AckBatch = function( name, connectionName, resolver ) {
	this.name = name;
	this.connectionName = connectionName;
	this.lastAck = -1;
	this.lastNack = -1;
	this.lastReject = -1;
	this.firstAck = undefined;
	this.firstNack = undefined;
	this.firstReject = undefined;
	this.messages = [];
	this.receivedCount = 0;
	this.resolver = resolver;
};

AckBatch.prototype._ack = function( tag, inclusive ) {
	this.lastAck = tag;
	this._resolveTag( tag, 'ack', inclusive );
};

AckBatch.prototype._ackOrNackSequence = function() {
	try {
		var firstMessage = this.messages[ 0 ];
		if ( firstMessage === undefined ) {
			return;
		}
		var firstStatus = firstMessage.status;
		var sequenceEnd = firstMessage.tag;
		var call = calls[ firstStatus ];
		if ( firstStatus === 'pending' ) {
			return;
		} else {
			for (var i = 1; i < _.size( this.messages ) - 1; i++) {
				if ( this.messages[ i ].status !== firstStatus ) {
					break;
				}
				sequenceEnd = this.messages[ i ].tag;
			}
			if ( call ) {
				this[ call ]( sequenceEnd, true );
			}
		}
	} catch ( err ) {
		log.error( 'An exception occurred while trying to resolve ack/nack sequence on %s - %s: %s', this.name, this.connectionName, err.stack );
	}
};

AckBatch.prototype._firstByStatus = function( status ) {
	return _.find( this.messages, { status: status } );
};

AckBatch.prototype._lastByStatus = function( status ) {
	return _.findLast( this.messages, { status: status } );
};

AckBatch.prototype._nack = function( tag, inclusive ) {
	this.lastNack = tag;
	this._resolveTag( tag, 'nack', inclusive );
};

AckBatch.prototype._reject = function( tag, inclusive ) {
	this.lastReject = tag;
	this._resolveTag( tag, 'reject', inclusive );
};

AckBatch.prototype._processBatch = function() {
	this.acking = this.acking !== undefined ? this.acking : false;
	if ( !this.acking ) {
		this.acking = true;
		var hasPending = ( _.findIndex( this.messages, { status: 'pending' } ) >= 0 );
		var hasAck = this.firstAck;
		var hasNack = this.firstNack;
		var hasReject = this.firstReject;
		// just acks
		if ( !hasPending && !hasNack && hasAck && !hasReject ) {
			this._resolveAll( 'ack', 'firstAck', 'lastAck' );
		}
		// just nacks
		else if ( !hasPending && hasNack && !hasAck && !hasReject ) {
			this._resolveAll( 'nack', 'firstNack', 'lastNack' );
		}
		// just rejects
		else if ( !hasPending && !hasNack && !hasAck && hasReject ) {
			this._resolveAll( 'reject', 'firstReject', 'lastReject' );
		}
		// acks, nacks or rejects
		else if ( hasNack || hasAck || hasReject ) {
			this._ackOrNackSequence();
			this.acking = false;
		}
		// nothing to do
		else {
			this.resolver( 'waiting' );
			this.acking = false;
		}
	}
};

AckBatch.prototype._resolveAll = function( status, first, last ) {
	var count = this.messages.length;
	var emitEmpty = function() {
		setTimeout( function() {
			this.emit( 'empty' );
		}.bind( this ), 0 );
	}.bind( this );
	if ( this.messages.length === 0 ) {

	} else {
		var lastTag = this._lastByStatus( status ).tag;
		log.info( '%s ALL (%d) tags on %s - %s.',
			status,
			this.messages.length,
			this.name,
			this.connectionName );
		this.resolver( status, { tag: lastTag, inclusive: true } )
			.then( function() {
				this[ last ] = lastTag;
				this._removeByStatus( status );
				this[ first ] = undefined;
				if ( count > 0 && this.messages.length === 0 ) {
					log.info( 'No pending tags remaining on queue %s - %s', this.name, this.connectionName );
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
			}.bind( this ) );
	}
};

AckBatch.prototype._resolveTag = function( tag, operation, inclusive ) {
	var removed = this._removeUpToTag( tag );
	var nextAck = this._firstByStatus( 'ack' );
	var nextNack = this._firstByStatus( 'nack' );
	var nextReject = this._firstByStatus( 'reject' );
	this.firstAck = nextAck ? nextAck.tag : undefined;
	this.firstNack = nextNack ? nextNack.tag : undefined;
	this.firstReject = nextReject ? nextReject.tag : undefined;
	log.info( '%s %d tags (%s) on %s - %s. (Next ack: %d, Next nack: %d, Next reject: %d)',
		operation,
		removed.length,
		inclusive ? 'inclusive' : 'individual',
		this.name,
		this.connectionName,
		this.firstAck || 0,
		this.firstNack || 0,
		this.firstReject || 0 );
	this.resolver( operation, { tag: tag, inclusive: inclusive } );
};

AckBatch.prototype._removeByStatus = function( status ) {
	return _.remove( this.messages, function( message ) {
		return message.status === status;
	} );
};

AckBatch.prototype._removeUpToTag = function( tag ) {
	return _.remove( this.messages, function( message ) {
		return message.tag <= tag;
	} );
};

AckBatch.prototype.addMessage = function( message ) {
	this.receivedCount++;
	var status = message.message || message;
	this.messages.push( status );
	log.debug( 'New pending tag %d on queue %s - %s', status.tag, this.name, this.connectionName );
};

AckBatch.prototype.getMessageOps = function( tag ) {
	var message = {
		tag: tag,
		status: 'pending'
	};
	return {
		message: message,
		ack: function() {
			log.debug( 'Marking tag %d as ack\'d on queue %s - %s', tag, this.name, this.connectionName );
			this.firstAck = this.firstAck || tag;
			message.status = 'ack';
		}.bind( this ),
		nack: function() {
			log.debug( 'Marking tag %d as nack\'d on queue %s - %s', tag, this.name, this.connectionName );
			this.firstNack = this.firstNack || tag;
			message.status = 'nack';
		}.bind( this ),
		reject: function() {
			log.debug( 'Marking tag %d as rejected on queue %s - %s', tag, this.name, this.connectionName );
			this.firstReject = this.firstReject || tag;
			message.status = 'reject';
		}.bind( this )
	};
};

AckBatch.prototype.ignoreSignal = function() {
	if ( this.signalSubscription ) {
		this.signalSubscription.unsubscribe();
	}
};

AckBatch.prototype.listenForSignal = function() {
	if ( !this.signalSubscription ) {
		this.signalSubscription = signal.subscribe( '#', function() {
			this._processBatch();
		}.bind( this ) );
	}
};

Monologue.mixin( AckBatch );

module.exports = AckBatch;
