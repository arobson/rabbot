var rabbit = require( "../../src/index.js" );

// variable to hold the timeout
var timeout;

// variable to hold starting time
var started;

// variable to hold received count
var received = 0;

// expected message count
var expected = 10000;

// always setup your message handlers first

// this handler will handle messages sent from the publisher
rabbit.handle( "publisher.message", function( msg ) {
	console.log( "Received:", JSON.stringify( msg.body ) );
	msg.ack();
	if( ( ++received ) === expected ) {
		console.log( "Received", received, "messages after", ( Date.now() - started ), "milliseconds" );
	}
} );

// it can make a lot of sense to share topology definition across
// services that will be using the same topology to avoid
// scenarios where you have race conditions around when
// exchanges, queues or bindings are in place
require( "./topology.js" )( rabbit, "messages" );

// now that our handlers are set up and topology is defined,
// we can publish a request to let the publisher know we're up 
// and ready for messages.

// because we will re-publish after a timeout, the messages will
// expire if not picked up from the queue in time.
// this prevents a bunch of requests from stacking up in the request
// queue and causing the publisher to send multiple bundles
var requestCount = 0;
notifyPublisher();

function notifyPublisher() {
	console.log( "Sending request", ++requestCount );
	rabbit.request( "wascally-pubsub-requests-x", {
		type: "subscriber.request",
		expiresAfter: 2000,
		routingKey: "",
		body: { ready: true, expected: expected }
	} ).then( function( response ) {
		started = Date.now();
		// if we get a response, cancel any existing timeout
		if( timeout ) {
			clearTimeout( timeout );
		}
		response.ack();
		console.log( "Publisher replied." );
	} );
	timeout = setTimeout( notifyPublisher, 3000 );
}