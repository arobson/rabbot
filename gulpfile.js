var gulp = require( 'gulp' );
var mocha = require( 'gulp-mocha' );
var processhost = require( 'processhost' )();
var exec = require( 'child_process' ).exec;
var istanbul = require( 'gulp-istanbul' );
var open = require( 'open' ); //jshint ignore : line

function cover( done ) {
	gulp.src( [ './src/**/*.js' ] )
		.pipe( istanbul() )
		.pipe( istanbul.hookRequire() )
		.on( 'finish', function() {
			done( runSpecs() );
		} );
}

function runSpecs() { // jshint ignore : line
	return gulp.src( [ './spec/behavior/*.spec.js', './spec/integration/integration.spec.js' ], { read: false } )
		.pipe( mocha( { reporter: 'spec' } ) );
}

function writeReport( cb, openBrowser, tests ) {
	tests
		.on( 'error', function( e ) {
			console.log( 'error occurred during testing', e.stack );
		} )
		.pipe( istanbul.writeReports() )
		.on( 'end', function() {
			if ( openBrowser ) {
				open( './coverage/lcov-report/index.html' );
			}
			cb();
		} );
}

gulp.task( 'continuous-coverage', function( cb ) {
	cover( writeReport.bind( undefined, cb, false ) );
} );

gulp.task( 'continuous-test', function() {
	return runSpecs()
		.on( 'end', function() {
			// console.log( process._getActiveRequests() );
			// console.log( process._getActiveHandles() );
		} );
} );

gulp.task( 'coverage', function( cb ) {
	cover( writeReport.bind( undefined, cb, true ) );
} );

gulp.task( 'coverage-watch', function() {
	gulp.watch( [ './src/**/*', './spec/**/*' ], [ 'continuous-coverage' ] );
} );

gulp.task( 'test', function() {
	return runSpecs()
		.on( 'end', process.exit.bind( process, 0 ) )
		.on( 'error', process.exit.bind( process, 1 ) );
} );

gulp.task( 'sleep-and-test', function() {
	exec( "sleep 2", function( error, stdout, stderr ) {
		runSpecs()
			.on( 'end', function() {
				// console.log( process._getActiveRequests() );
				// console.log( process._getActiveHandles() );
			} );
	} );
} );

gulp.task( 'host-watch', function() {
	gulp.watch( [ './src/**', './spec/**' ], [ 'restart', 'test' ] );
} );

gulp.task( 'restart', function() {
	console.log( 'restarting application' );
	processhost.restart();
} );

gulp.task( 'host', function() {
	processhost.startProcess( 'rabbit', {
		command: 'rabbitmq-server',
		args: [],
		stdio: 'inherit'
	} );
} );

gulp.task( 'test-watch', function() {
	gulp.watch( [ './src/**/*', './spec/**/*' ], [ 'continuous-test' ] );
} );

gulp.task( 'default', [ 'continuous-coverage', 'coverage-watch' ], function() {} );

// gulp.task( 'specs', [ 'continuous-test', 'test-watch' ], function() {} );
gulp.task( 'specs', [ 'continuous-test', 'test-watch' ], function() {} );

gulp.task( 'server', [ 'host', 'host-watch', 'sleep-and-test' ], function() {} );
