import AckBatch, { ackSignal, TrackedMessage, Resolver } from '../../src/ackBatch.js';

const noOp = () => {};

describe('Ack Batching', function () {
  describe('when adding a new message', function () {
    let batch: AckBatch;
    let messageData: TrackedMessage;

    beforeAll(function () {
      batch = new AckBatch('test-queue', 'test-connection', noOp as unknown as Resolver);
      messageData = batch.getMessageOps(101);
      batch.addMessage(messageData);
    });

    function remap(list: TrackedMessage[]) {
      return list.map((item) => ({ status: item.status, tag: item.tag }));
    }

    it('should return message in pending status', () => {
      expect(messageData.status).toEqual('pending');
    });

    it('should add pending status with tag', function () {
      expect(remap(batch.messages)).toEqual([{ tag: 101, status: 'pending' }]);
    });

    it('ack operation should change status to ack', function () {
      messageData.ack();
      expect(messageData.status).toEqual('ack');
      expect(remap(batch.messages)).toEqual([{ tag: 101, status: 'ack' }]);
    });

    it('nack operation should change status to nack', function () {
      messageData.nack();
      expect(messageData.status).toEqual('nack');
      expect(remap(batch.messages)).toEqual([{ tag: 101, status: 'nack' }]);
    });

    it('reject operation should change status to reject', function () {
      messageData.reject();
      expect(messageData.status).toEqual('reject');
      expect(remap(batch.messages)).toEqual([{ tag: 101, status: 'reject' }]);
    });

    afterAll(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with no tags', function () {
    let batch: AckBatch;
    let resolver: Resolver;
    let status: string;

    beforeAll(function () {
      return new Promise<void>((resolve) => {
        resolver = function (s) {
          status = s;
          resolve();
        };
        batch = new AckBatch('test-queue', 'test-connection', resolver);
        batch.listenForSignal();
        ackSignal.emit('ack', {});
      });
    });

    it("should resolve with 'waiting'", function () {
      expect(status).toBe('waiting');
    });

    it('should not remove or change tags', function () {
      expect(batch.messages).toEqual([]);
    });

    afterAll(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with only pending tags', function () {
    let batch: AckBatch;
    let resolver: Resolver;
    let status: string;

    beforeAll(function () {
      return new Promise<void>((resolve) => {
        resolver = function (s) {
          status = s;
          resolve();
        };
        batch = new AckBatch('test-queue', 'test-connection', resolver);
        batch.addMessage({ tag: 101, status: 'pending' } as TrackedMessage);
        batch.addMessage({ tag: 102, status: 'pending' } as TrackedMessage);
        batch.addMessage({ tag: 103, status: 'pending' } as TrackedMessage);
        batch.addMessage({ tag: 104, status: 'pending' } as TrackedMessage);
        batch.listenForSignal();
        ackSignal.emit('ack', {});
      });
    });

    it("should resolve with 'waiting'", function () {
      expect(status).toBe('waiting');
    });

    it('should not remove or change tags', function () {
      expect(batch.messages).toEqual([
        { tag: 101, status: 'pending' },
        { tag: 102, status: 'pending' },
        { tag: 103, status: 'pending' },
        { tag: 104, status: 'pending' }
      ]);
    });

    it('should reflect correct received count', function () {
      expect(batch.receivedCount).toBe(4);
    });

    afterAll(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with leading pending tags', function () {
    let batch: AckBatch;
    let resolver: Resolver;
    let status: string;

    beforeAll(function () {
      return new Promise<void>((resolve) => {
        resolver = function (s) {
          status = s;
          resolve();
        };
        batch = new AckBatch('test-queue', 'test-connection', resolver);
        batch.addMessage({ tag: 101, status: 'pending' } as TrackedMessage);
        batch.addMessage({ tag: 102, status: 'pending' } as TrackedMessage);
        batch.addMessage({ tag: 103, status: 'ack' } as TrackedMessage);
        batch.addMessage({ tag: 104, status: 'nack' } as TrackedMessage);
        batch.addMessage({ tag: 105, status: 'reject' } as TrackedMessage);
        batch.listenForSignal();
        ackSignal.emit('ack', {});
      });
    });

    it("should resolve with 'waiting'", function () {
      expect(status).toBe('waiting');
    });

    it('should not remove or change tags', function () {
      expect(batch.messages).toEqual([
        { tag: 101, status: 'pending' },
        { tag: 102, status: 'pending' },
        { tag: 103, status: 'ack' },
        { tag: 104, status: 'nack' },
        { tag: 105, status: 'reject' }
      ]);
    });

    it('should reflect correct received count', function () {
      expect(batch.receivedCount).toBe(5);
    });

    afterAll(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with all ack tags', function () {
    let batch: AckBatch;
    let resolver: Resolver;
    let status: string;
    let data: { tag: number; inclusive: boolean } | undefined;

    beforeAll(function () {
      return new Promise<void>((resolve) => {
        resolver = function (s, d) {
          status = s;
          data = d;
          return Promise.resolve(true);
        };
        batch = new AckBatch('test-queue', 'test-connection', resolver);
        batch.on('empty', function () {
          resolve();
        });

        batch.listenForSignal();
        batch.addMessage({ tag: 101, status: 'ack' } as TrackedMessage);
        batch.addMessage({ tag: 102, status: 'ack' } as TrackedMessage);
        batch.addMessage({ tag: 103, status: 'ack' } as TrackedMessage);
        batch.addMessage({ tag: 104, status: 'ack' } as TrackedMessage);
        batch.addMessage({ tag: 105, status: 'ack' } as TrackedMessage);
        batch.firstAck = 101;
        ackSignal.emit('ack', {});
      });
    });

    it("should resolve with 'ack'", function () {
      expect(status).toBe('ack');
      expect(data).toEqual({ tag: 105, inclusive: true });
    });

    it('should remove all tags', function () {
      expect(batch.messages).toEqual([]);
    });

    it('should set lastAck to last tag', function () {
      expect(batch.lastAck).toBe(105);
    });

    it('should reset firstAck to undefined', function () {
      expect(batch.firstAck).toBeUndefined();
    });

    it('should reflect correct received count', function () {
      expect(batch.receivedCount).toBe(5);
    });

    afterAll(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with all nack tags', function () {
    let batch: AckBatch;
    let resolver: Resolver;
    let status: string;
    let data: { tag: number; inclusive: boolean } | undefined;

    beforeAll(function () {
      return new Promise<void>((resolve) => {
        resolver = function (s, d) {
          status = s;
          data = d;
          return Promise.resolve(true);
        };
        batch = new AckBatch('test-queue', 'test-connection', resolver);
        batch.on('empty', function () {
          resolve();
        });

        batch.addMessage({ tag: 101, status: 'nack' } as TrackedMessage);
        batch.addMessage({ tag: 102, status: 'nack' } as TrackedMessage);
        batch.addMessage({ tag: 103, status: 'nack' } as TrackedMessage);
        batch.addMessage({ tag: 104, status: 'nack' } as TrackedMessage);
        batch.addMessage({ tag: 105, status: 'nack' } as TrackedMessage);
        batch.firstNack = 101;
        batch.listenForSignal();
        ackSignal.emit('ack', {});
      });
    });

    it("should resolve with 'nack'", function () {
      expect(status).toBe('nack');
      expect(data).toEqual({ tag: 105, inclusive: true });
    });

    it('should remove all tags', function () {
      expect(batch.messages).toEqual([]);
    });

    it('should set lastNack to last tag', function () {
      expect(batch.lastNack).toBe(105);
    });

    it('should reset firstNack to undefined', function () {
      expect(batch.firstNack).toBeUndefined();
    });

    it('should reflect correct received count', function () {
      expect(batch.receivedCount).toBe(5);
    });

    afterAll(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with all reject tags', function () {
    let batch: AckBatch;
    let resolver: Resolver;
    let status: string;
    let data: { tag: number; inclusive: boolean } | undefined;

    beforeAll(function () {
      return new Promise<void>((resolve) => {
        resolver = function (s, d) {
          status = s;
          data = d;
          return Promise.resolve(true);
        };
        batch = new AckBatch('test-queue', 'test-connection', resolver);
        batch.on('empty', function () {
          resolve();
        });

        batch.addMessage({ tag: 101, status: 'reject' } as TrackedMessage);
        batch.addMessage({ tag: 102, status: 'reject' } as TrackedMessage);
        batch.addMessage({ tag: 103, status: 'reject' } as TrackedMessage);
        batch.addMessage({ tag: 104, status: 'reject' } as TrackedMessage);
        batch.addMessage({ tag: 105, status: 'reject' } as TrackedMessage);
        batch.firstReject = 101;
        batch.listenForSignal();
        ackSignal.emit('ack', {});
      });
    });

    it("should resolve with 'reject'", function () {
      expect(status).toBe('reject');
      expect(data).toEqual({ tag: 105, inclusive: true });
    });

    it('should remove all tags', function () {
      expect(batch.messages).toEqual([]);
    });

    it('should set lastReject to last tag', function () {
      expect(batch.lastReject).toBe(105);
    });

    it('should reset firstReject to undefined', function () {
      expect(batch.firstReject).toBeUndefined();
    });

    it('should reflect correct received count', function () {
      expect(batch.receivedCount).toBe(5);
    });

    afterAll(function () {
      batch.ignoreSignal();
    });
  });

  describe('when resolving with no pending tags (mixed ops)', function () {
    let batch: AckBatch;
    let resolver: Resolver;
    const status: string[] = [];
    const data: ({ tag: number; inclusive: boolean } | undefined)[] = [];

    beforeAll(function () {
      return new Promise<void>((resolve) => {
        resolver = function (s, d) {
          status.push(s);
          data.push(d);
          return Promise.resolve(true);
        };
        batch = new AckBatch('test-queue', 'test-connection', resolver);
        batch.on('empty', function () {
          resolve();
        });

        const messages = [
          batch.getMessageOps(101),
          batch.getMessageOps(102),
          batch.getMessageOps(103),
          batch.getMessageOps(104),
          batch.getMessageOps(105),
          batch.getMessageOps(106)
        ];

        messages.forEach(batch.addMessage.bind(batch));

        messages[0].ack();
        messages[1].ack();
        messages[2].nack();
        messages[3].nack();
        messages[4].reject();
        messages[5].reject();

        batch.listenForSignal();
        ackSignal.emit('ack', {});
        ackSignal.emit('ack', {});
        ackSignal.emit('ack', {});
      });
    });

    it('should resolve operations in expected order with correct arguments', function () {
      expect(status).toEqual(['ack', 'nack', 'reject']);
      expect(data).toEqual([
        { tag: 102, inclusive: true },
        { tag: 104, inclusive: true },
        { tag: 106, inclusive: true }
      ]);
    });

    it('should remove all tags', function () {
      expect(batch.messages).toEqual([]);
    });

    it("should set lastAck to last ack'd tag", function () {
      expect(batch.lastAck).toBe(102);
    });

    it("should set lastNack to last nack'd tag", function () {
      expect(batch.lastNack).toBe(104);
    });

    it('should set lastReject to last rejected tag', function () {
      expect(batch.lastReject).toBe(106);
    });

    it('should reset firstAck to undefined', function () {
      expect(batch.firstAck).toBeUndefined();
    });

    it('should reset firstNack to undefined', function () {
      expect(batch.firstNack).toBeUndefined();
    });

    it('should reset firstReject to undefined', function () {
      expect(batch.firstReject).toBeUndefined();
    });

    it('should reflect correct received count', function () {
      expect(batch.receivedCount).toBe(6);
    });

    afterAll(function () {
      batch.ignoreSignal();
    });
  });
});
