var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' );

module.exports = function( Broker, log ) {

	// wraps 'useExchange'
	Broker.prototype.addExchange = function( name, type, options, connectionName, suppressAddTask ) {
		options.name = name;
		options.type = type;
		return this.useExchange( options, connectionName, suppressAddTask );
	};

	Broker.prototype.bindExchange = function( source, target, keys, connectionName, suppressAddTask ) {
		connectionName = connectionName || 'default';
		this.onReconnect( connectionName, 'bindExchange', arguments, 3, suppressAddTask );
		return when.promise( function( resolve, reject ) {
			this.getChannel( 'control', connectionName ) //Hey Alex, why are we always only binding to the control channel?
				.then( null, function( err ) {
					log.error( {
						error: err,
						reason: 'Could not get the control channel to bind exchange "' + target + '" to exchange ""' + source + ' with keys "' + JSON.stringify( keys ) + '"'
					} );
					reject( err );
				} )
				.then( function( channel ) {
					var actualKeys = _.isArray( keys ) ? keys : [ keys ],
						bindings = _.map( actualKeys, function( key ) {
							return channel.model.bindExchange( source, target, key );
						} );
					when.all( bindings )
						.then( null, function( err ) {
							log.error( {
								error: err,
								reason: 'Binding exchange "' + target + '" to exchange ""' + source + ' with keys "' + JSON.stringify( keys ) + '" failed.'
							} );
							reject( err );
						} )
						.done( resolve );
				}.bind( this ) );
		}.bind( this ) );
	};

	Broker.prototype._configureExchanges = function( exchangeDef, connectionName ) {
		return when.promise( function( resolve, reject ) {
			if ( _.isUndefined( exchangeDef ) ) {
				resolve();
			} else {
				var actualDefinitions = _.isArray( exchangeDef ) ? exchangeDef : [ exchangeDef ],
					actions = [];
				_.each( actualDefinitions, function( def ) {
					actions.push( function() {
						return this.useExchange( def, connectionName );
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


	Broker.prototype.getExchange = function( name, connectionName ) {
		connectionName = connectionName || 'default';
		var exchange = this.connections[ connectionName ].exchanges[ name ];
		return exchange;
	};

	Broker.prototype.useExchange = function( exchangeDef, connectionName, suppressAddTask ) {
		connectionName = connectionName || 'default';
		this.onReconnect( connectionName, 'useExchange', arguments, 1, suppressAddTask );
		var channelName = 'exchange-' + exchangeDef.name;
		return when.promise( function( resolve, reject ) {
			this.getChannel( channelName, connectionName, true )
				.then( null, function( err ) {
					reject( err );
				} )
				.then( function( channel ) {
					this.connections[ connectionName ].exchanges[ exchangeDef.name ] = channel;
					if ( exchangeDef.persistent ) {
						channel.persistent = true;
					}
					var valid = this.aliasOptions( exchangeDef, {
						alternate: 'alternateExchange'
					}, 'persistent' );
					var result = channel.model.assertExchange( exchangeDef.name, exchangeDef.type, valid )
						.then( null, function( err ) {
							log.error( {
								error: err,
								reason: 'Could not create exchange "' + JSON.stringify( exchangeDef ) + '" on connection "' + connectionName + '".'
							} );
							reject( err );
						} )
						.then( function() {
							resolve();
						} );
				}.bind( this ) );
		}.bind( this ) );
	};

};