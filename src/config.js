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
		var topology;
		var emit = this.emit;
		this.configurations[ config.name || "default" ] = config;
		return when.promise( function( resolve, reject ) {

			function onExchangeError( err ) {
				log.error( "Configuration of %s failed due to an error in one or more exchange settings: %s", topology.name, err );
				reject( err );
			}

			function onQueueError( err ) {
				log.error( "Configuration of %s failed due to an error in one or more queue settings: %s", topology.name, err.stack );
				reject( err );
			}

			function onBindingError( err ) {
				log.error( "Configuration of %s failed due to an error in one or more bindings: %s", topology.name, err.stack );
				reject( err );
			}

			function createExchanges() {
				topology.configureExchanges( config.exchanges )
					.then( createQueues, onExchangeError );
			}

			function createQueues() {
				topology.configureQueues( config.queues )
					.then( createBindings, onQueueError );
			}

			function createBindings() {
				topology.configureBindings( config.bindings, topology.name )
					.then( finish, onBindingError );
			}

			function finish() {
				log.info("Configuration succeeded %s", topology.name);
				emit( topology.connection.name + ".connection.configured", topology.connection );
				resolve();
			}

			topology = this.addConnection( config.connection );


			topology.connection.once( "connected", function() {
				createExchanges();
			} );

			topology.connection.once( "unreachable", function() {
				reject( new Error( format( "Configuration for '%s' failed - all nodes are unreachable.", topology.name ) ) );
			} );

		}.bind( this ) );
	};
};
