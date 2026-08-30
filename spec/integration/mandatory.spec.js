import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
This specificationd demonstrates the returned callback strategy.
The harness provides a default returned handler that captures
returned messages and adds them to a list.
*/
describe('Undeliverable & Mandatory: true', function () {
  let harness;

  before(function (done) {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.direct',
          type: 'direct',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.direct',
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.direct',
          target: 'rabbot-q.direct',
          keys: []
        }
      ]
    }).then(() => {
      rabbit.publish('rabbot-ex.direct', { mandatory: true, routingKey: 'completely.un.routable.1', body: 'returned message #1' });
      rabbit.publish('rabbot-ex.direct', { mandatory: true, routingKey: 'completely.un.routable.2', body: 'returned message #2' });
    });

    harness = harnessFactory(rabbit, done, 2);
  });

  it('should capture all unhandled messages via custom unhandled message strategy', function () {
    const results = harness.returned.map((m) => ({
      type: m.type,
      body: m.body
    }));
    sortBy(results, 'body').should.eql(
      [
        { body: 'returned message #1', type: 'completely.un.routable.1' },
        { body: 'returned message #2', type: 'completely.un.routable.2' }
      ]);
  });

  after(function () {
    return harness.clean('default');
  });
});
