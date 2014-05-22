var _ = require( 'lodash' ),
	when = require( 'when' );

module.exports = function( Broker, log ) {

	var calls = { 
		ack: 'betterAck', 
		nack: 'betterNack' 
	};
	Broker.prototype._ackOrNackSequence = function( channel ) {
		try {
			var firstMessage = channel.pendingMessages[ 0 ];
			if ( firstMessage === undefined ) {
				return;
			}
			var firstResult = firstMessage.result;
				sequenceEnd = firstMessage.tag,
				call = calls[ firstResult ];
			if( firstResult == 'pending' ) {
				return;
			} else {
				for ( var i = 1; i < _.size( channel.pendingMessages ) - 1; i++ ) {
					if ( channel.pendingMessages[ i ].result !== firstResult ) {
						break;
					}
					sequenceEnd = channel.pendingMessages[ i ].tag;
				}
				if( call ) {
					channel[ call ]( sequenceEnd, true );
				}
			}
		} catch ( err ) {
			this.log.error( 'Error in _ackOrNackSequence', err );
		}
	};

	Broker.prototype.batchAck = function() {
		_.forEach( this.ackChannels, function( channel ) {
			try {
				channel.acking = channel.acking !== undefined ? channel.acking : false;
				if ( !channel.acking ) {
					channel.acking = true;
					var hasPending = ( _.findIndex( channel.pendingMessages, {
							'result': 'pending'
						} ) > 0 ),
						hasAck = channel.firstAck,
						hasNack = channel.firstNack;

					//Just acksPending
					if ( !hasPending && !hasNack && hasAck ) {
						channel.betterAckAll();
						this.emit( 'batchAckAll' );
					}
					//Just nacksPending
					else if ( !hasPending && hasNack && !hasAck ) {
						channel.betterNackAll();
						this.emit( 'batchNackAll' );
					}
					//acksPending or nacksPending
					else if ( hasNack || hasAck ) {
						this._ackOrNackSequence( channel );
						this.emit( 'ackNackSequence' );
					}
					//Only pending
					else {
						this.emit( 'batchPendingOnly' );
					}
					channel.acking = false;
				}
			} catch ( err ) {
				log.debug( err );
			}
		}.bind( this ) );
	};

	Broker.prototype.clearAckInterval = function() {
		clearInterval( this.ackIntervalId );
	};

	Broker.prototype.setAckInterval = function( interval ) {
		if( this.ackIntervalId ) {
			this.clearAckInterval();
		}
		this.ackIntervalId = setInterval( this.batchAck, interval );
	};
};