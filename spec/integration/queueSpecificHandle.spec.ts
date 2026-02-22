import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory, sortBy } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Queue Specific Handler', function () {
  describe('with standard queues', function () {
    let harness: ReturnType<typeof harnessFactory>;
    beforeAll(() => new Promise<void>((done) => {
      rabbit.configure({ connection: config.connection, exchanges: [{ name: 'rabbot-ex.fanout', type: 'fanout', autoDelete: true }], queues: [{ name: 'rabbot-q.general1', autoDelete: true, subscribe: true }, { name: 'rabbot-q.general2', noAck: true, autoDelete: true, subscribe: true }], bindings: [{ exchange: 'rabbot-ex.fanout', target: 'rabbot-q.general1', keys: [] }, { exchange: 'rabbot-ex.fanout', target: 'rabbot-q.general2', keys: [] }] }).then(() => {
        rabbit.publish('rabbot-ex.fanout', { type: '', routingKey: '', body: 'one' });
        rabbit.publish('rabbot-ex.fanout', { type: '', routingKey: '', body: 'two' });
        rabbit.publish('rabbot-ex.fanout', { type: '', routingKey: '', body: 'three' });
      });
      harness = harnessFactory(rabbit, done, 6);
      harness.handle('', undefined, 'rabbot-q.general1');
    }));
    it('should only handle messages for the specified queue', function () {
      const results = harness.received.map((m: any) => ({ body: m.body, queue: m.queue }));
      expect(sortBy(results, 'body')).toEqual([{ body: 'one', queue: 'rabbot-q.general1' }, { body: 'three', queue: 'rabbot-q.general1' }, { body: 'two', queue: 'rabbot-q.general1' }]);
    });
    it('should show the other messages as unhandled', function () { expect(harness.unhandled.length).toEqual(3); });
    afterAll(function () { return harness.clean('default'); });
  });
  describe('with unique queue', function () {
    let harness: ReturnType<typeof harnessFactory>;
    beforeAll(() => new Promise<void>((done) => {
      rabbit.configure({ connection: config.connection, exchanges: [{ name: 'rabbot-ex.topic', type: 'topic', autoDelete: true }], queues: [{ name: 'rabbot-q.general1', autoDelete: true, unique: 'hash', subscribe: true }, { name: 'rabbot-q.general2', noAck: true, autoDelete: true, subscribe: true }], bindings: [{ exchange: 'rabbot-ex.topic', target: 'rabbot-q.general1', keys: ['a'] }, { exchange: 'rabbot-ex.topic', target: 'rabbot-q.general2', keys: ['b'] }] }).then(() => {
        rabbit.publish('rabbot-ex.topic', { type: 'a', body: 'one' });
        rabbit.publish('rabbot-ex.topic', { type: 'b', body: 'two' });
        rabbit.publish('rabbot-ex.topic', { type: 'a', body: 'three' });
        rabbit.publish('rabbot-ex.topic', { type: 'b', body: 'four' });
        rabbit.publish('rabbot-ex.topic', { type: 'a', body: 'five' });
        rabbit.publish('rabbot-ex.topic', { type: 'b', body: 'six' });
      });
      harness = harnessFactory(rabbit, done, 6);
      harness.handle('a', undefined, 'rabbot-q.general1');
    }));
    it('should only handle messages for the specified queue', function () {
      const uniqueName = (rabbit as any).getQueue('rabbot-q.general1').uniqueName;
      const results = harness.received.map((m: any) => ({ body: m.body, queue: m.queue }));
      expect(sortBy(results, 'body')).toEqual([{ body: 'five', queue: uniqueName }, { body: 'one', queue: uniqueName }, { body: 'three', queue: uniqueName }]);
    });
    it('should show the other messages as unhandled', function () { expect(harness.unhandled.length).toEqual(3); });
    afterAll(function () { return harness.clean('default'); });
  });
});
