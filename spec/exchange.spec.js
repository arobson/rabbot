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

describe( 'with a valid exchange (no queue)', function() {

	before( function( done ) {
		rabbit.closeAll( true )
			.done( function() {
				rabbit.getConnection( 'no-queue' )
					.then( function() {
						rabbit.addExchange( 'temp.ext', 'fanout', {
							autoDelete: true
						}, 'no-queue' )
						.done( function() {
							done();
						} );
					} );
			} );
	} );

	it( 'should confirm published message', function( done ) {

		rabbit.on( 'messageConfirmed', function( seqNo ) {
			rabbit.pendingMessages.should.exist;
			seqNo.should.equal( rabbit._sequenceNo );
			( rabbit.pendingMessages[ seqNo ] === undefined ).should.be.true;
			done();
		} ).disposeAfter( 1 );

		var result = rabbit.publish( 'temp.ext', 'test.3', {
			message: 'hello, world!'
		}, 'routingKey', 'correlationId', 'no-queue' );
		result.should.be.ok;
	} );

	after( function( done ) {
		close( done, true, 'no-queue' );
	} );
} );

describe( 'with a dead-letter exchange', function() {
	before( function( done ) {
		var promises = [
			rabbit.addExchange( 'dlx.7', 'fanout', {
				autoDelete: true
			} ),
			rabbit.addExchange( 'ex.7', 'fanout', {
				autoDelete: true
			} ),
			rabbit.addQueue( 'q.7', {
				autoDelete: true,
				messageTtl: 50,
				deadLetter: 'dlx.7'
			} ),
			rabbit.addQueue( 'dlq.7', {
				autoDelete: true,
				subscribe: true
			} )
		];
		when.all( promises )
			.done( function() {
				when.all( [
					rabbit.bindQueue( 'ex.7', 'q.7', '' ),
					rabbit.bindQueue( 'dlx.7', 'dlq.7', '' )
				] )
				.done( function() {
					for ( i = 0; i <= 2; i++ ) {
						rabbit.publish( 'ex.7', 'test.7', {
							message: 'hello, world!',
							number: i
						} );
					}
					done();
				} );
			} );
	} );

	it( 'should get a message on the dead-letter', function( done ) {
		this.timeout( 200 );
		rabbit.handle( 'test.7', function( message ) {
			if ( message.body.number == 2 ) {
				done();
			}
		} );
	} );
} );

describe( 'with an alternate exchange', function() {
	before( function( done ) {
		var promises = [
			rabbit.addExchange( 'dlx.8', 'fanout', {
				autoDelete: true
			} ),
			rabbit.addExchange( 'ex.8', 'topic', {
				autoDelete: true,
				alternate: 'dlx.8'
			} ),
			rabbit.addQueue( 'dlq.8', {
				autoDelete: true,
				subscribe: true
			} )
		];
		when.all( promises )
			.done( function() {
				when.all( [
					rabbit.bindQueue( 'dlx.8', 'dlq.8', '' )
				] )
				.done( function() {
					rabbit.publish( 'ex.8', 'test.8', {
						message: 'hello, world!',
						number: i
					}, 'test.key' );
					done();
				} );
			} );
	} );

	it( 'should get a message on alternate exchange\'s queue', function( done ) {
		this.timeout( 2000 );
		var testHandler = rabbit.handle( 'test.8', function( message ) {
			testHandler.remove();
			done();
		} );
	} );
} );

describe( 'with a hash exchange', function() {
	var config = {
		connection: {
			name: 'consistent-hash',
			user: 'guest',
			pass: 'guest',
			server: '127.0.0.1',
			port: 5672,
			vhost: '%2f',
		},

		exchanges: [ {
			name: 'ex.consistent-hash',
			type: 'x-consistent-hash',
			autoDelete: true,
			arguments: {
				'hash-header': 'CorrelationId'
			}
		} ],

		queues: [ {
			name: 'qc.1',
			autoDelete: true
		}, {
			name: 'qc.2',
			autoDelete: true
		}, {
			name: 'qc.3',
			autoDelete: true
		}, {
			name: 'qc.4',
			autoDelete: true
		} ],

		bindings: [ {
			exchange: 'ex.consistent-hash',
			target: 'qc.1',
			keys: '100'
		}, {
			exchange: 'ex.consistent-hash',
			target: 'qc.2',
			keys: '100'
		}, {
			exchange: 'ex.consistent-hash',
			target: 'qc.3',
			keys: '100'
		}, {
			exchange: 'ex.consistent-hash',
			target: 'qc.4',
			keys: '100'
		} ]
	};

	before( function( done ) {
		var ackChannelSize = _.size( rabbit.ackChannels );

		rabbit.ackChannels.splice( 0, ackChannelSize );
		rabbit.ackChannels.length.should.equal( 0 );

		rabbit.configure( config )
			.done( function() {
				var subscriptions = [];
				for ( var i = 1; i < 5; i++ ) {
					var subscription = rabbit.startSubscription( 'qc.' + i, 'consistent-hash' );
					subscriptions.push( subscription );
				}
				when.all( subscriptions )
					.done( function() {
						rabbit.ackChannels.length.should.equal( 4 );
						done();
					} );
			} );
	} );

	it( 'should balance message publishing among the queues', function( done ) {

		var promises = [],
			messageCount = 1000;

		var publishCall = function( i ) {
			return rabbit.publish( 'ex.consistent-hash', 'load.balanced.message', {
				message: 'Where in the hello world did I go?'
			}, undefined, ( i + 1 ).toString(), 'consistent-hash' );
		}

		for ( var i = 0; i < messageCount; i++ ) {
			promises.push( publishCall( i ) );
		}

		when.all( promises )
			.done( function() {
				//Even if it's not super uniform, this should be relatively uniform
				//Amazon Dynamo documents said using 100-200 nodes achieves 5-10% unbalance (acceptable)
				rabbit.ackChannels.length.should.equal( 4 ); //No previous test's ackChannels should leak into this or it won't work

				var ackChannels = rabbit.ackChannels,
					queueCounts = {
						q1: ackChannels[ 0 ].pendingMessages.length,
						q2: ackChannels[ 1 ].pendingMessages.length,
						q3: ackChannels[ 2 ].pendingMessages.length,
						q4: ackChannels[ 3 ].pendingMessages.length
					},
					pendingMessages = queueCounts.q1 + queueCounts.q2 + queueCounts.q3 + queueCounts.q4;

				pendingMessages.should.equal( messageCount );
				_.each( queueCounts, function( val ) {
					if ( val < ( messageCount / 5 ) ) {
						console.log( 'A queue had a (hopefully) outlier distribution of messages\nIf this is the first time you\'ve seen this message, you can ignore it\nIf you run the test multiple times and see it consistently, there is a problem' );
					}
				} );
				done();
			} );

		after( function( done ) {
			var ackChannelSize = _.size( rabbit.ackChannels );
			rabbit.ackChannels.splice( 0, ackChannelSize );
			close( done, true );
		} );
	} );
} );