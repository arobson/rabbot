import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
A promise, twice made, is not a promise for more,
it's simply reassurance for the insecure.
*/
describe('Duplicate Subscription', function () {
  let harness: ReturnType<typeof harnessFactory>;

  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.subscription',
          type: 'topic',
          alternate: 'rabbot-ex.alternate',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.subscription',
          autoDelete: true,
          subscribe: true,
          deadletter: 'rabbot-ex.deadletter'
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.subscription',
          target: 'rabbot-q.subscription',
          keys: 'this.is.#'
        }
      ]
    }).then(() => {
      harness.handle('topic');
      rabbit.startSubscription('rabbot-q.subscription');
      rabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' });
      rabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' });
      rabbit.publish('rabbot-ex.subscription', { type: 'topic', routingKey: 'this.is.not.wine.wtf', body: 'socrates' });
    });
    harness = harnessFactory(rabbit, done, 3);
  }));

  it('should handle all messages once', function () {
    const results = harness.received.map((m: any) =>
      ({
        body: m.body,
        key: m.fields.routingKey
      })
    );
    expect(sortBy(results, 'body')).toEqual(
      [
        { body: 'broadcast', key: 'this.is.a.test' },
        { body: 'leonidas', key: 'this.is.sparta' },
        { body: 'socrates', key: 'this.is.not.wine.wtf' }
      ]);
  });

  afterAll(function () {
    return harness.clean('default');
  });
});
