require('../setup');
const rabbit = require('../../src/index.js');
const config = require('./configuration');

/*
A promise, twice made, is not a promise for more,
it's simply reassurance for the insecure.
*/
describe('Duplicate Subscription', function () {
  var harness;

  before(function (done) {
    rabbit.configure({
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
    }).then(() => {
      harness.handle('topic');
      rabbit.startSubscription('rabbot-q.subscription');
      rabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' });
      rabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' });
      rabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.not.wine.wtf', body: 'socrates' });
    });
    harness = harnessFactory(rabbit, done, 3);
  });

  it('should handle all messages once', function () {
    const results = harness.received.map((m) =>
      ({
        body: m.body,
        key: m.fields.routingKey
      })
    );
    sortBy(results, 'body').should.eql(
      [
        { body: 'broadcast', key: 'this.is.a.test' },
        { body: 'leonidas', key: 'this.is.sparta' },
        { body: 'socrates', key: 'this.is.not.wine.wtf' }
      ]);
  });

  after(function () {
    return harness.clean('default');
  });
});
