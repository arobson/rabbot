var chai = require('chai');
chai.use(require('chai-as-promised'));
global.should = chai.should();
global.expect = chai.expect;
global.sinon = require('sinon');
process.title = 'rabbot-test';

global.harnessFactory = function (rabbit, cb, expected) {
  let handlers = [];
  let received = [];
  const unhandled = [];
  const returned = [];
  expected = expected || 1;
  const check = () => {
    if ((received.length + unhandled.length + returned.length) === expected) {
      cb();
    }
  };

  function defaultHandle (message) {
    message.ack();
  }

  function wrap (handle) {
    return (message) => {
      handle(message);
      received.push(message);
      check();
    };
  }

  function handleFn (type, handle, queueName) {
    if (typeof type === 'object') {
      const options = type;
      options.handler = wrap(options.handler || defaultHandle);
      handlers.push(rabbit.handle(options));
    } else {
      handlers.push(rabbit.handle(type, wrap(handle || defaultHandle), queueName));
    }
  }

  function clean (connectionName) {
    handlers.forEach((handle) => {
      handle.remove();
    });
    handlers = [];
    received = [];
    if (connectionName) {
      return rabbit.close(connectionName, true);
    }
  }

  rabbit.onUnhandled((message) => {
    unhandled.push(message);
    message.ack();
    check();
  });

  rabbit.onReturned((message) => {
    returned.push(message);
    check();
  });

  return {
    add: (msg) => {
      received.push(msg);
      check();
    },
    received: received,
    clean: clean,
    handle: handleFn,
    handlers: handlers,
    unhandled: unhandled,
    returned: returned
  };
};

global.sortBy = function (list, prop) {
  list.sort((a, b) => {
    if (a[ prop ] < b[ prop ]) {
      return -1;
    } else if (a[ prop ] > b[ prop ]) {
      return 1;
    } else {
      return 0;
    }
  });
  return list;
};
