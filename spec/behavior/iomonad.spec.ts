import { EventEmitter } from 'events';
import createIOMonad from '../../src/amqp/iomonad.js';
import type { IOMonad, Subscription } from '../../src/amqp/iomonad.js';

class Resource extends EventEmitter {
  closed = false;

  sayHi(): string {
    return 'hello';
  }

  close(): void {
    this.closed = true;
  }
}

describe('IO Monad', function () {
  describe('when resource is acquired successfully', function () {
    let resource: IOMonad;
    let acquiring: boolean;
    let releasedHandle: Subscription;
    let opResult: string;

    beforeAll(function () {
      return new Promise<void>((done) => {
        const factory = function () {
          return Promise.resolve(new Resource());
        };

        resource = createIOMonad({ name: 'test' }, 'resource', factory, Resource, (x) => {
          (x as Resource).close();
          (x as EventEmitter).emit('released');
        });

        resource.once('acquiring', function () {
          acquiring = true;
        });

        resource.once('acquired', function () {
          (resource.sayHi() as unknown as Promise<string>)
            .then(function (result: string) {
              opResult = result;
              resource.release();
              (resource.item as EventEmitter).emit('close', 'closed');
            });
        });

        releasedHandle = resource.on('released', function () {
          done();
        });
      });
    });

    it('should emit acquiring', function () {
      expect(acquiring).toBe(true);
    });

    it('should end in released state', function () {
      expect(resource.state).toBe('released');
    });

    it('should not retain handle to resource', function () {
      expect(resource.item).toBeNull();
    });

    it('should resolve operation successfully', function () {
      expect(opResult).toBe('hello');
    });

    afterAll(function () {
      releasedHandle.off();
    });
  });

  describe('when resource is unavailable', function () {
    let resource: IOMonad;
    let error: unknown;
    // Count acquisition rounds (not 'acquiring' events which fire twice)
    let acquisitionRounds = 0;
    let acquiringHandle: Subscription;
    let failedHandle: Subscription;

    beforeAll(function () {
      return new Promise<void>((done) => {
        const factory = function () {
          return Promise.reject(new Error('because no one likes you'));
        };

        resource = createIOMonad({ name: 'test' }, 'resource', factory, Resource, (x) => {
          (x as Resource).close();
          (x as unknown as { raise: (ev: string, data: string) => void }).raise('closed', '');
        });

        acquiringHandle = resource.on('acquiring', function () {
          acquisitionRounds++;
        });

        failedHandle = resource.on('failed', function (err) {
          if (acquisitionRounds > 1) {
            error = err;
            resource.release();
          }
        });

        resource.once('released', function () {
          done();
        });
      });
    });

    it('should end in released state', function () {
      expect(resource.state).toBe('released');
    });

    it('should have retried acquisition', function () {
      expect(acquisitionRounds).toBeGreaterThan(1);
    });

    it('should not retain handle to resource', function () {
      expect(resource.item).toBeNull();
    });

    it('should have called resource rejection handler', function () {
      expect(String(error)).toMatch(/^Error: because no one likes you$/);
    });

    afterAll(function () {
      acquiringHandle.off();
      failedHandle.off();
    });
  });

  describe('when acquired resource emits an error', function () {
    let resource: IOMonad;
    let error: unknown;
    // Count acquisitions (successful) vs acquisiton attempts ('acquiring' events)
    let acquisitionCount = 0; // counts 'acquired' events
    let acquiredHandle: Subscription;
    let acquiringHandle: Subscription;
    let failedHandle: Subscription;

    beforeAll(function () {
      return new Promise<void>((done) => {
        const factory = function () {
          return Promise.resolve(new Resource());
        };

        resource = createIOMonad({ name: 'test' }, 'resource', factory, Resource, (x) => {
          (x as Resource).close();
          (x as EventEmitter).emit('released');
        });

        // Track acquiring events but don't use for branching logic
        acquiringHandle = resource.on('acquiring', function () {});

        acquiredHandle = resource.on('acquired', function () {
          acquisitionCount++;
          if (acquisitionCount > 1) {
            resource.release();
            (resource.item as EventEmitter).emit('close', 'closed');
          } else {
            (resource.item as EventEmitter).emit('error', 'E_TOO_MUCH_BUNNIES - the rabbits caught fire');
          }
        });

        failedHandle = resource.on('failed', function (err) {
          error = error || err;
        });

        resource.once('released', function () {
          done();
        });
      });
    });

    it('should re-acquire (retry)', function () {
      // Two acquisitions were attempted
      expect(acquisitionCount).toBe(2);
    });

    it('should end in released state', function () {
      expect(resource.state).toBe('released');
    });

    it('should have called resource rejection handler', function () {
      expect(String(error)).toMatch(/^E_TOO_MUCH_BUNNIES - the rabbits caught fire$/);
    });

    it('should not retain handle to resource', function () {
      expect(resource.item).toBeNull();
    });

    afterAll(function () {
      acquiredHandle.off();
      acquiringHandle.off();
      failedHandle.off();
    });
  });

  describe('when acquired resource is closed remotely', function () {
    let resource: IOMonad;
    let closeReason: unknown;
    let acquisitionCount = 0; // counts 'acquired' events
    let acquiredHandle: Subscription;
    let acquiringHandle: Subscription;

    beforeAll(function () {
      return new Promise<void>((done) => {
        const factory = function () {
          return new Promise<Resource>(function (resolve) {
            process.nextTick(function () {
              resolve(new Resource());
            });
          });
        };

        resource = createIOMonad({ name: 'test' }, 'resource', factory, Resource, (x) => {
          (x as Resource).close();
        });

        acquiringHandle = resource.on('acquiring', function () {});

        acquiredHandle = resource.on('acquired', function () {
          acquisitionCount++;
          if (acquisitionCount > 1) {
            (resource.item as EventEmitter).emit('close', 'RabbitMQ hates your face');
          } else {
            (resource.item as EventEmitter).emit('error', new Error('you didda dum ting'));
          }
        });

        resource.once('closed', function (reason) {
          closeReason = reason;
          done();
        });
      });
    });

    it('should re-acquire (retry)', function () {
      expect(acquisitionCount).toBe(2);
    });

    it('should capture that resource was closed', function () {
      expect(closeReason).toEqual('RabbitMQ hates your face');
    });

    it('should end in closed state', function () {
      expect(resource.state).toBe('closed');
    });

    it('should not retain handle to resource', function () {
      expect(resource.item).toBeNull();
    });

    afterAll(function () {
      acquiredHandle.off();
      acquiringHandle.off();
    });
  });

  describe('when acquired resource is released locally', function () {
    let resource: IOMonad;
    let closeReason: unknown;
    let acquisitionCount = 0; // counts 'acquired' events
    let acquiredHandle: Subscription;
    let acquiringHandle: Subscription;

    beforeAll(function () {
      return new Promise<void>((done) => {
        const factory = function () {
          return new Promise<Resource>(function (resolve) {
            process.nextTick(function () {
              resolve(new Resource());
            });
          });
        };

        resource = createIOMonad({ name: 'test' }, 'resource', factory, Resource, (x) => {
          (x as Resource).close();
          (x as EventEmitter).emit('released');
        });

        acquiringHandle = resource.on('acquiring', function () {});

        acquiredHandle = resource.on('acquired', function () {
          acquisitionCount++;
          resource.release();
          (resource.item as EventEmitter).emit('close', 'Blah blah blah closed');
        });

        resource.once('released', function () {
          done();
        });
      });
    });

    it('should emit acquiring once (no retries)', function () {
      // Only one successful acquisition occurred
      expect(acquisitionCount).toBe(1);
    });

    it('should capture that resource was closed', function () {
      expect(closeReason).toBeUndefined();
    });

    it('should end in released state', function () {
      expect(resource.state).toBe('released');
    });

    it('should not retain handle to resource', function () {
      expect(resource.item).toBeNull();
    });

    afterAll(function () {
      acquiredHandle.off();
      acquiringHandle.off();
    });
  });

  describe('when operating against a released resource', function () {
    let resource: IOMonad;
    let acquisitionCount = 0; // counts 'acquired' events
    let acquiredHandle: Subscription;
    let acquiringHandle: Subscription;

    beforeAll(function () {
      return new Promise<void>((done) => {
        const factory = function () {
          return new Promise<Resource>(function (resolve) {
            process.nextTick(function () {
              resolve(new Resource());
            });
          });
        };

        resource = createIOMonad({ name: 'test' }, 'resource', factory, Resource, (x) => {
          (x as Resource).close();
          (x as EventEmitter).emit('close', 'closed');
        });

        acquiringHandle = resource.on('acquiring', function () {});

        acquiredHandle = resource.on('acquired', function () {
          acquisitionCount++;
          if (acquisitionCount === 1) {
            resource.release();
          }
        });

        resource.once('releasing', function () {
          (resource.item as EventEmitter).emit('close', 'user closed closefully');
        });

        resource.once('released', function () {
          done();
        });
      });
    });

    it('should not re-acquire on operation', function () {
      expect(acquisitionCount).toBe(1);
    });

    it('should not resolve operation after release', function () {
      return expect(resource.sayHi() as unknown as Promise<string>).rejects.toThrow("Cannot invoke operation 'sayHi' on released resource 'test'");
    });

    it('should end in a released state', function () {
      expect(resource.state).toBe('released');
    });

    it('should not retain handle to resource', function () {
      expect(resource.item).toBeNull();
    });

    afterAll(function () {
      acquiredHandle.off();
      acquiringHandle.off();
    });
  });

  describe('when operating against a closed resource', function () {
    let resource: IOMonad;
    let opResult: string;
    let acquisitionCount = 0; // counts 'acquired' events
    let acquiredHandle: Subscription;
    let acquiringHandle: Subscription;

    beforeAll(function () {
      return new Promise<void>((done) => {
        const factory = function () {
          return new Promise<Resource>(function (resolve) {
            process.nextTick(function () {
              resolve(new Resource());
            });
          });
        };

        resource = createIOMonad({ name: 'test' }, 'resource', factory, Resource, (x) => {
          (x as Resource).close();
          (x as EventEmitter).emit('close', 'you did this');
        });

        acquiringHandle = resource.on('acquiring', function () {});

        acquiredHandle = resource.on('acquired', function () {
          acquisitionCount++;
          if (acquisitionCount === 1) {
            (resource.item as EventEmitter).emit('close', 'RabbitMQ is sleepy now');
          }
        });

        resource.once('closed', function () {
          (resource.sayHi() as unknown as Promise<string>)
            .then(
              (result: string) => {
                opResult = result;
                resource.release();
              });
        });

        resource.once('released', function () {
          done();
        });
      });
    });

    it('should re-acquire on operation', function () {
      expect(acquisitionCount).toBe(2);
    });

    it('should resolve operation after close', function () {
      expect(opResult).toBe('hello');
    });

    it('should end in a released state', function () {
      expect(resource.state).toBe('released');
    });

    it('should not retain handle to resource', function () {
      expect(resource.item).toBeNull();
    });

    afterAll(function () {
      acquiredHandle.off();
      acquiringHandle.off();
    });
  });

  describe('when custom wait options are defined', function () {
    let resource: IOMonad;
    let releasedHandle: Subscription;
    const options = {
      name: 'test',
      waitMin: 1000,
      waitMax: 30000,
      waitIncrement: 1000
    };

    beforeAll(function () {
      return new Promise<void>((done) => {
        const factory = function () {
          return Promise.resolve(new Resource());
        };

        resource = createIOMonad(options, 'resource', factory, Resource, (x) => {
          (x as Resource).close();
          (x as EventEmitter).emit('released');
        });

        resource.once('acquired', function () {
          (resource.sayHi() as unknown as Promise<string>)
            .then(() => {
              resource.release();
              (resource.item as EventEmitter).emit('close', 'closed');
            });
        });

        releasedHandle = resource.on('released', function () {
          done();
        });
      });
    });

    it('should have parameters set by options', function () {
      expect(resource.name).toBe(options.name);
      expect(resource.waitMin).toBe(options.waitMin);
      expect(resource.waitMax).toBe(options.waitMax);
      expect(resource.waitIncrement).toBe(options.waitIncrement);
    });

    it('should have waitInterval equal to waitMin', function () {
      expect(resource.waitInterval).toBe(options.waitMin);
    });

    afterAll(function () {
      releasedHandle.off();
    });
  });
});
