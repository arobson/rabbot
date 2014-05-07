var _ = require( 'lodash' ),
	when = require( 'when' );

module.exports = function( Broker, log ) {

	Broker.prototype._ackOrNackSequence = function( channel ) {
		return when.promise( function( resolve, reject ) {
			var firstMessage = channel.pendingMessages[ 0 ];
			if ( firstMessage === undefined ) {
				resolve();
				return;
			}
			var firstResult = firstMessage.result;
			var sequenceEnd = firstMessage.tag;

			switch ( firstResult ) {
				case 'pending':
					var err = '0-index pendingMessage is pending, nothing to be done';
					log.debug( err );
					reject( err );
					return;
				case 'ack':
				case 'nack':
					for ( var i = 1; i < _.size( channel.pendingMessages ) - 1; i++ ) {
						if ( channel.pendingMessages[ i ].result !== firstResult ) {
							break;
						}
						sequenceEnd = channel.pendingMessages[ i ].tag;
					}
					break;
				default:
					var err = 'invalid result: ' + firstResult;
					log.error( err );
					reject( err );
					return;
			}

			switch ( firstResult ) {
				case 'ack':
					channel.betterAck( sequenceEnd, true )
						.done( function() {
							resolve();
						} );
					break;
				case 'nack':
					channel.betterNack( sequenceEnd, true )
						.done( function() {
							resolve();
						} );
					break;
			}
		} );
	};

	Broker.prototype.batchAck = function() {
		if ( _.size( this.ackChannels ) < 1 ) {
			log.error( 'No ackChannels' );
		} else {
			_.forEach( this.ackChannels, function( channel ) {
				try {
					channel.acking = channel.acking !== undefined ? channel.acking : false;

					if ( !channel.acking ) {
						channel.acking = true;
						var indexOfPending = _.findIndex( channel.pendingMessages, {
							'result': 'pending'
						} );
						var indexOfAck = _.findIndex( channel.pendingMessages, {
							'result': 'ack'
						} );
						var indexOfNack = _.findIndex( channel.pendingMessages, {
							'result': 'nack'
						} );

						var promise = [];
						//Just acksPending
						if ( indexOfPending === -1 && indexOfNack === -1 && indexOfAck !== -1 ) {
							promise.push( channel.betterAckAll() );
							this.emit( 'batchAckAll' );
						}
						//Just nacksPending
						if ( indexOfPending === -1 && indexOfNack !== -1 && indexOfAck === -1 ) {
							promise.push( channel.betterNackAll() );
							this.emit( 'batchNackAll' );
						}
						//acksPending or nacksPending
						else if ( indexOfNack !== -1 || indexOfAck !== -1 ) {
							promise.push( this._ackOrNackSequence( channel ) );
							this.emit( 'ackNackSequence' );
						}
						//Only pending
						else if ( indexOfPending !== -1 && indexOfNack === -1 || indexOfAck === -1 ) {
							this.emit( 'batchPendingOnly' );
							channel.acking = false;
						}
						//???
						else {
							log.error( 'Edge case\n', channel.pendingMessages );
							channel.acking = false;
						}
						when.all( promise )
							.done( function() {
								this.emit( 'backAckDone' );
								channel.acking = false;
							}.bind( this ) );
					}
				} catch ( err ) {
					log.debug( err );
				}
			}.bind( this ) );
		}
	};

	Broker.prototype.clearAckInterval = function() {
		clearInterval( this.ackIntervalId );
	};

	Broker.prototype.setAckInterval = function( interval ) {
		this.ackIntervalId = setInterval( this.batchAck, interval );
	};

};