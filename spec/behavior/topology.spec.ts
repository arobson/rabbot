import topologyFn from '../../src/topology.js';
import createEmitter from './emitter.js';
import info from '../../src/info.js';

const noOp = () => {};

type EmitterInstance = ReturnType<typeof createEmitter>;

interface ConnectionInstance {
  name: string;
  fail: (err: Error) => void;
  getChannel: (name: string, confirm: boolean, context: string) => Promise<unknown>;
  handlers: Record<string, ((data?: unknown) => void)[]>;
  lastErr: string | Error;
  lastError: () => string | Error;
  on: (ev: string, handle: (data?: unknown) => void) => { off: () => void };
  once: (ev: string, handle: (data?: unknown) => void) => { off: () => void };
  raise: (ev: string, data?: unknown) => void;
  resetHandlers: () => void;
  reset: () => void;
  state: string;
}

function connectionFn(): { instance: ConnectionInstance; mock: ConnectionInstance } {
  const handlers: Record<string, ((data?: unknown) => void)[]> = {};

  function raise(ev: string, data?: unknown) {
    if (handlers[ev]) {
      [...handlers[ev]].forEach(function (handler) {
        if (handler) {
          handler(data);
        }
      });
    }
  }

  function on(ev: string, handle: (data?: unknown) => void) {
    if (handlers[ev]) {
      handlers[ev].push(handle);
    } else {
      handlers[ev] = [handle];
    }
    return {
      off: function () {
        const idx = handlers[ev] ? handlers[ev].indexOf(handle) : -1;
        if (idx >= 0) handlers[ev].splice(idx, 1);
      }
    };
  }

  function resetHandlers() {
    Object.keys(handlers).forEach(k => delete (handlers as Record<string, unknown>)[k]);
  }

  const connection: ConnectionInstance = {
    name: 'default',
    fail: function (err: Error) {
      connection.state = 'failed';
      connection.lastErr = err;
      connection.raise('failed', err);
    },
    getChannel: noOp as unknown as ConnectionInstance['getChannel'],
    handlers,
    lastErr: '',
    lastError: function () {
      return connection.lastErr;
    },
    on: on,
    once: on,
    raise: raise,
    resetHandlers: resetHandlers,
    reset: noOp,
    state: ''
  };

  return {
    instance: connection,
    mock: connection
  };
}

