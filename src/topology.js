var when = require( 'when' );
var _ = require( 'lodash' );
var uuid = require( 'node-uuid' );
var Exchange = require( './exchange.js' );
var Queue = require( './queue.js' );
var Monologue = require( 'monologue.js' )( _ );

var replyId = uuid.v1();

function aliasOptions( options, aliases ) {
	var aliased = _.transform( options, function( result, value, key ) {
		var alias = aliases[ key ];
		result[ alias || key ] = value;
	} );
	return _.omit( aliased, Array.prototype.slice.call( arguments, 2 ) );
}

function getKeys( keys ) {
	var actualKeys = [ '' ];
	if( keys && keys.length > 0 ) {
		actualKeys = _.isArray( keys ) ? keys : [ keys ];
	}
	return actualKeys;
}

function toArray( x, list ) {
	if( _.isArray( x ) ) {
		return x; 
	}
	if( _.isObject( x ) && list ) {
		return _.map( x, function( item ) { 
			return item; 
		} );
	}
	if( _.isUndefined( x ) || _.isEmpty( x ) ) {
		return [];
	}
	return [ x ];
}

var Topology = function( connection ) {
	this.connection = connection;
	this.channels = {};
	this.definitions = {
			bindings: {},
			exchanges: {},
			queues: {}
		};
	this.replyQueue = [ replyId, 'response', 'queue' ].join( '.' );
	connection.on( 'reconnected', function() {
		this.createReplyQueue();
		this.onReconnect();
	}.bind( this ) );
	this.createReplyQueue();
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
		if( bindings.length === 0 ) {
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
		var actualDefinitions = toArray( exchangeDef, list ),
			exchanges = _.map( actualDefinitions, function( def ) {
				return this.createExchange( def );
			}.bind( this ) );
		return when.all( exchanges );
	}
};

Topology.prototype.createBinding = function( options ) {
	var id = [ options.source, options.target ].join( '->' );
	this.definitions.bindings[ id ] = options;
	var term = options.queue ? 'queue' : 'exchange';
	var call = options.queue ? 'bindQueue' : 'bindExchange';
	var source = options.source;
	var target = options.target;
	var keys = getKeys( options.keys );
	var channel = this.getChannel( 'control' );
	return when.all( 
		_.map( keys, function( key ) {
			return channel[ call ]( target, source, key );
		} ) );
};

Topology.prototype.createExchange = function( options ) {
	this.definitions.exchanges[ options.name ] = options;
	var channelName = 'exchange:' + options.name;
	return when.promise( function( resolve, reject ) {
		var exchange = this.channels[ channelName ] = new Exchange( options, this.connection, this );
		exchange.on( 'defined', function() {
			resolve( exchange );	
		} );
	}.bind( this ) );
};

Topology.prototype.createQueue = function( options ) {
	this.definitions.queues[ options.name ] = options;
	var channelName = 'queue:' + options.name;
	return when.promise( function( resolve, reject ) {
		var queue = this.channels[ channelName ] = new Queue( options, this.connection, this );
		queue.on( 'defined', function() {
			resolve( queue );
		} );
	}.bind( this ) );
};

Topology.prototype.createReplyQueue = function() {
	if( !this.channels[ 'queue:' + this.replyQueue ] ) {
		this.createQueue( { name: this.replyQueue, autoDelete: true, subscribe: true } );
	}
};

Topology.prototype.deleteExchange = function( name ) {
	var key = 'exchange:' + name,
		channel = this.channels[ key ];
	if( channel ) {
		channel.destroy();
		delete this.channels[ key ];
	} 
	var control = this.getChannel( 'control' );
	return control.deleteExchange( name );
};

Topology.prototype.deleteQueue = function( name ) {
	var key = 'queue:' + name;
	var channel = this.channels[ key ];
	if( channel ) {
		channel.destroy();
		delete this.channels[ key ];
	} 
	var control = this.getChannel( 'control' );
	return control.deleteQueue( name );
};

Topology.prototype.getChannel = function( name ) {
	var channel = this.channels[ name ];
	if( !channel ) {
		channel = this.connection.createChannel( false );
		this.channels[ name ] = channel;
	}
	return channel;
};

Topology.prototype.onReconnect = function() {
	var prerequisites = _.map( this.channels, function( channel ) {
		return channel.check ? channel.check() : when( true );
	}.bind( this ) );
	when.all( prerequisites )
		.then( function() {
			this.configureBindings( this.definitions.bindings, true )
				.then( function() {
					this.emit( 'bindings-completed' );
				}.bind( this ) );
		}.bind( this ) );
};

Topology.prototype.reset = function() {
	_.each( this.channels, function( channel ) {
		if( channel.destroy ) {
			channel.destroy();
		}
	} );
	this.channels = {};
	this.definitions = {
		bindings: {},
		exchanges: {},
		queues: {},
		subscriptions: {}
	};
};

Monologue.mixin( Topology );

module.exports = function( connection ) {
	return new Topology( connection );
};