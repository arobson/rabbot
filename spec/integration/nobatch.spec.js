import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Batch Acknowledgments Disabled (noBatch: true)', function () {
  let messagesToSend;
  let harness;

  before(function (done) {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.no-batch',
          type: 'direct',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.no-batch',
          autoDelete: true,
          subscribe: true,
          noBatch: true,
          limit: 5
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.no-batch',
          target: 'rabbot-q.no-batch'
        }
      ]
    }).then(() => {
      messagesToSend = 10;
      harness = harnessFactory(rabbit, done, messagesToSend);
      let messageCount = 0;

      harness.handle('no.batch', (message) => {
        if (messageCount > 0) {
          message.ack();
        }
        messageCount += 1;
      });

      for (let i = 0; i < messagesToSend; i++) {
        rabbit.publish('rabbot-ex.no-batch', {
          type: 'no.batch',
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
