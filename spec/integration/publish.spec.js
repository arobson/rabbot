import '../setup.js';
import rabbit from '../../src/index.js';

describe('Publishing Messages', function () {
  describe('without a connection defined', function () {
    it('should reject publish call with missing connection', function () {
      return rabbit.publish('', { type: 'nothing', routingKey: '', body: '', connectionName: 'notthere' })
        .should.be.rejectedWith('Publish failed - no connection notthere has been configured');
    });
  });

  describe('with a connection and no exchange defined', function () {
    it('should reject publish call with missing exchange', function () {
      rabbit.addConnection({});
      return rabbit.publish('missing.ex', { type: 'nothing', routingKey: '', body: '' })
        .should.be.rejectedWith('Publish failed - no exchange missing.ex on connection default is defined');
    });

    after(function () {
      rabbit.reset();
      return rabbit.shutdown();
    });
  });

  describe('with a connection and exchange defined', function () {
    it('should not error on publish calls', function () {
      rabbit.configure({
        connection: {
          name: 'temp'
        },
        exchanges: {
          name: 'simple.ex',
          type: 'direct',
          autoDelete: true
        }
      });
      return rabbit.publish('simple.ex', { type: 'nothing', routingKey: '', body: '', connectionName: 'temp' });
    });

    after(function () {
      return rabbit.deleteExchange('simple.ex', 'temp')
        .then(() => {
          rabbit.reset();
          return rabbit.shutdown();
        });
    });
  });
});
