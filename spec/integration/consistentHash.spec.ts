import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Consistent Hash Exchange', function () {
  let limit: number;
  let harness: ReturnType<typeof harnessFactory>;
  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({ connection: config.connection, exchanges: [{ name: 'rabbot-ex.consistent-hash', type: 'x-consistent-hash', autoDelete: true, arguments: { 'hash-header': 'CorrelationId' } }], queues: [{ name: 'rabbot-q.hashed1', autoDelete: true, subscribe: true }, { name: 'rabbot-q.hashed2', autoDelete: true, subscribe: true }, { name: 'rabbot-q.hashed3', autoDelete: true, subscribe: true }, { name: 'rabbot-q.hashed4', autoDelete: true, subscribe: true }], bindings: [{ exchange: 'rabbot-ex.consistent-hash', target: 'rabbot-q.hashed1', keys: '100' }, { exchange: 'rabbot-ex.consistent-hash', target: 'rabbot-q.hashed2', keys: '100' }, { exchange: 'rabbot-ex.consistent-hash', target: 'rabbot-q.hashed3', keys: '100' }, { exchange: 'rabbot-ex.consistent-hash', target: 'rabbot-q.hashed4', keys: '100' }] }).then(() => {
      limit = 1000;
      harness = harnessFactory(rabbit, done, limit);
      harness.handle('balanced');
      for (let i = 0; i < limit; i++) { rabbit.publish('rabbot-ex.consistent-hash', { type: 'balanced', correlationId: (i + i).toString(), body: 'message ' + i }); }
    });
  }));
  it('should distribute messages across queues within margin for error', function () {
    const consumers = harness.received.reduce((acc: Record<string, number>, m: any) => { const key = m.fields.consumerTag; if (acc[key]) { acc[key]++; } else { acc[key] = 1; } return acc; }, {});
    const quarter = limit / 4;
    const margin = quarter / 4;
    const counts = Object.keys(consumers).map((k) => consumers[k]);
    counts.forEach((count) => { expect(Math.abs(count - quarter)).toBeLessThanOrEqual(margin); });
    expect(counts.reduce((acc: number, x: number) => acc + x, 0)).toBe(limit);
  });
  afterAll(function () { return harness.clean('default'); });
});
