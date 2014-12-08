require( 'should' );

var rabbit = require( '../src/index.js' ),
	_ = require( 'lodash' ),
	exec = require( 'child_process' ).exec,
	fs = require( 'fs' ),
	when = require( 'when' );

describe( 'with default connection', function() {
	before( function() {
		rabbit.addConnection();
	} );

	describe( 'with a consumer limit', function() {
		var testHandler;
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
			var messages = [];
			for ( i = 0; i <= 5; i++ ) {
				rabbit.publish( 'ex.5', 'test.5', {
					message: 'hello, world!'
				} );
			}

			testHandler = rabbit.handle( 'test.5', function( message ) {
				messages.push( message );
				message.body.message.should.eql( 'hello, world!' );
			} );

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
			testHandler.remove();
			rabbit.close( 'default', true )
				.then( function() {
					done();
				} );
		} );
	} );

	describe( 'with a queue limit', function() {
		var testHandler;
		before( function( done ) {
			rabbit.clearAckInterval();
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
				confirmedCount = 0,
				queue = rabbit.connections[ 'default' ].getChannel( 'q.6' ),
				batchAck = function() { 
					queue.receivedMessages._processBatch(); 
				};
				
			testHandler = rabbit.handle( 'test.6', function( message ) {
				messages.push( message );
				message.body.message.should.eql( 'hello, world!' );
				message.ack();
				rabbit.batchAck();
			} );
			
			for ( i = 0; i <= 10; i++ ) {
				rabbit.publish( 'ex.6', 'test.6', {
					message: 'hello, world!'
				} )
				.then( function() {
					confirmedCount++;
					if ( confirmedCount == 5 ) {
						rabbit.startSubscription( 'q.6' );
					}
				} );
			}

			setTimeout( function() {
				messages.length.should.equal( 5 );
				done();
			}, 200 );
		} );

		after( function( done ) {
			rabbit.setAckInterval( 500 );
			testHandler.remove();
			rabbit.close( 'default', true )
				.then( function() {
					done();
				} );
		} );
	} );

	describe( 'with handler errors', function() {
		var testHandler;
		before( function( done ) {
			var promises = [
				rabbit.addExchange( 'ex.9', 'fanout', {
					autoDelete: true
				} ),
				rabbit.addQueue( 'q.9', {
					autoDelete: true,
					subscribe: true,
					limit: 1
				} )
			];
			when.all( promises )
				.done( function() {
					rabbit.bindQueue( 'ex.9', 'q.9', '' )
						.done( function() {
							done();
						} );
				} );
		} );

		it( 'should nack message the first time on error', function( done ) {
			var errored = false;
			rabbit.nackOnError();
			testHandler = rabbit.handle( 'test.message', function( msg ) {
				if( errored ) {
					msg.ack();
					msg.fields.exchange.should.equal( 'ex.9' );
					done();
					rabbit.ignoreHandlerErrors();
				} else {
					errored = true;
					throw new Error( 'Imma fail just to be a jerk :D' );
				}
			} );
			rabbit.publish( 'ex.9', 'test.message', 'hello' );
		} );

		after( function( done ) {
			testHandler.remove();
			rabbit.close( 'default', true )
				.then( function() {
					done();
				} );
		} );
	} );

	describe( 'with handler errors', function() {
		var testHandler;
		before( function( done ) {
			var promises = [
				rabbit.addExchange( 'ex.10', 'fanout', {
					autoDelete: true
				} ),
				rabbit.addExchange( 'dlx.10', 'fanout', {
					autoDelete: true
				} ),
				rabbit.addQueue( 'dlq.10', {
					autoDelete: true,
					subscribe: true,
					limit: 1
				} ),
				rabbit.addQueue( 'q.10', {
					autoDelete: true,
					subscribe: true,
					deadLetter: 'dlx.10',
					limit: 1
				} )
			];
			when.all( promises )
				.done( function() {
					rabbit.bindQueue( 'dlx.10', 'dlq.10', '' );
					rabbit.bindQueue( 'ex.10', 'q.10', '' )
						.done( function() {
							done();
						} );
				} );
		} );

		it( 'should reject message the first time on error', function( done ) {
			var errored = false;
			testHandler = rabbit.handle( 'test.message', function( msg ) {
				if( errored ) {
					msg.fields.exchange.should.equal( 'dlx.10' );
					msg.ack();
					done();
				} else {
					errored = true;
					throw new Error( 'Imma fail just to be a jerk :D' );
				}
			} );
			testHandler.catch( function( err, msg ) {
				msg.reject();
			} );
			rabbit.publish( 'ex.10', 'test.message', 'hello' );
		} );

		after( function( done ) {
			testHandler.remove();
			rabbit.close( 'default', true )
				.then( function() {
					done();
				} );
		} );
	} );

	after( function( done ) {
		rabbit.close( 'default', true )
			.then( function() {
				done();
			} );
	} );
} );