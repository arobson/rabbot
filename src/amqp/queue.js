var _ = require( "lodash" );
var AckBatch = require( "../ackBatch.js" );
var postal = require( "postal" );
var dispatch = postal.channel( "rabbit.dispatch" );
var responses = postal.channel( "rabbit.responses" );
var when = require( "when" );
var info = require( "../info" );
var log = require( "../log" )( "rabbot.queue" );
var format = require( "util" ).format;
var topLog = require( "../log" )( "rabbot.topology" );
var unhandledLog = require( "../log" )( "rabbot.unhandled" );
var noOp = function() {};

/* log
	* `rabbot.amqp-queue`
	  * `debug`
	    * for all message operations - ack, nack, reply & reject
	  * `info`
	    * subscribing
	    * unsubscribing
	  * `warn`
	    * no message handlers for message received
	  * `error`
	    * no serializer defined for outgoing message
	    * no serializer defined for incoming message
	    * message nacked/rejected when consumer is set to no-ack
	* `rabbot.topology`
	  * `info`
	    * queue declaration
*/

function aliasOptions( options, aliases ) {
	var aliased = _.transform( options, function( result, value, key ) {
		var alias = aliases[ key ];
		result[ alias || key ] = value;
	} );
	return _.omit( aliased, Array.prototype.slice.call( arguments, 2 ) );
}

function define( channel, options, subscriber, connectionName ) {
	var valid = aliasOptions( options, {
		queuelimit: "maxLength",
		queueLimit: "maxLength",
		deadletter: "deadLetterExchange",
		deadLetter: "deadLetterExchange",
		deadLetterRoutingKey: "deadLetterRoutingKey"
	}, "subscribe", "limit", "noBatch", "unique" );
	topLog.info( "Declaring queue '%s' on connection '%s' with the options: %s",
		options.uniqueName, connectionName, JSON.stringify( _.omit( options, [ "name" ] ) ) );
	return channel.assertQueue( options.uniqueName, valid )
		.then( function( q ) {
			if ( options.limit ) {
				channel.prefetch( options.limit );
			}
			return q;
		} );
}

function finalize( channel, messages ) {
	messages.reset();
	messages.ignoreSignal();
	channel.release();
	channel = undefined;
}

function getContentType( body, options ) {
	if( options && options.contentType ) {
		return options.contentType;
	}
	else if( _.isString( body ) ) {
		return "text/plain";
	} else if( _.isObject( body ) && !body.length ) {
		return "application/json";
	} else {
		return "application/octet-stream";
	}
}

function getCount( messages ) {
	if ( messages ) {
		return messages.messages.length;
	} else {
		return 0;
	}
}

