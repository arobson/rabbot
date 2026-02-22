import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import rabbit from '../../src/index.js';

describe('Bad Connection', function () {
  const noop = () => {};
  describe('when attempting a connection', function () {
    let error: any;
    beforeAll(() => new Promise<void>((done) => {
      rabbit.once('silly.connection.failed', (err: any) => { error = err; done(); });
      rabbit.addConnection({ name: 'silly', server: 'shfifty-five.gov', publishTimeout: 50, timeout: 100 }).catch(noop);
      rabbit.addExchange({ name: 'silly-ex' }, 'silly').then(null, noop);
    }));
    it('should fail to connect', () => expect(error.message).toBe('No endpoints could be reached'));
    it('should reject publish after timeout', () => expect(rabbit.publish('silly-ex', { body: 'test' }, 'silly')).rejects.toThrow('No endpoints could be reached'));
    afterAll(() => rabbit.close('silly', true));
  });
  describe('when configuring against a bad connection', function () {
    it('should fail to connect', function () {
      return expect(rabbit.configure({ connection: { name: 'silly2', server: 'this-is-not-a-real-thing-at-all.org', timeout: 100 }, exchanges: [{ name: 'rabbot-ex.direct', type: 'direct', autoDelete: true }], queues: [{ name: 'rabbot-q.direct', autoDelete: true, subscribe: true }], bindings: [{ exchange: 'rabbot-ex.direct', target: 'rabbot-q.direct', keys: '' }] })).rejects.toThrow('No endpoints could be reached');
    });
    afterAll(function () { return rabbit.close('silly2', true); });
  });
});
