import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
  Demonstrates handling by type specification from *any* queue
*/
describe('Type Handling On Any Queue', function () {
  let harness: ReturnType<typeof harnessFactory>;

  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.topic',
          type: 'topic',
          alternate: 'rabbot-ex.alternate',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.topic-1',
          autoDelete: true,
          subscribe: true,
          deadletter: 'rabbot-ex.deadletter'
        },
        {
          name: 'rabbot-q.topic-2',
          autoDelete: true,
          subscribe: true,
          deadletter: 'rabbot-ex.deadletter'
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.topic',
          target: 'rabbot-q.topic-1',
          keys: 'Type.A'
        },
        {
          exchange: 'rabbot-ex.topic',
          target: 'rabbot-q.topic-1',
          keys: 'Type.B'
        }
      ]
    }).then(() => {
      harness = harnessFactory(rabbit, done, 2);
      harness.handle('Type.*');
      Promise.all([
        rabbit.publish('rabbot-ex.topic', { type: 'Type.A', body: 'one' }),
        rabbit.publish('rabbot-ex.topic', { type: 'Type.B', body: 'two' })
      ]);
    });
  }));

  it('should handle messages based on the message type', function () {
    const results = harness.received.map((m: any) =>
      ({
        body: m.body,
        key: m.fields.routingKey
      })
    );
    expect(sortBy(results, 'body')).toEqual(
      [
        { body: 'one', key: 'Type.A' },
        { body: 'two', key: 'Type.B' }
      ]);
  });

  afterAll(function () {
    return harness.clean('default');
  });
});
