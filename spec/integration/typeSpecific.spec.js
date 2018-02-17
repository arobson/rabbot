require('../setup');
const rabbit = require('../../src/index.js');
const config = require('./configuration');

/*
  Demonstrates handling by type specification from *any* queue
*/
describe('Type Handling On Any Queue', function () {
  var harness;

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
          name: 'rabbot-q.topic-1',
          autoDelete: true,
          subscribe: true,
          deadletter: 'rabbot-ex.deadletter'
        },
        {
          name: 'rabbot-q.topic-2',
          autoDelete: true,
          subscribe: true,
          deadletter: 'rabbot-ex.deadletter'
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.topic',
          target: 'rabbot-q.topic-1',
          keys: 'Type.A'
        },
        {
          exchange: 'rabbot-ex.topic',
          target: 'rabbot-q.topic-1',
          keys: 'Type.B'
        }
      ]
    }).then(() => {
      harness = harnessFactory(rabbit, done, 2);
      harness.handle('Type.*');
      Promise.all([
        rabbit.publish('rabbot-ex.topic', { type: 'Type.A', body: 'one' }),
        rabbit.publish('rabbot-ex.topic', { type: 'Type.B', body: 'two' })
      ]);
    });
  });

  it('should handle messages based on the message type', function () {
    const results = harness.received.map((m) =>
      ({
        body: m.body,
        key: m.fields.routingKey
      })
    );
    sortBy(results, 'body').should.eql(
      [
        { body: 'one', key: 'Type.A' },
        { body: 'two', key: 'Type.B' }
      ]);
  });

  after(function () {
    return harness.clean('default');
  });
});
