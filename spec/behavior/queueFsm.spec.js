require('../setup.js');
var _ = require('lodash');
var queueFsm = require('../../src/queueFsm');
var noOp = function () {};
var emitter = require('./emitter');

function channelFn (options) {
  var channel = {
    name: options.name,
    type: options.type,
    channel: emitter(),
    define: noOp,
    destroy: noOp,
    finalize: noOp,
    purge: noOp,
    release: noOp,
    getMessageCount: noOp,
    subscribe: noOp,
    unsubscribe: noOp
  };
  var channelMock = sinon.mock(channel);

  return {
    mock: channelMock,
    factory: function () {
      return Promise.resolve(channel);
    }
  };
}

describe('Queue FSM', function () {
  describe('when initialization fails', function () {
    var connection, topology, queue, channelMock, options, error;

    before(function (done) {
      options = { name: 'test', type: 'test' };
      connection = emitter();
      connection.addQueue = noOp;
      topology = emitter();

      var ch = channelFn(options);
      channelMock = ch.mock;
      channelMock
        .expects('define')
        .once()
        .returns(Promise.reject(new Error('nope')));

      queue = queueFsm(options, connection, topology, {}, ch.factory);
      queue.on('failed', function (err) {
        error = err;
        done();
      }).once();
    });

    it('should have failed with an error', function () {
      error.toString().should.equal('Error: nope');
    });

    it('should be in failed state', function () {
      queue.state.should.equal('failed');
    });

    describe('when subscribing in failed state', function () {
      it('should reject subscribe with an error', function () {
        return queue.subscribe().should.be.rejectedWith(/nope/);
      });
    });

    describe('when purging in failed state', function () {
      it('should reject purge with an error', function () {
        return queue.purge().should.be.rejectedWith(/nope/);
      });
    });

    describe('when checking in failed state', function () {
      it('should reject check with an error', function () {
        return queue.check().should.be.rejectedWith(/nope/);
      });
    });
  });

  describe('when initializing succeeds', function () {
    var connection, topology, queue, ch, channelMock, options, error;

    before(function (done) {
      options = { name: 'test', type: 'test' };
      connection = emitter();
      connection.addQueue = noOp;
      topology = emitter();

      ch = channelFn(options);
      channelMock = ch.mock;
      channelMock
        .expects('define')
        .once()
        .resolves(true);

      queue = queueFsm(options, connection, topology, {}, ch.factory);
      queue.once('failed', function (err) {
        error = err;
        done();
      }).once();
      queue.once('defined', function () {
        done();
      }).once();
    });

    it('should not have failed', function () {
      should.not.exist(error);
    });

    it('should be in ready state', function () {
      queue.state.should.equal('ready');
    });

    describe('when subscribing in ready state', function () {
      before(function () {
        channelMock
          .expects('subscribe')
          .once()
          .resolves(true);
      });

      it('should resolve subscribe without error', function () {
        queue.subscribe();
        return queue.subscribe().should.be.fulfilled;
      });

      it('should change options.subscribe to true', function () {
        options.subscribe.should.equal(true);
      });

      it('should be in subscribed state', function () {
        queue.state.should.equal('subscribed');
      });
    });

    describe('when purging in ready state', function () {
      before(function () {
        channelMock
          .expects('purge')
          .once()
          .resolves(10);

        channelMock
          .expects('subscribe')
          .once()
          .resolves(true);
      });

      it('should resolve purge without error and resubscribe', function (done) {
        queue.on('subscribed', function () {
          queue.state.should.equal('subscribed');
          done();
        });
        queue.purge().should.eventually.equal(10);
      });
    });

    describe('when checking after subscribed state', function () {
      it('should be in subscribed state', function () {
        return queue.state.should.equal('subscribed');
      });

      it('should resolve check without error', function () {
        return queue.check().should.be.fulfilled;
      });
    });

    describe('when unsubscribing', function () {
      before(function () {
        channelMock
          .expects('unsubscribe')
          .once()
          .resolves(true);
      });

      it('should resolve unsubscribe without error', function () {
        return queue.unsubscribe().should.be.fulfilled;
      });

      it('should change options.subscribe to false', function () {
        options.subscribe.should.equal(false);
      });
    });

    describe('when channel is closed remotely', function () {
      var channel;
      before(function (done) {
        channelMock
          .expects('define')
          .once()
          .resolves();

        queue.once('defined', function () {
          done();
        });

        queue.once('closed', function () {
          queue.check();
        });

        ch.factory().then(function (q) {
          channel = q.channel;
          q.channel.raise('closed');
        });
      });

      it('should reinitialize without error on check', function () {
        should.not.exist(error);
      });

      it('should be in a ready state', function () {
        queue.state.should.equal('ready');
      });

      it('should not duplicate subscriptions to channel events', function () {
        _.each(channel.handlers, function (list, name) {
          list.length.should.equal(1);
        });
      });
    });

    describe('when releasing', function () {
      before(function () {
        channelMock
          .expects('release')
          .once()
          .resolves();

        return queue.release();
      });

      it('should remove handlers from topology and connection', function () {
        _.flatten(_.values(connection.handlers)).length.should.equal(0);
        _.flatten(_.values(topology.handlers)).length.should.equal(0);
      });

      it('should release channel instance', function () {
        should.not.exist(queue.channel);
      });

      describe('when checking a released queue', function () {
        it('should be released', function () {
          return queue.state.should.equal('released');
        });

        it('should reject check', function () {
          return queue.check().should.be.rejectedWith(`Cannot establish queue 'test' after intentionally closing its connection`);
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
