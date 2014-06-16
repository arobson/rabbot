var	postal = require( 'postal' ),
	log = postal.channel( 'log' );

var logPath = './log';
var dirExists = fs.existsSync( logPath );
if ( !dirExists ) {
	fs.mkdirSync( logPath );
}
var log = bunyan.createLogger( {
	name: 'rabbitBroker',
	streams: [ {
		level: 'error',
		path: logPath + '/wascally-error.log'
	}, {
		level: 'debug',
		path: logPath + '/wascally-debug.log'
	} ]
} );

log.on( 'debug', function( message ) {
	log.debug( entry );
} );

log.on( 'error', function( message ) {
	log.error( entry );
} );