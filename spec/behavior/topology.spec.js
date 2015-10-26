require( '../setup.js' );
var _ = require( 'lodash' );
var when = require( 'when' );
var topologyFn = require( '../../src/topology' );
var noOp = function() {};
var emitter = require( './emitter' );

function connectionFn() {

	var handlers = {};

	function raise( ev ) {
		if ( handlers[ ev ] ) {
			var args = Array.prototype.slice.call( arguments, 1 );
			_.each( handlers[ ev ], function( handler ) {
				if ( handler ) {
					handler.apply( undefined, args );
				}
			} );
		}
	}

	function on( ev, handle ) {
		if ( handlers[ ev ] ) {
			handlers[ ev ].push( handle );
		} else {
			handlers[ ev ] = [ handle ];
		}
		return { unsubscribe: function( h ) {
				handlers[ ev ].splice( _.indexOf( handlers[ ev ], h ) );
			} };
	}

	function reset() {
		handlers = {};
	}

	var connection = {
		name: 'default',
		fail: function( err ) {
			this.state = 'failed';
			this.lastErr = err;
			this.raise( 'failed', err );
		},
		getChannel: noOp,
		handlers: handlers,
		lastErr: '',
		lastError: function() {
			return this.lastErr;
		},
		on: on,
		once: on,
		raise: raise,
		resetHandlers: reset,
		reset: noOp,
		state: ''
	};

	_.bindAll( connection );

	return {
		instance: connection,
		mock: sinon.mock( connection )
	};
}

