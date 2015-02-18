var when = require( 'when' );
var log = require( './log' )( 'wascally:configuration' );

module.exports = function( Broker ) {

	Broker.prototype.configure = function( config ) {
		// convenience method to add connection and build up using specified configuration
		// normally, the approach here might be a bit pedantic, but it's preferable
		// to the pyramid of doom callbacks
		require( './log' )( config.logging || {} );
		var connection;
		var emit = this.emit;
		return when.promise( function( resolve, reject ) {

			var onExchangeError = function( err ) {
				log.error( 'Configuration of %s failed due to an error in one or more exchange settings: %s', connection.name, err );
				reject( err );
			}.bind( this );
			var createExchanges = function() {
				connection.configureExchanges( config.exchanges )
					.then( createQueues, onExchangeError );
			}.bind( this );

			var onQueueError = function( err ) {
				log.error( 'Configuration of %s failed due to an error in one or more queue settings: %s', connection.name, err );
				reject( err );
			}.bind( this );
			var createQueues = function() {
				connection.configureQueues( config.queues )
					.then( createBindings, onQueueError );
			}.bind( this );

			var onBindingError = function( err ) {
				log.error( 'Configuration of %s failed due to an error in one or more bindings: %s', connection.name, err );
				reject( err );
			}.bind( this );
			var createBindings = function() {
				connection.configureBindings( config.bindings, connection.name )
					.then( finish, onBindingError );
			}.bind( this );

			var finish = function() {
				emit( connection.name + '.connection.configured', connection );
				resolve();
			};
			connection = this.addConnection( config.connection );
			createExchanges();
		}.bind( this ) );
	};
};
