import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('No Reply Queue (replyQueue: false)', function () {
  const messagesToSend = 3;
  let harness: ReturnType<typeof harnessFactory>;

  beforeAll(() => new Promise<void>((done) => {
    harness = harnessFactory(rabbit, done, messagesToSend);
    rabbit.configure({
      connection: config.noReplyQueue,
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
      harness.handle('no.replyQueue');
      for (let i = 0; i < messagesToSend; i++) {
        rabbit.publish('noreply-ex.direct', {
          connectionName: 'noReplyQueue',
          type: 'no.replyQueue',
          body: 'message ' + i,
          routingKey: ''
        });
      }
    });
  }));

  it('should receive all messages', function () {
    expect(harness.received.length).toBe(messagesToSend);
  });

  afterAll(function () {
    return harness.clean('noReplyQueue');
  });
});
