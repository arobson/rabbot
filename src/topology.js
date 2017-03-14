var when = require( "when" );
var _ = require( "lodash" );
var Monologue = require( "monologue.js" );
var log = require( "./log" )( "rabbot.topology" );
var info = require( "./info" );
var Exchange, Queue;
var replyId;

/* log
	* `rabbot.topology`
	  * `info`
	    * creating a binding
	    * deleting an exchange
	    * deleting a queue
	    * reconnection established
	    * topology rebuilt (after reconnection)
	  * `error`
	    * failed to create reply queue
*/

function getKeys( keys ) {
	var actualKeys = [ "" ];
	if ( keys && keys.length > 0 ) {
		actualKeys = _.isArray( keys ) ? keys : [ keys ];
	}
	return actualKeys;
}

function toArray( x, list ) {
	if ( _.isArray( x ) ) {
		return x;
	}
	if ( _.isObject( x ) && list ) {
		return _.map( x, function( item ) {
			return item;
		} );
	}
	if ( _.isUndefined( x ) || _.isEmpty( x ) ) {
		return [];
	}
	return [ x ];
}

var Topology = function( connection, options, serializers, unhandledStrategies, returnedStrategies ) {
	var autoReplyTo = { name: [ replyId, "response", "queue" ].join( '.' ), autoDelete: true, subscribe: true };
	var rabbitReplyTo = { name: "amq.rabbitmq.reply-to", subscribe: true, noAck: true };
	var userReplyTo = _.isObject( options.replyQueue ) ? options.replyQueue : { name: options.replyQueue, autoDelete: true, subscribe: true };
	this.name = options.name;
	this.connection = connection;
	this.channels = {};
	this.promises = {};
	this.definitions = {
		bindings: {},
		exchanges: {},
		queues: {}
	};
	this.options = options;
	this.replyQueue = { name: false };
	this.serializers = serializers;
	this.onUnhandled = function( message ) {
		return unhandledStrategies.onUnhandled( message );
	};
	this.onReturned = function( message ) {
		return returnedStrategies.onReturned( message );
	};
	var replyQueueName = '';

	if ( _.has( options, "replyQueue" ) ) {
		replyQueueName = options.replyQueue.name || options.replyQueue;
		if ( replyQueueName === false ) {
			this.replyQueue = { name: false };
		} else if ( replyQueueName ) {
			this.replyQueue = userReplyTo;
		} else if ( replyQueueName === "rabbitmq" ) {
			this.replyQueue = rabbitReplyTo;
		}
	} else {
		this.replyQueue = autoReplyTo;
	}

	function onReplyQueueFailed( err ) {
		log.error( "Failed to create reply queue for connection name '" + connection.name || "default" + "' with ", err );
	}

	connection.on( "reconnected", function() {
		this.createReplyQueue().then( null, onReplyQueueFailed );
		this.onReconnect();
	}.bind( this ) );

	connection.on( "return", function(raw) {
		raw.type = _.isEmpty( raw.properties.type ) ? raw.fields.routingKey : raw.properties.type;
		var contentType = raw.properties.contentType || "application/octet-stream";
		var serializer = this.serializers[ contentType ];
		if( !serializer ) {
			log.error( "Could not deserialize message id %s, connection '%s' - no serializer defined",
				raw.properties.messageId, this.connection.name );
		} else {
			try {
				raw.body = serializer.deserialize( raw.content, raw.properties.contentEncoding );
			} catch( err ) {
			}
		}

		this.onReturned(raw);
	}.bind( this ) );

  this.createDefaultExchange().then( null, _.noop );
	// delay creation to allow for subscribers to attach a handler
	process.nextTick( function() {
		this.createReplyQueue().then( null, onReplyQueueFailed );
	}.bind( this ) );
};

