require( 'should' );

var rabbit = require( '../src/index.js' );

describe( 'with invalid connection criteria', function() {

	before( function() {
		rabbit.addConnection( {
			name: 'silly',
			server: 'shfifty-five.gov'
		} );
	} );

	it( 'should fail to connect', function( done ) {
		rabbit.on( 'silly.connection.failed', function( err ) { 
			err.should.equal( 'No endpoints could be reached' );
			rabbit.close( 'silly' );
			done();
		} ).once();
		rabbit.getConnection( 'silly' );
	} );
} );

describe( 'with default connection criteria', function() {

	describe( 'when connected', function() {

		before( function( done ) {
			rabbit.addConnection();
			rabbit.on( 'default.connection.opened', function() { 
				done(); 
			} ).once();
		} );

		it( 'should return a channel', function( done ) {
			rabbit.getChannel( 'test' )
				.then( function( channel ) {
					done();
				} );
		} );

		after( function( done ) {
			rabbit.on( 'default.connection.closed', function() {
				done();
			} ).once();
			rabbit.close();
		} );
	} );

	describe( 'when disconnected', function() {

		afterEach( function() {
			rabbit.close();
		} );

		it( 'should reconnect on getting a channel', function( done ) {
			rabbit.on( 'default.connection.opened', function() {
				done(); 
			} ).once();
			rabbit.getChannel( 'test' );
		} );

		it( 'should reconnect on getting connection', function( done ) {
			rabbit.on( 'default.connection.opened', function() { 
				done();
			} ).once();
			rabbit.getConnection();
		} );
	} );
} );