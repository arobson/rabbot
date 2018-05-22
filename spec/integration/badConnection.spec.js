require('../setup');
const rabbit = require('../../src/index.js');

describe('Bad Connection', function () {
  const noop = () => {};
  describe('when attempting a connection', function () {
    var error;
    before((done) => {
      rabbit.once('#.connection.failed', (err) => {
        error = err;
        done();
      });

      rabbit.addConnection({
        name: 'silly',
        server: 'shfifty-five.gov',
        publishTimeout: 50,
        timeout: 100
      }).catch(noop);

      rabbit.addExchange({ name: 'silly-ex' }, 'silly').then(null, noop);
    });

    it('should fail to connect', () =>
      error.should.equal('No endpoints could be reached')
    );

    it('should reject publish after timeout', () =>
      rabbit.publish('silly-ex', { body: 'test' }, 'silly')
        .should.be.rejectedWith('No endpoints could be reached')
    );

    after(() => rabbit.close('silly', true));
  });

  describe('when configuring against a bad connection', function () {
    var config;
    before(() => {
      config = {
        connection: {
          name: 'silly2',
          server: 'this-is-not-a-real-thing-at-all.org',
          timeout: 100
        },
        exchanges: [
          {
            name: 'rabbot-ex.direct',
            type: 'direct',
            autoDelete: true
          }
        ],
        queues: [
          {
            name: 'rabbot-q.direct',
            autoDelete: true,
            subscribe: true
          }
        ],
        bindings: [
          {
            exchange: 'rabbot-ex.direct',
            target: 'rabbot-q.direct',
            keys: ''
          }
        ]
      };
    });

    it('should fail to connect', function () {
      return rabbit.configure(config)
        .should.be.rejectedWith('No endpoints could be reached');
    });

    after(function () {
      return rabbit.close('silly2', true);
    });
  });
});
