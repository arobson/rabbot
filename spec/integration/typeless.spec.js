import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
  Demonstrates handling Messages With No Type Provided
*/
describe('No Type Handling', function () {
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
        }
      ],
      queues: [
        {
          name: 'rabbot-q.topic',
          autoDelete: true,
          subscribe: true,
          deadletter: 'rabbot-ex.deadletter'
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.topic',
          target: 'rabbot-q.topic',
          keys: 'this.is.*'
        }
      ]
    }).then(() => {
      harness = harnessFactory(rabbit, done, 1);
      harness.handle('#.typeless');
      rabbit.publish('rabbot-ex.topic', { type: '', routingKey: 'this.is.typeless', body: 'one' });
    });
  });

  it('should handle messages based on the message topic instead of type', function () {
    const results = harness.received.map((m) =>
      ({
        body: m.body,
        key: m.fields.routingKey
      })
    );
    sortBy(results, 'body').should.eql(
      [
        { body: 'one', key: 'this.is.typeless' }
      ]);
  });

  after(function () {
    return harness.clean('default');
  });
});
