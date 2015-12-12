var when = require( 'when' );
var _ = require( 'lodash' );
var uuid = require( 'node-uuid' );
var Monologue = require( 'monologue.js' );
var log = require( './log.js' )( 'wascally.topology' );
var Exchange, Queue;
var replyId;

function getKeys( keys ) {
	var actualKeys = [ '' ];
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

var Topology = function( connection, options, unhandledStrategies ) {
	var autoReplyTo = { name: [ replyId, 'response', 'queue' ].join( '.' ), autoDelete: true, subscribe: true };
	var rabbitReplyTo = { name: 'amq.rabbitmq.reply-to', subscribe: true, noAck: true };
	var userReplyTo = _.isObject( options.replyQueue ) ? options.replyQueue : { name: options.replyQueue, autoDelete: true, subscribe: true };
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
	this.onUnhandled = function( message ) {
		return unhandledStrategies.onUnhandled( message );
	};
	var replyQueueName = '';

	if ( _.has( options, 'replyQueue' ) ) {
		replyQueueName = options.replyQueue.name || options.replyQueue;
		if ( replyQueueName === false ) {
			this.replyQueue = { name: false };
		} else if ( replyQueueName ) {
			this.replyQueue = userReplyTo;
		} else if ( replyQueueName === 'rabbitmq' ) {
			this.replyQueue = rabbitReplyTo;
		}
	} else {
		this.replyQueue = autoReplyTo;
	}

	function onReplyQueueFailed( err ) {
		log.error( 'Failed to create reply queue for connection name "' + connection.name || 'default' + '" with ', err );
	}

	connection.on( 'reconnected', function() {
		this.createReplyQueue().then( null, onReplyQueueFailed );
		this.onReconnect();
	}.bind( this ) );

	// delay creation to allow for subscribers to attach a handler
	process.nextTick( function() {
		this.createReplyQueue().then( null, onReplyQueueFailed );
	}.bind( this ) );
};

Topology.prototype.configureBindings = function( bindingDef, list ) {
	if ( _.isUndefined( bindingDef ) ) {
		return when( true );
	} else {
		var actualDefinitions = toArray( bindingDef, list ),
			bindings = _.map( actualDefinitions, function( def ) {
				var q = this.definitions.queues[ def.target ];
				return this.createBinding(
					{
						source: def.exchange || def.source,
						target: def.target,
						keys: def.keys,
						queue: q !== undefined
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
	var id = [ options.source, options.target ].join( '->' );
	var promise = this.promises[ id ];
	if( !promise ) {
		this.definitions.bindings[ id ] = options;
		var call = options.queue ? 'bindQueue' : 'bindExchange';
		var source = options.source;
		var target = options.target;
		var keys = getKeys( options.keys );
		var channel = this.getChannel( 'control' );
		log.info( 'Binding \'%s\' to \'%s\' on \'%s\' with keys: %s',
			target, source, this.connection.name, JSON.stringify( keys ) );
		this.promises[ id ] = promise = when.all(
			_.map( keys, function( key ) {
				return channel[ call ]( target, source, key );
			} ) );
	}
	return promise;
};

Topology.prototype.createPrimitive = function( Primitive, primitiveType, options ) {
	var errorFn = function( err ) {
		return new Error( 'Failed to create ' + primitiveType + ' \'' + options.name +
			'\' on connection \'' + this.connection.name +
			'\' with \'' + ( err ? ( err.message || err ) : 'N/A' ) + '\'' );
	}.bind( this );
	var definitions = primitiveType === 'exchange' ? this.definitions.exchanges : this.definitions.queues;
	var channelName = [ primitiveType, options.name ].join( ':' );
	var promise = this.promises[ channelName ];
	if( !promise ) {
		this.promises[ channelName ] = promise = when.promise( function( resolve, reject ) {
			definitions[ options.name ] = options;
			var primitive = this.channels[ channelName ] = new Primitive( options, this.connection, this );
			var onConnectionFailed = function( connectionError ) {
				reject( errorFn( connectionError ) );
			};
			if ( this.connection.state === 'failed' ) {
				onConnectionFailed( this.connection.lastError() );
			} else {
				var onFailed = this.connection.on( 'failed', function( err ) {
					onConnectionFailed( err );
				} );
				primitive.once( 'defined', function() {
					onFailed.unsubscribe();
					resolve( primitive );
				} );
			}
			primitive.once( 'failed', function( err ) {
				delete definitions[ options.name ];
				delete this.channels[ channelName ];
				reject( errorFn( err ) );
			}.bind( this ) );
		}.bind( this ) );
	}
	return promise;
};

Topology.prototype.createExchange = function( options ) {
	return this.createPrimitive( Exchange, 'exchange', options );

};

Topology.prototype.createQueue = function( options ) {
	return this.createPrimitive( Queue, 'queue', options );
};

Topology.prototype.createReplyQueue = function() {
	if ( this.replyQueue.name === undefined || this.replyQueue.name === false ) {
		return when.resolve();
	}
	var key = 'queue:' + this.replyQueue.name;
	var promise;
	if ( !this.channels[ key ] ) {
		promise = this.createQueue( this.replyQueue );
		this.channels[ key ].on( 'defined', function() {
			this.emit( 'replyQueue.ready', this.replyQueue );
		}.bind( this ) );
	} else {
		promise = when.resolve();
	}
	return promise;
};

Topology.prototype.deleteExchange = function( name ) {
	var key = 'exchange:' + name;
	var channel = this.channels[ key ];
	if ( channel ) {
		channel.destroy();
		delete this.channels[ key ];
		log.info( 'Deleting %s exchange \'%s\' on connection \'%s\'', channel.type, name, this.connection.name );
	}
	var control = this.getChannel( 'control' );
	return control.deleteExchange( name );
};

Topology.prototype.deleteQueue = function( name ) {
	var key = 'queue:' + name;
	var channel = this.channels[ key ];
	if ( channel ) {
		channel.destroy();
		delete this.channels[ key ];
		log.info( 'Deleting queue \'%s\' on connection \'%s\'', name, this.connection.name );
	}
	var control = this.getChannel( 'control' );
	return control.deleteQueue( name );
};

Topology.prototype.getChannel = function( name ) {
	var channel = this.channels[ name ];
	if ( !channel ) {
		channel = this.connection.createChannel( false );
		this.channels[ name ] = channel;
	}
	return channel;
};

Topology.prototype.onReconnect = function() {
	log.info( 'Reconnection to \'%s\' established - rebuilding topology', this.connection.name );
	this.promises = {};
	var prerequisites = _.map( this.channels, function( channel ) {
		return channel.check ? channel.check() : when( true );
	}.bind( this ) );
	when.all( prerequisites )
		.then( function() {
			this.configureBindings( this.definitions.bindings, true )
				.then( function() {
					log.info( 'Topology rebuilt for connection \'%s\'', this.connection.name );
					this.emit( 'bindings-completed' );
				}.bind( this ) );
		}.bind( this ) );
};

Topology.prototype.reset = function() {
	_.each( this.channels, function( channel ) {
		if ( channel.destroy ) {
			channel.destroy();
		}
	} );
	this.channels = {};
	this.connection.reset();
	this.definitions = {
		bindings: {},
		exchanges: {},
		queues: {},
		subscriptions: {}
	};
};

Monologue.mixInto( Topology );

module.exports = function( connection, options, unhandledStrategies, exchangeFsm, queueFsm, defaultId ) {
	// allows us to optionally provide mocks and control the default queue name
	Exchange = exchangeFsm || require( './exchangeFsm.js' );
	Queue = queueFsm || require( './queueFsm.js' );
	replyId = defaultId || uuid.v1();

	return new Topology( connection, options, unhandledStrategies );
};