describe( 'Topology', function() {

	describe( 'when initializing with default reply queue', function() {
		var topology, conn, replyQueue, ex, q;

		before( function( done ) {
			ex = emitter();
			q = emitter();
			q.check = function() {
				q.raise( 'defined' );
				return when.resolve();
			};
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue, 'test' );
			topology.once( 'replyQueue.ready', function( queue ) {
				replyQueue = queue;
				done();
			} );
			process.nextTick( function() {
				q.raise( 'defined' );
			} );
		} );

		it( 'should create default reply queue', function() {
			replyQueue.should.eql(
				{
					name: 'test.response.queue',
					autoDelete: true,
					subscribe: true
				}
			);
		} );

		describe( 'when recovering from disconnection', function() {
			before( function( done ) {
				replyQueue = undefined;
				topology.once( 'replyQueue.ready', function( queue ) {
					replyQueue = queue;
					done();
				} );
				conn.instance.raise( 'reconnected' );
			} );

			it( 'should recreate default reply queue', function() {
				replyQueue.should.eql(
					{
						name: 'test.response.queue',
						autoDelete: true,
						subscribe: true
					}
				);
			} );
		} );
	} );

	describe( 'when initializing with custom reply queue', function() {
		var topology, conn, replyQueue, ex, q;

		before( function( done ) {
			ex = emitter();
			q = emitter();
			q.check = function() {
				q.raise( 'defined' );
				return when.resolve();
			};
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			var options = {
				replyQueue: {
					name: 'mine',
					autoDelete: false,
					subscribe: true
				}
			};
			topology = topologyFn( conn.instance, options, undefined, Exchange, Queue, 'test' );
			topology.once( 'replyQueue.ready', function( queue ) {
				replyQueue = queue;
				done();
			} );
			process.nextTick( function() {
				q.raise( 'defined' );
			} );
		} );

		it( 'should create custom reply queue', function() {
			replyQueue.should.eql(
				{
					name: 'mine',
					autoDelete: false,
					subscribe: true
				}
			);
		} );

		describe( 'when recovering from disconnection', function() {
			before( function( done ) {
				replyQueue = undefined;
				topology.once( 'replyQueue.ready', function( queue ) {
					replyQueue = queue;
					done();
				} );
				conn.instance.raise( 'reconnected' );
			} );

			it( 'should recreate custom reply queue', function() {
				replyQueue.should.eql(
					{
						name: 'mine',
						autoDelete: false,
						subscribe: true
					}
				);
			} );
		} );
	} );

	describe( 'when initializing with no reply queue', function() {
		var topology, conn, replyQueue, ex, q;

		before( function( done ) {
			ex = emitter();
			q = emitter();
			q.check = function() {
				q.raise( 'defined' );
				return when.resolve();
			};
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			var options = {
				replyQueue: false
			};
			topology = topologyFn( conn.instance, options, undefined, Exchange, Queue );
			topology.once( 'replyQueue.ready', function( queue ) {
				replyQueue = queue;
				done();
			} );
			process.nextTick( function() {
				q.raise( 'defined' );
			} );
			setTimeout( function() {
				done();
			}, 200 );
		} );

		it( 'should not create reply queue', function() {
			should.not.exist( replyQueue );
			topology.channels.should.eql( {} );
		} );
	} );

	describe( 'when creating valid exchange', function() {
		var topology, conn, exchange, ex, q;

		before( function( done ) {
			ex = emitter();
			q = emitter();
			ex.check = function() {
				ex.raise( 'defined' );
				return when.resolve();
			};
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue );
			topology.createExchange( { name: 'noice' } )
				.then( function( created ) {
					exchange = created;
					done();
				} );
			process.nextTick( function() {
				ex.raise( 'defined' );
			} );
		} );

		it( 'should create exchange', function() {
			exchange.should.eql( ex );
		} );

		it( 'should add exchange to channels', function() {
			should.exist( topology.channels[ 'exchange:noice' ] );
		} );
	} );

	describe( 'when creating a duplicate exchange', function() {
		var topology, conn, exchange, ex, q;
		var calls = 0;

		before( function( done ) {
			ex = emitter();
			q = emitter();
			ex.check = function() {
				ex.raise( 'defined' );
				return when.resolve();
			};
			var Exchange = function() {
				calls = calls + 1;
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue );
			topology.createExchange( { name: 'noice' } );
			topology.createExchange( { name: 'noice' } )
				.then( function( created ) {
					exchange = created;
					done();
				} );
			process.nextTick( function() {
				ex.raise( 'defined' );
			} );
		} );

		it( 'should create exchange', function() {
			exchange.should.eql( ex );
		} );

		it( 'should not create duplicate exchanges', function() {
			calls.should.equal( 1 );
		} );

		it( 'should add exchange to channels', function() {
			should.exist( topology.channels[ 'exchange:noice' ] );
		} );
	} );

	describe( 'when creating invalid exchange', function() {
		var topology, conn, error, ex, q;

		before( function( done ) {
			ex = emitter();
			q = emitter();
			ex.check = function() {
				return when.resolve();
			};
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue );
			topology.createExchange( { name: 'badtimes' } )
				.then( null, function( err ) {
					error = err;
					done();
				} );
			process.nextTick( function() {
				ex.raise( 'failed', new Error( 'ain\'t nobody got time fodat' ) );
			} );
		} );

		it( 'should reject with error', function() {
			error.toString().should.equal( 'Error: Failed to create exchange \'badtimes\' on connection \'default\' with \'ain\'t nobody got time fodat\'' );
		} );

		it( 'should not add invalid exchanges to channels', function() {
			should.not.exist( topology.channels[ 'exchange:badtimes' ] );
		} );
	} );

	describe( 'when creating invalid queue', function() {
		var topology, conn, error, ex, q;

		before( function( done ) {
			ex = emitter();
			q = emitter();
			ex.check = function() {
				return when.resolve();
			};
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			topology = topologyFn( conn.instance, { replyQueue: false }, undefined, Exchange, Queue );
			topology.createQueue( { name: 'badtimes' } )
				.then( null, function( err ) {
					error = err;
					done();
				} );
			process.nextTick( function() {
				q.raise( 'failed', new Error( 'ain\'t got time fodat' ) );
			} );
		} );

		it( 'should reject with error', function() {
			error.toString().should.equal( 'Error: Failed to create queue \'badtimes\' on connection \'default\' with \'ain\'t got time fodat\'' );
		} );

		it( 'should not add invalid queues to channels', function() {
			should.not.exist( topology.channels[ 'queue:badtimes' ] );
		} );
	} );

	describe( 'when deleting an existing exchange', function() {
		var topology, conn, exchange, ex, q;

		before( function( done ) {
			ex = emitter();
			q = emitter();
			ex.destroy = noOp;
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			var control = {
				deleteExchange: noOp
			};
			var controlMock = sinon.mock( control );
			controlMock
				.expects( 'deleteExchange' )
				.once()
				.withArgs( 'noice' )
				.returns( when.resolve() );
			conn.instance.createChannel = function() {
				return control;
			};
			topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue );
			topology.createExchange( { name: 'noice' } )
				.then( function( created ) {
					exchange = created;
					topology.deleteExchange( 'noice' )
						.then( function() {
							done();
						} );
				} );
			process.nextTick( function() {
				ex.raise( 'defined' );
			} );
		} );

		it( 'should create exchange', function() {
			exchange.should.eql( ex );
		} );

		it( 'should add exchange to channels', function() {
			should.not.exist( topology.channels[ 'exchange:noice' ] );
		} );
	} );

	describe( 'when deleting an existing queue', function() {
		var topology, conn, queue, ex, q;

		before( function() {
			ex = emitter();
			q = emitter();
			q.destroy = noOp;
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			var control = {
				deleteQueue: noOp
			};
			var controlMock = sinon.mock( control );
			controlMock
				.expects( 'deleteQueue' )
				.once()
				.withArgs( 'noice' )
				.returns( when.resolve() );
			conn.instance.createChannel = function() {
				return control;
			};
			topology = topologyFn( conn.instance, { replyQueue: false }, undefined, Exchange, Queue );

			process.nextTick( function() {
				q.raise( 'defined' );
			} );

			return topology.createQueue( { name: 'noice' } )
				.then( function( created ) {
					queue = created;
					return topology.deleteQueue( 'noice' );
				} );
		} );

		it( 'should create queue', function() {
			queue.should.eql( q );
		} );

		it( 'should add queue to channels', function() {
			should.not.exist( topology.channels[ 'queue:noice' ] );
		} );
	} );

	describe( 'when creating an exchange to exchange binding with no keys', function() {
		var topology, conn, ex, q;

		before( function() {
			ex = emitter();
			q = emitter();
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			var control = {
				bindExchange: noOp,
				bindQueue: noOp
			};
			var controlMock = sinon.mock( control );
			controlMock
				.expects( 'bindExchange' )
				.once()
				.withArgs( 'to', 'from', '' )
				.returns( when.resolve() );
			conn.instance.createChannel = function() {
				return control;
			};
			topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue );
			return topology.createBinding( { source: 'from', target: 'to' } );
		} );

		it( 'should add binding to definitions', function() {
			topology.definitions.bindings[ 'from->to' ].should.eql( { source: 'from', target: 'to' } );
		} );
	} );

	describe( 'when creating an exchange to queue binding with no keys', function() {
		var topology, conn, ex, q;

		before( function() {
			ex = emitter();
			q = emitter();
			var Exchange = function() {
				return ex;
			};
			var Queue = function() {
				return q;
			};
			conn = connectionFn();
			var control = {
				bindExchange: noOp,
				bindQueue: noOp
			};
			var controlMock = sinon.mock( control );
			controlMock.expects( 'bindQueue' )
				.withArgs( 'to', 'from', 'a.*' )
				.returns( when.resolve() );
			controlMock.expects( 'bindQueue' )
				.withArgs( 'to', 'from', 'b.*' )
				.returns( when.resolve() );

			conn.instance.createChannel = function() {
				return control;
			};
			topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue );
			topology.createBinding( { source: 'from', target: 'to', keys: [ 'a.*', 'b.*' ], queue: true } );
		} );

		it( 'should add binding to definitions', function() {
			topology.definitions.bindings[ 'from->to' ].should.eql(
				{ source: 'from', target: 'to', keys: [ 'a.*', 'b.*' ], queue: true }
			);
		} );
	} );

	describe( 'when a connection to rabbit cannot be established', function() {
		describe( 'when attempting to create an exchange', function() {
			var topology, conn, error, ex, q;

			before( function() {
				ex = emitter();
				q = emitter();
				var Exchange = function() {
					return ex;
				};
				var Queue = function() {
					return q;
				};
				conn = connectionFn();
				topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue );
				process.nextTick( function() {
					conn.instance.fail( new Error( 'no such server!' ) );
				} );
				return topology.createExchange( { name: 'delayed.ex' } )
					.then( null, function( err ) {
						error = err;
					} );
			} );

			it( 'should reject exchange promise with connection error', function() {
				error.toString().should.equal(
					'Error: Failed to create exchange \'delayed.ex\' on connection \'default\' with \'no such server!\'' );
			} );

			it( 'should keep exchange definition', function() {
				should.exist( topology.channels[ 'exchange:delayed.ex' ] );
			} );
		} );

		describe( 'when attempting to create a queue', function() {
			var topology, conn, error, ex, q;

			before( function() {
				ex = emitter();
				q = emitter();
				var Exchange = function() {
					return ex;
				};
				var Queue = function() {
					return q;
				};
				conn = connectionFn();
				topology = topologyFn( conn.instance, {}, undefined, Exchange, Queue );
				process.nextTick( function() {
					conn.instance.fail( new Error( 'no such server!' ) );
				} );
				return topology.createQueue( { name: 'delayed.q' } )
					.then( null, function( err ) {
						error = err;
					} );
			} );

			it( 'should reject queue promise with connection error', function() {
				error.toString().should.equal(
					'Error: Failed to create queue \'delayed.q\' on connection \'default\' with \'no such server!\'' );
			} );

			it( 'should keep queue definition', function() {
				should.exist( topology.channels[ 'queue:delayed.q' ] );
			} );
		} );
	} );
} );
