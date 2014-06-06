var _ = require( 'lodash' ),
	when = require( 'when' ),
	uuid = require( 'node-uuid' );

module.exports = function( Broker, log ) {

	Broker.prototype.publish = function( exchangeName, type, message, routingKey, correlationId, connectionName, sequenceNo ) {
		var replyTo = undefined,
			messageId = undefined,
			appId = this.appId,
			headers = {},
			timestamp = Date.now(),
			options;
		if( _.isObject( type ) ) {
			options = type;
			connectionName = message;
		} else {
			options = {
				appId: this.appId,
				type: type,
				body: message,
				routingKey: routingKey,
				correlationId: correlationId,
				replyTo: replyTo,
				sequenceNo: sequenceNo,
				timestamp: timestamp,
				headers: {}
			}
		}
		connectionName = connectionName || 'default';
		return when.promise( function( resolve, reject ) {
			this.getExchange( exchangeName, connectionName )
				.then( function( exchange ) {
					exchange.publish( options )
						.then( resolve );
				}.bind( this ) )
				.then( null, reject )
				.catch( reject );
			}.bind( this ) );
	};

	Broker.prototype.sendPendingMessages = function() {
		var results = _.map( this.pendingMessages, function( message ) {
			try {
				var connection = this.connections[ message.connectionName ];
				if ( connection && connection.exchanges[ message.exchangeName ] ) {
					this.publish( message.exchangeName, message.type, message.message, message.routingKey, message.correlationId, message.connectionName, message.sequenceNo );
				}
				return true;
			} catch ( err ) {
				this.emit( 'errorLogged' );
				this.log.error( {
					error: err,
					reason: 'Failed to re-send message "' + JSON.stringify( message ) + '"'
				} );
				return false;
			}
		}.bind( this ) );
		return _.reduce( results, function( aggregate, result ) {
			return aggregate && result;
		} );
	};

};