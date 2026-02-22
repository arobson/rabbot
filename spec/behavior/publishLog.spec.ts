import publishLog from '../../src/publishLog.js';

describe('Publish log', function () {
  describe('when adding a message', function () {
    let log: ReturnType<typeof publishLog>;
    const zero: Record<string, unknown> = {};
    const one: Record<string, unknown> = {};
    const two: Record<string, unknown> = {};
    const three: Record<string, unknown> = {};

    beforeAll(function () {
      log = publishLog();
      log.add(zero);
      log.add(one);
      log.add(two);
      log.add(three);
    });

    it('should keep a valid count', function () {
      expect(log.count()).toBe(4);
    });

    it('should assign sequence numbers correctly', function () {
      expect(zero.sequenceNo).toBe(0);
      expect(one.sequenceNo).toBe(1);
      expect(two.sequenceNo).toBe(2);
      expect(three.sequenceNo).toBe(3);
    });
  });

  describe('when removing a message', function () {
    let log: ReturnType<typeof publishLog>;

    beforeAll(function () {
      log = publishLog();
      log.add({});
      log.add({});
      log.add({});
      log.add({});
      log.add({});
    });

    describe('with valid sequence numbers', function () {
      let fourRemoved: boolean;
      let zeroRemoved: boolean;

      beforeAll(function () {
        fourRemoved = log.remove(4);
        zeroRemoved = log.remove({ sequenceNo: 0 });
      });

      it('should return true when removing a message', function () {
        expect(fourRemoved).toBe(true);
        expect(zeroRemoved).toBe(true);
      });

      it('should have removed two messages', function () {
        expect(log.count()).toBe(3);
      });

      describe('next message should get correct sequence', function () {
        let m: Record<string, unknown>;

        beforeAll(function () {
          m = {};
          log.add(m);
        });

        it('should assign sequence 5 to new message', function () {
          expect(m.sequenceNo).toBe(5);
        });

        it('should increase count to 4', function () {
          expect(log.count()).toBe(4);
        });
      });
    });

    describe('with an invalid sequence number', function () {
      let removed: boolean;

      beforeAll(function () {
        removed = log.remove(10);
      });

      it('should not decrease count', function () {
        expect(log.count()).toBe(4);
      });

      it('should return false when message is not in the log', function () {
        expect(removed).toBe(false);
      });

      describe('next message should get correct sequence', function () {
        let m: Record<string, unknown>;

        beforeAll(function () {
          m = {};
          log.add(m);
        });

        it('should assign sequence 5 to new message', function () {
          expect(m.sequenceNo).toBe(6);
        });

        it('should increase count to 5', function () {
          expect(log.count()).toBe(5);
        });
      });
    });
  });

  describe('when resetting log', function () {
    let log: ReturnType<typeof publishLog>;
    const zero = { id: 'zero' } as Record<string, unknown>;
    const one = { id: 'one' } as Record<string, unknown>;
    const two = { id: 'two' } as Record<string, unknown>;
    const three = { id: 'three' } as Record<string, unknown>;
    let list: Record<string, unknown>[];

    beforeAll(function () {
      log = publishLog();
      log.add(zero);
      log.add(one);
      log.add(two);
      log.add(three);
      list = log.reset() as Record<string, unknown>[];
    });

    it('should reset to 0 messages', function () {
      expect(log.count()).toBe(0);
    });

    it('should remove sequence numbers from messages', function () {
      expect(zero.sequenceNo).toBeUndefined();
      expect(one.sequenceNo).toBeUndefined();
      expect(two.sequenceNo).toBeUndefined();
      expect(three.sequenceNo).toBeUndefined();
    });

    it('should remove sequence numbers from list', function () {
      list.forEach(function (m) {
        expect(m.sequenceNo).toBeUndefined();
      });
    });

    it('should return all messages', function () {
      expect(list).toEqual([zero, one, two, three]);
    });

    describe('when adding message to reset log', function () {
      let tmp: Record<string, unknown>;

      beforeAll(function () {
        tmp = {};
        log.add(tmp);
      });

      it('should start at index 0 when adding new message', function () {
        expect(tmp.sequenceNo).toBe(0);
      });

      it('should only count new messages', function () {
        expect(log.count()).toBe(1);
      });
    });
  });
});
