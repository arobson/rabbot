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

	describe( 'with single request / reply', function() {
		before( function( done ) {
			this.timeout( 5000 );
			var promises = [
				rabbit.addExchange( 'ex.req.1', 'fanout', {
					autoDelete: true,
					durable: false
				} ),
				rabbit.addQueue( 'q.req.1', {
					autoDelete: true,
					subscribe: true,
					durable: false
				} )
			];
			when.all( promises )
				.done( function() {
					rabbit.bindQueue( 'ex.req.1', 'q.req.1', '' )
						.done( function() {
							done();
						} );
				} );

			rabbit.handle( 'request', function( message ) {
				message.reply( { body: { message: 'roger that.' } } );
			} );
		} );

		it( 'should receive a response', function( done ) {
			this.timeout( 5000 );
			rabbit.request( 'ex.req.1', { type: 'request', body: { message: 'DO. A BARREL ROLL!' } } )
				.then( function( reply ) {
					console.log( reply.body );
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
} );