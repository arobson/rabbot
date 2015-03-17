var rabbit = require( '../../src/index' );
var settings = {
	connection: {
		user: 'guest',
		pass: 'guest',
		server: '127.0.0.1',
		port: 5672,
		vhost: '/',
		//replyQueue: 'derp'
	},
	exchanges: [
		{ name: 'snd.1', type: 'topic', persistent: true }
	]
};
rabbit.configure( settings ).done( function() {} );
var x = 0;
setInterval( function() {
	rabbit.request( 'snd.1', {
		routingKey: 'post',
		type: 'snd.1.fb.post',
		body: { count: x }
	} ).then( function( final ) {
		console.log( final.body );
		final.ack();
	} );
	console.log( x );
	x++;
}, 1000 );
