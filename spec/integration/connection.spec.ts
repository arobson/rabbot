import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import rabbit from '../../src/index.js';
import config from './configuration.js';

describe('Connection', function () {
  describe('on connection', function () {
    let connected: any;
    beforeAll(() => new Promise<void>((done) => {
      rabbit.once('connected', (c: any) => { connected = c; done(); });
      rabbit.configure({ connection: config.connection });
    }));
    it('should assign uri to connection', function () {
      expect(connected.uri).toBe('amqp://guest:guest@127.0.0.1:5672/%2f?heartbeat=30');
    });
    afterAll(function () { return rabbit.close('default'); });
  });
});
