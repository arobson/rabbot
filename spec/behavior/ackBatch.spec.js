require('../setup.js');
var postal = require('postal');
var signal = postal.channel('rabbit.ack');
var AckBatch = require('../../src/ackBatch.js');
var noOp = function () {};

describe('Ack Batching', function () {
  describe('when adding a new message', function () {
    var batch;
    var messageData;
    before(function () {
      batch = new AckBatch('test-queue', 'test-connection', noOp);
      messageData = batch.getMessageOps(101);
      batch.addMessage(messageData);
    });

    function remap (list) {
      return list.map((item) => ({ status: item.status, tag: item.tag }));
    }

    it('should return message in pending status', () => {
      messageData.status.should.eql('pending');
    });

    it('should add pending status with tag', function () {
      remap(batch.messages).should.eql([ { tag: 101, status: 'pending' } ]);
    });

    it('ack operation should change status to ack', function () {
      messageData.ack();
      messageData.status.should.eql('ack');
      remap(batch.messages).should.eql([ { tag: 101, status: 'ack' } ]);
    });

    it('nack operation should change status to nack', function () {
      messageData.nack();
      messageData.status.should.eql('nack');
      remap(batch.messages).should.eql([ { tag: 101, status: 'nack' } ]);
    });

    it('reject operation should change status to reject', function () {
      messageData.reject();
      messageData.status.should.eql('reject');
      remap(batch.messages).should.eql([ { tag: 101, status: 'reject' } ]);
    });

    after(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with no tags', function () {
    var batch;
    var resolver;
    var status;
    before(function (done) {
      resolver = function (s) {
        status = s;
        done();
      };
      batch = new AckBatch('test-queue', 'test-connection', resolver);
      batch.listenForSignal();
      signal.publish('go', {});
    });

    it("should resolve with 'waiting'", function () {
      status.should.equal('waiting');
    });

    it('should not remove or change tags', function () {
      batch.messages.should.eql([]);
    });

    after(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with only pending tags', function () {
    var batch;
    var resolver;
    var status;
    before(function (done) {
      resolver = function (s) {
        status = s;
        done();
      };
      batch = new AckBatch('test-queue', 'test-connection', resolver);
      batch.addMessage({ tag: 101, status: 'pending' });
      batch.addMessage({ tag: 102, status: 'pending' });
      batch.addMessage({ tag: 103, status: 'pending' });
      batch.addMessage({ tag: 104, status: 'pending' });
      batch.listenForSignal();
      signal.publish('go', {});
    });

    it("should resolve with 'waiting'", function () {
      status.should.equal('waiting');
    });

    it('should not remove or change tags', function () {
      batch.messages.should.eql([
        { tag: 101, status: 'pending' },
        { tag: 102, status: 'pending' },
        { tag: 103, status: 'pending' },
        { tag: 104, status: 'pending' }
      ]);
    });

    it('should reflect correct received count', function () {
      batch.receivedCount.should.equal(4);
    });

    after(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with leading pending tags', function () {
    var batch;
    var resolver;
    var status;
    before(function (done) {
      resolver = function (s) {
        status = s;
        done();
      };
      batch = new AckBatch('test-queue', 'test-connection', resolver);
      batch.addMessage({ tag: 101, status: 'pending' });
      batch.addMessage({ tag: 102, status: 'pending' });
      batch.addMessage({ tag: 103, status: 'ack' });
      batch.addMessage({ tag: 104, status: 'nack' });
      batch.addMessage({ tag: 105, status: 'reject' });
      batch.listenForSignal();
      signal.publish('go', {});
    });

    it("should resolve with 'waiting'", function () {
      status.should.equal('waiting');
    });

    it('should not remove or change tags', function () {
      batch.messages.should.eql([
        { tag: 101, status: 'pending' },
        { tag: 102, status: 'pending' },
        { tag: 103, status: 'ack' },
        { tag: 104, status: 'nack' },
        { tag: 105, status: 'reject' }
      ]);
    });

    it('should reflect correct received count', function () {
      batch.receivedCount.should.equal(5);
    });

    after(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with all ack tags', function () {
    var batch;
    var resolver;
    var status, data;
    before(function (done) {
      resolver = function (s, d) {
        status = s;
        data = d;
        return Promise.resolve(true);
      };
      batch = new AckBatch('test-queue', 'test-connection', resolver);
      batch.on('empty', function () {
        done();
      });

      batch.listenForSignal();
      batch.addMessage({ tag: 101, status: 'ack' });
      batch.addMessage({ tag: 102, status: 'ack' });
      batch.addMessage({ tag: 103, status: 'ack' });
      batch.addMessage({ tag: 104, status: 'ack' });
      batch.addMessage({ tag: 105, status: 'ack' });
      batch.firstAck = 101;
      signal.publish('go', {});
    });

    it("should resolve with 'ack'", function () {
      status.should.equal('ack');
      data.should.eql({ tag: 105, inclusive: true });
    });

    it('should remove all tags', function () {
      batch.messages.should.eql([]);
    });

    it('should set lastAck to last tag', function () {
      batch.lastAck.should.equal(105);
    });

    it('should reset firstAck to undefined', function () {
      should.not.exist(batch.firstAck);
    });

    it('should reflect correct received count', function () {
      batch.receivedCount.should.equal(5);
    });

    after(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with all nack tags', function () {
    var batch;
    var resolver;
    var status, data;
    before(function (done) {
      resolver = function (s, d) {
        status = s;
        data = d;
        return Promise.resolve(true);
      };
      batch = new AckBatch('test-queue', 'test-connection', resolver);
      batch.on('empty', function () {
        done();
      });

      batch.addMessage({ tag: 101, status: 'nack' });
      batch.addMessage({ tag: 102, status: 'nack' });
      batch.addMessage({ tag: 103, status: 'nack' });
      batch.addMessage({ tag: 104, status: 'nack' });
      batch.addMessage({ tag: 105, status: 'nack' });
      batch.firstNack = 101;
      batch.listenForSignal();
      signal.publish('go', {});
    });

    it("should resolve with 'nack'", function () {
      status.should.equal('nack');
      data.should.eql({ tag: 105, inclusive: true });
    });

    it('should remove all tags', function () {
      batch.messages.should.eql([]);
    });

    it('should set lastNack to last tag', function () {
      batch.lastNack.should.equal(105);
    });

    it('should reset firstNack to undefined', function () {
      should.not.exist(batch.firstNack);
    });

    it('should reflect correct received count', function () {
      batch.receivedCount.should.equal(5);
    });

    after(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with all reject tags', function () {
    var batch;
    var resolver;
    var status, data;
    before(function (done) {
      resolver = function (s, d) {
        status = s;
        data = d;
        return Promise.resolve(true);
      };
      batch = new AckBatch('test-queue', 'test-connection', resolver);
      batch.on('empty', function () {
        done();
      });

      batch.addMessage({ tag: 101, status: 'reject' });
      batch.addMessage({ tag: 102, status: 'reject' });
      batch.addMessage({ tag: 103, status: 'reject' });
      batch.addMessage({ tag: 104, status: 'reject' });
      batch.addMessage({ tag: 105, status: 'reject' });
      batch.firstReject = 101;
      batch.listenForSignal();
      signal.publish('go', {});
    });

    it("should resolve with 'reject'", function () {
      status.should.equal('reject');
      data.should.eql({ tag: 105, inclusive: true });
    });

    it('should remove all tags', function () {
      batch.messages.should.eql([]);
    });

    it('should set lastReject to last tag', function () {
      batch.lastReject.should.equal(105);
    });

    it('should reset firstReject to undefined', function () {
      should.not.exist(batch.firstReject);
    });

    it('should reflect correct received count', function () {
      batch.receivedCount.should.equal(5);
    });

    after(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with no pending tags (mixed ops)', function () {
    var batch;
    var resolver;
    var status = [];
    var data = [];
    before(function (done) {
      resolver = function (s, d) {
        status.push(s);
        data.push(d);
        return Promise.resolve(true);
      };
      batch = new AckBatch('test-queue', 'test-connection', resolver);
      batch.on('empty', function () {
        done();
      });

      var messages = [
        batch.getMessageOps(101),
        batch.getMessageOps(102),
        batch.getMessageOps(103),
        batch.getMessageOps(104),
        batch.getMessageOps(105),
        batch.getMessageOps(106)
      ];

      messages.forEach(batch.addMessage.bind(batch));

      messages[ 0 ].ack();
      messages[ 1 ].ack();
      messages[ 2 ].nack();
      messages[ 3 ].nack();
      messages[ 4 ].reject();
      messages[ 5 ].reject();

      batch.listenForSignal();
      signal.publish('go', {});
      signal.publish('go', {});
      signal.publish('go', {});
    });

    it('should resolve operations in expected order with correct arguments', function () {
      status.should.eql([ 'ack', 'nack', 'reject' ]);
      data.should.eql([
        { tag: 102, inclusive: true },
        { tag: 104, inclusive: true },
        { tag: 106, inclusive: true }
      ]);
    });

    it('should remove all tags', function () {
      batch.messages.should.eql([]);
    });

    it("should set lastAck to last ack'd tag", function () {
      batch.lastAck.should.equal(102);
    });

    it("should set lastNack to last nack'd tag", function () {
      batch.lastNack.should.equal(104);
    });

    it('should set lastReject to last rejected tag', function () {
      batch.lastReject.should.equal(106);
    });

    it('should reset firstAck to undefined', function () {
      should.not.exist(batch.firstAck);
    });

    it('should reset firstNack to undefined', function () {
      should.not.exist(batch.firstNack);
    });

    it('should reset firstReject to undefined', function () {
      should.not.exist(batch.firstReject);
    });

    it('should reflect correct received count', function () {
      batch.receivedCount.should.equal(6);
    });

    after(function () {
      batch.ignoreSignal();
    });
  });
});
