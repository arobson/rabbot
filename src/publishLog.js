var _ = require( 'lodash' );

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

function remove( state, m ) {
	var mSeq = m.sequenceNo !== undefined ? m.sequenceNo : m;
	if ( state.messages[ mSeq ] ) {
		delete state.messages[ mSeq ];
		state.count--;
		return true;
	}
	return false;
}

function reset( state ) {
	var list = _.map( state.messages, function( m ) {
		delete m.sequenceNo;
		return m;
	} );
	state.sequenceNumber = 0;
	state.messages = {};
	state.count = 0;
	return list;
}


function publishLog() {
	var state = {
		count: 0,
		messages: {},
		sequenceNumber: 0
	};

	return {
		add: add.bind( undefined, state ),
		count: function() {
			return state.count;
		},
		reset: reset.bind( undefined, state ),
		remove: remove.bind( undefined, state )
	};
}

module.exports = publishLog;
