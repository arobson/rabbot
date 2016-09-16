var _ = require( "lodash" );
var Monologue = require( "monologue.js" );
var when = require( "when" );
var connectionFn = require( "./connectionFsm.js" );
var topologyFn = require( "./topology.js" );
var postal = require( "postal" );
var uuid = require( "node-uuid" );
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

Broker.prototype.batchNack = function() {
	signal.publish( "nack", {} );
};

Broker.prototype.bindExchange = function( source, target, keys, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].createBinding( { source: source, target: target, keys: keys } );
};

Broker.prototype.addExchangeBinding = function( source, target, key, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].addBindingOperation(
		{ source: source, target: target, key: key, adding:true },
		connectionName
	);
};

Broker.prototype.removeExchangeBinding = function( source, target, key, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].addBindingOperation(
		{ source: source, target: target, key: key},
		connectionName
	);
};

Broker.prototype.bindQueue = function( source, target, keys, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].createBinding(
		{ source: source, target: target, keys: keys, queue: true },
		connectionName
	);
};

Broker.prototype.addQueueBinding = function( source, target, key, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].addBindingOperation(
		{ source: source, target: target, key: key, queue: true, adding:true },
		connectionName
	);
};

Broker.prototype.removeQueueBinding = function( source, target, key, connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].addBindingOperation(
		{ source: source, target: target, key: key, queue: true },
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

Broker.prototype.getBindings = function(connectionName ) {
	connectionName = connectionName || "default";
	return this.connections[ connectionName ].definitions.bindings;
};

Broker.prototype.handle = function( messageType, handler, queueName, context, connectionName ) {
	this.hasHandles = true;
	var options;
	if( _.isString( messageType ) ) {
		options = {
			type: messageType,
			queue: queueName || "*",
			connectionName: connectionName || "*",
			context: context,
			autoNack: this.autoNack,
			handler: handler
		}
	} else {
		options = messageType;
		options.autoNack = options.autoNack === false ? false : true;
		options.queue = options.queue || (options.type ? '*' : '#');
		options.connectionName = options.connectionName || "*";
		options.handler = options.handler || handler;
	}
	var parts = [options.connectionName.replace( /[.]/g, "-" )];
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
	var connection = this.connections[ connectionName ].options;
	if( connection.publishTimeout ) {
		options.connectionPublishTimeout = connection.publishTimeout;
	}

	options.headers._rabbot_idm = uuid.v4();
	return when.promise(function(resolve, reject){
		function checkUnroutable (raw){
			if(raw.properties.headers._rabbot_idm == options.headers._rabbot_idm)
				reject(new Error("unroutable"));
		};
		var s = this.connections[connectionName].connection.on( "return", checkUnroutable);
		return this.getExchange( exchangeName, connectionName )
			.publish( options )
			.then(function(){
				setTimeout(function(){
					s.unsubscribe();
					resolve();
				}, 50);
			}).catch(reject);
	}.bind(this));
};

Broker.prototype.request = function (exchangeName, options, connectionName) {
	connectionName = connectionName || options.connectionName || 'default';
	options.messageId = options.messageId || uuid.v1();
	options.connectionName = connectionName;

	var connection = this.connections[connectionName].options,
		exchange = this.getExchange(exchangeName, connectionName),
		publishTimeout = 500,
		replyTimeout;

	if (options.timeout != void 0) {
		publishTimeout = options.timeout;
	}
	else if (exchange.publishTimeout != void 0) {
		publishTimeout = exchange.publishTimeout;
	}
	else if (connection.publishTimeout != void 0) {
		publishTimeout = connection.publishTimeout;
	}
	replyTimeout = publishTimeout * 2;
	if (options.replyTimeout != void 0) {
		replyTimeout = options.replyTimeout;
	}
	else if (exchange.replyTimeout != void 0) {
		replyTimeout = exchange.replyTimeout;
	}
	else if (connection.replyTimeout != void 0) {
		replyTimeout = connection.replyTimeout;
	}

	return when.promise(function (resolve, reject, notify) {
		var timeout, subscription;

		if (replyTimeout > 0) { //if replyTimeout == 0, unlimited timeout. if replyTimeout < 0, no timeout because of no expected response
			timeout = setTimeout(function () {
				subscription.unsubscribe();
				reject(new Error("No reply received within the configured timeout of " + replyTimeout + " ms"));
			}, replyTimeout);
		}
		if (replyTimeout >= 0) {
			subscription = responses.subscribe(options.messageId, function (message) {
				if (message.properties.headers["sequence_end"]) { // jshint ignore:line
					clearTimeout(timeout);
					resolve(message);
					subscription.unsubscribe();
				} else {
					notify(message);
				}
			}), this.publish(exchangeName, options).catch(reject);
		}
		else {
			this.publish(exchangeName, options).then(resolve, reject);
		}
	}.bind(this));
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

Broker.prototype.startSubscription = function (queueName, exclusive, connectionName) {
	if (!this.hasHandles) {
		console.warn("Subscription to '" + queueName + "' was started without any handlers. This will result in lost messages!");
	}
	if (_.isString(exclusive)) {
		connectionName = exclusive;
		exclusive = false;
	}
	var queue = this.getQueue(queueName, connectionName);
	if (queue) {
		return queue.subscribe(exclusive).then(function (r) {
			_.isPlainObject(r) && (r.queue = queue);
			return r;
		});
	} else {
		return when.reject( new Error("No queue named '" + queueName + "' for connection '" + connectionName + "'. Subscription failed.") );
	}
};

Broker.prototype.stopSubscription = function( queueName, connectionName ) {
	var queue = this.getQueue( queueName, connectionName );
	if( queue ) {
		return queue.unsubscribe();
	} else {
		return when.reject( new Error( "No queue named '" + queueName + "' for connection '" + connectionName + "'. Unsubscribe failed." ) );
	}
}

require( "./config.js" )( Broker );

Monologue.mixInto( Broker );

var broker = new Broker();

module.exports = broker;
