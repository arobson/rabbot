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

describe( 'with a mixture of acks and nacks', function() {
	var config = {
		connection: {
			name: 'default',
			user: 'guest',
			pass: 'guest',
			server: '127.0.0.1',
			port: 5672,
			vhost: '%2f',
		},

		exchanges: [ {
			name: 'ex.acknack',
			type: 'fanout',
			autoDelete: true
		} ],

		queues: [ {
			name: 'q.1',
			autoDelete: true
		} ],

		bindings: [ {
			exchange: 'ex.acknack',
			target: 'q.1',
			keys: ''
		} ]
	};

	before( function( done ) {
		rabbit.configure( config )
			.done( function() {
				done();
			} );
	} );

	it( 'should enqueue acks/nacks for rabbit', function( done ) {

		var ch = rabbit.connections[ 'default' ].channels[ 'queue-q.1' ];
		ch.should.be.ok;

		//Our batchAck is called last in our test, when we have
		//7 acks to do, no nacks, nothing pending
		rabbit.on( 'batchAckAll', function() {
			done();
		} ).disposeAfter( 1 );

		var messages = [],
			testHandler = rabbit.handle( 'acknack', function( message ) {
				messages.push( message );
			} );

		var promises = [];
		var publishCall = function() {
			return rabbit.publish( 'ex.acknack', 'acknack', {
				message: 'hello, world!'
			} );
		}

		for ( var i = 0; i < 10; i++ ) {
			promises.push( publishCall() );
		}

		var logPending = function() {
			// console.log( 'pendingMessages: \n', ch.pendingMessages );
			// console.log( 'lastAck: ', ch.lastAck );
			// console.log( 'lastNack: ', ch.lastNack );
		};

		var checkPendingAcksNacks = function( pendingNo, ackNo, nackNo ) {
			var foundPending = 0,
				foundAck = 0,
				foundNack = 0;
			for ( var i = 0; i < _.size( ch.pendingMessages ); i++ ) {
				switch ( ch.pendingMessages[ i ].result ) {
					case 'pending':
						foundPending++;
						break;
					case 'ack':
						foundAck++;
						break;
					case 'nack':
						foundNack++;
						break;
				}
			}
			foundPending.should.equal( pendingNo );
			foundAck.should.equal( ackNo );
			foundNack.should.equal( nackNo );
		}

		// This used to be a pyramid of doom, what follows is an attempt to 
		// break that apart and call out clear steps.
		// Austin designed a very thorough way of simulating the asynchronous
		// manner in which messages are ack'd or nack'd but must be handled 
		// in order. FTW.
		var step1 = function() {
				logPending();
				messages.length.should.equal( 10 );
				checkPendingAcksNacks( 10, 0, 0 );
				messages[ 0 ].ack();
				messages[ 1 ].ack();
				messages[ 5 ].nack();
				messages[ 7 ].nack();
				messages[ 8 ].ack();
				messages[ 9 ].ack();					
				step2();
			},
			step2 = function() {
				setTimeout( step3, 1 );
			},
			step3 = function() {
				checkPendingAcksNacks( 4, 4, 2 );
				logPending();
				rabbit.batchAck();
				setTimeout( step4, 100 );
			},
			step4 = function() {
				messages[ 2 ].nack();
				messages[ 3 ].nack();
				messages[ 4 ].nack();
				messages[ 6 ].ack();
				step5();
			},
			step5 = function() {
				checkPendingAcksNacks( 0, 3, 5 );
				logPending();
				rabbit.batchAck();
				setTimeout( step6, 100 );
			},
			step6 = function() {
				checkPendingAcksNacks( 4, 3, 1 );
				messages[ 10 ].ack();
				messages[ 11 ].ack();
				messages[ 12 ].ack();
				messages[ 13 ].ack();
				step7();
			},
			step7 = function() {
				checkPendingAcksNacks( 0, 7, 1 );
				logPending();
				rabbit.batchAck();
				setTimeout( step8, 100 );
			},
			step8 = function() {
				checkPendingAcksNacks( 0, 6, 1 );
				logPending();
				rabbit.batchAck();
				setTimeout( step9, 100 );
			},
			step9 = function() {
				checkPendingAcksNacks( 1, 6, 0 );
				messages[ 14 ].ack();
				step10();
			},
			step10 = function() {
				checkPendingAcksNacks( 0, 7, 0 );
				logPending();
				rabbit.batchAck();
				setTimeout( function() {
					checkPendingAcksNacks( 0, 0, 0 );
					logPending();
				}, 100 );
			};

		rabbit.startSubscription( 'q.1', 'default' )
			.done( function() {
				when.all( promises )
					.done( step1 );
			} );
	} );

	after( function( done ) {
		close( done, true, 'default' );
	} );
} );