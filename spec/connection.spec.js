require( 'should' );

var rabbit = require( '../src/index.js' ),
	_ = require( 'lodash' ),
	exec = require( 'child_process' ).exec,
	fs = require( 'fs' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' );

var open = function( done, connectionName ) {
	rabbit.getConnection( connectionName )
		.then( null, function( err ) {
			console.log( err );
		} )
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

describe( 'with valid default connection criteria', function() {
	before( function( done ) {
		rabbit.addConnection();
		close( done, true );

	} );

	afterEach( function( done ) {
		close( done );
	} );

	after( function( done ) {
		close( done, true );
	} );


	it( 'should connect successfully and emit connected', function( done ) {
		rabbit.on( 'connected', function( connection ) {
			connection.name.should.equal( 'default' );
			done();
		} ).once();

		rabbit.getConnection();
	} );

	it( 'should connect successfully and emit default.connection.opened', function( done ) {
		rabbit.on( '*.connection.opened', function( connection ) {
			connection.name.should.equal( 'default' );
			done();
		} ).once();

		rabbit.getConnection();
	} );

	it( 'should connect successfully and resolve connection promise', function( done ) {
		rabbit.getConnection()
			.then( function( conn ) {
				conn.name.should.equal( 'default' );
				done();
			} )
	} );
} );

describe( 'with valid user-specified connection criteria', function() {

	after( function( done ) {
		close( done, true );
	} );

	it( 'should connect successfully', function( done ) {

		rabbit.on( 'test.connection.opened', function( conn ) {
			conn.should.have.property( 'name', 'test' );
			done();
		} ).disposeAfter( 1 );

		var settings = {
			name: 'test',
			user: 'guest',
			pass: 'guest',
			server: '127.0.0.1, ubuntu',
			port: 5672,
			vhost: '%2f'
		};

		rabbit.addConnection( settings );

	} );
} );

describe( 'with valid kit environment vars connection criteria', function() {

	after( function( done ) {
		close( done, true );
	} );

	it( 'should connect successfully', function( done ) {

		rabbit.on( 'env-vars.connection.opened', function( conn ) {
			conn.should.have.property( 'name', 'env-vars' );
			done();
		} ).disposeAfter( 1 );

		var settings = {
			name: 'env-vars',
			RABBIT_BROKER: '127.0.0.1',
			RABBIT_USER: 'guest',
			RABBIT_PASSWORD: 'guest',
			RABBIT_VHOST: '%2F',
			RABBIT_PORT: 5672
		};

		rabbit.addConnection( settings );

	} );
} );

describe( 'without valid connection criteria', function() {
	it( 'should throw a meaninful error', function( done ) {
		rabbit.on( 'silly.connection.failed', function( data ) {
			data.should.equal( 'No endpoints could be reached' );
			// rabbit.connections[ data.name ].close();
			// delete rabbit.connections[ data.name ];
			done();
		} ).once();

		rabbit.addConnection( {
			name: 'silly',
			server: 'shfifty-five.gov'
		} );
	} );
} );

// describe( 'with disconnect', function() {

// 	var name = '';
// 	before( function( done ) {
// 		rabbit
// 			.getConnection()
// 			.done( function( connectionName ) {
// 				name = connectionName;
// 				rabbit.closeAll().done( function() {
// 					done();
// 				} );
// 			} );
// 	} );

// 	it( 'should mark connection as closed (not open)', function() {
// 		rabbit.connections[ 'default' ].isAvailable().should.be.false;
// 	} );

// 	describe( 'with a valid exchange', function() {
// 		before( function( done ) {
// 			rabbit.addExchange(
// 				{ 
// 					name: 'pendingExchange',
// 					autoDelete: true,
// 					type: 'fanout'
// 				}, 'default' )
// 				.then( function() {
// 					rabbit.close( 'default' ).done( function() {
// 						done();
// 					} );
// 				} );
// 		} );
// 		var seqNo;
// 		it( 'should be possible to add a pending message', function( done ) {
// 			done();
// 		} );

// 		it( 'should reconnect automatically', function( done ) {
// 			rabbit.getConnection()
// 				.done( function( connection ) {
// 					connection.isAvailable().should.be.true;
// 					done();
// 				} );
// 		} );

// 		it( 'should have published (and removed) the pending message', function( done ) {
// 			//this.timeout( 4000 );
// 			// rabbit.on( 'messageConfirmed', function() {
// 			// 	rabbit.should.have.property( 'pendingMessages' );
// 			// 	( rabbit.pendingMessages[ seqNo ] === undefined ).should.be.true;
// 			// 	done();
// 			// } ).disposeAfter( 1 );
// 		} );
// 	} );

// 	it( 'should reconnect successfully on channel request', function( done ) {
// 		rabbit.getChannel( 'control' )
// 			.done( function( channel ) {
// 				channel.should.be.ok;
// 				done();
// 			} );
// 	} );

// 	after( function( done ) {
// 		rabbit.close( 'default' ).done( function() {
// 			done();
// 		} );
// 	} );
// } );

// describe( 'when getting a connection', function() {

// 	describe( 'and the connection is already open', function() {

// 		before( function( done ) {
// 			open( done, 'reconnect-test.1' );
// 		} );

// 		it( 'should return the open connection', function( done ) {
// 			rabbit.getConnection( 'reconnect-test.1' )
// 				.then( function( conn ) {
// 					conn.name.should.equal( 'reconnect-test.1' );
// 					conn.isOpen.should.be.true;
// 					done();
// 				} );
// 		} );

// 		after( function( done ) {
// 			close( done, false, 'reconnect-test.1' );
// 		} );
// 	} );

// 	describe( 'and this is a new connection request', function() {

// 		it( 'should create a new connection with default settings', function( done ) {
// 			rabbit.getConnection( 'reconnect-test.2' )
// 				.then( function( conn ) {
// 					conn.name.should.equal( 'reconnect-test.2' );
// 					conn.isOpen.should.be.true;
// 					done();
// 				} );
// 		} );
// 	} );

// 	describe( 'with a previously closed connection', function() {

// 		describe( 'with a defined structure', function() {
// 			beforeEach( function( done ) {
// 				// build up test exchanges and queues
// 				var actions = [
// 					function() {
// 						return rabbit.getConnection( 'reconnect-test' );
// 					},
// 					function() {
// 						return rabbit.addExchange( 'ex.20', 'fanout', 
// 							{
// 								autoDelete: true
// 							}, 'reconnect-test' );
// 					},
// 					function() {
// 						return rabbit.addQueue( 'q.20', 
// 							{
// 								autoDelete: true,
// 								subscribe: true
// 							}, 'reconnect-test' );
// 					},
// 					function() {
// 						return rabbit.bindQueue( 'ex.20', 'q.20', '', 'reconnect-test' );
// 					}
// 				];
// 				pipeline( actions )
// 					.then( function() {
// 						close( done, false, 'reconnect-test' );
// 					} );
// 			} );

// 			it( 'should open the connection', function( done ) {
// 				rabbit.getConnection( 'reconnect-test' )
// 					.then( function( conn ) {
// 						conn.name.should.equal( 'reconnect-test' );
// 						conn.isOpen.should.be.true;
// 						done();
// 					} );

// 			} );

// 			it( 'should re-create the same structure', function( done ) {
// 				rabbit.getConnection( 'reconnect-test' )
// 					.then( function( conn ) {
// 						conn.exchanges[ 'ex.20' ].should.be.ok;
// 						conn.queues[ 'q.20' ].should.be.ok;
// 						done();
// 					} );
// 			} );

// 			it( 'should send a message ok', function( done ) {
// 				rabbit.handle( 'ewoks.rule', function( msg ) {
// 					msg.body.should.have.property( 'planet', 'endor' );
// 					done();
// 				} );
// 				exec( 'sleep .01', function( err, stdout, stdinn ) {
// 					rabbit.publish( 'ex.20', 'ewoks.rule', {
// 						planet: 'endor'
// 					}, '', '', 'reconnect-test' );
// 				} );
// 			} );

// 			after( function( done ) {
// 				close( done, true, 'reconnect-test' );
// 			} );
// 		} );

// 		describe( 'with no defined structure', function() {

// 			before( function( done ) {
// 				rabbit.getConnection( 'reconnect-test' )
// 					.then( function() {
// 						rabbit.close( 'reconnect-test' )
// 							.then( function() {
// 								done();
// 							} );
// 					} );
// 			} );

// 			it( 'should open the connection', function() {
// 				rabbit.getConnection( 'reconnect-test' )
// 					.then( function( conn ) {
// 						conn.name.should.equal( 'reconnect-test' );
// 						conn.isOpen.should.be.true;
// 						done();
// 					} );
// 			} );
// 		} );

// 	} );
// } );

// describe( 'closing a connection', function() {
// 	before( function( done ) {
// 		open( done, "coffee" );
// 	} );

// 	it( 'should emit close event', function( done ) {
// 		rabbit.on( 'coffee.connection.closed', function( connection ) {
// 			connection.should.have.property( 'name', 'coffee' );
// 			connection.should.have.property( 'isOpen', true );
// 			done();
// 		} );

// 		rabbit.connections[ 'coffee' ].isOpen.should.be.true;

// 		rabbit.close( 'coffee' );
// 	} );
// } );

// describe( 'with logging', function() {
// 	var del = function( f ) {
// 		return when.promise( function( resolve, reject, notify ) {
// 			if ( fs.existsSync( f ) ) {
// 				fs.unlinkSync( f );
// 			}
// 			resolve();
// 		} )
// 	}
// 	var logPath = './log';
// 	before( function( done ) {
// 		open( done );
// 	} );

// 	after( function( done ) {
// 		del( logPath + '/wascally-debug.log' ).done( function() {
// 			del( logPath + '/wascally-error.log' ).done( function() {
// 				fs.rmdirSync( logPath );
// 				done();
// 			} );
// 		} );
// 	} );

// 	it( 'should be possible to log an error', function( done ) {
// 		rabbit.publish( 'fail', 'fail', {
// 			message: 'fail'
// 		}, 'fail', 'fail', 'fail' );
// 		fs.exists( logPath + '/wascally-error.log', function( exists ) {
// 			exists.should.be.true;
// 			done();
// 		} );
// 	} );

// 	describe( 'when specifying an invalid exchange', function() {
// 		it( 'should log an error if an invalid exchange is specified', function( done ) {
// 			rabbit.on( 'errorLogged', function() {
// 				done();
// 			} ).disposeAfter( 1 );
// 			rabbit.publish( 'invalid exchange', 'invalid.type', {
// 				message: 'hello, world!'
// 			} );
// 		} );
// 	} );
// } );