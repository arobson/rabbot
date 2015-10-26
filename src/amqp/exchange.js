var _ = require( 'lodash' );
var when = require( 'when' );
var exLog = require( '../log.js' )( 'wascally.exchange' );
var topLog = require( '../log.js' )( 'wascally.topology' );

function aliasOptions( options, aliases ) {
	var aliased = _.transform( options, function( result, value, key ) {
		var alias = aliases[ key ];
		result[ alias || key ] = value;
	} );
	return _.omit( aliased, Array.prototype.slice.call( arguments, 2 ) );
}

function define( channel, options, connectionName ) {
	var valid = aliasOptions( options, {
		alternate: 'alternateExchange'
	}, 'persistent', 'publishTimeout' );
	topLog.info( 'Declaring %s exchange \'%s\' on connection \'%s\' with the options: %s',
		options.type,
		options.name,
		connectionName,
		JSON.stringify( _.omit( valid, [ 'name', 'type' ] ) )
	);
	return channel.assertExchange( options.name, options.type, valid );
}

function getChannel( connection ) {
	return connection.createChannel( true );
}

function publish( channel, options, topology, log, message ) {
	var channelName = options.name;
	var type = options.type;
	var baseHeaders = {
		'CorrelationId': message.correlationId
	};
	message.headers = _.merge( baseHeaders, message.headers );
	var payload = new Buffer( JSON.stringify( message.body ) );
	var publishOptions = {
		type: message.type || '',
		contentType: 'application/json',
		contentEncoding: 'utf8',
		correlationId: message.correlationId || '',
		replyTo: message.replyTo || topology.replyQueue.name || '',
		messageId: message.messageId || message.id || '',
		timestamp: message.timestamp,
		appId: message.appId || '',
		headers: message.headers || {},
		expiration: message.expiresAfter || undefined
	};
	if ( publishOptions.replyTo === 'amq.rabbitmq.reply-to' ) {
		publishOptions.headers[ 'direct-reply-to' ] = 'true';
	}
	if ( !message.sequenceNo ) {
		log.add( message );
	}
	if ( options.persistent ) {
		publishOptions.persistent = true;
	}

	var effectiveKey = message.routingKey === '' ? '' : message.routingKey || publishOptions.type;
	exLog.debug( 'Publishing message ( type: %s topic: %s, sequence: %s, correlation: %s, replyTo: %s ) to %s exchange %s - %s',
		publishOptions.type,
		effectiveKey,
		message.sequenceNo,
		publishOptions.correlationId,
		JSON.stringify( publishOptions ),
		type,
		channelName,
		topology.connection.name );

	function remove( x ) {
		log.remove( message );
		return x;
	}

	return when.promise( function( resolve, reject ) {
		channel.publish(
			channelName,
			effectiveKey,
			payload,
			publishOptions
		).then( resolve, reject );
	} ).then( remove, remove );
}

module.exports = function( options, topology, publishLog ) {
	var channel = getChannel( topology.connection );
	return {
		channel: channel,
		define: define.bind( undefined, channel, options, topology.connection.name ),
		destroy: function() {
			if ( channel ) {
				channel.destroy();
				channel = undefined;
			}
			return when( true );
		},
		publish: publish.bind( undefined, channel, options, topology, publishLog )
	};
};
