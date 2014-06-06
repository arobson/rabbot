var _ = require( 'lodash' ),
	amqp = require( 'amqplib' ),
	Monologue = require( 'monologue.js' )( _ ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' ),
	bunyan = require( 'bunyan' ),
	fs = require( 'fs' ),
	Connection = require( './connection.js');

var defaultTo = function( x, y ) {
	x = x || y;
};

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

var Broker = function() {
	this.connections = {};
	this.setAckInterval( 500 );
	this.log = log;
	_.bindAll( this );
};

Broker.prototype.addConnection = function( options ) {
	var connection = Connection( options, this );
	connection.on( 'connected', function() {
		this.emit( 'connected', connection );
		this.emit( connection.name + '.connection.opened', connection );
	}.bind( this) );
	connection.on( 'closed', function() {
		this.emit( connection.name + '.connection.closed', connection );
	}.bind( this ) );
	connection.on( 'connection.failed', function( err ) {
		this.emit( connection.name + '.connection.failed', err );
	}.bind( this ) );
	if ( this.connections[ connection.name ] ) {
		return this.getConnection( connection.name );
	}
	this.connections[ connection.name ] = connection;
	return connection.connect();
};

Broker.prototype.closeAll = function( reset ) {
	// COFFEE IS FOR CLOSERS
	var closers = _.map( this.connections, function( connection ) {
		return this.close( connection.name, reset );
	}, this );
	return when.all( closers );
};

Broker.prototype.close = function( connectionName, reset ) {
	connectionName = connectionName || 'default';
	var connection = this.connections[ connectionName ];
	if ( reset ) {
		if( connection ) {
			connection.reset();
		}
	}

	return when.promise( function( resolve, reject ) {
		if ( _.isUndefined( connection ) ) {
			resolve();
		}
		else if ( !connection.isAvailable() ) {
			resolve();
		} else {
			connection.close()
				.then( function() {
					resolve();
				} );
		}
	}.bind( this ) );
};

Broker.prototype.getConnection = function( connectionName ) {
	connectionName = connectionName || 'default';
	var connection = this.connections[ connectionName ];

	return when.promise( function( resolve, reject ) {
		if ( !connection ) {
			reject( 'No connection named ' + connectionName + ' has been defined' );	
		} else {
			connection
				.connect()
				.then( null, function( err ) {
					log.error( {
						error: err,
						reason: 'Could not reconnect connection "' + connectionName + '"'
					} );
					reject( err );
				} )
				.then( resolve );
		}
	}.bind( this ) );
};

Broker.prototype.getChannel = function( name, connectionName, confirm ) {
	connectionName = connectionName || 'default';
	return when.promise( function( resolve, reject ) {
		var connection,
			onConnection = function( instance ) {
					connection = instance;
					connection.getChannel( name, confirm )
						.then( resolve )
						.then( null, channelFailed );
				}.bind( this ),
			channelFailed = function( err ) {
					this.emit( 'errorLogged' );
					this.log.error( {
						error: err,
						reason: 'Could not create channel "' + name + '" on connection "' + connectionName + '"'
					} );
					reject( err );
				}.bind( this ),
			connectionFailed = function( err ) {
					this.emit( 'errorLogged' );
					this.log.error( {
						error: err,
						reason: 'Could not acquire connection "' + connectionName + '" trying to create channel "' + name + '"'
					} );
					reject( err );
				}.bind( this );

		this.getConnection( connectionName )
			.then( onConnection )
			.then( null, connectionFailed );
	}.bind( this ) );
};

require( './acks.js' )( Broker, log );
require( './config.js' )( Broker, log );
require( './exchange.js' )( Broker, log );
require( './publishing.js' )( Broker, log );
require( './queue.js' )( Broker, log );
require( './subscribing.js' )( Broker, log );

Monologue.mixin( Broker );

var broker = new Broker();

module.exports = broker;