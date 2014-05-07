require( 'should' );

var rabbit = require( '../src/index.js' )(),
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
			rabbit.connections[ 'default' ].exchanges[ 'ex.1' ].should.be.ok;
			done();
		} );
	} );

	it( 'should create queue correctly', function( done ) {
		rabbit.addQueue( 'q.1', {
			autoDelete: true
		} )
		.then( function( q ) {
			rabbit.connections[ 'default' ].queues[ 'q.1' ].should.be.ok;
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
		var sequence = rabbit._sequenceNo + 1,
			testHandler = rabbit.handle( 'this.is.a.test', function( message ) {
				message.body.message.should.eql( 'topic exchange message' );
				message.properties.deliveryMode.should.equal( 2 );
				testHandler.remove();
			} );
		rabbit.on( 'messageConfirmed', function( seqNo ) {
			if ( seqNo == sequence ) {
				done();
			}
		} );
		rabbit.publish( 'topic.ex.1', 'this.is.a.test', {
			message: 'topic exchange message'
		} );
	} );

	after( function( done ) {
		close( done, true, 'default' );
	} );
} );

describe( 'when adding or binding a valid exchange or queue', function() {
	before( function( done ) {
		rabbit.getConnection( 'fred' )
			.then( function() {
				done();
			} );
	} );

	it( 'should save the addExchange declaration', function() {
		rabbit.addExchange( 'ex.101', 'fanout', {
			autoDelete: true
		}, 'fred' );
		var func = rabbit.connections[ 'fred' ].reconnectTasks[ 0 ];
		rabbit.connections[ 'fred' ].reconnectTasks.length.should.equal( 1 );
		func.should.be.type( 'function' );
	} );

	it( 'should save the addQueue declaration', function() {
		rabbit.addQueue( 'q.101', {
			autoDelete: true,
			subscribe: true
		}, 'fred' );
		var func = rabbit.connections[ 'fred' ].reconnectTasks[ 1 ];
		rabbit.connections[ 'fred' ].reconnectTasks.length.should.equal( 2 );
		func.should.be.type( 'function' );
	} );

	it( 'should save the bindQueue declaration', function() {
		rabbit.bindQueue( 'ex.101', 'q.101', '', 'fred' );
		var func = rabbit.connections[ 'fred' ].reconnectTasks[ 2 ];
		rabbit.connections[ 'fred' ].reconnectTasks.length.should.equal( 3 );
		func.should.be.type( 'function' );
	} );

	it( 'should save the bindExchange declaration', function() {
		rabbit.addExchange( 'ex.102', 'fanout', {
			autoDelete: true
		}, 'fred' );
		rabbit.bindExchange( 'ex.101', 'ex.102', '', 'fred' );
		var func = rabbit.connections[ 'fred' ].reconnectTasks[ 4 ];
		rabbit.connections[ 'fred' ].reconnectTasks.length.should.equal( 5 );
		func.should.be.type( 'function' );
	} );

	after( function( done ) {
		rabbit.close( 'fred' ).done( function() {
			done();
		} );
	} );
} );