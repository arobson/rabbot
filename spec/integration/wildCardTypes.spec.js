require('../setup');
const rabbit = require('../../src/index.js');
const config = require('./configuration');

/*
  Demonstrates handling types based on wild card matching.
  Note that only 3 of four messages published match the pattern
  provided.
*/
describe('Wild Card Type Handling', function () {
  var harness;

  before(function () {
    harness = harnessFactory(rabbit, () => {}, 3);
    harness.handle('#.a');
    return rabbit.configure({
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
    }).then(() =>
      Promise.all([
        rabbit.publish('rabbot-ex.topic', { type: 'one.a', routingKey: 'this.is.one', body: 'one' }),
        rabbit.publish('rabbot-ex.topic', { type: 'two.i.a', routingKey: 'this.is.two', body: 'two' }),
        rabbit.publish('rabbot-ex.topic', { type: 'three-b.a', routingKey: 'this.is.three', body: 'three' }),
        rabbit.publish('rabbot-ex.topic', { type: 'a.four', routingKey: 'this.is.four', body: 'four' })
      ])
    );
  });

  it('should handle all message types ending in "a"', function () {
    const results = harness.received.map((m) =>
      ({
        body: m.body,
        key: m.fields.routingKey
      })
    );
    sortBy(results, 'body').should.eql(
      [
        { body: 'one', key: 'this.is.one' },
        { body: 'three', key: 'this.is.three' },
        { body: 'two', key: 'this.is.two' }
      ]);
  });

  it("should not handle message types that don't match the pattern", function () {
    harness.unhandled.length.should.equal(1);
    harness.unhandled[ 0 ].body.should.eql('four');
  });

  after(function () {
    return harness.clean('default');
  });
});
