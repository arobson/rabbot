require('../setup');
const Rabbit = require('../../src/index.js');
const rabbit = new Rabbit();
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
      const con = config.connection;
      connected.uri.should.equal(`amqp://${con.user}:${con.pass}@${con.host}:${con.port}/${con.vhost}?heartbeat=30`);
    });

    after(function () {
      return rabbit.close('default');
    });
  });
});
