module.exports = function emitter( name ) {

	var handlers = {};

	function raise( ev ) {
		if ( handlers[ ev ] ) {
			handlers[ ev ].apply( undefined, Array.prototype.slice.call( arguments, 1 ) );
		}
	}

	function on( ev, handle ) {
		handlers[ ev ] = handle;
		return { unsubscribe: function() {
				delete handlers[ ev ];
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
