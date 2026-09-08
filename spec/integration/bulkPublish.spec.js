import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
 Demonstrates how bulk publish API works
 in both formats.
*/
describe('Bulk Publish', function () {
  let harness;

  before(function (done) {
    this.timeout(10000);
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.direct-1',
          type: 'direct',
          autoDelete: true
        },
        {
          name: 'rabbot-ex.direct-2',
          type: 'direct',
          autoDelete: true
        },
        {
          name: 'rabbot-ex.direct-3',
          type: 'direct',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.1',
          autoDelete: true,
          subscribe: true
        },
        {
          name: 'rabbot-q.2',
          autoDelete: true,
          subscribe: true
        },
        {
          name: 'rabbot-q.3',
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.direct-1',
          target: 'rabbot-q.1',
          keys: ''
        },
        {
          exchange: 'rabbot-ex.direct-2',
          target: 'rabbot-q.2',
          keys: ''
        },
        {
          exchange: 'rabbot-ex.direct-3',
          target: 'rabbot-q.3',
          keys: ''
        }
      ]
    });
    harness = harnessFactory(rabbit, done, 18);
    harness.handle('bulk');
    rabbit.bulkPublish({
      'rabbot-ex.direct-1': [
        { type: 'bulk', routingKey: '', body: 1 },
        { type: 'bulk', routingKey: '', body: 2 },
        { type: 'bulk', routingKey: '', body: 3 }
      ],
      'rabbot-ex.direct-2': [
        { type: 'bulk', routingKey: '', body: 4 },
        { type: 'bulk', routingKey: '', body: 5 },
        { type: 'bulk', routingKey: '', body: 6 }
      ],
      'rabbot-ex.direct-3': [
        { type: 'bulk', routingKey: '', body: 7 },
        { type: 'bulk', routingKey: '', body: 8 },
        { type: 'bulk', routingKey: '', body: 9 }
      ]
    });

    rabbit.bulkPublish([
      { type: 'bulk', routingKey: '', body: 10, exchange: 'rabbot-ex.direct-1' },
      { type: 'bulk', routingKey: '', body: 11, exchange: 'rabbot-ex.direct-1' },
      { type: 'bulk', routingKey: '', body: 12, exchange: 'rabbot-ex.direct-2' },
      { type: 'bulk', routingKey: '', body: 13, exchange: 'rabbot-ex.direct-2' },
      { type: 'bulk', routingKey: '', body: 14, exchange: 'rabbot-ex.direct-2' },
      { type: 'bulk', routingKey: '', body: 15, exchange: 'rabbot-ex.direct-2' },
      { type: 'bulk', routingKey: '', body: 16, exchange: 'rabbot-ex.direct-3' },
      { type: 'bulk', routingKey: '', body: 17, exchange: 'rabbot-ex.direct-3' },
      { type: 'bulk', routingKey: '', body: 18, exchange: 'rabbot-ex.direct-3' }
    ]);
  });

  it('should bulk publish all messages successfully', function () {
    const results = harness.received.map((m) => (
      parseInt(m.body)
    ));
    results.sort((a, b) => a - b).should.eql(
      [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18
      ]);
  });

  after(function () {
    return harness.clean('default');
  });
});
