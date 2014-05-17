require( 'should' );

var rabbit = require( '../src/index.js' ),
	_ = require( 'lodash' ),
	exec = require( 'child_process' ).exec,
	fs = require( 'fs' ),
	when = require( 'when' );

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

describe( 'with a consumer limits', function() {
	before( function( done ) {
		var promises = [
			rabbit.addExchange( 'ex.5', 'fanout', {
				autoDelete: true
			} ),
			rabbit.addQueue( 'q.5', {
				autoDelete: true,
				subscribe: true,
				limit: 1
			} )
		];
		when.all( promises )
			.done( function() {
				rabbit.bindQueue( 'ex.5', 'q.5', '' )
					.done( function() {
						done();
					} );
			} );
	} );

	it( 'should publish and handle messages correctly according to type', function( done ) {
		this.timeout( 1000 );
		var messages = [],
			testHandler = rabbit.handle( 'test.5', function( message ) {
				messages.push( message );
				message.body.message.should.eql( 'hello, world!' );
			} );

		for ( i = 0; i <= 5; i++ ) {
			rabbit.publish( 'ex.5', 'test.5', {
				message: 'hello, world!'
			} );
		}

		// the cascading timeouts should gate the rate of messages
		// that get received due to the limit of 1 message at a time
		setTimeout( function() {
			messages.length.should.equal( 1 );
			messages[ 0 ].ack();
			rabbit.batchAck();
		}, 100 );

		setTimeout( function() {
			messages.length.should.equal( 2 );
			messages[ 1 ].ack();
			rabbit.batchAck();
		}, 120 );

		setTimeout( function() {
			messages.length.should.equal( 3 );
			messages[ 2 ].ack();
			rabbit.batchAck();
		}, 140 );

		setTimeout( function() {
			messages.length.should.equal( 4 );
			messages[ 3 ].ack();
			rabbit.batchAck();
		}, 160 );

		setTimeout( function() {
			messages.length.should.equal( 5 );
			messages[ 4 ].ack();
			rabbit.batchAck();
			done();
		}, 180 );
	} );

	after( function( done ) {
		close( done, true, 'default' );
	} );
} );

describe( 'with a queue limit', function() {
	before( function( done ) {
		var promises = [
			rabbit.addExchange( 'ex.6', 'fanout', {
				autoDelete: true
			} ),
			rabbit.addQueue( 'q.6', {
				autoDelete: true,
				limit: 1,
				maxLength: 5
			} )
		];
		when.all( promises )
			.done( function() {
				rabbit.bindQueue( 'ex.6', 'q.6', '' )
					.done( function() {
						done();
					} );
			} );
	} );

	it( 'should publish and handle messages correctly according to type', function( done ) {
		this.timeout( 100000 );
		var messagesOver5 = false;

		var messages = [],
			testHandler = rabbit.handle( 'test.6', function( message ) {
				messages.push( message );
				message.body.message.should.eql( 'hello, world!' );
				var ch = rabbit.connections[ 'default' ].channels[ 'queue-q.6' ];
				ch.should.be.ok;
				message.ack();
				rabbit.batchAck();
			} );

		var confirmedCount = 0;
		rabbit.on( 'messageConfirmed', function() {
			confirmedCount++;
			if ( confirmedCount == 5 ) {
				rabbit.startSubscription( 'q.6' );
			}
		} );

		for ( i = 0; i <= 10; i++ ) {
			rabbit.publish( 'ex.6', 'test.6', {
				message: 'hello, world!'
			} );
		}

		setTimeout( function() {
			messages.length.should.equal( 5 );
			done();
		}, 200 );
	} );

	after( function( done ) {
		close( done, true, 'default' );
	} );
} );