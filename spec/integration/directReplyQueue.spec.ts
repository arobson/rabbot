import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe(`Direct Reply Queue (replyQueue: 'rabbit')`, function () {
  let messagesToSend: number;
  let harness: ReturnType<typeof harnessFactory>;
  const replies: any[] = [];

  beforeAll(() => new Promise<void>((done) => {
    harness = harnessFactory(rabbit, () => {}, messagesToSend);
    rabbit.configure({
      connection: config.directReplyQueue,
      exchanges: [
        {
          name: 'noreply-ex.direct',
          type: 'direct',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'noreply-q.direct',
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'noreply-ex.direct',
          target: 'noreply-q.direct',
          keys: ''
        }
      ]
    }).then(() => {
      messagesToSend = 3;
      harness.handle('no.replyQueue', (req: any) => {
        req.reply({ reply: req.body.message });
      });
      for (let i = 0; i < messagesToSend; i++) {
        rabbit.request('noreply-ex.direct', {
          connectionName: 'directReplyQueue',
          type: 'no.replyQueue',
          body: { message: i },
          routingKey: ''
        })
          .then(
            (r: any) => {
              replies.push(r.body.reply);
              r.ack();
              if (replies.length >= messagesToSend) {
                done();
              }
            }
          );
      }
    });
  }));

  it('should receive all replies', function () {
    expect(harness.received.length).toBe(messagesToSend);
    expect(replies).toEqual([0, 1, 2]);
  });

  afterAll(function () {
    return harness.clean('directReplyQueue');
  });
});
