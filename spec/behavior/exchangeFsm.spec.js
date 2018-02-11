require('../setup.js');
const exchangeFsm = require('../../src/exchangeFsm');
const emitter = require('./emitter');
const defer = require('../../src/defer');
const noop = () => {};
const _ = require('lodash');

function exchangeFn (options) {
  var channel = {
    name: options.name,
    type: options.type,
    channel: emitter(),
    define: noop,
    release: noop,
    publish: noop
  };
  var channelMock = sinon.mock(channel);

  return {
    mock: channelMock,
    factory: function () {
      return Promise.resolve(channel);
    }
  };
}

describe('Exchange FSM', function () {
  describe('when connection is unreachable', function () {
    var connection, topology, exchange, channelMock, options, error;
    var published;
    before(function (done) {
      options = { name: 'test', type: 'test' };
      connection = emitter();
      connection.addExchange = noop;
      topology = emitter();

      var ex = exchangeFn(options);
      channelMock = ex.mock;
      channelMock
        .expects('define')
        .once()
        .returns({ then: noop });

      exchange = exchangeFsm(options, connection, topology, {}, ex.factory);
      published = [ 1, 2, 3 ].map(() => exchange.publish({}).then(null, e => e.message));
      exchange.once('failed', function (err) {
        error = err;
        done();
      }).once();
      connection.raise('unreachable');
    });

    it('should have emitted failed with an error', function () {
      return error.toString().should.equal('Error: Could not establish a connection to any known nodes.');
    });

    it('should reject all published promises', function () {
      return published.map((promise) =>
        promise.should.eventually.equal('Could not establish a connection to any known nodes.')
      );
    });

    it('should be in unreachable state', function () {
      exchange.state.should.equal('unreachable');
    });

    describe('when publishing in unreachable state', function () {
      var error;

      before(function () {
        return exchange.publish({}).catch(function (err) {
          error = err;
        });
      });

      it('should reject publish with an error', function () {
        error.toString().should.equal('Error: Could not establish a connection to any known nodes.');
      });

      it('should clean up the "failed" subscription', function () {
        exchange._subscriptions.failed.should.have.lengthOf(0);
      });
    });

    describe('when checking in unreachable state', function () {
      it('should reject check with an error', function () {
        return exchange.check().should.be.rejectedWith('Could not establish a connection to any known nodes.');
      });
    });
  });

  describe('when definition has failed with error', function () {
    var connection, topology, exchange, channelMock, options;
    var published;
    before(function () {
      options = { name: 'test', type: 'test' };
      connection = emitter();
      connection.addExchange = noop;
      topology = emitter();

      var ex = exchangeFn(options);
      channelMock = ex.mock;
      var deferred = defer();
      channelMock
        .expects('define')
        .once()
        .returns(deferred.promise);

      exchange = exchangeFsm(options, connection, topology, {}, ex.factory);
      published = [ 1, 2, 3 ].map(() =>
        exchange.publish({})
          .then(null, (err) => err.message)
      );
      deferred.reject(new Error('nope'));
      return Promise.all(published);
    });

    it('should be in failed state', function () {
      exchange.state.should.equal('failed');
    });

    it('should reject all published promises', function () {
      published.forEach((promise) => {
        promise.should.eventually.equal('nope');
      });
    });

    describe('when publishing in unreachable state', function () {
      var error;

      before(function () {
        return exchange.publish({}).catch(function (err) {
          error = err;
        });
      });

      it('should reject publish with an error', function () {
        error.toString().should.equal('Error: nope');
      });

      it('should clean up the "failed" subscription', function () {
        exchange._subscriptions.failed.should.have.lengthOf(0);
      });
    });

    describe('when checking in unreachable state', function () {
      it('should reject check with an error', function () {
        return exchange.check().should.be.rejectedWith('nope');
      });
    });
  });

  describe('when initializing succeeds', function () {
    var connection, topology, exchange, ex, channelMock, options, error;

    before(function (done) {
      options = { name: 'test', type: 'test' };
      connection = emitter();
      connection.addExchange = noop;
      topology = emitter();

      ex = exchangeFn(options);
      channelMock = ex.mock;
      channelMock
        .expects('define')
        .once()
        .returns(Promise.resolve());

      exchange = exchangeFsm(options, connection, topology, {}, ex.factory);
      exchange.on('failed', function (err) {
        error = err;
        done();
      }).once();
      exchange.on('defined', function () {
        done();
      }).once();
    });

    it('should not have failed', function () {
      should.not.exist(error);
    });

    it('should be in ready state', function () {
      exchange.state.should.equal('ready');
    });

    describe('when publishing in ready state', function () {
      var promise;

      before(function () {
        channelMock
          .expects('publish')
          .once()
          .returns(Promise.resolve(true));

        promise = exchange.publish({});

        return promise;
      });

      it('should resolve publish without error', function () {
        return promise.should.be.fulfilled;
      });

      it('should clean up the "failed" subscription', function () {
        // Should only have a single failed subscription from the outer "before" block
        exchange._subscriptions.failed.should.have.lengthOf(1);
      });
    });

    describe('when checking in ready state', function () {
      it('should resolve check without error', function () {
        exchange.check().should.be.fulfilled; // eslint-disable-line no-unused-expressions
      });
    });

    describe('when channel is closed', function () {
      before(function (done) {
        channelMock
          .expects('define')
          .once()
          .returns(Promise.resolve());

        exchange.on('defined', function () {
          done();
        }).once();

        exchange.once('closed', function () {
          exchange.check();
        });

        ex.factory().then(function (e) {
          e.channel.raise('closed');
        });
      });

      it('should reinitialize without error', function () {
        should.not.exist(error);
      });
    });

    describe('when releasing', function () {
      before(function () {
        exchange.published.add({});
        exchange.published.add({});
        exchange.published.add({});

        channelMock
          .expects('release')
          .once()
          .resolves();

        process.nextTick(function () {
          exchange.published.remove({ sequenceNo: 0 });
          exchange.published.remove({ sequenceNo: 1 });
          exchange.published.remove({ sequenceNo: 2 });
        });

        return exchange.release();
      });

      it('should remove handlers from topology and connection', function () {
        _.flatten(_.values(connection.handlers)).length.should.equal(1);
        _.flatten(_.values(topology.handlers)).length.should.equal(0);
      });

      it('should release channel instance', function () {
        should.not.exist(exchange.channel);
      });

      describe('when publishing to a released channel', function () {
        before(function () {
          channelMock
            .expects('define')
            .never();

          channelMock
            .expects('publish')
            .never();
        });

        it('should reject publish', function () {
          return exchange.publish({}).should.be.rejectedWith(`Cannot publish to exchange 'test' after intentionally closing its connection`);
        });

        it('should not make any calls to underlying exchange channel', function () {
          channelMock.verify();
        });
      });
    });

    after(function () {
      connection.reset();
      topology.reset();
      channelMock.restore();
    });
  });
});
