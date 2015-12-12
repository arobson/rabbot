var _ = require( 'lodash' );

module.exports = function emitter( name ) {

	var handlers = {};

	function raise( ev ) {
		if ( handlers[ ev ] ) {
			var args = Array.prototype.slice.call( arguments, 1 );
			_.each( handlers[ ev ], function( handler ) {
				if ( handler ) {
					handler.apply( undefined, args );
				}
			} );
		}
	}

	function on( ev, handle ) {
		if ( handlers[ ev ] ) {
			handlers[ ev ].push( handle );
		} else {
			handlers[ ev ] = [ handle ];
		}
		return { unsubscribe: function( h ) {
				var r = handlers[ ev ].splice( _.indexOf( handlers[ ev ], h || handle ) ); // jshint ignore:line
			} };
	}

	function reset() {
		handlers = {};
	}

	return {
		name: name || 'default',
		handlers: handlers,
		on: on,
		once: on,
		raise: raise,
		reset: reset
	};
};
