import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Rejecting Messages To A Deadletter', function () {
  let harness: ReturnType<typeof harnessFactory>;
  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({
      connection: config.connection,
      exchanges: [{ name: 'rabbot-ex.topic', type: 'topic', alternate: 'rabbot-ex.alternate', autoDelete: true }, { name: 'rabbot-ex.deadletter', type: 'fanout', autoDelete: true }],
      queues: [{ name: 'rabbot-q.topic', autoDelete: true, subscribe: true, deadletter: 'rabbot-ex.deadletter' }, { name: 'rabbot-q.deadletter', autoDelete: true, subscribe: true }],
      bindings: [{ exchange: 'rabbot-ex.topic', target: 'rabbot-q.topic', keys: 'this.is.*' }, { exchange: 'rabbot-ex.deadletter', target: 'rabbot-q.deadletter', keys: [] }]
    }).then(() => {
      harness = harnessFactory(rabbit, done, 2);
      harness.handlers.push(rabbit.handle('reject', (env: any) => {
        if (harness.received.length < 2) { env.reject(); } else { env.ack(); }
        harness.add(env);
      }));
      rabbit.publish('rabbot-ex.topic', { type: 'reject', routingKey: 'this.is.rejection', body: 'haters gonna hate' });
    });
  }));
  it('should receive the message from bound queue and dead-letter queue', function () {
    const results = harness.received.map((m: any) => ({ body: m.body, key: m.fields.routingKey, exchange: m.fields.exchange }));
    expect(results).toEqual([{ body: 'haters gonna hate', key: 'this.is.rejection', exchange: 'rabbot-ex.topic' }, { body: 'haters gonna hate', key: 'this.is.rejection', exchange: 'rabbot-ex.deadletter' }]);
  });
  afterAll(function () { return harness.clean('default'); });
});
