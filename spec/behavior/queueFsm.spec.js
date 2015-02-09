var should = require( 'should' );
var sinon = require( 'sinon' );
var _ = require( 'lodash' );
var when = require( 'when' );
var queueFsm = require( '../../src/queueFsm' );
var noOp = function() {};
var emitter = require( './emitter' );

function channelFn( options ) {
	var channel = {
		name: options.name,
		type: options.type,
		channel: emitter(),
		define: noOp,
		destroy: noOp,
		getMessageCount: noOp,
		subscribe: noOp
	};
	var channelMock = sinon.mock( channel );

	return {
		mock: channelMock,
		factory: function() {
			return channel;
		}
	};
}

describe( 'Queue FSM', function() {

	describe( 'when initialization fails', function() {

		var connection, topology, queue, channelMock, options, error;

		before( function( done ) {
			options = { name: 'test', type: 'test' };
			connection = emitter();
			connection.addQueue = noOp;
			topology = emitter();

			var ch = channelFn( options );
			channelMock = ch.mock;
			channelMock
				.expects( 'define' )
				.once()
				.returns( when.reject( new Error( 'nope' ) ) );

			queue = queueFsm( options, connection, topology, ch.factory );
			queue.on( 'failed', function( err ) {
				error = err;
				done();
			} );
		} );

		it( 'should have failed with an error', function() {
			error.toString().should.equal( 'Error: nope' );
		} );

		it( 'should be in failed state', function() {
			queue.state.should.equal( 'failed' );
		} );

		describe( 'when susbcribing in failed state', function() {
			before( function( done ) {
				queue.subscribe()
					.then( function() {
						done();
					} )
					.then( null, function( err ) {
						error = err;
						done();
					} );
			} );

			it( 'should reject subscribe with an error', function() {
				error.toString().should.equal( 'Error: nope' );
			} );
		} );

		describe( 'when checking in failed state', function() {
			before( function( done ) {
				queue.check()
					.then( function() {
						done();
					} )
					.then( null, function( err ) {
						error = err;
						done();
					} );
			} );

			it( 'should reject check with an error', function() {
				error.toString().should.equal( 'Error: nope' );
			} );
		} );

	} );

	describe( 'when initializing succeeds', function() {
		var connection, topology, queue, ch, channelMock, options, error;

		before( function( done ) {
			options = { name: 'test', type: 'test' };
			connection = emitter();
			connection.addQueue = noOp;
			topology = emitter();

			ch = channelFn( options );
			channelMock = ch.mock;
			channelMock
				.expects( 'define' )
				.once()
				.returns( when.resolve() );

			queue = queueFsm( options, connection, topology, ch.factory );
			queue.on( 'failed', function( err ) {
				error = err;
				done();
			} );
			queue.on( 'defined', function() {
				done();
			} );
		} );

		it( 'should not have failed', function() {
			should.not.exist( error );
		} );

		it( 'should be in ready state', function() {
			queue.state.should.equal( 'ready' );
		} );

		describe( 'when subscribing in ready state', function() {
			before( function( done ) {
				channelMock
					.expects( 'subscribe' )
					.once()
					.returns( when( true ) );

				queue.subscribe( {} )
					.then( function() {
						done();
					} )
					.then( null, function( err ) {
						error = err;
						done();
					} );
			} );

			it( 'should resolve susbcribe without error', function() {
				should.not.exist( error );
			} );
		} );

		describe( 'when checking in ready state', function() {
			before( function( done ) {
				queue.check()
					.then( function() {
						done();
					} )
					.then( null, function( err ) {
						error = err;
						done();
					} );
			} );

			it( 'should resolve check without error', function() {
				should.not.exist( error );
			} );
		} );

		describe( 'when channel is released', function() {

			before( function( done ) {
				channelMock
					.expects( 'define' )
					.once()
					.returns( when.resolve() );

				queue.on( 'failed', function( err ) {
					error = err;
					done();
				} );
				queue.on( 'defined', function() {
					done();
				} );

				ch.factory().channel.raise( 'released' );
			} );

			it( 'should reinitialize without error', function() {
				should.not.exist( error );
			} );
		} );

		describe( 'when destroying', function() {

			before( function( done ) {
				channelMock
					.expects( 'destroy' )
					.once()
					.returns( when.resolve() );

				queue.destroy()
					.then( function() {
						done();
					} );
			} );

			it( 'should remove handlers from topology and connection', function() {
				_.keys( connection.handlers ).length.should.equal( 0 );
				_.keys( topology.handlers ).length.should.equal( 0 );
			} );

			it( 'should release channel instance', function() {
				should.not.exist( queue.channel );
			} );

			describe( 'when checking a destroyed channel', function() {

				before( function( done ) {
					channelMock
						.expects( 'define' )
						.once()
						.returns( when.resolve() );

					queue.check()
						.then( function() {
							done();
						} )
						.then( null, function( err ) {
							error = err;
							done();
						} );
				} );

				it( 'should redefine queue without errors', function() {
					should.not.exist( error );
				} );
			} );
		} );

		after( function() {
			connection.reset();
			topology.reset();
			channelMock.restore();
		} );
	} );
} );
