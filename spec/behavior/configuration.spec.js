var should = require( 'should' );
var sinon = require( 'sinon' );
var when = require( 'when' );

describe( 'Configuration', function() {
	var noOp = function() {};
	var connection = {
		name: 'test',
		configureBindings: noOp,
		configureExchanges: noOp,
		configureQueues: noOp
	};
	var Broker = function( conn ) {
		this.connection = conn;
	};

	Broker.prototype.addConnection = function() {
		return this.connection;
	};

	Broker.prototype.emit = function() {};

	describe( 'with valid configuration', function() {
		var config = {
			exchanges: [ {} ],
			queues: [ {} ],
			bindings: [ {} ]
		};
		var connectionMock;
		before( function( done ) {
			connectionMock = sinon.mock( connection );
			connectionMock.expects( 'configureExchanges' )
				.once()
				.withArgs( config.exchanges )
				.returns( when( true ) );
			connectionMock.expects( 'configureQueues' )
				.once()
				.withArgs( config.queues )
				.returns( when( true ) );
			connectionMock.expects( 'configureBindings' )
				.once()
				.withArgs( config.bindings, 'test' )
				.returns( when( true ) );
			require( '../../src/config' )( Broker );

			var broker = new Broker( connection );

			broker.configure( config )
				.then( function() {
					done();
				} );
		} );

		it( 'should make expected calls', function() {
			connectionMock.verify();
		} );

		after( function() {
			connectionMock.restore();
		} );
	} );

	describe( 'when exchange creation fails', function() {
		var config = {
			exchanges: [ {} ],
			queues: [ {} ],
			bindings: [ {} ]
		};
		var connectionMock;
		var error;
		before( function( done ) {
			connectionMock = sinon.mock( connection );
			connectionMock.expects( 'configureExchanges' )
				.once()
				.withArgs( config.exchanges )
				.returns( when.reject( new Error( 'Not feelin\' it today' ) ) );
			connectionMock.expects( 'configureQueues' )
				.once()
				.withArgs( config.queues )
				.returns( when( true ) );
			connectionMock.expects( 'configureBindings' )
				.once()
				.withArgs( config.bindings, 'test' )
				.returns( when( true ) );
			require( '../../src/config' )( Broker );

			var broker = new Broker( connection );

			broker.configure( config )
				.then( null, function( err ) {
					error = err;
					done();
				} );
		} );

		it( 'should make expected calls', function() {
			connectionMock.verify();
		} );

		it( 'should return error', function() {
			error.toString().should.equal( 'Error: Not feelin\' it today' );
		} );

		after( function() {
			connectionMock.restore();
		} );
	} );

	describe( 'when queue creation fails', function() {
		var config = {
			exchanges: [ {} ],
			queues: [ {} ],
			bindings: [ {} ]
		};
		var connectionMock;
		var error;
		before( function( done ) {
			connectionMock = sinon.mock( connection );
			connectionMock.expects( 'configureExchanges' )
				.once()
				.withArgs( config.exchanges )
				.returns( when( true ) );
			connectionMock.expects( 'configureQueues' )
				.once()
				.withArgs( config.queues )
				.returns( when.reject( new Error( 'Not feelin\' it today' ) ) );
			connectionMock.expects( 'configureBindings' )
				.once()
				.withArgs( config.bindings, 'test' )
				.returns( when( true ) );
			require( '../../src/config' )( Broker );

			var broker = new Broker( connection );

			broker.configure( config )
				.then( null, function( err ) {
					error = err;
					done();
				} );
		} );

		it( 'should make expected calls', function() {
			connectionMock.verify();
		} );

		it( 'should return error', function() {
			error.toString().should.equal( 'Error: Not feelin\' it today' );
		} );

		after( function() {
			connectionMock.restore();
		} );
	} );

	describe( 'when binding creation fails', function() {
		var config = {
			exchanges: [ {} ],
			queues: [ {} ],
			bindings: [ {} ]
		};
		var connectionMock;
		var error;
		before( function( done ) {
			connectionMock = sinon.mock( connection );
			connectionMock.expects( 'configureExchanges' )
				.once()
				.withArgs( config.exchanges )
				.returns( when( true ) );
			connectionMock.expects( 'configureQueues' )
				.once()
				.withArgs( config.queues )
				.returns( when( true ) );
			connectionMock.expects( 'configureBindings' )
				.once()
				.withArgs( config.bindings, 'test' )
				.returns( when.reject( new Error( 'Not feelin\' it today' ) ) );
			require( '../../src/config' )( Broker );

			var broker = new Broker( connection );

			broker.configure( config )
				.then( null, function( err ) {
					error = err;
					done();
				} );
		} );

		it( 'should make expected calls', function() {
			connectionMock.verify();
		} );

		it( 'should return error', function() {
			error.toString().should.equal( 'Error: Not feelin\' it today' );
		} );

		after( function() {
			connectionMock.restore();
		} );
	} );

} );
