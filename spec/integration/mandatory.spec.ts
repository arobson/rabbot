import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Undeliverable & Mandatory: true', function () {
  let harness: ReturnType<typeof harnessFactory>;
  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({ connection: config.connection, exchanges: [{ name: 'rabbot-ex.direct', type: 'direct', autoDelete: true }], queues: [{ name: 'rabbot-q.direct', autoDelete: true, subscribe: true }], bindings: [{ exchange: 'rabbot-ex.direct', target: 'rabbot-q.direct', keys: [] }] }).then(() => {
      rabbit.publish('rabbot-ex.direct', { mandatory: true, routingKey: 'completely.un.routable.1', body: 'returned message #1' });
      rabbit.publish('rabbot-ex.direct', { mandatory: true, routingKey: 'completely.un.routable.2', body: 'returned message #2' });
    });
    harness = harnessFactory(rabbit, done, 2);
  }));
  it('should capture all unhandled messages via custom unhandled message strategy', function () {
    const results = harness.returned.map((m: any) => ({ type: m.type, body: m.body }));
    expect(sortBy(results, 'body')).toEqual([{ body: 'returned message #1', type: 'completely.un.routable.1' }, { body: 'returned message #2', type: 'completely.un.routable.2' }]);
  });
  afterAll(function () { return harness.clean('default'); });
});
