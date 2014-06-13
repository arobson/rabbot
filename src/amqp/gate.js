var _ = require( 'lodash' ),
	when = require( 'when' ),
	machina = require( 'machina' )( _ );

var Gate = machina.Fsm.extend( {
	enqueue: function( fn ) {
		var op = { operation: fn },
			promise = when.promise( function( resolve, reject ) {
				op.resolve = resolve;
				op.reject = reject;
			} );
		this.handle( 'call', op );
		return promise;
	},
	initialState: 'ready',
	states: {
		'waiting': {
			call: function( op ) {
				this.deferUntilTransition( op );
			}
		},
		'ready': {
			call: function( op ) {
				var p = op.operation();
				p
					.then( function( x ) {
						op.resolve( x );
						this.transition( 'ready' );
					}.bind( this ) )
					.then( null, function( err ) {
						op.reject( err );
						this.transition( 'ready' );
					}.bind( this ) );
				this.transition( 'waiting' );
			}
		}
	}
} );

module.exports = Gate;