Topology.prototype.configureBindings = function( bindingDef, list ) {
	if ( _.isUndefined( bindingDef ) ) {
		return when( true );
	} else {
		var actualDefinitions = toArray( bindingDef, list );
		var bindings = _.map( actualDefinitions, function( def ) {
				var q = this.definitions.queues[ def.queueAlias ? def.queueAlias : def.target ];
				return this.createBinding(
					{
						source: def.exchange || def.source,
						target: q ? q.uniqueName : def.target,
						keys: def.keys,
						queue: q !== undefined,
						queueAlias: q ? q.name : undefined
					} );
			}.bind( this ) );
		if ( bindings.length === 0 ) {
			return when( true );
		} else {
			return when.all( bindings );
		}
	}
};

Topology.prototype.configureQueues = function( queueDef, list ) {
	if ( _.isUndefined( queueDef ) ) {
		return when( true );
	} else {
		var actualDefinitions = toArray( queueDef, list );
		var queues = _.map( actualDefinitions, function( def ) {
			return this.createQueue( def );
		}.bind( this ) );
		return when.all( queues );
	}
};

Topology.prototype.configureExchanges = function( exchangeDef, list ) {
	if ( _.isUndefined( exchangeDef ) ) {
		return when( true );
	} else {
		var actualDefinitions = toArray( exchangeDef, list );
		var exchanges = _.map( actualDefinitions, function( def ) {
			return this.createExchange( def );
		}.bind( this ) );
		return when.all( exchanges );
	}
};

Topology.prototype.createBinding = function( options ) {
	var id = [ options.source, options.target ].join( "->" );
	var keys = getKeys( options.keys );
	if ( keys[0] !== "" ) {
		id += ":" + keys.join(':');
	}
	var promise = this.promises[ id ];
	if( !promise ) {
		this.definitions.bindings[ id ] = options;
		var call = options.queue ? "bindQueue" : "bindExchange";
		var source = options.source;
		var target = options.target;
		if( options.queue ) {
			var queue = this.definitions.queues[ options.target ];
			if( queue && queue.uniqueName ) {
				target = queue.uniqueName;
			}
		}
		this.promises[ id ] = promise = this.connection.getChannel( "control", false, "control channel for bindings" )
			.then( function( channel ) {
				log.info( "Binding %s '%s' to '%s' on '%s' with keys: %s",
					( options.queue ? "queue" : "exchange" ), target, source, this.connection.name, JSON.stringify( keys ) );
				return when.all(
					_.map( keys, function( key ) {
						return channel[ call ]( target, source, key );
					} ) );
			}.bind( this ) );

	}
	return promise;
};

Topology.prototype.createPrimitive = function( Primitive, primitiveType, options ) {
	var errorFn = function( err ) {
		return new Error( "Failed to create " + primitiveType + " '" + options.name +
			"' on connection '" + this.connection.name +
			"' with '" + ( err ? ( err.stack || err ) : "N/A" ) + "'" );
	}.bind( this );
	var definitions = primitiveType === "exchange" ? this.definitions.exchanges : this.definitions.queues;
	var channelName = [ primitiveType, options.name ].join( ":" );
	var promise = this.promises[ channelName ];
	if( !promise ) {
		this.promises[ channelName ] = promise = when.promise( function( resolve, reject ) {
			definitions[ options.name ] = options;
			var primitive = this.channels[ channelName ] = new Primitive( options, this.connection, this, this.serializers );
			var onConnectionFailed = function( connectionError ) {
				reject( errorFn( connectionError ) );
			};
			if ( this.connection.state === "failed" ) {
				onConnectionFailed( this.connection.lastError() );
			} else {
				var onFailed = this.connection.on( "failed", function( err ) {
					onConnectionFailed( err );
				} );
				primitive.once( "defined", function() {
					onFailed.unsubscribe();
					resolve( primitive );
				} );
			}
			primitive.once( "failed", function( err ) {
				delete definitions[ options.name ];
				delete this.channels[ channelName ];
        delete this.promises[ channelName ];
				reject( errorFn( err ) );
			}.bind( this ) );
		}.bind( this ) );
	}
	return promise;
};

Topology.prototype.createDefaultExchange = function() {
  return this.createExchange( { name: "", passive: true } );
}

