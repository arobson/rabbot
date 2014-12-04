var rabbit = require( '../../src/index.js' );

// always setup your message handlers first

// this handler will respond to the subscriber request and trigger
// sending a bunch of messages
rabbit.handle( 'subscriber.request', function( msg ) {
	console.log( 'Got subscriber request' );
	// replying to the message also ack's it to the queue
	msg.reply( { getReady: 'forawesome' }, 'publisher.response' );
	publish( msg.body.expected );
} );

// it can make a lot of sense to share topology definition across
// services that will be using the same topology to avoid
// scenarios where you have race conditions around when
// exchanges, queues or bindings are in place
require( './topology.js' )( rabbit, 'requests' );

function publish( total ) {
	for( var i = 0; i < total; i ++ ) {
		rabbit.publish( 'wascally-pubsub-messages-x', {
			type: 'publisher.message',
			body: { message: 'Message ' + i }
		} );
	}
}