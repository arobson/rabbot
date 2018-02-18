require('../setup');
const rabbit = require('../../src/index.js');
const config = require('./configuration');

describe('Request & Response', function () {
  var harness;
  before(function () {
    return rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.request',
          type: 'fanout',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.request-1',
          autoDelete: true,
          subscribe: true
        },
        {
          name: 'rabbot-q.request-2',
          autoDelete: true,
          subscribe: true
        },
        {
          name: 'rabbot-q.request-3',
          autoDelete: true,
          subscribe: true
        },
        {
          name: 'rabbot-q.request-4',
          autoDelete: true,
          subscribe: true
        },
        {
          name: 'rabbot-q.request-5',
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.request',
          target: 'rabbot-q.request-1',
          keys: []
        },
        {
          exchange: 'rabbot-ex.request',
          target: 'rabbot-q.request-2',
          keys: []
        },
        {
          exchange: 'rabbot-ex.request',
          target: 'rabbot-q.request-3',
          keys: []
        },
        {
          exchange: 'rabbot-ex.request',
          target: 'rabbot-q.request-4',
          keys: []
        },
        {
          exchange: 'rabbot-ex.request',
          target: 'rabbot-q.request-5',
          keys: []
        }
      ]
    });
  });

  describe('when getting a response within the timeout', function () {
    var response1;
    var response2;
    var response3;

    before(function (done) {
      this.timeout(3000);
      harness = harnessFactory(rabbit, done, 21);

      harness.handle('polite', (q) => {
        q.reply(':D');
      }, 'rabbot-q.request-1');

      harness.handle('rude', (q) => {
        q.reply('>:@');
      }, 'rabbot-q.request-1');

      harness.handle('silly', (q) => {
        q.reply('...', { more: true });
        q.reply('...', { more: true });
        q.reply('...', { more: true });
        setTimeout(() => q.reply('...'), 10);
      }, 'rabbot-q.request-1');

      rabbit.request('rabbot-ex.request', { type: 'polite', body: 'how are you?' })
        .then((response) => {
          response1 = response.body;
          harness.add(response);
          response.ack();
        });

      rabbit.request('rabbot-ex.request', { type: 'rude', body: 'why so dumb?' })
        .then((response) => {
          response2 = response.body;
          harness.add(response);
          response.ack();
        });

      function onPart (part) {
        response3 = (response3 || '') + part.body;
        part.ack();
        harness.add(part);
      }

      rabbit.request(
        'rabbot-ex.request',
        { type: 'silly', body: 'do you like my yak-hair-shirt?' },
        onPart
      ).then(onPart);
    });

    it('should receive multiple responses', function () {
      var results = harness.received.map((m) => ({
        body: m.body
      }));
      sortBy(results, 'body').should.eql(
        [
          { body: '...' },
          { body: '...' },
          { body: '...' },
          { body: '...' },
          { body: ':D' },
          { body: '>:@' },
          { body: 'do you like my yak-hair-shirt?' },
          { body: 'how are you?' },
          { body: 'why so dumb?' }
        ]);
    });

    it('should capture responses corresponding to the originating request', function () {
      response1.should.equal(':D');
      response2.should.equal('>:@');
      response3.should.equal('............');
    });

    after(function () {
      harness.clean();
    });
  });

  describe('when performing scatter-gather', function () {
    const gather = [];
    before(function (done) {
      harness = harnessFactory(rabbit, () => {}, 4);
      let index = 0;
      harness.handle('scatter', (q) => {
        q.reply(`number: ${++index}`);
      });

      function onReply (msg) {
        gather.push(msg);
        msg.ack();
        done();
      }

      rabbit.request(
        'rabbot-ex.request',
        { type: 'scatter', body: 'whatever', expect: 3 },
        (msg) => {
          gather.push(msg);
          msg.ack();
        }
      ).then(
        onReply
      );
    });

    it('should have gathered desired replies', function () {
      gather.length.should.equal(3);
    });

    it('should have ignored responses past limit', function () {
      harness.unhandled.length.should.equal(2);
    });

    after(function () {
      harness.clean();
    });
  });

  describe('when the request times out', function () {
    var timeoutError;
    const timeout = 100;
    before(function () {
      return rabbit.request(
        'rabbot-ex.request',
        { type: 'polite', body: 'how are you?', replyTimeout: timeout }
      )
        .then(null, (err) => {
          timeoutError = err;
        });
    });

    it('should receive rejection with timeout error', function () {
      timeoutError.message.should.eql(`No reply received within the configured timeout of ${timeout} ms`);
    });
  });

  after(function () {
    return harness.clean('default');
  });
});