Topology.prototype.createExchange = function( options ) {
	return this.createPrimitive( Exchange, "exchange", options );
};

Topology.prototype.createQueue = function( options ) {
	options.uniqueName = this.getUniqueName( options );
	return this.createPrimitive( Queue, "queue", options );
};

Topology.prototype.createReplyQueue = function() {
	if ( this.replyQueue.name === undefined || this.replyQueue.name === false ) {
		return when.resolve();
	}
	var key = "queue:" + this.replyQueue.name;
	var promise;
	if ( !this.channels[ key ] ) {
		promise = this.createQueue( this.replyQueue );
		promise.then( function( channel ) {
			this.channels[ key ] = channel;
			this.emit( "replyQueue.ready", this.replyQueue );
		}.bind( this ) );
	} else {
		promise = when.resolve( this.channels[ key ] );
		this.emit( "replyQueue.ready", this.replyQueue );
	}
	return promise;
};

Topology.prototype.deleteExchange = function( name ) {
	var key = "exchange:" + name;
	var channel = this.channels[ key ];
	if ( channel ) {
		channel.release();
		delete this.channels[ key ];
		log.info( "Deleting %s exchange '%s' on connection '%s'", channel.type, name, this.connection.name );
	}
	return this.connection.getChannel( "control", false, "control channel for bindings"  )
		.then( function( channel ) {
			return channel.deleteExchange( name );
		} );
};

Topology.prototype.deleteQueue = function( name ) {
	var key = "queue:" + name;
	var channel = this.channels[ key ];
	if ( channel ) {
		channel.release();
		delete this.channels[ key ];
		log.info( "Deleting queue '%s' on connection '%s'", name, this.connection.name );
	}
	return this.connection.getChannel( "control", false, "control channel for bindings"  )
		.then( function( channel ) {
			return channel.deleteQueue( name );
		} );
};

Topology.prototype.getUniqueName = function( options ) {
	if( options.unique === "id" ) {
		return [ info.id, options.name ].join( "-" );
	} else if( options.unique === "hash" ) {
		return [ options.name, info.createHash() ].join( "-" );
	} else if( options.unique === "consistent" ) {
		return [ options.name, info.createConsistentHash() ].join( "-" );
	} else {
		return options.name;
	}
};

Topology.prototype.onReconnect = function() {
	log.info( "Reconnection to '%s' established - rebuilding topology", this.connection.name );
	this.promises = {};
	var prerequisites = _.map( this.channels, function( channel ) {
		return channel.check ? channel.check() : when( true );
	}.bind( this ) );
	return when.all( prerequisites )
		.then( function() {
			return this.configureBindings( this.definitions.bindings, true )
				.then( function() {
					log.info( "Topology rebuilt for connection '%s'", this.connection.name );
					this.emit( "bindings-completed", this.definitions );
          this.emit( this.connection.name + ".connection.configured", this.connection );
				}.bind( this ) );
		}.bind( this ) );
};

Topology.prototype.reset = function() {
	this.channels = {};
	this.definitions = {
		bindings: {},
		exchanges: {},
		queues: {},
		subscriptions: {}
	};
};

Topology.prototype.renameQueue = function( newQueueName ) {
  var queue = this.definitions.queues[ "" ];
  var channel = this.channels [ "queue:" ];
  this.definitions.queues[ newQueueName ] = queue;
  this.channels[ [ "queue", newQueueName ].join( ":" ) ] = channel;
  delete this.definitions.queues[ "" ];
  delete this.channels[ "queue:" ];
}

Monologue.mixInto( Topology );

module.exports = function( connection, options, serializers, unhandledStrategies, returnedStrategies, exchangeFsm, queueFsm, defaultId ) {
	// allows us to optionally provide mocks and control the default queue name
	Exchange = exchangeFsm || require( "./exchangeFsm.js" );
	Queue = queueFsm || require( "./queueFsm.js" );
	replyId = defaultId || info.id;

	return new Topology( connection, options, serializers, unhandledStrategies, returnedStrategies );
};
