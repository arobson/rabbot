var gulp = require( 'gulp' ),
	mocha = require( 'gulp-mocha' ),
	processhost = require( 'processhost' )(),
	exec = require("child_process").exec;

gulp.task( 'test', function() {
	gulp.src( './spec/*.spec.js' )
		.pipe( mocha( { reporter: 'spec' } ) )
		.on( 'error', function( err ) { console.log( err.stack ); } );
} );

gulp.task( 'sleep-and-test', function() {
	exec("sleep 2", function(error, stdout, stderr) {
		gulp.src( './spec/*.spec.js' )
			.pipe( mocha( { reporter: 'spec' } ) )
			.on( 'error', function( err ) { console.log( err.stack ); } );
	});
} );

gulp.task( 'watch', function() {
	gulp.watch( [ './src/**', './spec/**' ], [ 'restart', 'test' ] );
} );

gulp.task( 'restart', function() {
	console.log( 'restarting application' );
	processhost.restart();
});

gulp.task( 'host', function() {
	processhost.startProcess( 'rabbit', {
		command: 'rabbitmq-server',
		args: [],
		stdio: 'inherit'
	} );
} );

gulp.task( 'default', [ 'host', 'watch', 'sleep-and-test' ], function() {
} );