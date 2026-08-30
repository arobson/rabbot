import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Unroutable Messages - Alternate Exchanges', function () {
  let harness;

  before(function (done) {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.deadend',
          type: 'fanout',
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
          name: 'rabbot-q.alternate',
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.alternate',
          target: 'rabbot-q.alternate',
          keys: []
        }
      ]
    }).then(() => {
      rabbit.publish('rabbot-ex.deadend', { type: 'deadend', routingKey: 'empty', body: 'one' });
      rabbit.publish('rabbot-ex.deadend', { type: 'deadend', routingKey: 'nothing', body: 'two' });
      rabbit.publish('rabbot-ex.deadend', { type: 'deadend', routingKey: 'de.nada', body: 'three' });
    });

    harness = harnessFactory(rabbit, done, 3);
    harness.handle('deadend');
  });

  it('should capture all unrouted messages via the alternate exchange and queue', function () {
    const results = harness.received.map((m) => ({
      body: m.body,
      key: m.fields.routingKey
    }));
    sortBy(results, 'body').should.eql(
      [
        { body: 'one', key: 'empty' },
        { body: 'three', key: 'de.nada' },
        { body: 'two', key: 'nothing' }
      ]);
  });

  after(function () {
    return harness.clean('default');
  });
});
