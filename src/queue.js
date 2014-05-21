var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' );

module.exports = function( Broker, log ) {

	// wraps useQueue
	Broker.prototype.addQueue = function( name, options, connectionName, suppressAddTask ) {
		options.name = name;
		return this.useQueue( options, connectionName, suppressAddTask );
	};

	Broker.prototype.bindQueue = function( source, target, keys, connectionName, suppressAddTask ) {
		connectionName = connectionName || 'default';
		this.onReconnect( connectionName, 'bindQueue', arguments, 3, suppressAddTask );
		return when.promise( function( resolve, reject ) {
			this.getChannel( 'control', connectionName )
				.then( null, function( err ) {
					this.log.error( {
						error: err,
						reason: 'Could not get the control channel to bind queue "' + target + '" to exchange "' + source + '" with keys "' + JSON.stringify( keys ) + '"'
					} );
					reject( err );
				}.bind( this ) )
				.then( function( channel ) {
					var actualKeys = [ '' ];
					if( keys && keys.length > 0 ) {
						actualKeys = _.isArray( keys ) ? keys : [ keys ];
					}
					var bindings = _.map( actualKeys, function( key ) {
						return channel.model.bindQueue( target, source, key );
					} );
					when.all( bindings )
						.then( null, function( err ) {
							this.log.error( {
								error: err,
								reason: 'Binding exchange "' + target + '" to exchange ""' + source + ' with keys "' + JSON.stringify( keys ) + '" failed.'
							} );
							reject( err );
						}.bind( this ) )
						.done( resolve );
				}.bind( this ) );
		}.bind( this ) );
	};

	Broker.prototype._configureQueues = function( queueDef, connectionName ) {
		return when.promise( function( resolve, reject ) {
			if ( _.isUndefined( queueDef ) ) {
				resolve();
			} else {
				var actualDefinitions = _.isArray( queueDef ) ? queueDef : [ queueDef ],
					actions = [];
				_.each( actualDefinitions, function( def ) {
					actions.push( function() {
						return this.useQueue( def, connectionName );
					}.bind( this ) );
				}.bind( this ) );
				pipeline( actions )
					.then( null, function( err ) {
						reject( err );
					} )
					.done( function() {
						resolve();
					} );
			}
		}.bind( this ) );
	};

	Broker.prototype.getQueue = function( name, connectionName ) {
		connectionName = connectionName || 'default';
		var queue = this.connections[ connectionName ].queues[ name ];
		return queue;
	};

	Broker.prototype.useQueue = function( queueDef, connectionName, suppressAddTask ) {
		connectionName = connectionName || 'default';
		this.onReconnect( connectionName, 'useQueue', arguments, 1, suppressAddTask );
		var name = queueDef.name;
		channelName = 'queue-' + name;
		return when.promise( function( resolve, reject ) {
			this.getChannel( channelName, connectionName )
				.then( null, function( err ) {
					reject( err );
				} )
				.then( function( channel ) {
					this.connections[ connectionName ].queues[ name ] = channel;
					var valid = this.aliasOptions( queueDef, {
						queueLimit: 'maxLength',
						deadLetter: 'deadLetterExchange'
					}, 'subscribe', 'limit' ),
						result = channel.model.assertQueue( name, valid );
					if ( queueDef[ 'limit' ] ) {
						channel.model.prefetch( queueDef[ 'limit' ] );
					}
					var consuming = _.contains( this.connections[ connectionName ].consuming, name );
					if ( queueDef.subscribe || consuming ) {
						this.subscribe( channel, name );
					}
					result
						.then( null, function( err ) {
							this.log.error( {
								error: err,
								reason: 'Could not create queue "' + JSON.stringify( queueDef ) + '" on connection "' + connectionName + '".'
							} );
							reject( err );
						}.bind( this ) )
						.then( function() {
							resolve();
						} );
				}.bind( this ) );
		}.bind( this ) );
	};
};