function getNoBatchOps( channel, raw, messages, noAck ) {
	messages.receivedCount += 1;

	var ack, nack, reject;
	if ( noAck ) {
		ack = noOp;
		nack = function() {
			log.error( "Tag %d on '%s' - '%s' cannot be nacked in noAck mode - message will be lost!", raw.fields.deliveryTag, messages.name, messages.connectionName );
		};
		reject = function() {
			log.error( "Tag %d on '%s' - '%s' cannot be rejected in noAck mode - message will be lost!", raw.fields.deliveryTag, messages.name, messages.connectionName );
		};
	} else {
		ack = function() {
			log.debug( "Acking tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName );
			channel.ack( { fields: { deliveryTag: raw.fields.deliveryTag } }, false );
		};
		nack = function() {
			log.debug( "Nacking tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName );
			channel.nack( { fields: { deliveryTag: raw.fields.deliveryTag } }, true );
		};
		reject = function() {
			log.debug( "Rejecting tag %d on '%s' - '%s'", raw.fields.deliveryTag, messages.name, messages.connectionName );
			channel.reject( { fields: { deliveryTag: raw.fields.deliveryTag } }, false );
		};
	}

	return {
		ack: ack,
		nack: nack,
		reject: reject
	};
}

function getReply( channel, serializers, raw, replyQueue, connectionName ) {
	var position = 0;
	return function( reply, options ) {
		var defaultReplyType = raw.type + ".reply";
		var replyType = options ? ( options.replyType || defaultReplyType ) : defaultReplyType;
		var contentType = getContentType( reply, options );
		var serializer = serializers[ contentType ];
		if( !serializer ) {
			var message = format( "Failed to publish message with contentType %s - no serializer defined", contentType );
			log.error( message );
			return when.reject( new Error( message ) );
		}
		var payload = serializer.serialize( reply );

		var replyTo = raw.properties.replyTo;
		raw.ack();
		if ( replyTo ) {
			var publishOptions = {
					type: replyType,
					contentType: contentType,
					contentEncoding: "utf8",
					correlationId: raw.properties.messageId,
					timestamp: options && options.timestamp ? options.timestamp : Date.now(),
					replyTo: replyQueue === false ? undefined : replyQueue,
					headers: options && options.headers ? options.headers : {}
				};
			if ( options && options.more ) {
				publishOptions.headers.position = ( position++ );
			} else {
				publishOptions.headers.sequence_end = true; // jshint ignore:line
			}
			log.debug( "Replying to message %s on '%s' - '%s' with type '%s'",
				raw.properties.messageId,
				replyTo,
				connectionName,
				publishOptions.type );
			if ( raw.properties.headers && raw.properties.headers[ "direct-reply-to" ] ) {
				return channel.publish(
					'',
					replyTo,
					payload,
					publishOptions
				);
			} else {
				return channel.sendToQueue( replyTo, payload, publishOptions );
			}
		} else {
			return when.reject( new Error( "Cannot reply to a message that has no return address" ) );
		}
	};
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

function getTrackedOps( raw, messages ) {
	return messages.getMessageOps( raw.fields.deliveryTag );
}

function getUntrackedOps( channel, raw, messages ) {
	messages.receivedCount += 1;
	return {
		ack: noOp,
		nack: function() {
			log.error( "Tag %d on '%s' - '%s' cannot be nacked in noAck mode - message will be lost!", raw.fields.deliveryTag, messages.name, messages.connectionName );
		},
		reject: function() {
			log.error( "Tag %d on '%s' - '%s' cannot be rejected in noAck mode - message will be lost!", raw.fields.deliveryTag, messages.name, messages.connectionName );
		}
	};
}

function release( channel, options, messages, released ) {
	function onUnsubscribed() {
		return when.promise( function( resolve ) {
			if ( messages.messages.length && !released ) {
				messages.once( "empty", function() {
					finalize( channel, messages );
					resolve();
				} );
			} else {
        finalize( channel, messages );
				resolve();
			}
		}.bind( this ) );
	}
	return unsubscribe( channel, options )
		.then( onUnsubscribed, onUnsubscribed );
}

function resolveTags( channel, queue, connection ) {
	return function( op, data ) {
		switch (op) {
			case "ack":
				log.debug( "Acking tag %d on '%s' - '%s'", data.tag, queue, connection );
				return channel.ack( { fields: { deliveryTag: data.tag } }, data.inclusive );
			case "nack":
				log.debug( "Nacking tag %d on '%s' - '%s'", data.tag, queue, connection );
				return channel.nack( { fields: { deliveryTag: data.tag } }, data.inclusive );
			case "reject":
				log.debug( "Rejecting tag %d on '%s' - '%s'", data.tag, queue, connection );
				return channel.nack( { fields: { deliveryTag: data.tag } }, data.inclusive, false );
			default:
				return when( true );
		}
	};
}

function subscribe( channelName, channel, topology, serializers, messages, options, exclusive ) {
	var shouldAck = !options.noAck;
	var shouldBatch = !options.noBatch;
	var shouldCacheKeys = !options.noCacheKeys;
  // this is done to support rabbit-assigned queue names
  channelName = channelName || options.name;
	if ( shouldAck && shouldBatch ) {
		messages.listenForSignal();
	}

	options.consumerTag = info.createTag( channelName );
	if( _.keys( channel.item.consumers ).length > 0 ) {
		log.info( "Duplicate subscription to queue %s ignored", channelName );
		return when( options.consumerTag );
	}
	log.info( "Starting subscription to queue '%s' on '%s'", channelName, topology.connection.name );
  return channel.consume( channelName, function( raw ) {
		if( !raw ) {
			// this happens when the consumer has been cancelled
			log.warn( "Queue '%s' was sent a consumer cancel notification" );
			throw new Error( "Broker cancelled the consumer remotely" );
		}
		var correlationId = raw.properties.correlationId;
		var ops = getResolutionOperations( channel, raw, messages, options );

		raw.ack = ops.ack;
		raw.nack = ops.nack;
		raw.reject = ops.reject;
		raw.reply = getReply( channel, serializers, raw, topology.replyQueue.name, topology.connection.name );
		raw.type = _.isEmpty( raw.properties.type ) ? raw.fields.routingKey : raw.properties.type;
		if( exclusive ) {
			options.exclusive = true;
		}
		raw.queue = channelName;
		var parts = [ channelName.replace( /[.]/g, "-" ) ];
		if( raw.type ) {
			parts.push( raw.type );
		}
		var topic = parts.join( "." );
		var contentType = raw.properties.contentType || "application/octet-stream";
		var serializer = serializers[ contentType ];
		if( !serializer ) {
			log.error( "Could not deserialize message id %s on queue '%s', connection '%s' - no serializer defined",
				raw.properties.messageId, channelName, topology.connection.name );
			ops.nack();
		} else {
			try {
				raw.body = serializer.deserialize( raw.content, raw.properties.contentEncoding );
			} catch( err ) {
				ops.nack();
			}
		}

		var onPublish = function( data ) {
			var handled;

			if ( data.activated ) {
				handled = true;
			}
			if ( shouldAck && shouldBatch ) {
				messages.addMessage( ops.message );
			}

			if ( !handled ) {
				unhandledLog.warn( "Message of %s on queue '%s', connection '%s' was not processed by any registered handlers",
					raw.type,
					channelName,
					topology.connection.name
				);
				topology.onUnhandled( raw );
			}
		};

		if ( raw.fields.routingKey === topology.replyQueue.name ) {
			responses.publish(
				{
					topic: correlationId,
					headers: {
						resolverNoCache: true
					},
					data: raw
				},
				onPublish
			);
		} else {
			dispatch.publish( {
				topic: topic,
				headers: {
					resolverNoCache: !shouldCacheKeys
				},
				data: raw
			}, onPublish );
		}
	}, options )
		.then( function( result ) {
			channel.tag = result.consumerTag;
			return result;
		}, function( err ) {
      log.error( "Error on channel consume", options );
      throw err;
    } );
}

function unsubscribe( channel, options ) {
	if ( channel.tag ) {
		log.info( "Unsubscribing from queue '%s' with tag %s", options.name, channel.tag );
		return channel.cancel( channel.tag );
	} else {
		return when.resolve();
	}
}

module.exports = function( options, topology, serializers ) {
  var channelName = [ "queue", options.uniqueName ].join( ":" );
	return topology.connection.getChannel( channelName, false, "queue channel for " + options.name )
		.then( function( channel ) {
			var messages = new AckBatch( options.name, topology.connection.name, resolveTags( channel, options.name, topology.connection.name ) );
			var subscriber = subscribe.bind( undefined, options.uniqueName, channel, topology, serializers, messages, options );

			return {
				channel: channel,
				messages: messages,
				define: define.bind( undefined, channel, options, subscriber, topology.connection.name ),
				finalize: finalize.bind( undefined, channel, messages ),
				getMessageCount: getCount.bind( undefined, messages ),
				release: release.bind( undefined, channel, options, messages ),
				subscribe: subscriber,
				unsubscribe: unsubscribe.bind( undefined, channel, options, messages )
			};
		} );
};
