var when = require( "when" );
var format = require( "util" ).format;
var log = require( "./log" )( "rabbot.configuration" );

/* log
	* `rabbot.configuration`
	  * error
	    * configuration failed (in exchange, queue or bindings)
*/

var logger;
module.exports = function( Broker ) {
	Broker.prototype.configure = function( config ) {
		if( !logger && config.logging ) {
			logger = require( "./log" )( config.logging || {} );
		}
		var connection;
		var emit = this.emit;
		this.configurations[ config.name || "default" ] = config;
		return when.promise( function( resolve, reject ) {

			function onExchangeError( err ) {
				log.error( "Configuration of %s failed due to an error in one or more exchange settings: %s", connection.name, err );
				reject( err );
			}

			function onQueueError( err ) {
				log.error( "Configuration of %s failed due to an error in one or more queue settings: %s", connection.name, err.stack );
				reject( err );
			}

			function onBindingError( err ) {
				log.error( "Configuration of %s failed due to an error in one or more bindings: %s", connection.name, err.stack );
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
				emit( connection.name + ".connection.configured", connection );
				resolve();
			}

			connection = this.addConnection( config.connection );
			createExchanges();
			connection.once( "unreachable", function() {
				reject( new Error( format( "Configuration for '%s' failed - all nodes are unreachable.", connection.name ) ) );
			} );
		}.bind( this ) );
	};
};
