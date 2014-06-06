var _ = require( 'lodash' ),
	when = require( 'when' ),
	postal = require( 'postal' ),
	signal = postal.channel( 'rabbit.ack' );

module.exports = function( Broker, log ) {

	Broker.prototype.batchAck = function() {
		signal.publish( 'ack', {} );
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