import connectionFn from '../../src/connectionFsm.js';
import { EventEmitter } from 'events';

const noOp = () => {};

interface MonadInstance {
  acquire: () => Promise<void>;
  item: { uri: string };
  close: () => void;
  createChannel: () => Promise<unknown>;
  createConfirmChannel: () => Promise<unknown>;
  on: (ev: string, handle: (data?: unknown) => void) => void;
  raise: (ev: string, data?: unknown) => void;
  release: () => Promise<void>;
  reset: () => void;
}

function connectionMonadFn(): MonadInstance {
  const handlers: Record<string, (data?: unknown) => void> = {};

  function raise(ev: string, data?: unknown) {
    if (handlers[ev]) {
      handlers[ev](data);
    }
  }

  function on(ev: string, handle: (data?: unknown) => void) {
    handlers[ev] = handle;
  }

  function reset(this: MonadInstance) {
    Object.keys(handlers).forEach(k => delete (handlers as Record<string, unknown>)[k]);
    this.close = noOp;
    this.createChannel = () => Promise.resolve();
    this.createConfirmChannel = () => Promise.resolve();
    this.release = () => Promise.resolve();
  }

  const instance: MonadInstance = {
    acquire: function () {
      instance.raise('acquiring');
      return Promise.resolve();
    },
    item: { uri: '' },
    close: noOp,
    createChannel: () => Promise.resolve(),
    createConfirmChannel: () => Promise.resolve(),
    on: on,
    raise: raise,
    release: () => Promise.resolve(),
    reset: reset
  };

  setTimeout(() => instance.acquire(), 0);
  return instance;
}