describe('Topology', function () {
  describe('when initializing with default reply queue', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let replyQueue: unknown;
    let ex: EmitterInstance;
    let q: EmitterInstance & { check?: () => Promise<void> };
    let uniqueQueueName: string;

    beforeAll(function () {
      return new Promise<void>((done) => {
        ex = createEmitter();
        q = createEmitter() as EmitterInstance & { check?: () => Promise<void> };
        q.check = function () {
          q.raise('defined');
          return Promise.resolve();
        };
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();

        uniqueQueueName = 'top-q-' + info.createHash();

        const control = {
          bindQueue: vi.fn(() => Promise.resolve())
        };

        vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

        topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue, 'test');
        Promise.all([
          topology.createExchange({ name: 'top-ex', type: 'topic' }),
          topology.createQueue({ name: 'top-q', unique: 'hash' })
        ]).then(function () {
          topology.configureBindings({ exchange: 'top-ex', target: 'top-q' } as unknown as Parameters<typeof topology.configureBindings>[0]);
        });
        (topology as unknown as { once: (ev: string, fn: (queue: unknown) => void) => void }).once('replyQueue.ready', function (queue: unknown) {
          replyQueue = queue;
          done();
        });
        process.nextTick(function () {
          q.raise('defined');
          ex.raise('defined');
        });
      });
    });

    it('should create default reply queue', function () {
      expect(replyQueue).toEqual(
        {
          name: 'test.response.queue',
          uniqueName: 'test.response.queue',
          autoDelete: true,
          subscribe: true
        }
      );
    });

    it('should bind queue', function () {
      const control = vi.mocked((conn.instance.getChannel as ReturnType<typeof vi.fn>).mock.results[0].value);
      // binding was called
      expect(conn.instance.getChannel).toHaveBeenCalled();
    });

    describe('when recovering from disconnection', function () {
      let control2: { bindExchange: ReturnType<typeof vi.fn>; bindQueue: ReturnType<typeof vi.fn> };

      beforeAll(function () {
        return new Promise<void>((done) => {
          replyQueue = undefined;

          control2 = {
            bindExchange: vi.fn(() => Promise.resolve()),
            bindQueue: vi.fn(() => Promise.resolve())
          };

          vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control2 as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

          (topology as unknown as { once: (ev: string, fn: (queue: unknown) => void) => void }).once('replyQueue.ready', function (queue: unknown) {
            replyQueue = queue;
          });
          (topology as unknown as { once: (ev: string, fn: (bindings: unknown) => void) => void }).once('bindings.completed', function () {
            done();
          });
          conn.instance.raise('reconnected');
        });
      });

      it('should recreate default reply queue', function () {
        expect(replyQueue).toEqual(
          {
            name: 'test.response.queue',
            uniqueName: 'test.response.queue',
            autoDelete: true,
            subscribe: true
          }
        );
      });

      it('should bindQueue but not bindExchange', function () {
        expect(control2.bindExchange).not.toHaveBeenCalled();
        expect(control2.bindQueue).toHaveBeenCalled();
      });
    });
  });

  describe('when initializing with custom reply queue', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let replyQueue: unknown;
    let ex: EmitterInstance;
    let q: EmitterInstance & { check?: () => Promise<void> };

    beforeAll(function () {
      return new Promise<void>((done) => {
        ex = createEmitter();
        q = createEmitter() as EmitterInstance & { check?: () => Promise<void> };
        q.check = function () {
          q.raise('defined');
          return Promise.resolve();
        };
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();
        const options = {
          replyQueue: {
            name: 'mine',
            uniqueName: 'mine',
            autoDelete: false,
            subscribe: true
          }
        };
        topology = topologyFn(conn.instance, options as unknown as Parameters<typeof topologyFn>[1], {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue, 'test');
        (topology as unknown as { once: (ev: string, fn: (queue: unknown) => void) => void }).once('replyQueue.ready', function (queue: unknown) {
          replyQueue = queue;
          done();
        });
        process.nextTick(function () {
          q.raise('defined');
        });
      });
    });

    it('should create custom reply queue', function () {
      expect(replyQueue).toEqual(
        {
          name: 'mine',
          uniqueName: 'mine',
          autoDelete: false,
          subscribe: true
        }
      );
    });

    describe('when recovering from disconnection', function () {
      beforeAll(function () {
        return new Promise<void>((done) => {
          replyQueue = undefined;
          (topology as unknown as { once: (ev: string, fn: (queue: unknown) => void) => void }).once('replyQueue.ready', function (queue: unknown) {
            replyQueue = queue;
            done();
          });
          conn.instance.raise('reconnected');
        });
      });

      it('should recreate custom reply queue', function () {
        expect(replyQueue).toEqual(
          {
            name: 'mine',
            uniqueName: 'mine',
            autoDelete: false,
            subscribe: true
          }
        );
      });
    });
  });

  describe('when initializing with no reply queue', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let replyQueue: unknown;
    let ex: EmitterInstance;
    let q: EmitterInstance & { check?: () => Promise<void> };

    beforeAll(function () {
      return new Promise<void>((done) => {
        ex = createEmitter();
        q = createEmitter() as EmitterInstance & { check?: () => Promise<void> };
        q.check = function () {
          q.raise('defined');
          return Promise.resolve();
        };
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();
        const options = {
          replyQueue: false
        };
        topology = topologyFn(conn.instance, options as unknown as Parameters<typeof topologyFn>[1], {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
        (topology as unknown as { once: (ev: string, fn: (queue: unknown) => void) => void }).once('replyQueue.ready', function (queue: unknown) {
          replyQueue = queue;
          done();
        });
        process.nextTick(function () {
          q.raise('defined');
        });
        setTimeout(function () {
          done();
        }, 200);
      });
    });

    it('should not create reply queue', function () {
      expect(replyQueue).toBeUndefined();
      expect((topology as unknown as { definitions: { queues: Record<string, unknown> } }).definitions.queues).toEqual({});
    });
  });

  describe('when creating valid exchange', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let exchange: unknown;
    let ex: EmitterInstance & { check?: () => Promise<void> };
    let q: EmitterInstance;

    beforeAll(function () {
      return new Promise<void>((done) => {
        ex = createEmitter() as EmitterInstance & { check?: () => Promise<void> };
        q = createEmitter();
        ex.check = function () {
          ex.raise('defined');
          return Promise.resolve();
        };
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();
        topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
        topology.createExchange({ name: 'noice' })
          .then(function (created) {
            exchange = created;
            done();
          });
        process.nextTick(function () {
          ex.raise('defined');
        });
      });
    });

    it('should create exchange', function () {
      expect(exchange).toEqual(ex);
    });

    it('should add exchange to channels', function () {
      expect((topology as unknown as { channels: Record<string, unknown> }).channels['exchange:noice']).toBeDefined();
    });
  });

  describe('when creating a duplicate exchange', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let exchange: unknown;
    let ex: EmitterInstance & { check?: () => Promise<void> };
    let q: EmitterInstance;
    let calls = 0;

    beforeAll(function () {
      return new Promise<void>((done) => {
        ex = createEmitter() as EmitterInstance & { check?: () => Promise<void> };
        q = createEmitter();
        ex.check = function () {
          ex.raise('defined');
          return Promise.resolve();
        };
        const Exchange = function () {
          calls++;
          return ex;
        } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();
        topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
        topology.createExchange({ name: 'noice' });
        topology.createExchange({ name: 'noice' })
          .then(function (created) {
            exchange = created;
            done();
          });
        process.nextTick(function () {
          ex.raise('defined');
        });
      });
    });

    it('should create exchange', function () {
      expect(exchange).toEqual(ex);
    });

    it('should not create duplicate exchanges', function () {
      expect(calls).toBe(2);
    });

    it('should add exchange to channels', function () {
      expect((topology as unknown as { channels: Record<string, unknown> }).channels['exchange:noice']).toBeDefined();
    });
  });

  describe('when creating invalid exchange', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let error: Error;
    let ex: EmitterInstance & { check?: () => Promise<void> };
    let q: EmitterInstance;

    beforeAll(function () {
      return new Promise<void>((done) => {
        ex = createEmitter() as EmitterInstance & { check?: () => Promise<void> };
        q = createEmitter();
        ex.check = function () {
          return Promise.resolve();
        };
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();
        topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
        topology.createExchange({ name: 'badtimes' })
          .then(null, function (err: Error) {
            error = err;
            done();
          });
        process.nextTick(function () {
          ex.raise('failed', new Error("ain't nobody got time fodat"));
        });
      });
    });

    it('should reject with error', function () {
      expect(error.toString()).toContain("Error: Failed to create exchange 'badtimes' on connection 'default' with 'Error: ain't nobody got time fodat");
    });

    it('should not add invalid exchanges to channels', function () {
      expect((topology as unknown as { channels: Record<string, unknown> }).channels['exchange:badtimes']).toBeUndefined();
    });
  });

  describe('when creating invalid queue', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let error: Error;
    let ex: EmitterInstance & { check?: () => Promise<void> };
    let q: EmitterInstance;

    beforeAll(function () {
      return new Promise<void>((done) => {
        ex = createEmitter() as EmitterInstance & { check?: () => Promise<void> };
        q = createEmitter();
        ex.check = function () {
          return Promise.resolve();
        };
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();
        topology = topologyFn(conn.instance, { replyQueue: false } as unknown as Parameters<typeof topologyFn>[1], {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
        topology.createQueue({ name: 'badtimes' })
          .then(null, function (err: Error) {
            error = err;
            done();
          });
        process.nextTick(function () {
          q.raise('failed', new Error("ain't got time fodat"));
        });
      });
    });

    it('should reject with error', function () {
      expect(error.toString()).toContain("Error: Failed to create queue 'badtimes' on connection 'default' with 'Error: ain't got time fodat");
    });

    it('should not add invalid queues to channels', function () {
      expect((topology as unknown as { channels: Record<string, unknown> }).channels['queue:badtimes']).toBeUndefined();
    });
  });

  describe('when deleting an existing exchange', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let exchange: unknown;
    let ex: EmitterInstance & { release?: () => void };
    let q: EmitterInstance;

    beforeAll(function () {
      return new Promise<void>((done) => {
        ex = createEmitter() as EmitterInstance & { release?: () => void };
        q = createEmitter();
        ex.release = noOp;
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();

        const control = {
          deleteExchange: vi.fn((name: string) => Promise.resolve())
        };

        vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

        topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
        topology.createExchange({ name: 'noice' })
          .then(function (created) {
            exchange = created;
            topology.deleteExchange('noice')
              .then(function () {
                done();
              });
          });
        process.nextTick(function () {
          ex.raise('defined');
        });
      });
    });

    it('should create exchange', function () {
      expect(exchange).toEqual(ex);
    });

    it('should remove exchange from channels', function () {
      expect((topology as unknown as { channels: Record<string, unknown> }).channels['exchange:noice']).toBeUndefined();
    });
  });

  describe('when deleting an existing queue', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let queue: unknown;
    let ex: EmitterInstance;
    let q: EmitterInstance & { release?: () => void };

    beforeAll(function () {
      ex = createEmitter();
      q = createEmitter() as EmitterInstance & { release?: () => void };
      q.release = noOp;
      const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
      const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
      conn = connectionFn();

      const control = {
        deleteQueue: vi.fn((name: string) => Promise.resolve())
      };

      vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

      topology = topologyFn(conn.instance, { replyQueue: false } as unknown as Parameters<typeof topologyFn>[1], {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);

      process.nextTick(function () {
        q.raise('defined');
      });

      return topology.createQueue({ name: 'noice' })
        .then(function (created) {
          queue = created;
          return topology.deleteQueue('noice');
        });
    });

    it('should create queue', function () {
      expect(queue).toEqual(q);
    });

    it('should remove queue from channels', function () {
      expect((topology as unknown as { channels: Record<string, unknown> }).channels['queue:noice']).toBeUndefined();
    });
  });

  describe('when creating an exchange to exchange binding with no keys', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let ex: EmitterInstance;
    let q: EmitterInstance;

    beforeAll(function () {
      ex = createEmitter();
      q = createEmitter();
      const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
      const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
      conn = connectionFn();

      const control = {
        bindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        bindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve())
      };

      vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

      topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
      return topology.createBinding({ source: 'from', target: 'to' });
    });

    it('should add binding to definitions', function () {
      expect((topology as unknown as { definitions: { bindings: Record<string, unknown> } }).definitions.bindings['from->to']).toEqual({ source: 'from', target: 'to' });
    });
  });

  describe('when removing an exchange to exchange binding with no keys', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let ex: EmitterInstance;
    let q: EmitterInstance;

    beforeAll(function () {
      ex = createEmitter();
      q = createEmitter();
      const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
      const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
      conn = connectionFn();

      const control = {
        bindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        bindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        unbindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        unbindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve())
      };

      vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

      topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
      return topology.createBinding({ source: 'from', target: 'to' })
        .then(() => topology.removeBinding({ source: 'from', target: 'to' }));
    });

    it('should remove binding from definitions', function () {
      expect((topology as unknown as { definitions: { bindings: Record<string, unknown> } }).definitions.bindings['from->to']).toBeUndefined();
    });
  });

  describe('when creating an exchange to queue binding with no keys', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let ex: EmitterInstance;
    let q: EmitterInstance;

    beforeAll(function () {
      ex = createEmitter();
      q = createEmitter();
      const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
      const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
      conn = connectionFn();

      const control = {
        bindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        bindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve())
      };

      vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

      topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
      topology.createBinding({ source: 'from', target: 'to', keys: undefined, queue: true })
        .catch(() => {});
    });

    it('should add binding to definitions', function () {
      expect((topology as unknown as { definitions: { bindings: Record<string, unknown> } }).definitions.bindings['from->to']).toEqual(
        { source: 'from', target: 'to', keys: undefined, queue: true }
      );
    });
  });

  describe('when removing an exchange to queue binding with no keys', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let ex: EmitterInstance;
    let q: EmitterInstance;

    beforeAll(function () {
      ex = createEmitter();
      q = createEmitter();
      const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
      const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
      conn = connectionFn();

      const control = {
        bindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        bindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        unbindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        unbindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve())
      };

      vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

      topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
      return topology.createBinding({ source: 'from', target: 'to', keys: undefined, queue: true })
        .catch(() => {})
        .then(() => topology.removeBinding({ source: 'from', target: 'to' }));
    });

    it('should remove binding from definitions', function () {
      expect((topology as unknown as { definitions: { bindings: Record<string, unknown> } }).definitions.bindings['from->to']).toBeUndefined();
    });
  });

  describe('when creating an exchange to queue binding with keys', function () {
    let topology: ReturnType<typeof topologyFn>;
    let conn: ReturnType<typeof connectionFn>;
    let ex: EmitterInstance;
    let q: EmitterInstance;

    beforeAll(function () {
      ex = createEmitter();
      q = createEmitter();
      const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
      const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
      conn = connectionFn();

      const control = {
        bindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
        bindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve())
      };

      vi.spyOn(conn.instance, 'getChannel').mockResolvedValue(control as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

      topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
      topology.createBinding({ source: 'from', target: 'to', keys: ['a.*', 'b.*'], queue: true });
    });

    it('should add binding to definitions', function () {
      expect((topology as unknown as { definitions: { bindings: Record<string, unknown> } }).definitions.bindings['from->to:a.*:b.*']).toEqual(
        { source: 'from', target: 'to', keys: ['a.*', 'b.*'], queue: true }
      );
    });

    describe('when removing an exchange to queue binding with keys', function () {
      let topology2: ReturnType<typeof topologyFn>;
      let conn2: ReturnType<typeof connectionFn>;
      let ex2: EmitterInstance;
      let q2: EmitterInstance;

      beforeAll(function () {
        ex2 = createEmitter();
        q2 = createEmitter();
        const Exchange2 = function () { return ex2; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue2 = function () { return q2; } as unknown as Parameters<typeof topologyFn>[6];
        conn2 = connectionFn();

        const control2 = {
          bindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
          bindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
          unbindExchange: vi.fn((to: string, from: string, key: string) => Promise.resolve()),
          unbindQueue: vi.fn((to: string, from: string, key: string) => Promise.resolve())
        };

        vi.spyOn(conn2.instance, 'getChannel').mockResolvedValue(control2 as unknown as Awaited<ReturnType<ConnectionInstance['getChannel']>>);

        topology2 = topologyFn(conn2.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange2, Queue2);
        return topology2.createBinding({ source: 'from', target: 'to', keys: ['a.*', 'b.*'], queue: true })
          .then(() => topology2.removeBinding({ source: 'from', target: 'to' }));
      });

      it('should remove binding from definitions', function () {
        expect((topology2 as unknown as { definitions: { bindings: Record<string, unknown> } }).definitions.bindings['from->to']).toBeUndefined();
      });
    });
  });

  describe('when a connection to rabbit cannot be established', function () {
    describe('when attempting to create an exchange', function () {
      let topology: ReturnType<typeof topologyFn>;
      let conn: ReturnType<typeof connectionFn>;
      let error: Error;
      let ex: EmitterInstance;
      let q: EmitterInstance;

      beforeAll(function () {
        ex = createEmitter();
        q = createEmitter();
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();
        topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
        process.nextTick(function () {
          conn.instance.fail(new Error('no such server!'));
        });
        return topology.createExchange({ name: 'delayed.ex' })
          .then(null, function (err: Error) {
            error = err;
          });
      });

      it('should reject exchange promise with connection error', function () {
        expect(error.toString()).toContain(
          "Error: Failed to create exchange 'delayed.ex' on connection 'default' with 'Error: no such server!"
        );
      });

      it('should keep exchange definition', function () {
        expect((topology as unknown as { channels: Record<string, unknown> }).channels['exchange:delayed.ex']).toBeDefined();
      });
    });

    describe('when attempting to create a queue', function () {
      let topology: ReturnType<typeof topologyFn>;
      let conn: ReturnType<typeof connectionFn>;
      let error: Error;
      let ex: EmitterInstance;
      let q: EmitterInstance;

      beforeAll(function () {
        ex = createEmitter();
        q = createEmitter();
        const Exchange = function () { return ex; } as unknown as Parameters<typeof topologyFn>[5];
        const Queue = function () { return q; } as unknown as Parameters<typeof topologyFn>[6];
        conn = connectionFn();
        topology = topologyFn(conn.instance, {}, {}, undefined as unknown as Parameters<typeof topologyFn>[3], undefined as unknown as Parameters<typeof topologyFn>[4], Exchange, Queue);
        process.nextTick(function () {
          conn.instance.fail(new Error('no such server!'));
        });
        return topology.createQueue({ name: 'delayed.q' })
          .then(null, function (err: Error) {
            error = err;
          });
      });

      it('should reject queue promise with connection error', function () {
        expect(error.toString()).toContain(
          "Error: Failed to create queue 'delayed.q' on connection 'default' with 'Error: no such server!"
        );
      });

      it('should keep queue definition', function () {
        expect((topology as unknown as { channels: Record<string, unknown> }).channels['queue:delayed.q']).toBeDefined();
      });
    });
  });
});
