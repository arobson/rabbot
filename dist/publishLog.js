import defer from './defer.js';
function add(state, m) {
    if (!m.sequenceNo) {
        const mSeq = next(state);
        m.sequenceNo = mSeq;
        state.messages[mSeq] = m;
    }
}
function next(state) {
    state.count++;
    return state.sequenceNumber++;
}
function getEmptyPromise(state) {
    if (state.count) {
        const deferred = defer();
        state.waiting = deferred;
        return deferred.promise;
    }
    else {
        return Promise.resolve(0);
    }
}
function resolveWaiting(state) {
    if (state.waiting) {
        setTimeout(() => {
            state.waiting.resolve(state.count);
            state.waiting = undefined;
        }, state.sequenceNumber);
    }
}
function rejectWaiting(state) {
    if (state.waiting) {
        state.waiting.reject();
        state.waiting = undefined;
    }
}
function remove(state, m) {
    const mSeq = typeof m === 'number' ? m : m.sequenceNo;
    let removed = false;
    if (mSeq !== undefined && state.messages[mSeq]) {
        const msg = state.messages[mSeq];
        delete state.messages[mSeq];
        delete msg.sequenceNo;
        state.count--;
        removed = true;
    }
    if (state.count === 0) {
        resolveWaiting(state);
    }
    return removed;
}
function reset(state) {
    const keys = Object.keys(state.messages).map(Number);
    const list = keys.map((key) => {
        const m = state.messages[key];
        delete m.sequenceNo;
        return m;
    });
    state.sequenceNumber = 0;
    state.messages = {};
    state.count = 0;
    rejectWaiting(state);
    return list;
}
export default function publishLog() {
    const state = {
        count: 0,
        messages: {},
        sequenceNumber: 0,
        waiting: undefined,
    };
    return {
        add: add.bind(undefined, state),
        count: () => Object.keys(state.messages).length,
        onceEmptied: getEmptyPromise.bind(undefined, state),
        reset: reset.bind(undefined, state),
        remove: remove.bind(undefined, state),
        state,
    };
}
//# sourceMappingURL=publishLog.js.map