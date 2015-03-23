var rabbit = require( '../../src/index' );
var settings = {
	connection: {
		user: 'guest',
		pass: 'guest',
		server: '127.0.0.1',
		port: 5672,
		vhost: '/',
		replyQueue: false
	},
	exchanges: [
		{ name: 'snd.1', type: 'topic', persistent: true }
	],
	queues: [
		{ name: 'fb', limit: 500, queueLimit: 1000, subscribe: true, durable: true }
	],
	bindings: [
		{ exchange: 'snd.1', target: 'fb', keys: [ 'post', 'request' ] }
	]
};
var handler = rabbit.handle( 'snd.1.fb.post', function( message ) {
	try {
		console.log( message.body );
		message.reply( message.body );
	} catch ( err ) {
		message.nack();
	}
} );
rabbit.configure( settings ).done( function() {} );
