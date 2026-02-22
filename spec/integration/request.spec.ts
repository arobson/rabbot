import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Request & Response', function () {
  let harness: ReturnType<typeof harnessFactory>;
  beforeAll(function () {
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
    let response1: any;
    let response2: any;
    let response3: any;

    beforeAll(() => new Promise<void>((done) => {
      harness = harnessFactory(rabbit, done, 21);

      harness.handle('polite', (q: any) => {
        q.reply(':D');
      }, 'rabbot-q.request-1');

      harness.handle('rude', (q: any) => {
        q.reply('>:@');
      }, 'rabbot-q.request-1');

      harness.handle('silly', (q: any) => {
        q.reply('...', { more: true });
        q.reply('...', { more: true });
        q.reply('...', { more: true });
        setTimeout(() => q.reply('...'), 10);
      }, 'rabbot-q.request-1');

      rabbit.request('rabbot-ex.request', { type: 'polite', body: 'how are you?' })
        .then((response: any) => {
          response1 = response.body;
          harness.add(response);
          response.ack();
        });

      rabbit.request('rabbot-ex.request', { type: 'rude', body: 'why so dumb?' })
        .then((response: any) => {
          response2 = response.body;
          harness.add(response);
          response.ack();
        });

      function onPart (part: any) {
        response3 = (response3 || '') + part.body;
        part.ack();
        harness.add(part);
      }

      rabbit.request(
        'rabbot-ex.request',
        { type: 'silly', body: 'do you like my yak-hair-shirt?' },
        onPart
      ).then(onPart);
    }), 3000);

    it('should receive multiple responses', function () {
      const results = harness.received.map((m: any) => ({
        body: m.body
      }));
      expect(sortBy(results, 'body')).toEqual(
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
      expect(response1).toBe(':D');
      expect(response2).toBe('>:@');
      expect(response3).toBe('............');
    });

    afterAll(function () {
      harness.clean();
    });
  });

  describe('when performing scatter-gather', function () {
    const gather: any[] = [];
    beforeAll(() => new Promise<void>((done) => {
      harness = harnessFactory(rabbit, done, 7);
      let index = 0;
      harness.handle('scatter', (q: any) => {
        q.reply(`number: ${++index}`);
      });

      function onReply (msg: any) {
        gather.push(msg);
        msg.ack();
      }

      rabbit.request(
        'rabbot-ex.request',
        { type: 'scatter', body: 'whatever', expect: 3 },
        (msg: any) => {
          gather.push(msg);
          msg.ack();
        }
      ).then(
        onReply
      );
    }));

    it('should have gathered desired replies', function () {
      expect(gather.length).toBe(3);
    });

    it('should have ignored responses past limit', function () {
      expect(harness.unhandled.length).toBe(2);
    });

    afterAll(function () {
      harness.clean();
    });
  });

  describe('when the request times out', function () {
    let timeoutError: any;
    const timeout = 100;
    beforeAll(function () {
      return rabbit.request(
        'rabbot-ex.request',
        { type: 'polite', body: 'how are you?', replyTimeout: timeout }
      )
        .then(null, (err: any) => {
          timeoutError = err;
        });
    });

    it('should receive rejection with timeout error', function () {
      expect(timeoutError.message).toEqual(`No reply received within the configured timeout of ${timeout} ms`);
    });
  });

  afterAll(function () {
    return harness.clean('default');
  });
});
