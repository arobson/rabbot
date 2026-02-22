import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Unroutable Messages - Alternate Exchanges', function () {
  let harness: ReturnType<typeof harnessFactory>;

  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.deadend',
          type: 'fanout',
          alternate: 'rabbot-ex.alternate',
          autoDelete: true
        },
        {
          name: 'rabbot-ex.alternate',
          type: 'fanout',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.alternate',
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.alternate',
          target: 'rabbot-q.alternate',
          keys: []
        }
      ]
    }).then(() => {
      rabbit.publish('rabbot-ex.deadend', { type: 'deadend', routingKey: 'empty', body: 'one' });
      rabbit.publish('rabbot-ex.deadend', { type: 'deadend', routingKey: 'nothing', body: 'two' });
      rabbit.publish('rabbot-ex.deadend', { type: 'deadend', routingKey: 'de.nada', body: 'three' });
    });

    harness = harnessFactory(rabbit, done, 3);
    harness.handle('deadend');
  }));

  it('should capture all unrouted messages via the alternate exchange and queue', function () {
    const results = harness.received.map((m: any) => ({
      body: m.body,
      key: m.fields.routingKey
    }));
    expect(sortBy(results, 'body')).toEqual(
      [
        { body: 'one', key: 'empty' },
        { body: 'three', key: 'de.nada' },
        { body: 'two', key: 'nothing' }
      ]);
  });

  afterAll(function () {
    return harness.clean('default');
  });
});
