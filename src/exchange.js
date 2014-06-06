var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' );

module.exports = function( Broker, log ) {

	Broker.prototype.addExchange = function( name, type, options, connectionName ) {
		if( _.isObject( name ) ) {
			options = name;
			connectionName = type;
		} else {
			options.name = name;
			options.type = type;
		}
		return when.promise( function( resolve, reject ) {
			this.getConnection( connectionName )
				.then( function( connection ) {
					connection._createExchange( options )
						.then( resolve )
						.then( null, reject );
				} )
				.then( null, reject );
		}.bind( this ) );
	};

	Broker.prototype.bindExchange = function( source, target, keys, connectionName ) {
		return when.promise( function( resolve, reject ) {
			this.getConnection( connectionName )
				.then( function( connection ) {
					connection._createBinding( { source: source, target: target, keys: keys } )
						.then( resolve )
						.then( null, reject );
				} )
				.then( null, function( err ) {} );
		}.bind( this ) );
	};

	Broker.prototype.getExchange = function( name, connectionName ) {
		return when.promise( function( resolve, reject ) {
			this.getChannel( 'exchange:' + name, connectionName, true )
				.then( function( channel ) {
					resolve( channel );
				} )
				.then( null, function( err ) {} );
		}.bind( this ) );
	};
};