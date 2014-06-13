var amqp = require( 'amqplib' ),
	_ = require( 'lodash' ),
	AmqpChannel = require( 'amqplib/lib/callback_model' ).Channel,
	Promiser = require( './promiseMachine.js'),
	gate = new ( require( './gate.js' ) )();

var close = function( channel ) {
	channel.close();
};

module.exports = {
	create: function( connection, confirm ) {
		var method = confirm ? 'createConfirmChannel' : 'createChannel';
			factory = function() {
				if( connection.state === 'released' ) {
					connection.acquire();
				}
				return connection[ method ]();
			};
		var promise = Promiser( factory, AmqpChannel, close, 'close' );
		connection.on( 'releasing', function() {
			promise.release();
		} );
		return promise;
	}
};