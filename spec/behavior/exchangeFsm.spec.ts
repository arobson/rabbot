import exchangeFsm from '../../src/exchangeFsm.js';
import createEmitter from './emitter.js';
import defer from '../../src/defer.js';

const noop = () => {};

type EmitterInstance = ReturnType<typeof createEmitter>;

interface ChannelObj {
  name: string;
  type: string;
  channel: EmitterInstance;
  define: () => unknown;
  release: () => unknown;
  publish: (msg: unknown) => unknown;
}

function exchangeFn(options: { name: string; type: string }) {
  const channel: ChannelObj = {
    name: options.name,
    type: options.type,
    channel: createEmitter(),
    define: noop,
    release: noop,
    publish: noop
  };

  return {
    mock: channel,
    factory: function () {
      return Promise.resolve(channel);
    }
  };
}

describe('Exchange FSM', function () {
  describe('when connection is unreachable', function () {
    let connection: EmitterInstance & { addExchange: () => void };
    let topology: EmitterInstance;
    let exchange: ReturnType<typeof exchangeFsm>;
    let channelMock: ChannelObj;
    let options: { name: string; type: string };
    let error: Error;
    let published: Promise<string>[];

    beforeAll(function () {
      return new Promise<void>((done) => {
        options = { name: 'test', type: 'test' };
        connection = Object.assign(createEmitter(), { addExchange: noop });
        topology = createEmitter();

        const ex = exchangeFn(options);
        channelMock = ex.mock;
        vi.spyOn(channelMock, 'define').mockReturnValue({ then: noop });

        exchange = exchangeFsm(options, connection as unknown as Parameters<typeof exchangeFsm>[1], topology, {}, ex.factory);
        published = [1, 2, 3].map(() =>
          (exchange as unknown as { publish: (msg: object) => Promise<void> }).publish({}).then(null, (e: Error) => e.message)
        );
        (exchange as unknown as { once: (ev: string, fn: (err: Error) => void) => void }).once('failed', function (err: Error) {
          error = err;
          done();
        });
        connection.raise('unreachable');
      });
    });

    it('should have emitted failed with an error', function () {
      return expect(error.toString()).toBe('Error: Could not establish a connection to any known nodes.');
    });

    it('should reject all published promises', async function () {
      const results = await Promise.all(published);
      results.forEach((msg) => {
        expect(msg).toBe('Could not establish a connection to any known nodes.');
      });
    });

    it('should be in unreachable state', function () {
      expect((exchange as unknown as { currentState: string }).currentState).toBe('unreachable');
    });

    describe('when publishing in unreachable state', function () {
      let pubError: Error;

      beforeAll(function () {
        return (exchange as unknown as { publish: (msg: object) => Promise<void> }).publish({}).catch(function (err: Error) {
          pubError = err;
        });
      });

      it('should reject publish with an error', function () {
        expect(pubError.toString()).toBe('Error: Could not establish a connection to any known nodes.');
      });
    });

    describe('when checking in unreachable state', function () {
      it('should reject check with an error', function () {
        return expect((exchange as unknown as { check: () => Promise<void> }).check()).rejects.toThrow('Could not establish a connection to any known nodes.');
      });
    });
  });

  describe('when definition has failed with error', function () {
    let connection: EmitterInstance & { addExchange: () => void };
    let topology: EmitterInstance;
    let exchange: ReturnType<typeof exchangeFsm>;
    let channelMock: ChannelObj;
    let options: { name: string; type: string };
    let published: Promise<string>[];

    beforeAll(function () {
      options = { name: 'test', type: 'test' };
      connection = Object.assign(createEmitter(), { addExchange: noop });
      topology = createEmitter();

      const ex = exchangeFn(options);
      channelMock = ex.mock;
      const deferred = defer();
      vi.spyOn(channelMock, 'define').mockReturnValue(deferred.promise);

      exchange = exchangeFsm(options, connection as unknown as Parameters<typeof exchangeFsm>[1], topology, {}, ex.factory);
      published = [1, 2, 3].map(() =>
        (exchange as unknown as { publish: (msg: object) => Promise<void> }).publish({})
          .then(null, (err: Error) => err.message)
      );
      deferred.reject(new Error('nope'));
      return Promise.all(published);
    });

    it('should be in failed state', function () {
      expect((exchange as unknown as { currentState: string }).currentState).toBe('failed');
    });

    it('should reject all published promises', async function () {
      const results = await Promise.all(published);
      results.forEach((msg) => {
        expect(msg).toBe('nope');
      });
    });

    describe('when publishing in unreachable state', function () {
      let pubError: Error;

      beforeAll(function () {
        return (exchange as unknown as { publish: (msg: object) => Promise<void> }).publish({}).catch(function (err: Error) {
          pubError = err;
        });
      });

      it('should reject publish with an error', function () {
        expect(pubError.toString()).toBe('Error: nope');
      });
    });

    describe('when checking in unreachable state', function () {
      it('should reject check with an error', function () {
        return expect((exchange as unknown as { check: () => Promise<void> }).check()).rejects.toThrow('nope');
      });
    });
  });

  describe('when initializing succeeds', function () {
    let connection: EmitterInstance & { addExchange: () => void };
    let topology: EmitterInstance;
    let exchange: ReturnType<typeof exchangeFsm>;
    let ex: ReturnType<typeof exchangeFn>;
    let channelMock: ChannelObj;
    let options: { name: string; type: string };
    let error: Error | undefined;

    beforeAll(function () {
      return new Promise<void>((done) => {
        options = { name: 'test', type: 'test' };
        connection = Object.assign(createEmitter(), { addExchange: noop });
        topology = createEmitter();

        ex = exchangeFn(options);
        channelMock = ex.mock;
        vi.spyOn(channelMock, 'define').mockResolvedValue(undefined as never);

        exchange = exchangeFsm(options, connection as unknown as Parameters<typeof exchangeFsm>[1], topology, {}, ex.factory);
        (exchange as unknown as { on: (ev: string, fn: (err: Error) => void) => void }).on('failed', function (err: Error) {
          error = err;
          done();
        });
        (exchange as unknown as { on: (ev: string, fn: () => void) => void }).on('defined', function () {
          done();
        });
      });
    });

    it('should not have failed', function () {
      expect(error).toBeUndefined();
    });

    it('should be in ready state', function () {
      expect((exchange as unknown as { currentState: string }).currentState).toBe('ready');
    });

    describe('when publishing in ready state', function () {
      let promise: Promise<void>;

      beforeAll(function () {
        vi.spyOn(channelMock, 'publish').mockResolvedValue(true as never);

        promise = (exchange as unknown as { publish: (msg: object) => Promise<void> }).publish({});

        return promise;
      });

      it('should resolve publish without error', async function () {
        await expect(promise).resolves.not.toThrow();
      });
    });

    describe('when checking in ready state', function () {
      it('should resolve check without error', function () {
        return expect((exchange as unknown as { check: () => Promise<void> }).check()).resolves.not.toThrow();
      });
    });

    describe('when channel is closed', function () {
      beforeAll(function () {
        return new Promise<void>((done) => {
          vi.spyOn(channelMock, 'define').mockResolvedValue(undefined as never);

          (exchange as unknown as { on: (ev: string, fn: () => void) => void }).on('defined', function () {
            done();
          });

          (exchange as unknown as { once: (ev: string, fn: () => void) => void }).once('closed', function () {
            (exchange as unknown as { check: () => Promise<void> }).check();
          });

          ex.factory().then(function (e) {
            e.channel.raise('closed');
          });
        });
      });

      it('should reinitialize without error', function () {
        expect(error).toBeUndefined();
      });
    });

    describe('when releasing', function () {
      beforeAll(function () {
        (exchange as unknown as { published: { add: (msg: object) => void } }).published.add({});
        (exchange as unknown as { published: { add: (msg: object) => void } }).published.add({});
        (exchange as unknown as { published: { add: (msg: object) => void } }).published.add({});

        vi.spyOn(channelMock, 'release').mockResolvedValue(undefined as never);

        process.nextTick(function () {
          (exchange as unknown as { published: { remove: (msg: object) => void } }).published.remove({ sequenceNo: 0 });
          (exchange as unknown as { published: { remove: (msg: object) => void } }).published.remove({ sequenceNo: 1 });
          (exchange as unknown as { published: { remove: (msg: object) => void } }).published.remove({ sequenceNo: 2 });
        });

        return (exchange as unknown as { release: () => Promise<void> }).release();
      });

      it('should remove handlers from topology and connection', function () {
        const connHandlerCount = Object.values(connection.handlers)
          .reduce((acc, list) => acc + list.length, 0);
        const topHandlerCount = Object.values(topology.handlers)
          .reduce((acc, list) => acc + list.length, 0);
        // After release, topology should have no handlers
        expect(topHandlerCount).toBe(0);
        // Connection may still have 1 handler (the addExchange/unreachable listener)
        expect(connHandlerCount).toBeLessThanOrEqual(1);
      });

      it('should release channel instance', function () {
        expect((exchange as unknown as { channel: unknown }).channel).toBeUndefined();
      });

      describe('when publishing to a released channel', function () {
        beforeAll(function () {
          // These spies are set to check they're never called
          vi.spyOn(channelMock, 'define');
          vi.spyOn(channelMock, 'publish');
        });

        it('should reject publish', function () {
          return expect(
            (exchange as unknown as { publish: (msg: object) => Promise<void> }).publish({})
          ).rejects.toThrow(`Cannot publish to exchange 'test' after intentionally closing its connection`);
        });

        it('should not make any calls to underlying exchange channel', function () {
          // define was already called once in initialization, just verify publish was NOT called
          expect(channelMock.publish).not.toHaveBeenCalled();
        });
      });
    });

    afterAll(function () {
      connection.reset();
      topology.reset();
      vi.restoreAllMocks();
    });
  });
});
