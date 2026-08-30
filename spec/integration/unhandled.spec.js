import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Unhandled Strategies', function () {
  /*
  This specification only works because the harness supplies
  a custom unhandled strategy for rabbot in `setup.js`:

    rabbit.onUnhandled( ( message ) => {
      unhandled.push( message );
      message.ack();
      check();
    } );

  This allows it to capture any unhandled messages as such
  and test accordingly.
  */

  describe('Custom Strategy - Capturing Messages With No Handler', function () {
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
        rabbit.publish('rabbot-ex.direct', { type: 'junk', routingKey: '', body: 'uh oh' });
        rabbit.publish('rabbot-ex.direct', { type: 'garbage', routingKey: '', body: 'uh oh' });
      });

      harness = harnessFactory(rabbit, done, 2);
    });

    it('should capture all unhandled messages via custom unhandled message strategy', function () {
      const results = harness.unhandled.map((m) => ({
        body: m.body,
        type: m.type
      }));
      sortBy(results, 'type').should.eql(
        [
          { body: 'uh oh', type: 'garbage' },
          { body: 'uh oh', type: 'junk' }
        ]);
    });

    after(function () {
      return harness.clean('default');
    });
  });

  /*
  This spec uses the `rejectUnhandled` strategy and demonstrates
  how one might reject unhandled messages to a catch-all queue
  via deadlettering for logging or processing.
  */
  describe('Rejecting Unhandled Messages To A Deadletter', function () {
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
            name: 'rabbot-ex.deadletter',
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
            name: 'rabbot-q.deadletter',
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
            exchange: 'rabbot-ex.deadletter',
            target: 'rabbot-q.deadletter',
            keys: []
          }
        ]
      }).then(() => {
        harness = harnessFactory(rabbit, done, 1);
        rabbit.rejectUnhandled();
        harness.handle({ queue: 'rabbot-q-deadletter' });
        rabbit.publish(
          'rabbot-ex.topic',
          {
            type: 'noonecares',
            routingKey: 'this.is.rejection',
            body: 'haters gonna hate'
          }
        );
      });
    });

    it('should reject and then receive the message from dead-letter queue', function () {
      const results = harness.received.map((m) =>
        ({
          body: m.body,
          key: m.fields.routingKey,
          exchange: m.fields.exchange
        })
      );
      results.should.eql(
        [
          { body: 'haters gonna hate', key: 'this.is.rejection', exchange: 'rabbot-ex.deadletter' }
        ]);
    });

    after(function () {
      return harness.clean('default');
    });
  });
});
