var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' ),
	log = require( './log' );

module.exports = function( Broker ) {

	Broker.prototype.configure = function( config ) {
		// convenience method to add connection and build up using specified configuration
		// normally, the approach here might be a bit pedantic, but it's preferable
		// to the pyramid of doom callbacks
		this.config = config;
		var connection,
			emit = this.emit;
		return when.promise( function( resolve, reject ) {
			var createExchanges = function() {
				connection.configureExchanges( config.exchanges )
					.then( null, function( err ) {
						log.error( {
							error: err,
							reason: 'Could not configure exchanges as specified'
						} );
						reject( err );
					}.bind( this ) )
					.then( createQueues )
				}.bind( this ),
				createQueues = function() {
					connection.configureQueues( config.queues )
						.then( null, function( err ) {
							log.error( {
								error: err,
								reason: 'Could not configure queues as specified'
							} );
							reject( err );
						}.bind( this ) )
						.then( createBindings );
				}.bind( this ),
				createBindings = function() {
					connection.configureBindings( config.bindings, connection.name )
						.then( null, function( err ) {
							log.error( {
								error: err,
								reason: 'Could not configure bindings as specified'
							} );
							reject( err );
						}.bind( this ) )
						.then( finish );
				}.bind( this ),
				finish = function() {
					emit( connection.name + '.connection.configured', connection );
					resolve();
				};
			connection = this.addConnection( config.connection );

			createExchanges();
		}.bind( this ) );
	};
};