require( '../setup.js' );
var when = require( 'when' );
var Promy = require( '../../src/amqp/promiseMachine.js' );

describe( 'Promise Machine', function() {
	describe( 'when working with a stable resource', function() {

		var Test = function() {};

		Test.prototype.sayHi = function( firstName, lastName, city ) {
			return when.promise( function( resolve ) {
				setTimeout( function() {
					resolve( 'Hello, ' + firstName + ' ' + lastName + ' of ' + city );
				}, 10 );
			} );
		};

		var factory = function() {
			return when.promise( function( resolve ) {
				setTimeout( function() {
					resolve( new Test() );
				}, 10 );
			} );
		};

		var machine = new Promy( factory, Test );

		it( 'should resolve the Test sayHi call', function() {
			return machine.sayHi( 'Alex', 'Robson', 'Murfreesboro' )
				.should.eventually.equal( 'Hello, Alex Robson of Murfreesboro' );
		} );

	} );

	describe( 'when acquire fails, retry should occur', function() {
		var Not4You = function() {};

		var rejectCount = 0;
		var factory = function() {
			return when.promise( function( resolve, reject ) {
				setTimeout( function() {
					if ( rejectCount < 3 ) {
						rejectCount++;
						reject( 'No resource 4 You' );
					} else {
						resolve( new Not4You() );
					}
				}, 10 );
			} );
		};

		var machine = new Promy( factory, Not4You );
		var hasFailed = false;
		var hasAcquired = false;

		machine.on( 'failed', function() {
			hasFailed = true;
		} );
		machine.on( 'acquired', function() {
			if ( hasFailed ) {
				hasAcquired = true;
			}
		} );

		it( 'should retry acquire', function( done ) {
			var interval = setInterval( function() {
				if ( hasFailed && hasAcquired ) {
					clearInterval( interval );
					done();
				}
			}, 20 );
		} );
	} );
} );
