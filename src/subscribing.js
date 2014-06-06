var _ = require( 'lodash' ),
	postal = require( 'postal' ),
	when = require( 'when' ),
	uuid = require( 'node-uuid' );

module.exports = function( Broker, log ) {

	var dispatch = postal.channel( 'rabbit.dispatch' ),
		responses = postal.channel( 'rabbit.responses' ),
		responseSubscriptions = {};

	Broker.prototype.handle = function( messageType, handler, context ) {
		var subscription = dispatch.subscribe( messageType, handler.bind( context ) );
		subscription.remove = subscription.unsubscribe;
		return subscription;
	};

	Broker.prototype.request = function( exchangeName, options, connectionName ) {
		var requestId = uuid.v1();
		options.messageId = requestId;
		options.connectionName = connectionName;
		options.replyTo = this.replyTo;
		return when.promise( function( resolve, reject, notify ) {
			var subscription = responses.subscribe( requestId, function( message ) {
				if( message.properties.headers[ 'sequence_end' ] ) {
					resolve( message );
					subscription.unsubscribe();
				} else {
					notify( message );
				}
			} );
			this.publish( exchangeName, options );
		}.bind( this ) );
	};

	Broker.prototype.startSubscription = function( queue, connectionName ) {
		connectionName = connectionName || 'default';
		return when.promise( function( resolve, reject ) {
			this.getQueue( queue, connectionName )
				.then( null, reject )
				.then( function( channel ) {
					try {
						var consumerTag = channel.subscribe( queue );
						if ( !consumerTag ) {
							reject( 'Could not subscribe to queue "' + queue + '"' );
						} else {
							resolve( channel );
						}
					} catch ( err ) {
						reject( err );
					}
				}.bind( this ) );
		}.bind( this ) );
	};
};