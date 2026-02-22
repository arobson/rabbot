import { describe, it, afterAll, expect } from 'vitest';
import rabbit from '../../src/index.js';

describe('Publishing Messages', function () {
  describe('without a connection defined', function () {
    it('should reject publish call with missing connection', function () {
      return expect(rabbit.publish('', { type: 'nothing', routingKey: '', body: '', connectionName: 'notthere' })).rejects.toThrow('Publish failed - no connection notthere has been configured');
    });
  });
  describe('with a connection and no exchange defined', function () {
    it('should reject publish call with missing exchange', function () {
      rabbit.addConnection({});
      return expect(rabbit.publish('missing.ex', { type: 'nothing', routingKey: '', body: '' })).rejects.toThrow('Publish failed - no exchange missing.ex on connection default is defined');
    });
    afterAll(function () { return rabbit.close('default', true); });
  });
  describe('with a connection and exchange defined', function () {
    it('should not error on publish calls', function () {
      rabbit.configure({ name: 'temp', connection: { name: 'temp' }, exchanges: { name: 'simple.ex', type: 'direct', autoDelete: true } });
      return rabbit.publish('simple.ex', { type: 'nothing', routingKey: '', body: '', connectionName: 'temp' });
    });
    afterAll(function () { return rabbit.deleteExchange('simple.ex', 'temp').then(() => rabbit.close('temp', true)); });
  });
});
