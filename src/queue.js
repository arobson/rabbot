var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' );

module.exports = function( Broker, log ) {

	Broker.prototype.addQueue = function( name, options, connectionName ) {
		options.name = name;
		return when.promise( function( resolve, reject ) {
			this.getConnection( connectionName )
				.then( function( connection ) {
					connection._createQueue( options, connectionName )
						.then( resolve )
						.then( null, reject );
				} )
				.then( null, reject );
		}.bind( this ) );
	};

	Broker.prototype.bindQueue = function( source, target, keys, connectionName ) {
		return when.promise( function( resolve, reject ) {
			this.getConnection( connectionName )
				.then( function( connection ) {
					connection._createBinding( { source: source, target: target, keys: keys, queue: true }, connectionName )
						.then( resolve )
						.then( null, reject );
				} )
				.then( null, reject )
				.catch( reject );
		}.bind( this ) );
	};

	Broker.prototype.getQueue = function( name, connectionName ) {
		return when.promise( function( resolve, reject ) {
			this.getChannel( 'queue:' + name, connectionName )
				.then( function( channel ) {
					resolve( channel );
				} )
				.then( null, function( err ) {} );
		}.bind( this ) );
	};
};