require('../setup');
const Rabbit = require('../../src/index.js');
const config = require('./configuration');

const firstRabbit = new Rabbit();
const secondRabbit = new Rabbit();

const configs = {
  instance_1: {
    connection: config.connection,
    exchanges: [
      {
        name: 'rabbot-ex.subscription',
        type: 'topic',
        alternate: 'rabbot-ex.alternate',
        autoDelete: true
      }
    ],
    queues: [
      {
        name: 'rabbot-q.subscription',
        autoDelete: true,
        subscribe: true,
        deadletter: 'rabbot-ex.deadletter'
      }
    ],
    bindings: [
      {
        exchange: 'rabbot-ex.subscription',
        target: 'rabbot-q.subscription',
        keys: 'this.is.#'
      }
    ]
  },
  instance_2: {
    connection: config.differentVhost,
    exchanges: [
      {
        name: 'rabbot-ex.subscription',
        type: 'topic',
        alternate: 'rabbot-ex.alternate',
        autoDelete: true
      }
    ],
    queues: [
      {
        name: 'rabbot-q.subscription',
        autoDelete: true,
        subscribe: true,
        deadletter: 'rabbot-ex.deadletter'
      }
    ],
    bindings: [
      {
        exchange: 'rabbot-ex.subscription',
        target: 'rabbot-q.subscription',
        keys: 'this.is.#'
      }
    ]
  }
};

describe('Multiple Instances', function () {
  var firstHarness, secondHarness;

  before(function (done) {
    new Promise(function (resolve, reject) {
      firstRabbit.configure(configs.instance_1).then(() => {
        firstHarness.handle('topic');
        firstRabbit.startSubscription('rabbot-q.subscription');
        firstRabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' });
      });

      firstHarness = harnessFactory(firstRabbit, resolve, 1);
    }).then(function () {
      secondRabbit.configure(configs.instance_2).then(() => {
        secondHarness.handle('topic');
        secondRabbit.startSubscription('rabbot-q.subscription', false, 'differentVhost');
        secondRabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.a.different.test', body: 'broadcast' }, 'differentVhost');
        secondRabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.a.different.test2', body: 'broadcast' }, 'differentVhost');
      });

      secondHarness = harnessFactory(secondRabbit, done, 1);
    });
  });

  it('should not recieve the same message', function () {
    const filterMsg = (m) =>
      ({
        body: m.body,
        key: m.fields.routingKey
      });

    const firstResults = firstHarness.received.map(filterMsg);
    const secondResults = secondHarness.received.map(filterMsg);

    sortBy(firstResults, 'body').should.eql(
      [
        { body: 'broadcast', key: 'this.is.a.test' }
      ]
    );

    sortBy(secondResults, 'body').should.eql(
      [
        { body: 'broadcast', key: 'this.is.a.different.test' },
        { body: 'broadcast', key: 'this.is.a.different.test2' }
      ]
    );
  });

  after(function () {
    return firstHarness.clean('default').then(function () {
      return secondHarness.clean('differentVhost');
    });
  });
});
