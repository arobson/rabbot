import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Random Queue Name', function () {
  let harness: ReturnType<typeof harnessFactory>;
  let queueName: string;
  beforeAll(() => new Promise<void>((done) => {
    rabbit.configure({ connection: config.connection, exchanges: [], queues: [], bindings: [] }).then(() => {
      harness.handle('rando', undefined, queueName);
      rabbit.addQueue('', { autoDelete: true, subscribe: true }).then(function (queue: any) {
        queueName = queue.name;
        rabbit.publish('', { type: 'rando', routingKey: queueName, body: 'one' });
        rabbit.publish('', { type: 'rando', routingKey: queueName, body: Buffer.from('two') });
        rabbit.publish('', { type: 'rando', routingKey: queueName, body: [0x62, 0x75, 0x66, 0x66, 0x65, 0x72] });
      });
    });
    harness = harnessFactory(rabbit, done, 3);
  }));
  it('should deliver all messages to the randomly generated queue', function () {
    const results = harness.received.map((m: any) => ({ body: m.body.toString(), queue: m.queue }));
    expect(sortBy(results, 'body')).toEqual([{ body: '98,117,102,102,101,114', queue: queueName }, { body: 'one', queue: queueName }, { body: 'two', queue: queueName }]);
  });
  afterAll(function () { return harness.clean('default'); });
});
