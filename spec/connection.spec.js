require( 'should' );

var rabbit = require( '../src/index.js' );

describe( 'with invalid connection criteria', function() {

	before( function() {
		
	} );

	it( 'should fail to connect', function( done ) {
		rabbit.on( 'silly.connection.failed', function( err ) {
			err.should.equal( 'No endpoints could be reached' );
			rabbit.close( 'silly', true )
				.then( function() {
					done();
				} );
		} ).once();

		rabbit.addConnection( {
			name: 'silly',
			server: 'shfifty-five.gov'
		} );
	} );
} );

describe( 'with default connection criteria', function() {

	describe( 'when connected', function() {

		before( function( done ) {
			rabbit.on( '#.connection.opened', function() { 
				done(); 
			} ).once();
			rabbit.addConnection( { name: 'connection.one' } );
		} );

		it( 'should return a channel', function( done ) {
			var channel = rabbit.connections[ 'connection.one' ].getChannel( 'test' );
			channel.should.be.ok;
			channel.on( 'acquired', function() {
				done();
			} ).once();
		} );

		after( function( done ) {
			rabbit.close( 'connection.one', true )
				.then( function() { 
					done();
				} );
		} ); 
	} );

	describe( 'when disconnected', function() {

		before( function(  ) {
			rabbit.addConnection( { name: 'connection.two' } );
		} );

		beforeEach( function( done ) {
			rabbit
				.close( 'connection.two' )
				.then( function() { 
					done();
				} );
		} );

		after( function( done ) {
			rabbit.close( 'connection.two', true )
				.then( function() { 
					done();
				} );
		} );

		it( 'should reconnect on getting a channel', function( done ) {
			rabbit.on( '#.connection.opened', function() {
				done();
			} ).once();
			var channel = rabbit.connections[ 'connection.two' ].getChannel( 'test' );
		} );
	} );
} );