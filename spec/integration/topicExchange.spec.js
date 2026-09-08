import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
  In this test it is worth noting the setup and the topics
  of the messages as they're sent as well as the queues of
  the messages in the test results.

  I set them up this way to demonstrate some more advanced
  routing techniques within rabbit and also test that all of
  this works when in use in rabbot.
*/
describe('Topic Exchange With Alternate Bindings', function () {
  let harness;

  before(function (done) {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.topic',
          type: 'topic',
          alternate: 'rabbot-ex.alternate',
          autoDelete: true
        },
        {
          name: 'rabbot-ex.alternate',
          type: 'fanout',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.topic',
          autoDelete: true,
          subscribe: true,
          deadletter: 'rabbot-ex.deadletter'
        },
        {
          name: 'rabbot-q.alternate',
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.topic',
          target: 'rabbot-q.topic',
          keys: 'this.is.*'
        },
        {
          exchange: 'rabbot-ex.alternate',
          target: 'rabbot-q.alternate',
          keys: []
        }
      ]
    }).then(() => {
      // this message only arrives via the alternate
      rabbit.publish('rabbot-ex.topic', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' });
      // this message is deliver by the topic route
      rabbit.publish('rabbot-ex.topic', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' });
      // this message only arrives via the alternate
      rabbit.publish('rabbot-ex.topic', { type: 'topic', routingKey: 'a.test.this.is', body: 'yoda' });
    });

    harness = harnessFactory(rabbit, done, 3);
    harness.handle('topic');
  });

  it('should receive matched an unmatched topics due to alternate exchange', function () {
    const results = harness.received.map((m) => ({
      body: m.body,
      key: m.fields.routingKey,
      queue: m.queue
    }));
    sortBy(results, 'body').should.eql(
      [
        { body: 'broadcast', key: 'this.is.a.test', queue: 'rabbot-q.alternate' },
        { body: 'leonidas', key: 'this.is.sparta', queue: 'rabbot-q.topic' },
        { body: 'yoda', key: 'a.test.this.is', queue: 'rabbot-q.alternate' }
      ]);
  });

  after(function () {
    return harness.clean('default');
  });
});
