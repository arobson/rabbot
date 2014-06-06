require( 'should' );

var rabbit = require( '../src/index.js' ),
	_ = require( 'lodash' ),
	exec = require( 'child_process' ).exec,
	fs = require( 'fs' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' );

var open = function( done, connectionName ) {
	rabbit.getConnection( connectionName )
		.then( function() {
			done();
		} );
};

var close = function( done, reset, connectionName ) {
	if ( connectionName ) {
		rabbit.close( connectionName, reset )
			.then( function() {
				done();
			} );
	} else {
		rabbit.closeAll( reset )
			.then( function() {
				done();
			} );
	}
};

describe( 'when creating channel, exchange, or queue', function() {
	after( function( done ) {
		close( done );
	} );

	before( function( done ) {
		rabbit.addConnection()
			.then( function() { done(); });
	} );

	it( 'should acquire channel successfully', function( done ) {
		rabbit.getChannel( 'one' )
			.then( function( channel ) {
				channel.should.not.be.undefined;
				done();
			} );
	} );

	it( 'should create exchange correctly', function( done ) {
		rabbit.addExchange( 'ex.1', 'fanout', {
			autoDelete: true
		} )
		.then( function( ex ) {
			ex.name.should.equal( 'ex.1' );
			done();
		} );
	} );

	it( 'should create queue correctly', function( done ) {
		rabbit.addQueue( 'q.1', {
			autoDelete: true
		} )
		.then( function( q ) {
			q.name.should.equal( 'q.1' );
			done();
		} );
	} );

	it( 'should bind to queue correctly', function( done ) {
		rabbit.bindQueue( 'ex.1', 'q.1', '' )
			.done( function() {
				done();
			} )
	} );
} );

describe( 'with a valid exchange and queue', function() {
	before( function( done ) {
		var actions = [
			function() {
				return rabbit.closeAll( true );
			},
			function() {
				return rabbit.getChannel( 'one' );
			},
			function() {
				return rabbit.addExchange( 'ex.1', 'fanout', 
				{
					autoDelete: true
				} );
			},
			function() {
				return rabbit.addQueue( 'q.1', 
				{
					autoDelete: true,
					subscribe: true
				} );
			},
			function() {
				return rabbit.bindQueue( 'ex.1', 'q.1', '' );
			}
		];

		pipeline( actions )
			.done( function() { 
				done(); 
			} );
	} );

	it( 'should publish and handle messages correctly according to type', function( done ) {
		var testHandler = rabbit.handle( 'test.1', function( message ) {
			message.body.message.should.eql( 'hello, world!' );
			testHandler.remove();
			done();
		} );

		rabbit.publish( 'ex.1', 'test.1', {
			message: 'hello, world!'
		} );
	} );

	after( function( done ) {
		close( done, true, 'default' );
	} );
} );

describe( 'with a valid topic exchange and queue', function() {
	before( function( done ) {
		var actions = [
			function() {
				return rabbit.closeAll( true );
			},
			function() {
				return rabbit.addExchange( 'topic.ex.1', 'topic', 
				{
					autoDelete: true,
					persistent: true
				} );
			},
			function() {
				return rabbit.addQueue( 'topic.q.1', 
				{
					autoDelete: true,
					subscribe: true
				} );
			},
			function() {
				return rabbit.bindQueue( 'topic.ex.1', 'topic.q.1', 'this.is.*.*' );
			}
		];

		pipeline( actions )
			.done( function() { 
				done(); 
			} );
	} );

	it( 'should publish and handle messages correctly according to type', function( done ) {
		var testHandler = rabbit.handle( 'this.is.a.test', function( message ) {
				message.body.message.should.eql( 'topic exchange message' );
				message.properties.deliveryMode.should.equal( 2 );
				testHandler.remove();
			} );
		rabbit.publish( 'topic.ex.1', 'this.is.a.test', {
				message: 'topic exchange message'
			} )
			.then( function() { done(); } );
	} );

	after( function( done ) {
		close( done, true, 'default' );
	} );
} );

describe( 'when testing reconnection', function() {
	before( function( done ) {
		var config = {
			connection: {
				name: 'reconnectionTest',
				user: 'guest',
				pass: 'guest',
				server: '127.0.0.1',
				port: 5672,
				vhost: '%2f',
			},

			exchanges: [ {
				name: 'recon-ex.1',
				type: 'fanout',
				autoDelete: true
			} ],

			queues: [ {
				name: 'recon-q.1',
				autoDelete: true,
				subscribe: true
			} ],

			bindings: [ {
				exchange: 'recon-ex.1',
				target: 'recon-q.1',
				keys: []
			} ]
		};

		rabbit.configure( config )
			.done( function() { 
				rabbit.close( 'reconnectionTest' )
					.then( function() { 
						done(); 
					} );
			} );
	} );

	it( 'should restablish topology and receive messages', function( done ) {
		rabbit.handle( 'recon.test', function( message ) {
			done();
		} );
		rabbit.publish( 'recon-ex.1', { body: 'hello', type: 'recon.test' }, 'reconnectionTest' );
	} );

	after( function( done ) {
		rabbit.close( 'reconnectionTest' ).done( function() {
			done();
		} );
	} );
} );