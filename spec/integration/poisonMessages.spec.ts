import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
  When garbage is in the queue from a publisher
  rabbot should reject the unprocessable/busted
  message instead of melting down the process
*/
describe('Invalid Message Format', function () {
  let harness: ReturnType<typeof harnessFactory>;

  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
        {
          name: 'rabbot-ex.fanout',
          type: 'fanout',
          autoDelete: true
        },
        {
          name: 'poison-ex',
          type: 'fanout',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'rabbot-q.general1',
          autoDelete: true,
          subscribe: true,
          deadletter: 'poison-ex'
        },
        {
          name: 'rabbot-q.poison',
          noAck: true,
          autoDelete: true,
          subscribe: true,
          poison: true
        }
      ],
      bindings: [
        {
          exchange: 'rabbot-ex.fanout',
          target: 'rabbot-q.general1',
          keys: []
        },
        {
          exchange: 'poison-ex',
          target: 'rabbot-q.poison',
          keys: []
        }
      ]
    }).then(() => {
      rabbit.publish('rabbot-ex.fanout', {
        type: 'yuck',
        routingKey: '',
        body: 'lol{":parse this',
        contentType: 'application/json'
      });
    });

    harness = harnessFactory(rabbit, done, 1);
    harness.handle('yuck.quarantined');
  }));

  it('should have quarantined messages in unhandled', function () {
    const results = harness.received.map((m: any) => ({
      body: m.body.toString(),
      key: m.fields.routingKey,
      quarantined: m.quarantined
    }));
    expect(sortBy(results, 'body')).toEqual(
      [
        {
          key: '',
          body: 'lol{":parse this',
          quarantined: true
        }
      ]
    );
  });

  afterAll(function () {
    return harness.clean('default');
  });
});
