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
	var handle;
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

			handle = rabbit.handle( 'request', function( message ) {
				console.log( message.body );
				message.reply( { body: { message: 'roger that.' } } );
				handle.remove();
			} );
		} );

		it( 'should receive a response', function( done ) {
			this.timeout( 5000 );
			rabbit.request( 'ex.req.1', { type: 'request', body: { message: 'DO. A BARREL ROLL!' } } )
				.then( function( reply ) {
					reply.ack();
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

	describe( 'with multiple replies', function() {
		before( function( done ) {
			this.timeout( 5000 );
			var promises = [
				rabbit.addExchange( 'ex.req.2', 'fanout', {
					autoDelete: true,
					durable: false
				} ),
				rabbit.addQueue( 'q.req.2', {
					autoDelete: true,
					subscribe: true,
					durable: false
				} )
			];
			when.all( promises )
				.done( function() {
					rabbit.bindQueue( 'ex.req.2', 'q.req.2', '' )
						.done( function() {
							done();
						} );
				} );

			var handle = rabbit.handle( 'request.2', function( message ) {
				message.reply( { body: { message: 'NEVER.' } }, true );
				message.reply( { body: { message: 'EVER.' } }, true );
				message.reply( { body: { message: 'NEVER EVER!' } } );
				handle.remove();
			} );
		} );

		it( 'should receive 3 responses', function( done ) {
			this.timeout( 5000 );
			var replies = [];
			rabbit.request( 'ex.req.2', { type: 'request.2', body: { message: 'DO. A BARREL ROLL!' } } )
				.progress( function( reply ) {
					replies.push( reply.body );
					reply.ack();
				} )
				.then( function( reply ) {
					replies.push( reply.body );
					replies.length.should.equal( 3 );
					reply.ack();
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