describe('Connection FSM', function () {
  describe('when configuration has getter', function () {
    let connection: ReturnType<typeof connectionFn>;

    it('should not throw exception', function () {
      expect(function () {
        connection = connectionFn({
          get: function (this: Record<string, unknown>, property: string) {
            const value = this[property];
            if (value === undefined) {
              throw new Error('Configuration property "' + property + '" is not defined');
            }
            return value;
          }
        } as unknown as Record<string, unknown>);
      }).not.toThrow();
    });

    afterAll(function () {
      (connection as unknown as { close: () => void }).close();
    });
  });

  describe('when connection is unavailable (failed)', function () {
    describe('when connecting', function () {
      let connection: ReturnType<typeof connectionFn>;
      let monad: MonadInstance;

      beforeAll(function () {
        return new Promise<void>((done) => {
          monad = connectionMonadFn();
          connection = connectionFn({ name: 'failure' }, function () {
            return monad as unknown as ReturnType<typeof connectionMonadFn>;
          });
          monad.release = function () {
            return Promise.resolve();
          };
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('connecting', function () {
            monad.raise('failed', new Error('bummer'));
          });
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('failed', function () {
            done();
          });
        });
      });

      it('should transition to failed status', function () {
        expect((connection as unknown as { currentState: string }).currentState).toBe('failed');
      });

      describe('implicitly (due to operation)', function () {
        let error: Error;

        beforeAll(function () {
          return new Promise<void>((done) => {
            monad.createChannel = function () {
              return Promise.reject(new Error(':( no can do'));
            };
            (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('connecting', function () {
              monad.raise('failed', new Error('connection failed'));
            });
            (connection as unknown as { once: (ev: string, fn: (err: Error) => void) => void }).once('failed', function (err: Error) {
              error = err;
              done();
            });
            (connection as unknown as { getChannel: () => void }).getChannel();
            monad.raise('acquiring');
          });
        });

        it('should fail to create channel', function () {
          expect(error.toString()).toContain('connection failed');
        });

        it('should transition to failed status', function () {
          expect((connection as unknown as { currentState: string }).currentState).toBe('failed');
        });
      });

      describe('explicitly', function () {
        beforeAll(function () {
          return new Promise<void>((done) => {
            (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('failed', function () {
              done();
            });
            (connection as unknown as { on: (ev: string, fn: () => void) => void }).on('connecting', function () {
              monad.raise('failed', new Error('bummer'));
            });
            (connection as unknown as { connect: () => void }).connect();
          });
        });

        it('should transition to failed status', function () {
          expect((connection as unknown as { currentState: string }).currentState).toBe('failed');
        });
      });
    });
  });

  describe('when connection is available', function () {
    describe('when first node fails', function () {
      let connection: ReturnType<typeof connectionFn>;
      let monad: MonadInstance;
      let badEvent: boolean | undefined;
      let onAcquiring: { off: () => void };

      beforeAll(function () {
        return new Promise<void>((done) => {
          const attempts = ['acquired', 'failed'];
          monad = connectionMonadFn();
          connection = connectionFn({ name: 'success' }, function () {
            return monad as unknown as ReturnType<typeof connectionMonadFn>;
          });
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('connected', function () {
            onAcquiring.off();
            done();
          });
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('reconnected', function () {
            badEvent = true;
          });
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('failed', function () {
            process.nextTick(function () {
              (connection as unknown as { connect: () => void }).connect();
            });
          });
          onAcquiring = (connection as unknown as { on: (ev: string, fn: () => void) => { off: () => void } }).on('connecting', function () {
            const ev = attempts.pop()!;
            process.nextTick(function () {
              monad.raise(ev);
            });
          });
        });
      });

      it('should transition to connected status', function () {
        expect((connection as unknown as { currentState: string }).currentState).toBe('connected');
      });

      it('should not emit reconnected', function () {
        expect(badEvent).toBeUndefined();
      });
    });

    describe('when connecting (with failed initial attempt)', function () {
      let connection: ReturnType<typeof connectionFn>;
      let monad: MonadInstance;
      let badEvent: boolean | undefined;
      let onAcquiring: { off: () => void };
      let channel: EventEmitter & { release: () => void };

      beforeAll(function () {
        return new Promise<void>((done) => {
          const attempts = ['acquired', 'failed'];
          monad = connectionMonadFn();
          connection = connectionFn({ name: 'success' }, function () {
            return monad as unknown as ReturnType<typeof connectionMonadFn>;
          });
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('connected', function () {
            onAcquiring.off();
            done();
          });
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('reconnected', function () {
            badEvent = true;
          });
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('failed', function () {
            process.nextTick(function () {
              (connection as unknown as { connect: () => void }).connect();
            });
          });
          onAcquiring = (connection as unknown as { on: (ev: string, fn: () => void) => { off: () => void } }).on('connecting', function () {
            const ev = attempts.pop()!;
            process.nextTick(function () {
              monad.raise(ev);
            });
          });
        });
      });

      it('should transition to connected status', function () {
        expect((connection as unknown as { currentState: string }).currentState).toBe('connected');
      });

      it('should not emit reconnected', function () {
        expect(badEvent).toBeUndefined();
      });

      describe('when acquiring a channel', function () {
        beforeAll(function () {
          monad.createChannel = function () {
            return Promise.resolve(new EventEmitter());
          };
        });

        it('should create channel', function () {
          return (connection as unknown as { getChannel: (name: string, confirm: boolean, context: string) => Promise<EventEmitter & { release: () => void }> })
            .getChannel('test', false, 'testing channel creation')
            .then(function (x) {
              channel = x;
            });
        });

        afterAll(function () {
          channel.release();
        });
      });

      describe('when closing with queues', function () {
        const queue = { release: vi.fn(() => Promise.resolve(true)) };

        beforeAll(function () {
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);

          monad.release = function () {
            monad.raise('released');
            return Promise.resolve();
          };

          return (connection as unknown as { close: () => Promise<void> }).close();
        });

        it('should have destroyed all queues before closing', function () {
          expect(queue.release).toHaveBeenCalledTimes(5);
        });

        afterAll(function () {
          monad.release = () => Promise.resolve();
          queue.release.mockClear();
        });
      });

      describe('when closing with queues after lost connection', function () {
        const queue = { release: vi.fn(() => Promise.resolve(true)) };

        beforeAll(function () {
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);
          (connection as unknown as { addQueue: (q: unknown) => void }).addQueue(queue);

          monad.raise('released');

          return (connection as unknown as { close: () => Promise<void> }).close();
        });

        it('should not attempt to release queues', function () {
          expect(queue.release).not.toHaveBeenCalled();
        });
      });

      describe('when connection is lost', function () {
        let onAcquired: { off: () => void };

        beforeAll(function () {
          onAcquired = (connection as unknown as { on: (ev: string, fn: () => void) => { off: () => void } }).on('connecting', function () {
            monad.raise('acquired');
          });
          (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('closed', function () {
            monad.raise('acquiring');
          });
          setTimeout(function () {
            channel.emit('acquired');
          }, 500);
          return (connection as unknown as { connect: () => Promise<void> }).connect()
            .then(function () {
              (connection as unknown as { addQueue: (q: unknown) => void }).addQueue({});
              (connection as unknown as { addQueue: (q: unknown) => void }).addQueue({});
              (connection as unknown as { addQueue: (q: unknown) => void }).addQueue({});
            }, console.log);
        });

        it('it should emit reconnected after a loss', function () {
          return new Promise<void>((done) => {
            (connection as unknown as { once: (ev: string, fn: () => void) => void }).once('reconnected', function () {
              done();
            });
            monad.raise('closed');
          });
        });

        afterAll(function () {
          onAcquired.off();
        });
      });
    });
  });
});
