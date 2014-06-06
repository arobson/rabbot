require( 'should' );

var rabbit = require( '../src/index.js' ),
	_ = require( 'lodash' ),
	exec = require( 'child_process' ).exec,
	fs = require( 'fs' ),
	when = require( 'when' );

var open = function( done, connectionName ) {
	rabbit.getConnection( connectionName )
		.then( function() {
			done();
		} );
};

var close = function( done, reset, connectionName ) {
	if ( connectionName ) {
		rabbit.close( connectionName, reset )
			.then( function() {
				done();
			} );
	} else {
		rabbit.closeAll( reset )
			.then( function() {
				done();
			} );
	}
};

describe( 'when configuring with valid settings', function() {
	var testConnection = undefined;
	var promise = undefined;

	before( function( done ) {
		rabbit.on( 'configTest.connection.configured', function( conn ) {
			testConnection = conn;
			testConnection.should.have.property( 'name', 'configTest' );
			done();
		} ).disposeAfter( 1 );

		var config = {
			connection: {
				name: 'configTest',
				user: 'guest',
				pass: 'guest',
				server: '127.0.0.1',
				port: 5672,
				vhost: '%2f',
			},

			exchanges: [ {
				name: 'config-ex.1',
				type: 'fanout',
				autoDelete: true
			}, {
				name: 'config-ex.2',
				type: 'topic',
				autoDelete: true
			}, {
				name: 'config-ex.3',
				type: 'direct',
				autoDelete: true
			}, {
				name: 'config-ex.4',
				type: 'direct',
				autoDelete: true
			} ],

			queues: [ {
				name: 'config-q.1',
				autoDelete: true
			}, {
				name: 'config-q.2',
				autoDelete: true
			} ],

			bindings: [ {
				exchange: 'config-ex.1',
				target: 'config-q.1',
				keys: [ 'bob', 'fred', '#' ]
			}, {
				exchange: 'config-ex.2',
				target: 'config-q.2',
				keys: 'test1'
			}, {
				exchange: 'config-ex.3',
				target: 'config-ex.4',
				keys: 'bob'
			} ]
		};

		promise = rabbit.configure( config );
		promise.should.be.ok;
	} );

	after( function( done ) {
		close( done, true, 'configTest' );
	} );

	it( 'returns and resolves a promise', function( done ) {
		promise
			.done( function() {
				done();
			}.bind( this ) );
	} );

	it( 'binds exchanges to queues', function( done ) {
		// send a message to test

		rabbit.handle( 'config.test.message', function( msg ) {
			msg.body.should.have.property( 'greeting', 'hello world' );
			done();
		}, this );

		rabbit.startSubscription( 'config-q.1', 'configTest' )
			.done( function() {
				rabbit.publish( 'config-ex.1', 'config.test.message', {
					greeting: 'hello world'
				}, '', '', 'configTest' );
			} );
	} );
} );