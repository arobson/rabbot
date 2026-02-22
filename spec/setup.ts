process.title = 'rabbot-test';

import type rabbit from '../src/index.js';

export function harnessFactory(
  rabbitInstance: typeof rabbit,
  cb: () => void,
  expected = 1
) {
  let handlers: { off: () => void }[] = [];
  const received: unknown[] = [];
  const unhandled: unknown[] = [];
  const returned: unknown[] = [];

  const check = () => {
    if ((received.length + unhandled.length + returned.length) === expected) {
      cb();
    }
  };

  function defaultHandle(message: { ack: () => void }) {
    message.ack();
  }

  function wrap(handle: (msg: unknown) => void) {
    return (message: unknown) => {
      handle(message);
      received.push(message);
      check();
    };
  }

  function handleFn(type: string | { handler?: (msg: unknown) => void; [key: string]: unknown }, handle?: (msg: unknown) => void, queueName?: string) {
    if (typeof type === 'object') {
      const options = { ...type, handler: wrap(type.handler || defaultHandle) };
      handlers.push((rabbitInstance as unknown as { handle: (opts: unknown) => { off: () => void } }).handle(options));
    } else {
      handlers.push((rabbitInstance as unknown as { handle: (type: string, handler: (msg: unknown) => void, queue?: string) => { off: () => void } }).handle(type, wrap(handle || defaultHandle), queueName));
    }
  }

  (rabbitInstance as unknown as { onUnhandled: (fn: (msg: unknown) => void) => void }).onUnhandled((message) => {
    unhandled.push(message);
    (message as { ack: () => void }).ack();
    check();
  });

  (rabbitInstance as unknown as { onReturned: (fn: (msg: unknown) => void) => void }).onReturned((message) => {
    returned.push(message);
    check();
  });

  return {
    add: (msg: unknown) => { received.push(msg); check(); },
    received,
    clean: (connectionName?: string) => {
      handlers.forEach(h => h.off());
      handlers = [];
      received.length = 0;
      if (connectionName) {
        return (rabbitInstance as unknown as { close: (name: string, reset: boolean) => Promise<void> }).close(connectionName, true);
      }
    },
    handle: handleFn,
    handlers,
    unhandled,
    returned,
  };
}

export function sortBy<T>(list: T[], prop: keyof T): T[] {
  list.sort((a, b) => {
    if (a[prop] < b[prop]) return -1;
    if (a[prop] > b[prop]) return 1;
    return 0;
  });
  return list;
}
