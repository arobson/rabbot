var _ = require( 'lodash' );
var AckBatch = require( '../ackBatch.js' );
var postal = require( 'postal' );
var dispatch = postal.channel( 'rabbit.dispatch' );
var responses = postal.channel( 'rabbit.responses' );
var when = require( 'when' );
var log = require( '../log.js' )( 'wascally:amqp-queue' );
var topLog = require( '../log.js' )( 'wascally:topology' );
var unhandledLog = require( '../log.js' )( 'wascally:unhandled' );
var noOp = function() {};

function aliasOptions( options, aliases ) {
	var aliased = _.transform( options, function( result, value, key ) {
		var alias = aliases[ key ];
		result[ alias || key ] = value;
	} );
	return _.omit( aliased, Array.prototype.slice.call( arguments, 2 ) );
}

function define( channel, options, subscriber, connectionName ) {
	var valid = aliasOptions( options, {
		queuelimit: 'maxLength',
		queueLimit: 'maxLength',
		deadletter: 'deadLetterExchange',
		deadLetter: 'deadLetterExchange',
		deadLetterRoutingKey: 'deadLetterRoutingKey'
	}, 'subscribe', 'limit', 'noBatch' );
	topLog.info( 'Declaring queue \'%s\' on connection \'%s\' with the options: %s',
		options.name, connectionName, JSON.stringify( _.omit( options, [ 'name' ] ) ) );
	return channel.assertQueue( options.name, valid )
		.then( function( q ) {
			if ( options.limit ) {
				channel.prefetch( options.limit );
			}
			if ( options.subscribe ) {
				subscriber();
			}
			return q;
		} );
}

function destroy( channel, options, messages, released ) {
	function finalize() {
		messages.ignoreSignal();
		channel.destroy();
		channel = undefined;
	}

	function onUnsubscribed() {
		return when.promise( function( resolve ) {
			if ( messages.messages.length && !released ) {
				messages.once( 'empty', function() {
					finalize();
					resolve();
				} );
			} else {
				finalize();
				resolve();
			}
		} );
	}

	return unsubscribe( channel, options )
		.then( onUnsubscribed, onUnsubscribed );
}

function getChannel( connection ) {
	return connection.createChannel( true );
}

function getCount( messages ) {
	if ( messages ) {
		return messages.messages.length;
	} else {
		return 0;
	}
}

function getReply( channel, raw, replyQueue, connectionName ) {
	var position = 0;
	return function( reply, more, replyType ) {
		if ( _.isString( more ) ) {
			replyType = more;
			more = false;
		}
		var replyTo = raw.properties.replyTo;
		raw.ack();
		if ( replyTo ) {
			var payload = new Buffer( JSON.stringify( reply ) ),
				publishOptions = {
					type: replyType || raw.type + '.reply',
					contentType: 'application/json',
					contentEncoding: 'utf8',
					correlationId: raw.properties.messageId,
					replyTo: replyQueue === false ? undefined : replyQueue,
					headers: {}
				};
			if ( !more ) {
				publishOptions.headers.sequence_end = true; // jshint ignore:line
			} else {
				publishOptions.headers.position = ( position++ );
			}
			log.debug( 'Replying to message %s on %s - %s with type %s',
				raw.properties.messageId,
				replyTo,
				connectionName,
				publishOptions.type );
			if ( raw.properties.headers[ 'direct-reply-to' ] ) {
				return channel.publish(
					'',
					replyTo,
					payload,
					publishOptions
				);
			} else {
				return channel.sendToQueue( replyTo, payload, publishOptions );
			}
		}
	};
}

function getTrackedOps( raw, messages ) {
	return messages.getMessageOps( raw.fields.deliveryTag );
}

function getUntrackedOps( channel, raw, messages ) {
	messages.receivedCount += 1;
	return {
		ack: noOp,
		nack: function() {
			log.debug( 'Nacking tag %d on %s - %s', raw.fields.deliveryTag, messages.name, messages.connectionName );
			channel.nack( { fields: { deliveryTag: raw.fields.deliveryTag } }, false );
		},
		reject: function() {
			log.debug( 'Rejecting tag %d on %s - %s', raw.fields.deliveryTag, messages.name, messages.connectionName );
			channel.nack( { fields: { deliveryTag: raw.fields.deliveryTag } }, false, false );
		}
	};
}

