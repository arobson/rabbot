var _ = require( 'lodash' ),
	amqp = require( 'amqplib' ),
	Monologue = require( 'monologue.js' )( _ ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' ),
	fs = require( 'fs' ),
	Connection = require( './connection.js'),
	Topology = require( './topology.js' ),
	postal = require( 'postal' ),
	uuid = require( 'node-uuid' ),
	log = require( './log.js' );

var defaultTo = function( x, y ) {
	x = x || y;
};

var dispatch = postal.channel( 'rabbit.dispatch' ),
	responses = postal.channel( 'rabbit.responses' ),
	signal = postal.channel( 'rabbit.ack' ),
	responseSubscriptions = {};

var Broker = function() {
	this.connections = {};
	this.setAckInterval( 500 );
	_.bindAll( this );
};

Broker.prototype.addConnection = function( options ) {
	var name = options ? ( options.name || 'default' ) : 'default';
	if( !this.connections[ name ] ) {
		var connection = Connection( options || {} ),
			topology = Topology( connection );
		connection.on( 'connected', function() {
			this.emit( 'connected', connection );
			this.emit( connection.name + '.connection.opened', connection );
		}.bind( this) );
		connection.on( 'closed', function() {
			this.emit( connection.name + '.connection.closed', connection );
		}.bind( this ) );
		connection.on( 'failed', function( err ) {
			this.emit( name + '.connection.failed', err );
		}.bind( this ) );
		this.connections[ connection.name ] = topology;
		return topology;
	} else {
		return this.connections[ name ];
	}
};

Broker.prototype.addExchange = function( name, type, options, connectionName ) {
	connectionName = connectionName || 'default';
	if( _.isObject( name ) ) {
		options = name;
		connectionName = type;
	} else {
		options.name = name;
		options.type = type;
	}
	return this.connections[ connectionName ].createExchange( options );
};

Broker.prototype.addQueue = function( name, options, connectionName ) {
	connectionName = connectionName || 'default';
	options.name = name;
	return this.connections[ connectionName ].createQueue( options, connectionName );
};

Broker.prototype.batchAck = function() {
	signal.publish( 'ack', {} );
};

Broker.prototype.bindExchange = function( source, target, keys, connectionName ) {
	connectionName = connectionName || 'default';
	return this[ connectionName ].createBinding( { source: source, target: target, keys: keys } );
};

Broker.prototype.bindQueue = function( source, target, keys, connectionName ) {
	connectionName = connectionName || 'default';
	return this.connections[ connectionName ].createBinding( 
		{ source: source, target: target, keys: keys, queue: true }
		, connectionName 
	);
};

Broker.prototype.clearAckInterval = function() {
	clearInterval( this.ackIntervalId );
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
	var connection = this.connections[ connectionName ].connection;
	if ( !_.isUndefined( connection ) ) {
		if ( reset ) {
			this.connections[ connectionName ].reset();
		}
		return connection.close();
	} else {
		return when( true );
	}
};

Broker.prototype.deleteExchange = function( name, connectionName ) {
	connectionName = connectionName || 'default';
	return this.connections[ connectionName ].deleteExchange( name );
};

Broker.prototype.deleteQueue = function( name, connectionName ) {
	connectionName = connectionName || 'default';
	return this.connections[ connectionName ].deleteQueue( name );
};

Broker.prototype.getExchange = function( name, connectionName ) {
	connectionName = connectionName || 'default';
	return this.connections[ connectionName ].channels[ 'exchange:' + name ];
};

Broker.prototype.getQueue = function( name, connectionName ) {
	connectionName = connectionName || 'default';
	return this.connections[ connectionName ].channels[ 'queue:' + name ];
};

Broker.prototype.handle = function( messageType, handler, context ) {
	var subscription = dispatch.subscribe( messageType, handler.bind( context ) );
	subscription.remove = subscription.unsubscribe;
	return subscription;
};

Broker.prototype.publish = function( exchangeName, type, message, routingKey, correlationId, connectionName, sequenceNo ) {
	var messageId = undefined,
		headers = {},
		timestamp = Date.now(),
		options;
	if( _.isObject( type ) ) {
		options = type;
		connectionName = message || options.connectionName;
	} else {
		options = {
			appId: this.appId,
			type: type,
			body: message,
			routingKey: routingKey,
			correlationId: correlationId,
			sequenceNo: sequenceNo,
			timestamp: timestamp,
			headers: {},
			connectionName: connectionName || 'default'
		}
	}
	connectionName = connectionName || 'default';
	return this.getExchange( exchangeName, connectionName )
				.publish( options );
};

Broker.prototype.request = function( exchangeName, options, connectionName ) {
	connectionName = connectionName || 'default';
	var requestId = uuid.v1();
	options.messageId = requestId;
	options.connectionName = connectionName;
	return when.promise( function( resolve, reject, notify ) {
		var subscription = responses.subscribe( requestId, function( message ) {
			if( message.properties.headers[ 'sequence_end' ] ) {
				resolve( message );
				subscription.unsubscribe();
			} else {
				notify( message );
			}
		} );
		this.publish( exchangeName, options );
	}.bind( this ) );
};

Broker.prototype.setAckInterval = function( interval ) {
	if( this.ackIntervalId ) {
		this.clearAckInterval();
	}
	this.ackIntervalId = setInterval( this.batchAck, interval );
};

Broker.prototype.startSubscription = function( queue, connectionName ) {
	connectionName = connectionName || 'default';
	var queue = this.getQueue( queue, connectionName );
	if( queue ) {
		var consumerTag = queue.subscribe( queue );
		return queue;
	} else {
		throw new Error( 'No queue named "' + queue + '" for connection "' + connectionName + '". Subscription failed.' );
	}
};

require( './config.js' )( Broker );

Monologue.mixin( Broker );

var broker = new Broker();

module.exports = broker;