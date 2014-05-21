var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' );

module.exports = function( Broker, log ) {

	Broker.prototype.aliasOptions = function( options, aliases ) {
		var aliased = _.transform( options, function( result, value, key ) {
			var alias = aliases[ key ];
			result[ alias || key ] = value;
		} );
		return _.omit( aliased, Array.prototype.slice.call( arguments, 2 ) );
	};

	Broker.prototype.configure = function( config ) {
		// convenience method to add connection and build up using specified configuration
		// normally, the approach here might be a bit pedantic, but it's preferable
		// to the pyramid of doom callbacks
		this.config = config;
		config.connection.name = config.connection.name || 'default';
		var connection,
			configExchanges = _.bind( this._configureExchanges, this ),
			configQueues = _.bind( this._configureQueues, this ),
			configBindings = _.bind( this._configureBindings, this ),
			emit = this.emit;
		return when.promise( function( resolve, reject ) {
			var createExchanges = function( conn ) {
				connection = conn;
				configExchanges( config.exchanges, connection.name )
					.then( null, function( err ) {
						this.log.error( {
							error: err,
							reason: 'Could not configure exchanges as specified'
						} );
						reject( err );
					}.bind( this ) )
					.then( createQueues );
				}.bind( this ),
				createQueues = function() {
					configQueues( config.queues, connection.name )
						.then( null, function( err ) {
							this.log.error( {
								error: err,
								reason: 'Could not configure queues as specified'
							} );
							reject( err );
						}.bind( this ) )
						.done( createBindings );
				}.bind( this ),
				createBindings = function() {
					configBindings( config.bindings, connection.name )
						.then( null, function( err ) {
							this.log.error( {
								error: err,
								reason: 'Could not configure bindings as specified'
							} );
							reject( err );
						}.bind( this ) )
						.done( finish );
				}.bind( this ),
				finish = function() {
					emit( connection.name + '.connection.configured', connection );
					resolve();
				};
			this.addConnection( config.connection )
				.then( null, function( err ) {
					this.log.error( {
						error: err,
						reason: 'Could not establish the connection specified'
					} );
					reject( err );
				}.bind( this ) )
				.then( function( c ) {
					createExchanges( c );
				} );
		}.bind( this ) );
	};

	Broker.prototype._configureBindings = function( bindingDef, connectionName ) {
		return when.promise( function( resolve, reject ) {
			if ( _.isUndefined( bindingDef ) ) {
				resolve();
			} else {
				var actualDefinitions = _.isArray( bindingDef ) ? bindingDef : [ bindingDef ],
					actions = [];
				_.each( actualDefinitions, function( def ) {
					var q = this.getQueue( def.target, connectionName ),
						call = q ? 'bindQueue' : 'bindExchange',
						bind = function() {
							return this[ call ]( def.exchange, def.target, def.keys, connectionName );
						}.bind( this );
					actions.push( bind );
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
};