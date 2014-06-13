var _ = require( 'lodash' ),
	postal = require( 'postal' ),
	Monologue = require( 'monologue.js' )( _ ),
	signal = postal.channel( 'rabbit.ack' );

var calls = { 
	ack: '_ack', 
	nack: '_nack' 
};

var StatusList = function() {
	this.lastAck = -1;
	this.lastNack = -1;
	this.firstAck = undefined;
	this.firstNack = undefined;
	this.messages = [];
	this.receivedCount = 0;
};

StatusList.prototype._ackAll = function() {
	this.lastAck = this._lastByStatus( 'ack' ).tag;
	this._removeByStatus( 'ack' );
	this.firstAck = undefined;
	this.emit( 'ackAll' );
};

StatusList.prototype._ack = function( tag, inclusive ) {
	this.lastAck = tag;
	this._resolveTag( tag, 'ack', inclusive );
};

StatusList.prototype._ackOrNackSequence = function() {
	try {
		var firstMessage = this.messages[ 0 ];
		if ( firstMessage === undefined ) {
			return;
		}
		var firstStatus = firstMessage.status;
			sequenceEnd = firstMessage.tag,
			call = calls[ firstStatus ];
		if( firstStatus == 'pending' ) {
			return;
		} else {
			for ( var i = 1; i < _.size( this.messages ) - 1; i++ ) {
				if ( this.messages[ i ].status !== firstStatus ) {
					break;
				}
				sequenceEnd = this.messages[ i ].tag;
			}
			if( call ) {
				this[ call ]( sequenceEnd, true );
			}
		}
	} catch ( err ) {
		console.log( 'Error in _ackOrNackSequence', err.stack );
	}
};

StatusList.prototype._ignoreSignal = function() {
	if( this.signalSubscription ) {
		this.signalSubscription.unsubscribe();
	}
};

StatusList.prototype._firstByStatus = function( status ) {
	return _.find( this.messages, { status: status } );
};

StatusList.prototype._lastByStatus = function( status ) {
	return _.findLast( this.messages, { status: status } );
};

StatusList.prototype._listenForSignal = function() {
	signal.subscribe( '#', function() {
		this._processBatch();
	}.bind( this ) );
};

StatusList.prototype._nack = function( tag, inclusive ) {
	this.lastNack = tag;
	this._resolveTag( tag, 'nack', inclusive );
};

StatusList.prototype._nackAll = function() {
	this.lastNack = this._lastByStatus( 'nack' ).tag;
	this._removeByStatus( 'nack' );
	this.firstNack = undefined;
	this.emit( 'nackAll' );
};

StatusList.prototype._processBatch = function() {
	this.acking = this.acking !== undefined ? this.acking : false;
	if ( !this.acking ) {
		this.acking = true;
		var hasPending = ( _.findIndex( this.messages, { status: 'pending' } ) > 0 ),
			hasAck = this.firstAck,
			hasNack = this.firstNack;
		//Just acksPending
		if ( !hasPending && !hasNack && hasAck ) {
			this._ackAll();
		}
		//Just nacksPending
		else if ( !hasPending && hasNack && !hasAck ) {
			this._nackAll();
		}
		//acksPending or nacksPending
		else if ( hasNack || hasAck ) {
			this._ackOrNackSequence();
		}
		//Only pending
		this.acking = false;
	}
};

StatusList.prototype._resolveTag = function( tag, operation, inclusive ) {
	this._removeUpToTag( tag );
	var nextAck = this._firstByStatus( 'ack' ),
		nextNack = this._firstByStatus( 'nack' );
	this.firstAck = nextAck ? nextAck.tag : undefined;
	this.firstNack = nextNack ? nextNack.tag : undefined;
	this.emit( operation, { tag: tag, inclusive: inclusive } );
};

StatusList.prototype._removeByStatus = function( status ) {
	_.remove( this.messages, function( message ) {
		return message.status == status;
	} );
};

StatusList.prototype._removeUpToTag = function( tag ) {
	_.remove( this.messages, function( message ) {
		return message.tag <= tag;
	} );
};

StatusList.prototype.addMessage = function( tag ) {
	this.receivedCount ++;
	var message = {
		tag: tag,
		status: 'pending'
	};
	this.messages.push( message );
	return {
		ack: function() { 
			this.firstAck = this.firstAck || tag;
			message.status = 'ack' 
		}.bind( this ),
		nack: function() {
			this.firstNack = this.firstNack || tag;
			message.status = 'nack' 
		}.bind( this )
	};
};

Monologue.mixin( StatusList );

module.exports = StatusList;