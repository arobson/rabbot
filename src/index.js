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

var logPath = __dirname.replace( 'src', 'log' );
var dirExists = fs.existsSync( logPath );
if ( !dirExists ) {
	fs.mkdirSync( logPath );
}
var log = bunyan.createLogger( {
	name: 'rabbitBroker',
	streams: [ {
		level: 'error',
		path: logPath + '/error.log'
	}, {
		level: 'debug',
		path: logPath + '/debug.log'
	} ]
} );

var Broker = function() {
	this._sequenceNo = 0;
	this.connections = {};
	this.pendingMessages = this.pendingMessages || {};
	_.bindAll( this );
	this.ackChannels = [];
	this.ackIntervalId = undefined;
};

Broker.prototype.addConnection = function( connection ) {
	connection = new Connection( connection, this );
	if ( this.connections[ connection.name ] ) {
		return this.getConnection( connection.name );
	}
	this.connections[ connection.name ] = connection;
	return connection.connect();
};

Broker.prototype.closeAll = function( clearReconnectTasks ) {
	// COFFEE IS FOR CLOSERS
	var closers = _.map( this.connections, function( connection ) {
		return this.close( connection.name, clearReconnectTasks );
	}, this );
	return when.all( closers );
};

Broker.prototype.close = function( connectionName, clearReconnectTasks ) {
	connectionName = connectionName || 'default';
	var connection = this.connections[ connectionName ];
	if ( clearReconnectTasks ) {
		connection.reconnectTasks = [];
	}

	return when.promise( function( resolve, reject ) {
		if ( _.isUndefined( connection ) ) {
			resolve();
		}
		else if ( !connection.isOpen ) {
			resolve();
		} else {
			if ( _.size( this.ackChannels ) > 0 ) {
				_.each( connection.channels, function( channel ) {
					var i = this.ackChannels.indexOf( channel );
					if ( i !== -1 ) {
						this.ackChannels.splice( i, 1 );
					}
				}.bind( this ) );
			}

			connection.handle.close()
				.then( function() {
					connection.isOpen = false;
					connection.handle = undefined;
					connection.channels = {};
					connection.exchanges = {};
					connection.queues = {};
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
			this.addConnection( {
				name: connectionName
			} )
				.then( null, function( err ) {
					log.error( {
						error: err,
						reason: 'Could not add create a default connection for "' + connectionName + '"'
					} );
					reject( err );
				} )
				.then( resolve );
		} else if ( connection.isOpen ) {
			resolve( connection );
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

Broker.prototype.getHandle = function( connectionName ) {
	var connection = this.getConnection( connectionName );
	return connection ? connection.handle : undefined;
};

Broker.prototype.onReconnect = function( connectionName, call, args, take, suppress ) {
	if ( !suppress ) {
		var argList = Array.prototype.slice.call( args, 0, take );
		this.connections[ connectionName ]
			.reconnectTasks
			.push( function() {
				return Broker.prototype[ call ].apply( this, argList.concat( connectionName, true ) );
			}.bind( this ) );
	}
};

require( './acks.js' )( Broker, log );
require( './channel.js' )( Broker, log );
require( './config.js' )( Broker, log );
require( './exchange.js' )( Broker, log );
require( './publishing.js' )( Broker, log );
require( './queue.js' )( Broker, log );
require( './subscribing.js' )( Broker, log );

Monologue.mixin( Broker );

var broker = new Broker();

module.exports = broker;