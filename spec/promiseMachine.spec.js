require( 'should' );

var when = require( 'when' ),
	Promy = require( '../src/amqp/promiseMachine.js' );

describe( 'when working with a stable resource', function() {

	var Test = function() {

	};

	Test.prototype.sayHi = function( firstName, lastName, city ) {
		return when.promise( function( resolve, reject ) {
			setTimeout( function() {
				resolve( 'Hello, ' + firstName + ' ' + lastName + ' of ' + city );
			}, 100 );
		} );
	};

	var factory = function() {
		return when.promise( function( resolve, reject ) {
			setTimeout( function() {
				resolve( new Test() );
			}, 100 );
		} );
	};

	var machine = new Promy( factory, Test );

	it( 'should resolve the Test sayHi call', function( done ) {
		machine.sayHi( 'Alex', 'Robson', 'Murfreesboro' )
			.then( function( message ) {
				message.should.eql( 'Hello, Alex Robson of Murfreesboro' );
				done();
			} );
	} );

} );

describe( 'when acquiire fails, retry should occur', function() {
	var Not4You = function() {

	};

	var rejectCount = 0;
	var factory = function() {
		return when.promise( function( resolve, reject ) {
			setTimeout( function() {
				if (rejectCount < 3) {
					rejectCount++;
					reject( "No resource 4 You" );
				} else {
					resolve(new Not4You());
				}
			}, 100 );
		} );
	};

	var machine = new Promy( factory, Not4You );
	var hasFailed = false;
	var hasAcquired = false;

	machine.on('failed', function() {
		hasFailed = true;
	});
	machine.on('acquired', function () {
		if (hasFailed) {
			hasAcquired = true;
		}
	});

	it( 'should retry acquire', function( done ) {
		var interval = setInterval(function () {
			if (hasFailed && hasAcquired) {
				clearInterval(interval);
				done();
			}
		}, 200);
	} );


} );
