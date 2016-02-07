var AmqpChannel = require( "amqplib/lib/callback_model" ).Channel;
var monad = require( "./iomonad.js" );
var when = require( "when" );
var log = require( "../log" )( "rabbot.channel" );

/* log
	* `rabbot.channel`
	  * `debug`
	    * when amqplib's `channel.close` promise is rejected
*/

function close( name, channel ) {
	if ( channel.close ) {
		return channel.close()
			.then( null, function( err ) {
				// since calling close on channel could reject the promise
				// (see connection close's comment) this catches and logs it
				// for debug level
				log.debug( "Error was reported during close of connection `%s` - `%s`", name, err );
			} );
	} else {
		return when();
	}
}

module.exports = {
	create: function( connection, name, confirm ) {
		var method = confirm ? "createConfirmChannel" : "createChannel";
		var factory = function() {
			return connection[ method ]();
		};
		var channel = monad( name, "channel", factory, AmqpChannel, close.bind( null, name ) );
		return channel;
	}
};
