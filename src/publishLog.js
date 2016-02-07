var _ = require( "lodash" );
var when = require( "when" );

function add( state, m ) {
	if ( !state.messages.sequenceNo ) {
		var mSeq = next( state );
		m.sequenceNo = mSeq;
		state.messages[ mSeq ] = m;
	}
}

function next( state ) {
	state.count++;
	return ( state.sequenceNumber++ );
}

function getEmptyPromise( state ) {
	if( state.count ) {
		var deferred = when.defer();
		state.waiting = deferred;
		return deferred.promise;
	} else {
		return when.resolve();
	}	
}

function resolveWaiting( state ) {
	if( state.waiting ) {
		setTimeout( function() {
			state.waiting.resolve( state.count );
			state.waiting = undefined;
		}, state.sequenceNumber );
	}
}

function rejectWaiting( state ) {
	if( state.waiting ) {
		state.waiting.reject();
		state.waiting = undefined;
	}
}

function remove( state, m ) {
	var mSeq = m.sequenceNo !== undefined ? m.sequenceNo : m;
	var removed = false;
	if ( state.messages[ mSeq ] ) {
		delete state.messages[ mSeq ];
		state.count--;
		removed = true;
	}
	if( state.count === 0 ) {
		resolveWaiting( state );
	}
	return removed;
}

function reset( state ) {
	var list = _.map( state.messages, function( m ) {
		delete m.sequenceNo;
		return m;
	} );
	state.sequenceNumber = 0;
	state.messages = {};
	state.count = 0;
	rejectWaiting( state );
	return list;
}


function publishLog() {
	var state = {
		count: 0,
		messages: {},
		sequenceNumber: 0,
		waiting: undefined
	};

	return {
		add: add.bind( undefined, state ),
		count: function() {
			return Object.keys( state.messages ).length;
		},
		onceEmptied: getEmptyPromise.bind( undefined, state ),
		reset: reset.bind( undefined, state ),
		remove: remove.bind( undefined, state ),
		state: state
	};
}

module.exports = publishLog;
