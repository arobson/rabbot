import queueFsm from '../../src/queueFsm.js';
import createEmitter from './emitter.js';

const noOp = () => {};

type EmitterInstance = ReturnType<typeof createEmitter>;

interface ChannelObj {
  name: string;
  type: string | undefined;
  channel: EmitterInstance;
  define: () => unknown;
  destroy: () => unknown;
  finalize: () => unknown;
  purge: () => unknown;
  release: () => unknown;
  getMessageCount: () => unknown;
  subscribe: () => unknown;
  unsubscribe: () => unknown;
}

function channelFn(options: { name: string; type?: string }) {
  const channel: ChannelObj = {
    name: options.name,
    type: options.type,
    channel: createEmitter(),
    define: noOp,
    destroy: noOp,
    finalize: noOp,
    purge: noOp,
    release: noOp,
    getMessageCount: noOp,
    subscribe: noOp,
    unsubscribe: noOp
  };

  return {
    mock: channel,
    factory: function () {
      return Promise.resolve(channel);
    }
  };
}

describe('Queue FSM', function () {
  describe('when initialization fails', function () {
    let connection: EmitterInstance & { addQueue: () => void };
    let topology: EmitterInstance;
    let queue: ReturnType<typeof queueFsm>;
    let channelMock: ChannelObj;
    let options: { name: string; type: string };
    let error: Error;

    beforeAll(function () {
      return new Promise<void>((done) => {
        options = { name: 'test', type: 'test' };
        connection = Object.assign(createEmitter(), { addQueue: noOp });
        topology = createEmitter();

        const ch = channelFn(options);
        channelMock = ch.mock;
        vi.spyOn(channelMock, 'define').mockRejectedValue(new Error('nope') as never);

        queue = queueFsm(options, connection as unknown as Parameters<typeof queueFsm>[1], topology, {}, ch.factory);
        (queue as unknown as { once: (ev: string, fn: (err: Error) => void) => void }).once('failed', function (err: Error) {
          error = err;
          done();
        });
      });
    });

    it('should have failed with an error', function () {
      expect(error.toString()).toBe('Error: nope');
    });

    it('should be in failed state', function () {
      expect((queue as unknown as { currentState: string }).currentState).toBe('failed');
    });

    describe('when subscribing in failed state', function () {
      it('should reject subscribe with an error', function () {
        return expect((queue as unknown as { subscribe: () => Promise<void> }).subscribe()).rejects.toThrow(/nope/);
      });
    });

    describe('when purging in failed state', function () {
      it('should reject purge with an error', function () {
        return expect((queue as unknown as { purge: () => Promise<void> }).purge()).rejects.toThrow(/nope/);
      });
    });

    describe('when checking in failed state', function () {
      it('should reject check with an error', function () {
        return expect((queue as unknown as { check: () => Promise<void> }).check()).rejects.toThrow(/nope/);
      });
    });
  });

  describe('when initializing succeeds', function () {
    let connection: EmitterInstance & { addQueue: () => void };
    let topology: EmitterInstance;
    let queue: ReturnType<typeof queueFsm>;
    let ch: ReturnType<typeof channelFn>;
    let channelMock: ChannelObj;
    let options: { name: string; type: string; subscribe?: boolean };
    let error: Error | undefined;

    beforeAll(function () {
      return new Promise<void>((done) => {
        options = { name: 'test', type: 'test' };
        connection = Object.assign(createEmitter(), { addQueue: noOp });
        topology = createEmitter();

        ch = channelFn(options);
        channelMock = ch.mock;
        vi.spyOn(channelMock, 'define').mockResolvedValue(true as never);

        queue = queueFsm(options, connection as unknown as Parameters<typeof queueFsm>[1], topology, {}, ch.factory);
        (queue as unknown as { once: (ev: string, fn: (err: Error) => void) => void }).once('failed', function (err: Error) {
          error = err;
          done();
        });
        (queue as unknown as { once: (ev: string, fn: () => void) => void }).once('defined', function () {
          done();
        });
      });
    });

    it('should not have failed', function () {
      expect(error).toBeUndefined();
    });

    it('should be in ready state', function () {
      expect((queue as unknown as { currentState: string }).currentState).toBe('ready');
    });

    describe('when subscribing in ready state', function () {
      beforeAll(function () {
        vi.spyOn(channelMock, 'subscribe').mockResolvedValue(true as never);
      });

      it('should resolve subscribe without error', function () {
        (queue as unknown as { subscribe: () => Promise<void> }).subscribe();
        return expect((queue as unknown as { subscribe: () => Promise<void> }).subscribe()).resolves.not.toThrow();
      });

      it('should change options.subscribe to true', function () {
        expect(options.subscribe).toBe(true);
      });

      it('should be in subscribed state', function () {
        expect((queue as unknown as { currentState: string }).currentState).toBe('subscribed');
      });
    });

    describe('when purging in ready state', function () {
      beforeAll(function () {
        vi.spyOn(channelMock, 'purge').mockResolvedValue(10 as never);
        vi.spyOn(channelMock, 'subscribe').mockResolvedValue(true as never);
      });

      it('should resolve purge without error and resubscribe', async function () {
        const purgePromise = (queue as unknown as { purge: () => Promise<number> }).purge();
        await new Promise<void>((resolve) => {
          (queue as unknown as { on: (ev: string, fn: () => void) => void }).on('subscribed', function () {
            expect((queue as unknown as { currentState: string }).currentState).toBe('subscribed');
            resolve();
          });
        });
        await expect(purgePromise).resolves.toBe(10);
      });
    });

    describe('when checking after subscribed state', function () {
      it('should be in subscribed state', function () {
        expect((queue as unknown as { currentState: string }).currentState).toBe('subscribed');
      });

      it('should resolve check without error', function () {
        return expect((queue as unknown as { check: () => Promise<void> }).check()).resolves.not.toThrow();
      });
    });

    describe('when unsubscribing', function () {
      beforeAll(function () {
        vi.spyOn(channelMock, 'unsubscribe').mockResolvedValue(true as never);
      });

      it('should resolve unsubscribe without error', function () {
        return expect((queue as unknown as { unsubscribe: () => Promise<void> }).unsubscribe()).resolves.not.toThrow();
      });

      it('should change options.subscribe to false', function () {
        expect(options.subscribe).toBe(false);
      });
    });

    describe('when channel is closed remotely', function () {
      let channelEmitter: EmitterInstance;

      beforeAll(function () {
        return new Promise<void>((done) => {
          vi.spyOn(channelMock, 'define').mockResolvedValue(undefined as never);

          (queue as unknown as { once: (ev: string, fn: () => void) => void }).once('defined', function () {
            done();
          });

          (queue as unknown as { once: (ev: string, fn: () => void) => void }).once('closed', function () {
            (queue as unknown as { check: () => Promise<void> }).check();
          });

          ch.factory().then(function (q) {
            channelEmitter = q.channel;
            q.channel.raise('closed');
          });
        });
      });

      it('should reinitialize without error on check', function () {
        expect(error).toBeUndefined();
      });

      it('should be in a ready state', function () {
        expect((queue as unknown as { currentState: string }).currentState).toBe('ready');
      });

      it('should not duplicate subscriptions to channel events', function () {
        Object.entries(channelEmitter.handlers).forEach(([_name, list]) => {
          expect(list.length).toBe(1);
        });
      });
    });

    describe('when releasing', function () {
      beforeAll(function () {
        vi.spyOn(channelMock, 'release').mockResolvedValue(undefined as never);

        return (queue as unknown as { release: () => Promise<void> }).release();
      });

      it('should remove handlers from topology and connection', function () {
        const connHandlerCount = Object.values(connection.handlers)
          .reduce((acc, list) => acc + list.length, 0);
        const topHandlerCount = Object.values(topology.handlers)
          .reduce((acc, list) => acc + list.length, 0);
        expect(connHandlerCount).toBe(0);
        expect(topHandlerCount).toBe(0);
      });

      it('should release channel instance', function () {
        expect((queue as unknown as { channel: unknown }).channel).toBeUndefined();
      });

      describe('when checking a released queue', function () {
        it('should be released', function () {
          expect((queue as unknown as { currentState: string }).currentState).toBe('released');
        });

        it('should reject check', function () {
          return expect((queue as unknown as { check: () => Promise<void> }).check()).rejects.toThrow(
            `Cannot establish queue 'test' after intentionally closing its connection`
          );
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
