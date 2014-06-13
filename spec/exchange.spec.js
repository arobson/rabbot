require( 'should' );

var rabbit = require( '../src/index.js' ),
	_ = require( 'lodash' ),
	exec = require( 'child_process' ).exec,
	fs = require( 'fs' ),
	when = require( 'when' );

describe( 'with default connection', function() {
	before( function() {
		rabbit.addConnection( { name: 'no-queue' } );
	} );

	describe( 'with a valid exchange (no queue)', function() {
		before( function( done ) {
			rabbit.addExchange( 'temp.ext', 'fanout', {
				autoDelete: true
			}, 'no-queue' )
			.done( function() {
				done();
			} );
		} );

		it( 'should confirm published message', function( done ) {
			rabbit.publish( 'temp.ext', 'test.3', {
				message: 'hello, world!'
			}, 'routingKey', 'correlationId', 'no-queue' )
			.then( function() {
				done();
			} )
		} );

		after( function() {
			rabbit.close( 'no-queue', true );
		} );
	} );

	describe( 'with a dead-letter exchange', function() {
		before( function( done ) {
			rabbit.addConnection();
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
			var handler = rabbit.handle( 'test.7', function( message ) {
				if ( message.body.number == 2 ) {
					handler.remove();
					done();
				}
			} );
		} );

		after( function( done ) {
			rabbit.close( 'default', true )
				.then( function() {
					done();
				} );
		} );
	} );

	describe( 'with an alternate exchange', function() {
		before( function( done ) {
			rabbit.addConnection();
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

		after( function( done ) {
			rabbit.close( 'default', true )
				.then( function() {
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

		var queues = [];
		before( function( done ) {
			rabbit.addConnection();
			rabbit.configure( config )
				.then( function() {
					var subscriptions = [];
					for ( var i = 1; i < 5; i++ ) {
						queues.push( rabbit.startSubscription( 'qc.' + i, 'consistent-hash' ) );
					}
					done();
				} );
		} );

		describe( 'when publishing messages', function() {

			var promises = [],
				messageCount = 1000,
				receivedMessages = 0;

			var publishCall = function( i ) {
				return rabbit.publish( 'ex.consistent-hash', 'load.balanced.message', {
					message: 'Where in the hello world did I go?'
				}, undefined, ( i + 1 ).toString(), 'consistent-hash' );
			}

			before( function( done ) {
				for ( var i = 0; i < messageCount; i++ ) {
					promises.push( publishCall( i ) );
				}

				when.all( promises )
					.done( function() {
						_.each( queues, function( q ) {
							receivedMessages += q.receivedMessages.receivedCount;
						} );
						done();
					} );
			} );

			it( 'should have published all messages', function() {
				receivedMessages.should.be.approximately( 1000, 10 );
			} )

			//Even if it's not super uniform, this should be relatively uniform
			//Amazon Dynamo documents said using 100-200 nodes achieves 5-10% unbalance (acceptable)			
			it( 'should create even distribution', function() {
				var quarter = receivedMessages / 4,
					margin = quarter / 4;
				queues[ 0 ].receivedMessages.receivedCount.should.be.approximately( quarter, margin );
				queues[ 1 ].receivedMessages.receivedCount.should.be.approximately( quarter, margin );
				queues[ 2 ].receivedMessages.receivedCount.should.be.approximately( quarter, margin );
				queues[ 3 ].receivedMessages.receivedCount.should.be.approximately( quarter, margin );
			} );
			

			after( function( done ) {
				rabbit.close( 'consistent-hash', true )
					.then( function() {
						done();
					} );
			} );
		} );
	} );

} );