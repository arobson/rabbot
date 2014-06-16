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