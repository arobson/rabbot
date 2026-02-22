import defer from './defer.js';

interface Message {
  sequenceNo?: number;
  [key: string]: unknown;
}

interface PublishState {
  count: number;
  messages: Record<number, Message>;
  sequenceNumber: number;
  waiting?: ReturnType<typeof defer<number>>;
}

function add(state: PublishState, m: Message): void {
  if (!m.sequenceNo) {
    const mSeq = next(state);
    m.sequenceNo = mSeq;
    state.messages[mSeq] = m;
  }
}

function next(state: PublishState): number {
  state.count++;
  return state.sequenceNumber++;
}

function getEmptyPromise(state: PublishState): Promise<number> {
  if (state.count) {
    const deferred = defer<number>();
    state.waiting = deferred;
    return deferred.promise;
  } else {
    return Promise.resolve(0);
  }
}

function resolveWaiting(state: PublishState): void {
  if (state.waiting) {
    setTimeout(() => {
      state.waiting!.resolve(state.count);
      state.waiting = undefined;
    }, state.sequenceNumber);
  }
}

function rejectWaiting(state: PublishState): void {
  if (state.waiting) {
    state.waiting.reject();
    state.waiting = undefined;
  }
}

function remove(state: PublishState, m: Message | number): boolean {
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

function reset(state: PublishState): Message[] {
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

export interface PublishLog {
  add: (m: Message) => void;
  count: () => number;
  onceEmptied: () => Promise<number>;
  reset: () => Message[];
  remove: (m: Message | number) => boolean;
  state: PublishState;
}

export default function publishLog(): PublishLog {
  const state: PublishState = {
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
