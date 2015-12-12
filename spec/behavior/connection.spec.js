require( '../setup.js' );
var when = require( 'when' );
var connectionFn = require( '../../src/connectionFsm.js' );
var noOp = function() {};

/* globals expect */

var connectionMonadFn = function() {
	var handlers = {};

	function raise( ev ) {
		if ( handlers[ ev ] ) {
			handlers[ ev ].apply( undefined, Array.prototype.slice.call( arguments, 1 ) );
		}
	}

	function on( ev, handle ) {
		handlers[ ev ] = handle;
	}

	function reset() {
		handlers = {};
		this.close = noOp;
		this.createChannel = noOp;
		this.createConfirmChannel = noOp;
		this.release = noOp;
	}

	var instance = {
		acquire: function() {
			this.raise( 'acquiring' );
		},
		close: noOp,
		createChannel: noOp,
		createConfirmChannel: noOp,
		on: on,
		raise: raise,
		release: noOp,
		reset: reset
	};
	this.setTimeout( instance.acquire.bind( instance ), 0 );
	return instance;
};

describe( 'Connection FSM', function() {

	describe( 'when configuration has getter', function() {
		it( 'should not throw exception', function() {
			expect( function() {
				connectionFn( { get: function( property ) {
					var value = this[ property ];
					if (value === undefined) {
						throw new Error('Configuration property "' + property + '" is not defined');
					}
					return value;
				} } );
			} ).to.not.throw( Error );
		} );
	} );

	describe( 'when connection is unavailable (failed)', function() {

		describe( 'when connecting', function() {
			var connection, monad;
			before( function( done ) {
				monad = connectionMonadFn();
				connection = connectionFn( { name: 'failure' }, function() {
					return monad;
				} );
				connection.once( 'acquiring', function() {
					monad.raise( 'failed', new Error( 'bummer' ) );
				} );
				connection.once( 'failed', function() {
					done();
				} );
			} );

			it( 'should transition to failed status', function() {
				connection.state.should.equal( 'failed' );
			} );

			describe( 'implicitly (due to operation)', function() {
				var error;
				before( function( done ) {
					monad.createChannel = function() {
						return when.reject( ':( no can do' );
					};
					var channel;
					connection.once( 'acquiring', function() {
						monad.raise( 'failed', new Error( 'bummer' ) );
					} );
					connection.once( 'failed', function() {
						done();
					} );
					channel = connection.createChannel();
					channel.once( 'failed', function( err ) {
						error = err;
						channel.destroy();
					} );
				} );

				it( 'should fail to create channel', function() {
					error.toString().should.equal( ':( no can do' );
				} );

				it( 'should transition to failed status', function() {
					connection.state.should.equal( 'failed' );
				} );
			} );

			describe( 'explicitly', function() {
				before( function( done ) {
					connection.on( 'failed', function() {
						done();
					} ).once();
					connection.on( 'acquiring', function() {
						monad.raise( 'failed', new Error( 'bummer' ) );
					} );
					connection.connect();
				} );

				it( 'should transition to failed status', function() {
					connection.state.should.equal( 'failed' );
				} );
			} );
		} );
	} );

	describe( 'when connection is available', function() {

		describe( 'when first node fails', function() {
			var connection, monad, badEvent, onAcquiring;
			before( function( done ) {
				// this nightmare of a test setup causes the FSM to get a failed
				// event from the connection monad.
				// on the failed event, connect is called which triggers an 'acquiring'
				// event and transitions the FSM to 'connecting state'.
				// on the acquiring event, we raise the 'acquired' event from the monad
				// causing the FSM to transition into a connected state and emit 'connected'
				// but it should NOT emit 'reconnected' despite failures since an original connection
				// was never established
				var attempts = [ 'acquired', 'failed' ];
				monad = connectionMonadFn();
				connection = connectionFn( { name: 'success' }, function() {
					return monad;
				} );
				connection.once( 'connected', function() {
					onAcquiring.unsubscribe();
					done();
				} );
				connection.once( 'reconnected', function() {
					badEvent = true;
				} );
				connection.once( 'failed', function() {
					process.nextTick( function() {
						connection.connect();
					} );
				} );
				onAcquiring = connection.on( 'acquiring', function() {
					var ev = attempts.pop();
					process.nextTick( function() {
						monad.raise( ev );
					} );
				} );
			} );

			it( 'should transition to connected status', function() {
				connection.state.should.equal( 'connected' );
			} );

			it( 'should not emit reconnected', function() {
				should.not.exist( badEvent );
			} );
		} );

		describe( 'when connecting (with failed initial attempt)', function() {
			var connection, monad, badEvent, onAcquiring;
			before( function( done ) {
				// this nightmare of a test setup causes the FSM to get a failed
				// event from the connection monad.
				// on the failed event, connect is called which triggers an 'acquiring'
				// event and transitions the FSM to 'connecting state'.
				// on the acquiring event, we raise the 'acquired' event from the monad
				// causing the FSM to transition into a connected state and emit 'connected'
				// but it should NOT emit 'reconnected' despite failures since an original connection
				// was never established
				var attempts = [ 'acquired', 'failed' ];
				monad = connectionMonadFn();
				connection = connectionFn( { name: 'success' }, function() {
					return monad;
				} );
				connection.once( 'connected', function() {
					onAcquiring.unsubscribe();
					done();
				} );
				connection.once( 'reconnected', function() {
					badEvent = true;
				} );
				connection.once( 'failed', function() {
					process.nextTick( function() {
						connection.connect();
					} );
				} );
				onAcquiring = connection.on( 'acquiring', function() {
					var ev = attempts.pop();
					process.nextTick( function() {
						monad.raise( ev );
					} );
				} );
			} );

			it( 'should transition to connected status', function() {
				connection.state.should.equal( 'connected' );
			} );

			it( 'should not emit reconnected', function() {
				should.not.exist( badEvent );
			} );

			describe( 'when acquiring a channel', function() {
				var channel;
				before( function() {
					monad.createChannel = function() {
						return when( {} );
					};
				} );

				it( 'should create channel', function( done ) {
					channel = connection.createChannel();
					channel.once( 'acquired', function() {
						done();
					} );
				} );

				after( function() {
					channel.destroy();
				} );
			} );

			describe( 'when closing with queues', function() {
				var queueMock;
				var queue = { destroy: noOp };
				before( function() {
					queueMock = sinon.mock( queue );
					queueMock.expects( 'destroy' ).exactly( 5 ).returns( when( true ) );
					connection.addQueue( queue );
					connection.addQueue( queue );
					connection.addQueue( queue );
					connection.addQueue( queue );
					connection.addQueue( queue );

					monad.close = function() {
						// prevents the promise from being returned if the queues haven't all resolved
						queueMock.verify();
						return when( true );
					};

					return connection
						.close();
				} );

				it( 'should have destroyed all queues before closing', function() {
					queueMock.verify();
				} );

				after( function() {
					monad.close = noOp;
				} );

			} );

			describe( 'when closing with queues after lost connection', function() {
				var queueMock;
				var queue = { destroy: noOp };
				before( function() {
					queueMock = sinon.mock( queue );
					queueMock.expects( 'destroy' ).never();
					connection.addQueue( queue );
					connection.addQueue( queue );
					connection.addQueue( queue );
					connection.addQueue( queue );
					connection.addQueue( queue );

					monad.raise( 'lost' );

					return connection
						.close();
				} );

				it( 'should not attempt to destroy queues', function() {
					queueMock.verify();
				} );

			} );

			describe( 'when connection is lost', function() {
				var onAcquired;
				before( function() {
					onAcquired = connection.on( 'acquiring', function() {
						monad.raise( 'acquired' );
					} );
					return connection.connect().then( function() {
						connection.addQueue( {} );
						connection.addQueue( {} );
						connection.addQueue( {} );
					} );
				} );

				it( 'it should emit reconnected after a loss', function( done ) {
					connection.once( 'reconnected', function() {
						done();
					} );
					monad.raise( 'lost' );
				} );

				after( function() {
					onAcquired.unsubscribe();
				} );
			} );
		} );
	} );
} );
