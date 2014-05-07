require( 'should' );

var rabbit = require( '../src/index.js' )(),
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

describe( 'when aliasing options', function() {
	var options = {
		a: 1,
		bee: 2,
		cee: 3,
		dee: 4,
		e: 5,
		eff: 6,
		gee: 7
	};
	var expected = {
		a: 1,
		b: 2,
		c: 3,
		d: 4,
		e: 5
	};
	var aliased = {};
	before( function() {
		aliased = rabbit.aliasOptions( options, {
			bee: 'b',
			cee: 'c',
			dee: 'd'
		}, 'gee', 'eff' );
	} );

	it( 'should filter out invalid options', function() {
		aliased.should.eql( expected );
	} );
} );

describe( 'when configuring with valid settings', function() {
	// this.timeout(99999);
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

	it( 'adds or verifies the requested exchanges', function( done ) {
		testConnection.exchanges[ 'config-ex.1' ].should.be.ok;
		testConnection.exchanges[ 'config-ex.2' ].should.be.ok;
		done();
	} );

	it( 'adds or verifies the requested queues', function( done ) {
		testConnection.queues[ 'config-q.1' ].should.be.ok;
		testConnection.queues[ 'config-q.2' ].should.be.ok;
		done();
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