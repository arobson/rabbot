require('../setup.js');
const _ = require('lodash');
var publishLog = require('../../src/publishLog');

describe('Publish log', function () {
  describe('when adding a message', function () {
    var log;
    var zero = {};
    var one = {};
    var two = {};
    var three = {};
    before(function () {
      log = publishLog();
      log.add(zero);
      log.add(one);
      log.add(two);
      log.add(three);
    });

    it('should keep a valid count', function () {
      log.count().should.equal(4);
    });

    it('should assign sequence numbers correctly', function () {
      zero.sequenceNo.should.equal(0);
      one.sequenceNo.should.equal(1);
      two.sequenceNo.should.equal(2);
      three.sequenceNo.should.equal(3);
    });
  });

  describe('when removing a message', function () {
    var log;

    before(function () {
      log = publishLog();
      log.add({});
      log.add({});
      log.add({});
      log.add({});
      log.add({});
    });

    describe('with valid sequence numbers', function () {
      var fourRemoved, zeroRemoved;
      before(function () {
        fourRemoved = log.remove(4);
        zeroRemoved = log.remove({ sequenceNo: 0 });
      });

      it('should return true when removing a message', function () {
        fourRemoved.should.equal(true);
        zeroRemoved.should.equal(true);
      });

      it('should have removed two messages', function () {
        log.count().should.equal(3);
      });

      describe('next message should get correct sequence', function () {
        var m;
        before(function () {
          m = {};
          log.add(m);
        });

        it('should assign sequence 5 to new message', function () {
          m.sequenceNo.should.equal(5);
        });

        it('should increase count to 4', function () {
          log.count().should.equal(4);
        });
      });
    });

    describe('with an invalid sequence number', function () {
      var removed;
      before(function () {
        removed = log.remove(10);
      });

      it('should not decrease count', function () {
        log.count().should.equal(4);
      });

      it('should return false when message is not in the log', function () {
        removed.should.equal(false);
      });

      describe('next message should get correct sequence', function () {
        var m;
        before(function () {
          m = {};
          log.add(m);
        });

        it('should assign sequence 5 to new message', function () {
          m.sequenceNo.should.equal(6);
        });

        it('should increase count to 5', function () {
          log.count().should.equal(5);
        });
      });
    });
  });

  describe('when resetting log', function () {
    var log;
    var zero = { id: 'zero' };
    var one = { id: 'one' };
    var two = { id: 'two' };
    var three = { id: 'three' };
    var list;
    before(function () {
      log = publishLog();
      log.add(zero);
      log.add(one);
      log.add(two);
      log.add(three);
      list = log.reset();
    });

    it('should reset to 0 messages', function () {
      log.count().should.equal(0);
    });

    it('should remove sequence numbers from messages', function () {
      should.not.exist(zero.sequenceNo);
      should.not.exist(one.sequenceNo);
      should.not.exist(two.sequenceNo);
      should.not.exist(three.sequenceNo);
    });

    it('should remove sequence numbers from list', function () {
      _.each(list, function (m) {
        should.not.exist(m.sequenceNo);
      });
    });

    it('should return all messages', function () {
      list.should.eql([ zero, one, two, three ]);
    });

    describe('when adding message to reset log', function () {
      var tmp;
      before(function () {
        tmp = {};
        log.add(tmp);
      });

      it('should start at index 0 when adding new message', function () {
        tmp.sequenceNo.should.equal(0);
      });

      it('should only count new messages', function () {
        log.count().should.equal(1);
      });
    });
  });
});
