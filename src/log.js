var	postal = require( 'postal' ),
	log = postal.channel( 'log' );

module.exports = {
	info: function( entry ) {
		log.publish( 'info', entry );
	},
	debug: function( entry ) {
		log.publish( 'debug', entry );
	},
	error: function( entry ) {
		log.publish( 'error', entry );
	}
};