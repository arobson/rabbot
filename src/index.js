var _ = require( "lodash" );
var Monologue = require( "monologue.js" );
var when = require( "when" );
var connectionFn = require( "./connectionFsm.js" );
var topologyFn = require( "./topology.js" );
var postal = require( "postal" );
var uuid = require( "uuid" );
var dispatch = postal.channel( "rabbit.dispatch" );
var responses = postal.channel( "rabbit.responses" );
var signal = postal.channel( "rabbit.ack" );
var format = require( "util" ).format;

var unhandledStrategies = {
	nackOnUnhandled: function( message ) {
		message.nack();
	},
	rejectOnUnhandled: function( message ) {
		message.reject();
	},
	customOnUnhandled: function() {}
};
var returnedStrategies = {
	customOnReturned: function() {}
};
unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;
returnedStrategies.onReturned = returnedStrategies.customOnReturned;

var serializers = {
	"application/json": {
		deserialize: function( bytes, encoding ) {
			return JSON.parse( bytes.toString( encoding || "utf8" ) );
		},
		serialize: function( object ) {
			return new Buffer( JSON.stringify( object ), "utf8" );
		}
	},
	"application/octet-stream": {
		deserialize: function( bytes ) {
      return bytes;
		},
		serialize: function( bytes ) {
      if( Buffer.isBuffer( bytes ) ) {
        return bytes;
      } else if( _.isArray( bytes ) ) {
        return Buffer.from( bytes );
      } else {
        throw new Error( "Cannot serialize unknown data type" );
      }
		}
	},
	"text/plain": {
		deserialize: function( bytes, encoding ) {
			return bytes.toString( encoding || "utf8" );
		},
		serialize: function( string ) {
			return new Buffer( string, "utf8" );
		}
	}
};

var Broker = function() {
	this.connections = {};
	this.hasHandles = false;
	this.autoNack = false;
	this.serializers = serializers;
	this.configurations = {};
	_.bindAll( this );
};

Broker.prototype.addConnection = function( options ) {
	var self = this

	var connectionPromise;
	var name = options ? ( options.name || "default" ) : "default";
	options = options || {};
	options.name = name;
	options.retryLimit = options.retryLimit || 3;
	options.failAfter = options.failAfter || 60;
	var connection;

	connectionPromise = when.promise( function( resolve, reject ) {
		if ( !self.connections[ name ] ) {
			connection = connectionFn( options );
			var topology = topologyFn( connection, options || {}, serializers, unhandledStrategies, returnedStrategies );
			connection.on( "connected", function() {
				self.emit( "connected", connection );
				self.emit( connection.name + ".connection.opened", connection );
				self.setAckInterval( 500 );
				return resolve( topology )
			} );
			connection.on( "closed", function() {
				self.emit( "closed", connection );
				self.emit( connection.name + ".connection.closed", connection );
				return reject( new Error( "connection closed" ) )
			} );
			connection.on( "failed", function( err ) {
				self.emit( "failed", connection );
				self.emit( name + ".connection.failed", err );
				return reject( err )
			} );
			connection.on( "unreachable", function() {
				self.emit( "unreachable", connection );
				self.emit( name + ".connection.unreachable" );
				self.clearAckInterval();
				return reject( new Error( "connection unreachable" ) )
			} );
			connection.on( "return", function(raw) {
				self.emit( "return", raw );
			} );
			self.connections[ name ] = topology;
		} else {
			connection = self.connections[ name ];
			connection.connection.connect();
			resolve( connection );
		}
	} );
	if( !this.connections[ name ].promise ) {
		this.connections[ name ].promise = connectionPromise;
	}
	return connectionPromise;
};

Broker.prototype.addExchange = function( name, type, options, connectionName ) {
	connectionName = connectionName || "default";
  if( !type && !options ) {
    options = {};
  }
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
	connectionName = connectionName || "default";
  options = options || {};
	options.name = name;
	if ( options.subscribe && !this.hasHandles ) {
		console.warn( "Subscription to '" + name + "' was started without any handlers. This will result in lost messages!" );
	}
	return this.connections[ connectionName ].createQueue( options, connectionName );
};

Broker.prototype.addSerializer = function( contentType, serializer ) {
	serializers[ contentType ] = serializer;
};

Broker.prototype.batchAck = function() {
	signal.publish( "ack", {} );
};

Broker.prototype.bindExchange = function( source, target, keys, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].createBinding( { source: source, target: target, keys: keys } );
};

Broker.prototype.bindQueue = function( source, target, keys, connectionName ) {
	connectionName = connectionName || "default";
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
	connectionName = connectionName || "default";
	var connection = this.connections[ connectionName ].connection;
	if ( !_.isUndefined( connection ) ) {
		if( reset ) {
			this.connections[ connectionName ].reset();
		}
		return connection.close( reset );
	} else {
		return when( true );
	}
};

Broker.prototype.deleteExchange = function( name, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].deleteExchange( name );
};

Broker.prototype.deleteQueue = function( name, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].deleteQueue( name );
};

Broker.prototype.getExchange = function( name, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].channels[ "exchange:" + name ];
};

Broker.prototype.getQueue = function( name, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].channels[ "queue:" + name ];
};

