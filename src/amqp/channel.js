var AmqpChannel = require( 'amqplib/lib/callback_model' ).Channel;
var promiserFn = require( './promiseMachine.js' );

function close( channel ) {
	if ( channel.close ) {
		channel.close();
	}
}

module.exports = {
	create: function( connection, confirm ) {
		var method = confirm ? 'createConfirmChannel' : 'createChannel';
		var factory = function() {
			if ( connection.state === 'released' ) {
				connection.acquire();
			}
			return connection[ method ]();
		};
		var promise = promiserFn( factory, AmqpChannel, close, 'close' );
		connection.on( 'releasing', function() {
			promise.release();
		} );
		return promise;
	}
};
