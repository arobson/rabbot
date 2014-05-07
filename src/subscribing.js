var _ = require( 'lodash' ),
	postal = require( 'postal' ),
	when = require( 'when' );

module.exports = function( Broker, log ) {

	var dispatch = postal.channel( 'rabbit.dispatch' );

	Broker.prototype.handle = function( messageType, handler, context ) {
		var subscription = dispatch.subscribe( messageType, handler.bind( context ) );
		subscription.remove = subscription.unsubscribe;
		return subscription;
	};

	Broker.prototype.startSubscription = function( queue, connectionName ) {
		connectionName = connectionName || 'default';
		var channelName = 'queue-' + queue,
			list = this.connections[ connectionName ].consuming;
		if ( !_.contains( list, queue ) ) {
			list.push( channelName );
		}

		return when.promise( function( resolve, reject ) {
			this.getChannel( channelName, connectionName )
				.then( null, function( err ) {
					reject( err );
				} )
				.then( function( channel ) {
					try {
						var consumerTag = this.subscribe( channel, queue );
						if ( !consumerTag ) {
							reject( 'Could not subscribe to queue "' + queue + '"' );
						} else {
							resolve( consumerTag );
						}
					} catch ( err ) {
						reject( err );
					}
				}.bind( this ) );
		}.bind( this ) );
	};

	Broker.prototype.subscribe = function( channel, queueName ) {
		if ( this.ackChannels.indexOf( channel ) === -1 ) {
			this.ackChannels.push( channel );
		}
		return channel.model.consume( queueName, function( raw ) {
			raw.body = JSON.parse( raw.content.toString( 'utf8' ) );

			var pendingJSON = {
				'tag': raw.fields.deliveryTag,
				'result': 'pending'
			};
			channel.pendingMessages.push( pendingJSON );

			raw.setResult = function( tag, result ) {
				var i = _.findIndex( channel.pendingMessages, {
					'tag': tag
				} );
				channel.pendingMessages[ i ].result = result;
			}
			raw.ack = function() {
				raw.setResult( raw.fields.deliveryTag, 'ack' );
			};
			raw.nack = function() {
				raw.setResult( raw.fields.deliveryTag, 'nack' );
			};

			dispatch.publish( raw.properties.type, raw );
		}.bind( this ) );
	};
};