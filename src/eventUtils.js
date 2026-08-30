import createLog from './log.js';

const log = createLog('rabbot.events');

// topic-dispatch's emit() returns a Promise<any[]> that rejects if any
// subscribed handler's async work throws. Every call site that treats
// emit as synchronous fire-and-forget (the norm throughout this codebase)
// needs a .catch() so a listener's failure can't produce an unhandled
// rejection - this is just standard hygiene for a promise-returning API,
// not a workaround for a library defect.
export function safeEmit (bus, topic, data) {
  const result = bus.emit(topic, data);
  if (result && typeof result.catch === 'function') {
    result.catch(err => {
      log.error(`Unhandled error from a '${topic}' listener: ${err && err.stack ? err.stack : err}`);
    });
  }
  return result;
}
