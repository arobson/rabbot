require('../setup');
const rabbit = require('../../src/index.js');
const config = require('./configuration');

describe('Connection', function () {
  describe('on connection', function () {
    var connected;
    before(function (done) {
      rabbit.once('connected', (c) => {
        connected = c;
        done();
      });
      rabbit.configure({ connection: config.connection });
    });

    it('should assign uri to connection', function () {
      connected.uri.should.equal('amqp://guest:guest@127.0.0.1:5672/%2f?heartbeat=30');
    });

    after(function () {
      return rabbit.close('default');
    });
  });
});
