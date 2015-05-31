var gulp = require( 'gulp' );
var bg = require( 'biggulp' )( gulp );

gulp.task( 'coverage', bg.withCoverage() );

gulp.task( 'coverage-watch', function() {
	bg.watch( [ 'coverage' ] );
} );

gulp.task( 'show-coverage', bg.showCoverage() );

gulp.task( 'continuous-test', function() {
	return bg.test();
} );

gulp.task( 'test-watch', function() {
	bg.watch( [ 'continuous-test' ] );
} );

gulp.task( 'test-and-exit', function() {
	return bg.testOnce();
} );

gulp.task( 'default', [ 'coverage', 'coverage-watch' ], function() {} );
gulp.task( 'test', [ 'continuous-test', 'test-watch' ], function() {} );
gulp.task( 'build', [ 'test-and-exit' ] );