Broker.prototype.handle = function( messageType, handler, queueName, context ) {
	this.hasHandles = true;
	var options;
	if( _.isString( messageType ) ) {
		options = {
			type: messageType,
			queue: queueName || "*",
			context: context,
			autoNack: this.autoNack,
			handler: handler
		}
	} else {
		options = messageType;
		options.autoNack = options.autoNack === false ? false : true;
		options.queue = options.queue || (options.type ? '*' : '#');
		options.handler = options.handler || handler;
	}
	var parts = [];
	if( options.queue === "#" ) {
		parts.push( "#" );
	} else {
		parts.push( options.queue.replace( /[.]/g, "-" ) );
		if( options.type !== "" ) {
			parts.push( options.type || "#" );
		}
	}

	var target = parts.join( "." );
	var subscription = dispatch.subscribe( target, options.handler.bind( options.context ) );
	if ( options.autoNack ) {
		subscription.catch( function( err, msg ) {
			console.log( "Handler for '" + target + "' failed with:", err.stack );
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
	unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;
};

Broker.prototype.onUnhandled = function( handler ) {
	unhandledStrategies.onUnhandled = unhandledStrategies.customOnUnhandled = handler;
};

Broker.prototype.rejectUnhandled = function() {
	unhandledStrategies.onUnhandled = unhandledStrategies.rejectOnUnhandled;
};

Broker.prototype.onReturned = function( handler ) {
	returnedStrategies.onReturned = returnedStrategies.customOnReturned = handler;
};

Broker.prototype.publish = function( exchangeName, type, message, routingKey, correlationId, connectionName, sequenceNo ) {
	var timestamp = Date.now();
	var options;
	if ( _.isObject( type ) ) {
		options = type;
		connectionName = message || options.connectionName || "default";
	} else {
		connectionName = connectionName || message.connectionName || "default";
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
	if( !this.connections[ connectionName ] ) {
		return when.reject( new Error( format( "Publish failed - no connection %s has been configured", connectionName ) ) );
	}
	if( this.connections[ connectionName ] && this.connections[ connectionName ].options.publishTimeout ) {
		options.connectionPublishTimeout = this.connections[ connectionName ].options.publishTimeout;
	}
	if( _.isNumber( options.body ) ) {
		options.body = options.body.toString();
	}

	return this.connections[ connectionName ].promise
		.then( function() {
			var exchange = this.getExchange( exchangeName, connectionName );
			if( exchange ) {
				return exchange.publish( options );
			} else {
				return when.reject( new Error( format( "Publish failed - no exchange %s on connection %s is defined", exchangeName, connectionName ) ) );
			}
		}.bind( this ) );
};

Broker.prototype.request = function( exchangeName, options, notify, connectionName ) {
  if( _.isFunction( notify ) ) {
    connectionName = connectionName || options.connectionName || 'default';
  } else {
    connectionName = notify || options.connectionName || 'default';
  }
	var requestId = uuid.v1();
	options.messageId = requestId;
	options.connectionName = connectionName;
	var connection = this.connections[ connectionName ].options;
	var exchange = this.getExchange( exchangeName, connectionName );
	var publishTimeout = options.timeout || exchange.publishTimeout || connection.publishTimeout || 500;
	var replyTimeout = options.replyTimeout || exchange.replyTimeout || connection.replyTimeout || ( publishTimeout * 2 );

	return when.promise( function( resolve, reject ) {
		var timeout = setTimeout( function() {
			subscription.unsubscribe();
			reject( new Error( "No reply received within the configured timeout of " + replyTimeout + " ms" ) );
		}, replyTimeout );
		var subscription = responses.subscribe( requestId, function( message ) {
			if ( message.properties.headers[ "sequence_end" ] ) { // jshint ignore:line
				clearTimeout( timeout );
				resolve( message );
				subscription.unsubscribe();
			} else if( notify ) {
				notify( message );
			}
		} );
		this.publish( exchangeName, options );

	}.bind( this ) );
};

Broker.prototype.reset = function() {
	this.connections = {};
	this.configurations = {};
};

Broker.prototype.retry = function( connectionName ) {
	connectionName = connectionName || "default";
	var config = this.configurations[ connectionName ];
	return this.configure( config );
};

Broker.prototype.setAckInterval = function( interval ) {
	if ( this.ackIntervalId ) {
		this.clearAckInterval();
	}
	this.ackIntervalId = setInterval( this.batchAck, interval );
};

Broker.prototype.shutdown = function() {
	return this.closeAll( true )
		.then( function() {
			this.clearAckInterval();
		}.bind( this ) );
};

Broker.prototype.startSubscription = function( queueName, exclusive, connectionName ) {
	if ( !this.hasHandles ) {
		console.warn( "Subscription to '" + queueName + "' was started without any handlers. This will result in lost messages!" );
	}
	if( _.isString( exclusive ) ) {
		connectionName = exclusive;
		exclusive = false;
	}
	var queue = this.getQueue( queueName, connectionName );
	if ( queue ) {
		return queue.subscribe( exclusive );
	} else {
		throw new Error( "No queue named '" + queueName + "' for connection '" + connectionName + "'. Subscription failed." );
	}
};

Broker.prototype.stopSubscription = function( queueName, connectionName ) {
	var queue = this.getQueue( queueName, connectionName );
	if( queue ) {
		queue.unsubscribe();
		return queue;
	} else {
		throw new Error( "No queue named '" + queueName + "' for connection '" + connectionName + "'. Unsubscribe failed." );
	}
}

require( "./config.js" )( Broker );

Monologue.mixInto( Broker );

var broker = new Broker();

module.exports = broker;