function getNoBatchOps( channel, raw, messages, noAck ) {
	messages.receivedCount += 1;

	var ack;
	if ( noAck ) {
		ack = noOp;
	} else {
		ack = function() {
			log.debug( 'Acking tag %d on %s - %s', raw.fields.deliveryTag, messages.name, messages.connectionName );
			channel.ack( { fields: { deliveryTag: raw.fields.deliveryTag } }, false );
		};
	}

	return {
		ack: ack,
		nack: function() {
			log.debug( 'Nacking tag %d on %s - %s', raw.fields.deliveryTag, messages.name, messages.connectionName );
			channel.nack( { fields: { deliveryTag: raw.fields.deliveryTag } }, false );
		},
		reject: function() {
			log.debug( 'Rejecting tag %d on %s - %s', raw.fields.deliveryTag, messages.name, messages.connectionName );
			channel.nack( { fields: { deliveryTag: raw.fields.deliveryTag } }, false, false );
		}
	};
}

function resolveTags( channel, queue, connection ) {
	return function( op, data ) {
		switch (op) {
			case 'ack':
				log.debug( 'Acking tag %d on %s - %s', data.tag, queue, connection );
				return channel.ack( { fields: { deliveryTag: data.tag } }, data.inclusive );
			case 'nack':
				log.debug( 'Nacking tag %d on %s - %s', data.tag, queue, connection );
				return channel.nack( { fields: { deliveryTag: data.tag } }, data.inclusive );
			case 'reject':
				log.debug( 'Rejecting tag %d on %s - %s', data.tag, queue, connection );
				return channel.nack( { fields: { deliveryTag: data.tag } }, data.inclusive, false );
			default:
				return when( true );
		}
	};
}

function subscribe( channelName, channel, topology, messages, options ) {
	var shouldAck = !options.noAck;
	var shouldBatch = !options.noBatch;

	if ( shouldAck && shouldBatch ) {
		messages.listenForSignal();
	}

	log.info( 'Starting subscription %s - %s', channelName, topology.connection.name );
	return channel.consume( channelName, function( raw ) {
		var correlationId = raw.properties.correlationId;
		raw.body = JSON.parse( raw.content.toString( 'utf8' ) );

		var ops = getResolutionOperations( channel, raw, messages, options );

		raw.ack = ops.ack;
		raw.nack = ops.nack;
		raw.reject = ops.reject;
		raw.reply = getReply( channel, raw, topology.replyQueue.name, topology.connection.name );
		raw.type = raw.properties.type;

		var onPublish = function( data ) {
			var handled;

			if ( data.activated ) {
				handled = true;
				if ( shouldAck && shouldBatch ) {
					messages.addMessage( ops.message );
				}
			}

			if ( !handled ) {
				unhandledLog.warn( 'Message of %s on queue %s - %s was not processed by any registered handlers',
					raw.type,
					channelName,
					topology.connection.name
				);
				topology.onUnhandled( raw );
			}
		};

		if ( raw.fields.routingKey === topology.replyQueue.name ) {
			responses.publish( correlationId, raw, onPublish );
		} else {
			dispatch.publish( raw.type, raw, onPublish );
		}
	}, options )
		.then( function( result ) {
			channel.tag = result.consumerTag;
			return result;
		} );
}


function getResolutionOperations( channel, raw, messages, options ) {
	if ( options.noBatch ) {
		return getNoBatchOps( channel, raw, messages, options.noAck );
	}

	if ( options.noAck || options.noBatch ) {
		return getUntrackedOps( channel, raw, messages );
	}

	return getTrackedOps( raw, messages );
}

function unsubscribe( channel, options ) {
	if ( channel.tag ) {
		log.info( 'Unsubscribing from queue %s with tag %s', options.name, channel.tag );
		return channel.cancel( channel.tag );
	} else {
		return when.resolve();
	}
}

module.exports = function( options, topology ) {
	var channel = getChannel( topology.connection );
	var messages = new AckBatch( options.name, topology.connection.name, resolveTags( channel, options.name, topology.connection.name ) );
	var subscriber = subscribe.bind( undefined, options.name, channel, topology, messages, options );

	return {
		channel: channel,
		messages: messages,
		define: define.bind( undefined, channel, options, subscriber, topology.connection.name ),
		destroy: destroy.bind( undefined, channel, options, messages ),
		getMessageCount: getCount.bind( undefined, messages ),
		subscribe: subscriber,
		unsubscribe: unsubscribe.bind( undefined, channel, options, messages )
	};
};
