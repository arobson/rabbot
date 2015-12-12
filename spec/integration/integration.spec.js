require( '../setup.js' );
var _ = require( 'lodash' );

var harnessFactory = function( rabbit, cb, expected ) {
	var handlers = [];
	var received = [];
	var unhandled = [];
	expected = expected || 1;
	var check = function() {
		if ( ( received.length + unhandled.length ) === expected ) {
			cb();
		}
	};

	function defaultHandle( message ) {
		message.ack();
	}

	function wrap( handle ) {
		return function( message ) {
			handle( message );
			received.push( message );
			check();
		};
	}

	function handleFn( type, handle ) {
		handlers.push( rabbit.handle( type, wrap( handle || defaultHandle ) ) );
	}

	function clean() {
		handlers.forEach( function( handle ) {
			handle.remove();
		} );
		handlers = [];
		received = [];
	}

	rabbit.onUnhandled( function( message ) {
		unhandled.push( message );
		message.ack();
		check();
	} );

	return {
		add: function( msg ) {
			received.push( msg );
			check();
		},
		received: received,
		clean: clean,
		handle: handleFn,
		handlers: handlers,
		unhandled: unhandled
	};
};

describe( 'Integration Test Suite', function() {
	var rabbit, harnessFn;
	before( function() {
		rabbit = require( '../../src/index.js' );
		harnessFn = harnessFactory.bind( undefined, rabbit );
		return rabbit.configure( require( './configuration.js' ) );
	} );

	describe( 'with invalid connection criteria', function() {
		describe( 'when attempting a connection', function() {
			var error;
			before( function( done ) {
				rabbit.once( 'silly.connection.failed', function( err ) {
					error = err;
					done();
				} );

				rabbit.addConnection( {
					name: 'silly',
					server: 'shfifty-five.gov',
					publishTimeout: 50
				} );

				rabbit.addExchange( { name: 'silly-ex' }, 'silly' ).then( null, _.noop );
			} );

			it( 'should fail to connect', function() {
				error.should.equal( 'No endpoints could be reached' );
			} );

			it( 'should reject publish after timeout', function() {
				return rabbit.publish( 'silly-ex', { body: 'test' }, 'silly' )
					.then( null, function( err ) {
						console.log( err );
					} );
			} );

			after( function() {
				return rabbit.close( 'silly' );
			} );
		} );

		describe( 'when configuring against a bad connection', function() {
			var config;
			before( function() {
				config = {
					connection: {
						name: 'silly2',
						server: 'beanpaste.org'
					},
					exchanges: [
						{
							name: 'wascally-ex.direct',
							type: 'direct',
							autoDelete: true
						},
						{
							name: 'wascally-ex.topic',
							type: 'topic',
							alternate: 'wascally-ex.alternate',
							autoDelete: true
						}
					],
					queues: [
						{
							name: 'wascally-q.direct',
							autoDelete: true,
							subscribe: true
						},
						{
							name: 'wascally-q.topic',
							autoDelete: true,
							subscribe: true,
							deadletter: 'wascally-ex.deadletter'
						}
					],
					bindings: [
						{
							exchange: 'wascally-ex.direct',
							target: 'wascally-q.direct',
							keys: ''
						},
						{
							exchange: 'wascally-ex.topic',
							target: 'wascally-q.topic',
							keys: '#'
						}
					]
				};
			} );

			it( 'should fail to connect', function() {
				return rabbit.configure( config )
					.should.be.rejectedWith(
					'Failed to create exchange \'wascally-ex.direct\' on connection \'silly2\' with \'No endpoints could be reached\''
				);
			} );

			after( function() {
				rabbit.close( 'silly2' );
			} );
		} );
	} );

	describe( 'with topic routes', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 3 );
			harness.handle( 'topic' );
			rabbit.publish( 'wascally-ex.topic', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' } );
			rabbit.publish( 'wascally-ex.topic', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' } );
			rabbit.publish( 'wascally-ex.topic', { type: 'topic', routingKey: 'a.test.this.is', body: 'yoda' } );
		} );

		it( 'should route all messages correctly', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey
				};
			} );
			_.sortBy( results, 'body' ).should.eql(
				[
					{ body: 'broadcast', key: 'this.is.a.test' },
					{ body: 'leonidas', key: 'this.is.sparta' },
					{ body: 'yoda', key: 'a.test.this.is' },
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with fanout exchange', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 2 );
			harness.handle( 'fanned' );
			rabbit.publish( 'wascally-ex.fanout', { type: 'fanned', routingKey: 'this.is.ignored', body: 'hello, everyone' } );
		} );

		it( 'should route all messages correctly', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey
				};
			} );
			results.should.eql(
				[
					{ body: 'hello, everyone', key: 'this.is.ignored' },
					{ body: 'hello, everyone', key: 'this.is.ignored' }
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with unhandled messages', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 2 );
			rabbit.publish( 'wascally-ex.direct', { type: 'junk', routingKey: '', body: 'uh oh' } );
			rabbit.publish( 'wascally-ex.direct', { type: 'garbage', routingKey: '', body: 'uh oh' } );
		} );

		it( 'should capture messages according to unhandled strategy', function() {
			var results = _.map( harness.unhandled, function( m ) {
				return {
					body: m.body,
					type: m.type
				};
			} );
			results.should.eql(
				[
					{ body: 'uh oh', type: 'junk' },
					{ body: 'uh oh', type: 'garbage' }
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with unrouted messages', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 3 );
			harness.handle( 'deadend' );
			rabbit.publish( 'wascally-ex.deadend', { type: 'deadend', routingKey: 'empty', body: 'one' } );
			rabbit.publish( 'wascally-ex.deadend', { type: 'deadend', routingKey: 'nothing', body: 'two' } );
			rabbit.publish( 'wascally-ex.deadend', { type: 'deadend', routingKey: 'de.nada', body: 'three' } );
		} );

		it( 'should route all messages correctly', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey
				};
			} );
			_.sortBy( results, 'body' ).should.eql(
				[
					{ body: 'one', key: 'empty' },
					{ body: 'three', key: 'de.nada' },
					{ body: 'two', key: 'nothing' },
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with requests', function() {
		this.timeout( 3000 );
		var harness, response1, response2, response3;
		before( function( done ) {
			harness = harnessFn( done, 8 );
			harness.handle( 'polite', function( q ) {
				q.reply( ':D' );
			} );
			harness.handle( 'rude', function( q ) {
				q.reply( '>:@' );
			} );
			harness.handle( 'crazy', function( q ) {
				q.reply( '...', true );
				q.reply( '...', true );
				q.reply( '...' );
			} );

			rabbit.request( 'wascally-ex.request', { type: 'polite', body: 'how are you?' } )
				.then( function( response ) {
					response1 = response.body;
					harness.add( response );
					response.ack();
				} );

			rabbit.request( 'wascally-ex.request', { type: 'rude', body: 'why so dumb?' } )
				.then( function( response ) {
					response2 = response.body;
					harness.add( response );
					response.ack();
				} );

			function onPart( part ) {
				response3 = ( response3 || '' ) + part.body;
				part.ack();
				harness.add( part );
			}
			rabbit.request( 'wascally-ex.request', { type: 'crazy', body: 'do you like my yak-hair-shirt?' } )
				.progress( onPart )
				.then( function( response ) {
					onPart( response );
				} );
		} );

		it( 'should handle all requests', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body
				};
			} );
			_.sortBy( results, 'body' ).should.eql(
				[
					{ body: '...' },
					{ body: '...' },
					{ body: '...' },
					{ body: ':D' },
					{ body: '>:@' },
					{ body: 'do you like my yak-hair-shirt?' },
					{ body: 'how are you?' },
					{ body: 'why so dumb?' },
				] );
		} );

		it( 'should capture responses corresponding to the originating request', function() {
			response1.should.equal( ':D' );
			response2.should.equal( '>:@' );
			response3.should.equal( '.........' );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with rejection and dead-letter', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 2 );
			harness.handlers.push(
				rabbit.handle( 'reject', function( env ) {
					if ( harness.received.length < 2 ) {
						env.reject();
					} else {
						env.ack();
					}
					harness.add( env );
				} )
			);
			rabbit.publish( 'wascally-ex.topic', { type: 'reject', routingKey: 'this.is.rejection', body: 'haters gonna hate' } );
		} );

		it( 'receive message from bound queue and dead-letter queue', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey,
					exchange: m.fields.exchange
				};
			} );
			results.should.eql(
				[
					{ body: 'haters gonna hate', key: 'this.is.rejection', exchange: 'wascally-ex.topic' },
					{ body: 'haters gonna hate', key: 'this.is.rejection', exchange: 'wascally-ex.deadletter' }
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with consistent hash exchange', function() {
		var harness, limit;
		before( function( done ) {
			this.timeout( 4000 );
			limit = 1000;
			harness = harnessFn( done, limit );
			harness.handle( 'balanced' );
			for (var i = 0; i < limit; i++) {
				rabbit.publish( 'wascally-ex.consistent-hash', { type: 'balanced', correlationId: ( i + i ).toString(), body: 'message ' + i } );
			}
		} );

		it( 'should distribute messages across queues within margin for error', function() {
			var consumers = _.reduce( harness.received, function( acc, m ) {
				var key = m.fields.consumerTag;
				if ( acc[ key ] ) {
					acc[key]++;
				} else {
					acc[ key ] = 1;
				}
				return acc;
			}, {} );
			var quarter = limit / 4;
			var margin = quarter / 4;
			var counts = _.values( consumers );
			_.each( counts, function( count ) {
				count.should.be.closeTo( quarter, margin );
			} );
			_.reduce( counts, function( acc, x ) {
				return acc + x;
			}, 0 ).should.equal( limit );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with noBatch enabled', function() {
		var messagesToSend, harness;

		before( function( done ) {
			this.timeout( 5000 );

			messagesToSend = 10;
			harness = harnessFn( done, messagesToSend );
			var messageCount = 0;

			harness.handle( 'no.batch', function( message ) {
				if ( messageCount > 0 ) {
					message.ack();
				}
				messageCount += 1;
			} );

			for (var i = 0; i < messagesToSend; i++) {
				rabbit.publish( 'wascally-ex.no-batch', {
					type: 'no.batch',
					body: 'message ' + i,
					routingKey: ''
				} );
			}
		} );

		it( 'should receive all messages', function() {
			harness.received.length.should.equal( messagesToSend );
		} );
	} );

	describe( 'with wild card type handling', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 3 );
			harness.handle( '#.a' );
			rabbit.publish( 'wascally-ex.topic', { type: 'one.a', routingKey: 'this.is.one', body: 'one' } );
			rabbit.publish( 'wascally-ex.topic', { type: 'two.i.a', routingKey: 'this.is.two', body: 'two' } );
			rabbit.publish( 'wascally-ex.topic', { type: 'three-b.a', routingKey: 'this.is.three', body: 'three' } );
			rabbit.publish( 'wascally-ex.topic', { type: 'a.four', routingKey: 'this.is.four', body: 'four' } );
		} );

		it( 'should handle all message types ending in "a"', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey
				};
			} );
			_.sortBy( results, 'body' ).should.eql(
				[
					{ body: 'one', key: 'this.is.one' },
					{ body: 'three', key: 'this.is.three' },
					{ body: 'two', key: 'this.is.two' }
				] );
		} );

		it( 'should not handle message types that don\'t match the pattern', function() {
			harness.unhandled.length.should.equal( 1 );
			harness.unhandled[ 0 ].body.should.eql( 'four' );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with no type present', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 1 );
			harness.handle( '#.typeless' );
			rabbit.publish( 'wascally-ex.topic', { type: '', routingKey: 'this.is.typeless', body: 'one' } );
		} );

		it( 'should handle based on topic', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey
				};
			} );
			_.sortBy( results, 'body' ).should.eql(
				[
					{ body: 'one', key: 'this.is.typeless' }
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	after( function() {
		this.timeout( 5000 );
		rabbit.deleteExchange( 'wascally-ex.deadend' ).then( function() {} );
		return rabbit.closeAll().then( function() {
			rabbit.reset();
		} );
	} );

} );

describe( 'Integration Test Suite - Alternate Configuration', function() {
	var rabbit, harnessFn;
	before( function() {
		rabbit = require( '../../src/index.js' );
		harnessFn = harnessFactory.bind( undefined, rabbit );
		return rabbit.configure( require( './alt-configuration.js' ) );
	} );

	describe( 'with no replyQueue', function() {
		var harness, messagesToSend;

		before( function( done ) {
			messagesToSend = 3;
			harness = harnessFn( done, messagesToSend );

			harness.handle( 'no.replyQueue', function( message ) {
				message.ack();
			} );

			for (var i = 0; i < messagesToSend; i++) {
				rabbit.publish( 'noreply-ex.direct', {
					type: 'no.replyQueue',
					body: 'message ' + i,
					routingKey: ''
				} );
			}
		} );

		it( 'should receive all messages', function() {
			harness.received.length.should.equal( messagesToSend );
		} );
	} );

	after( function() {
		return rabbit.closeAll().then( function() {
			rabbit.reset();
		} );
	} );
} );
