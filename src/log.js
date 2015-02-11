var postal = require( 'postal' );
var Log = require( 'whistlepunk' );
var log = configure( {} );

function configure( config ) {
	var envDebug = !!process.env.DEBUG;
	if ( envDebug ) {
		return Log( postal, { adapters: { debug: { level: 5 } } } );
	} else {
		return Log( postal, config );
	}
}

module.exports = function( config, ns ) {
	if ( typeof config === 'string' ) {
		ns = config;
	} else {
		log = configure( config || {} );
	}
	return log( ns );
};
