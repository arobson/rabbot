import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Message Acknowledgments Disabled (noAck: true)', function () {
  let messagesToSend;
  let harness;

  before(function (done) {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.no-ack',
          type: 'direct',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.no-ack',
          autoDelete: true,
          subscribe: true,
          noAck: true,
          limit: 5
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.no-ack',
          target: 'rabbot-q.no-ack'
        }
      ]
    }).then(() => {
      messagesToSend = 10;
      harness = harnessFactory(rabbit, done, messagesToSend);
      harness.handle('no.ack');

      for (let i = 0; i < messagesToSend; i++) {
        rabbit.publish('rabbot-ex.no-ack', {
          type: 'no.ack',
          body: 'message ' + i,
          routingKey: ''
        });
      }
    });
  });

  it('should receive all messages', function () {
    harness.received.length.should.equal(messagesToSend);
  });

  after(function () {
    return harness.clean('default');
  });
});
