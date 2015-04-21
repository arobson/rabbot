var _ = require( 'lodash' );
var Monologue = require( 'monologue.js' )( _ );
var when = require( 'when' );
var connectionFn = require( './connectionFsm.js' );
var topologyFn = require( './topology.js' );
var postal = require( 'postal' );
var uuid = require( 'node-uuid' );
var log = require( './log.js' );
var dispatch = postal.channel( 'rabbit.dispatch' );
var responses = postal.channel( 'rabbit.responses' );
var signal = postal.channel( 'rabbit.ack' );

var unhandledStrategies = {
	nackOnUnhandled: function( message ) {
		message.nack();
	},
	rejectOnUnhandled: function( message ) {
		message.reject();
	},
	customOnUnhandled: function() {}
};
unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;

var Broker = function() {
	this.connections = {};
	this.setAckInterval( 500 );
	this.hasHandles = false;
	this.autoNack = false;
	_.bindAll( this );
};

Broker.prototype.addConnection = function( options ) {
	var name = options ? ( options.name || 'default' ) : 'default';
	if ( !this.connections[ name ] ) {
		var connection = connectionFn( options || {} );
		var topology = topologyFn( connection, options || {}, unhandledStrategies );
		connection.on( 'connected', function( state ) {
			connection.uri = state.item.uri;
			this.emit( 'connected', connection );
			this.emit( connection.name + '.connection.opened', connection );
		}.bind( this ) );
		connection.on( 'closed', function() {
			this.emit( connection.name + '.connection.closed', connection );
		}.bind( this ) );
		connection.on( 'failed', function( err ) {
			this.emit( name + '.connection.failed', err );
		}.bind( this ) );
		this.connections[ name ] = topology;
		return topology;
	} else {
		return this.connections[ name ];
	}
};

Broker.prototype.addExchange = function( name, type, options, connectionName ) {
	connectionName = connectionName || 'default';
	if ( _.isObject( name ) ) {
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
	if ( options.subscribe && !this.hasHandles ) {
		console.warn( 'Subscription to "' + name + '" was started without any handlers. This will result in lost messages!' );
	}
	return this.connections[ connectionName ].createQueue( options, connectionName );
};

Broker.prototype.batchAck = function() {
	signal.publish( 'ack', {} );
};

Broker.prototype.bindExchange = function( source, target, keys, connectionName ) {
	connectionName = connectionName || 'default';
	return this.connections[ connectionName ].createBinding( { source: source, target: target, keys: keys } );
};

Broker.prototype.bindQueue = function( source, target, keys, connectionName ) {
	connectionName = connectionName || 'default';
	return this.connections[ connectionName ].createBinding(
		{ source: source, target: target, keys: keys, queue: true },
		connectionName
	);
};

Broker.prototype.clearAckInterval = function() {
	clearInterval( this.ackIntervalId );
};

Broker.prototype.closeAll = function( reset ) {
	// COFFEE IS FOR CLOSERS
	var closers = _.map( this.connections, function( connection ) {
		return this.close( connection.name, reset );
	}.bind( this ) );
	return when.all( closers );
};

Broker.prototype.close = function( connectionName, reset ) {
	connectionName = connectionName || 'default';
	var connection = this.connections[ connectionName ].connection;
	if ( !_.isUndefined( connection ) ) {
		return connection.close( reset );
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
	this.hasHandles = true;
	var subscription = dispatch.subscribe( messageType, handler.bind( context ) );
	if ( this.autoNack ) {
		subscription.catch( function( err, msg ) {
			console.log( 'Handler for "' + messageType + '" failed with:', err.stack );
			msg.nack();
		} );
	}
	subscription.remove = subscription.unsubscribe;
	return subscription;
};

Broker.prototype.ignoreHandlerErrors = function() {
	this.autoNack = false;
};

Broker.prototype.nackOnError = function() {
	this.autoNack = true;
};

Broker.prototype.nackUnhandled = function() {
	unhandledStrategies.onUnhandled = this.nackOnUnhandled;
};

Broker.prototype.onUnhandled = function( handler ) {
	unhandledStrategies.onUnhandled = this.customOnUnhandled = handler;
};

Broker.prototype.rejectUnhandled = function() {
	unhandledStrategies.onUnhandled = this.rejectOnUnhandled;
};

Broker.prototype.publish = function( exchangeName, type, message, routingKey, correlationId, connectionName, sequenceNo ) {
	var timestamp = Date.now();
	var options;
	if ( _.isObject( type ) ) {
		options = type;
		connectionName = message || options.connectionName || 'default';
	} else {
		connectionName = connectionName || message.connectionName || 'default';
		options = {
			appId: this.appId,
			type: type,
			body: message,
			routingKey: routingKey,
			correlationId: correlationId,
			sequenceNo: sequenceNo,
			timestamp: timestamp,
			headers: {},
			connectionName: connectionName
		};
	}
	return this.getExchange( exchangeName, connectionName )
		.publish( options );
};

Broker.prototype.request = function( exchangeName, options, connectionName ) {
	connectionName = connectionName || options.connectionName || 'default';
	var requestId = uuid.v1();
	options.messageId = requestId;
	options.connectionName = connectionName;
	return when.promise( function( resolve, reject, notify ) {
		var subscription = responses.subscribe( requestId, function( message ) {
			if ( message.properties.headers[ 'sequence_end' ] ) { // jshint ignore:line
				resolve( message );
				subscription.unsubscribe();
			} else {
				notify( message );
			}
		} );
		this.publish( exchangeName, options );
	}.bind( this ) );
};

Broker.prototype.reset = function() {
	this.connections = {};
};

Broker.prototype.setAckInterval = function( interval ) {
	if ( this.ackIntervalId ) {
		this.clearAckInterval();
	}
	this.ackIntervalId = setInterval( this.batchAck, interval );
};

Broker.prototype.startSubscription = function( queueName, connectionName ) {
	if ( !this.hasHandles ) {
		console.warn( 'Subscription to "' + queueName + '" was started without any handlers. This will result in lost messages!' );
	}
	connectionName = connectionName || 'default';
	var queue = this.getQueue( queueName, connectionName );
	if ( queue ) {
		queue.subscribe( queue );
		return queue;
	} else {
		throw new Error( 'No queue named "' + queueName + '" for connection "' + connectionName + '". Subscription failed.' );
	}
};

require( './config.js' )( Broker );

Monologue.mixin( Broker );

var broker = new Broker();

module.exports = broker;
