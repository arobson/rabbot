import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Fanout Exchange With Multiple Subscribed Queues', function () {
  let harness: ReturnType<typeof harnessFactory>;

  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.fanout',
          type: 'fanout',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.general1',
          autoDelete: true,
          subscribe: true
        },
        {
          name: 'rabbot-q.general2',
          noAck: true,
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.fanout',
          target: 'rabbot-q.general1',
          keys: []
        },
        {
          exchange: 'rabbot-ex.fanout',
          target: 'rabbot-q.general2',
          keys: []
        }
      ]
    }).then(() => {
      rabbit.publish('rabbot-ex.fanout', { type: 'fanned', routingKey: 'this.is.ignored', body: 'hello, everyone' });
    });

    harness = harnessFactory(rabbit, done, 2);
    harness.handle('fanned');
  }));

  it('should handle messages on all subscribed queues', function () {
    const results = harness.received.map((m: any) => ({
      body: m.body,
      key: m.fields.routingKey
    }));
    expect(sortBy(results, 'body')).toEqual(
      [
        { body: 'hello, everyone', key: 'this.is.ignored' },
        { body: 'hello, everyone', key: 'this.is.ignored' }
      ]);
  });

  afterAll(function () {
    return harness.clean('default');
  });
});
