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

			function onExchangeError( err ) {
				log.error( 'Configuration of %s failed due to an error in one or more exchange settings: %s', connection.name, err );
				reject( err );
			}

			function onQueueError( err ) {
				log.error( 'Configuration of %s failed due to an error in one or more queue settings: %s', connection.name, err );
				reject( err );
			}

			function onBindingError( err ) {
				log.error( 'Configuration of %s failed due to an error in one or more bindings: %s', connection.name, err );
				reject( err );
			}

			function createExchanges() {
				connection.configureExchanges( config.exchanges )
					.then( createQueues, onExchangeError );
			}

			function createQueues() {
				connection.configureQueues( config.queues )
					.then( createBindings, onQueueError );
			}

			function createBindings() {
				connection.configureBindings( config.bindings, connection.name )
					.then( finish, onBindingError );
			}

			function finish() {
				emit( connection.name + '.connection.configured', connection );
				resolve();
			}

			connection = this.addConnection( config.connection );
			createExchanges();
		}.bind( this ) );
	};
};
