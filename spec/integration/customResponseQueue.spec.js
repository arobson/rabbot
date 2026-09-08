import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
#148 / #191: a responder (often cross-language) that doesn't honor
`replyTo` and instead publishes its reply to an exchange/routing key of
its own choosing. This simulates that by having the handler bypass
`req.reply()` entirely and publish directly to a separate exchange,
matching the exact shape of the original bug reports.
*/
describe('Request With A Custom Response Queue', function () {
  let harness;
  let response;

  before(function (done) {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        { name: 'rabbot-ex.customresponse', type: 'fanout', autoDelete: true },
        { name: 'rabbot-ex.customresponse.replies', type: 'topic', autoDelete: true }
      ],
      queues: [
        { name: 'rabbot-q.customresponse', autoDelete: true, subscribe: true }
      ],
      bindings: [
        { exchange: 'rabbot-ex.customresponse', target: 'rabbot-q.customresponse', keys: [] }
      ]
    }).then(() => {
      harness = harnessFactory(rabbit, () => {}, 0);

      harness.handle('foreign.request', (req) => {
        // does not call req.reply() / honor replyTo - replies on its own
        // exchange and routing key instead, as a non-rabbot responder
        // (or one following a different convention) would
        rabbit.publish('rabbot-ex.customresponse.replies', {
          type: 'foreign.reply',
          routingKey: 'foreign.reply.key',
          correlationId: req.properties.messageId,
          body: 'got it: ' + req.body
        });
        req.ack();
      }, 'rabbot-q.customresponse');

      rabbit.request('rabbot-ex.customresponse', {
        type: 'foreign.request',
        body: 'hello',
        responseQueue: {
          exchange: 'rabbot-ex.customresponse.replies',
          key: 'foreign.reply.key'
        }
      }).then((reply) => {
        response = reply.body;
        reply.ack();
        done();
      });
    });
  });

  it('should receive the reply published on the custom exchange/key', function () {
    response.should.equal('got it: hello');
  });

  after(function () {
    return harness.clean('default');
  });
});
