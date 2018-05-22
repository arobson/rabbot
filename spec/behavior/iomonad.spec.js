require('../setup.js');
var Monad = require('../../src/amqp/iomonad.js');
var EventEmitter = require('events');
var util = require('util');

var Resource = function () {
  this.closed = false;
  EventEmitter.call(this);
};

util.inherits(Resource, EventEmitter);

Resource.prototype.sayHi = function () {
  return 'hello';
};

Resource.prototype.close = function () {
  this.closed = true;
};

describe('IO Monad', function () {
  describe('when resource is acquired successfully', function () {
    var resource, acquiring, releasedHandle, opResult;
    before(function (done) {
      var factory = function () {
        return Promise.resolve(new Resource());
      };

      resource = new Monad({ name: 'test' }, 'resource', factory, Resource, (x) => {
        x.close();
        x.emit('released');
      });

      resource.once('acquiring', function () {
        acquiring = true;
      });

      resource.once('acquired', function () {
        opResult = resource.sayHi()
          .then(function (result) {
            opResult = result;
            resource.release();
            resource.item.emit('close', 'closed');
          });
      });

      releasedHandle = resource.on('released', function () {
        done();
      });
    });

    it('should emit acquiring', function () {
      acquiring.should.equal(true);
    });

    it('should end in released state', function () {
      resource.state.should.equal('released');
    });

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item);
    });

    it('should resolve operation successfully', function () {
      opResult.should.equal('hello');
    });

    after(function () {
      releasedHandle.off();
    });
  });

  describe('when resource is unavailable', function () {
    var resource, error;
    var acquiring = 0;
    var acquiringHandle, failedHandle;
    before(function (done) {
      var factory = function () {
        return Promise.reject(new Error('because no one likes you'));
      };

      resource = new Monad({ name: 'test' }, 'resource', factory, Resource, (x) => {
        x.close();
        x.raise('closed', '');
      });
      acquiringHandle = resource.on('acquiring', function () {
        acquiring++;
      });

      failedHandle = resource.on('failed', function (err) {
        if (acquiring > 1) {
          error = err;
          resource.release();
        }
      });

      resource.once('released', function () {
        done();
      });
    });

    it('should end in released state', function () {
      resource.state.should.equal('released');
    });

    it('should have retried acquisition', function () {
      acquiring.should.be.greaterThan(1);
    });

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item);
    });

    it('should have called resource rejection handler', function () {
      error.should.match(/^Error: because no one likes you$/);
    });

    after(function () {
      acquiringHandle.off();
      failedHandle.off();
    });
  });

  describe('when acquired resource emits an error', function () {
    var resource, error;
    var acquiring = 0;
    var acquiredHandle, acquiringHandle, failedHandle;
    before(function (done) {
      var factory = function () {
        return Promise.resolve(new Resource());
      };

      resource = new Monad({ name: 'test' }, 'resource', factory, Resource, (x) => {
        x.close();
        x.emit('released');
      });

      acquiringHandle = resource.on('acquiring', function () {
        acquiring++;
      });

      acquiredHandle = resource.on('acquired', function () {
        if (acquiring > 1) {
          resource.release();
          resource.item.emit('close', 'closed');
        } else {
          resource.item.emit('error', 'E_TOO_MUCH_BUNNIES - the rabbits caught fire');
        }
      });

      failedHandle = resource.on('failed', function (err) {
        error = error || err;
      });

      resource.once('released', function () {
        done();
      });
    });

    it('should re-acquire (retry)', function () {
      acquiring.should.equal(2);
    });

    it('should end in released state', function () {
      resource.state.should.equal('released');
    });

    it('should have called resource rejection handler', function () {
      error.should.match(/^E_TOO_MUCH_BUNNIES - the rabbits caught fire$/);
    });

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item);
    });

    after(function () {
      acquiredHandle.off();
      acquiringHandle.off();
      failedHandle.off();
    });
  });

  describe('when acquired resource is closed remotely', function () {
    var resource, closeReason;
    var acquiring = 0;
    var acquiredHandle, acquiringHandle;
    before(function (done) {
      var factory = function () {
        return new Promise(function (resolve) {
          process.nextTick(function () {
            resolve(new Resource());
          });
        });
      };

      resource = new Monad({ name: 'test' }, 'resource', factory, Resource, (x) => {
        x.close();
      });

      acquiringHandle = resource.on('acquiring', function () {
        acquiring++;
      });

      acquiredHandle = resource.on('acquired', function () {
        if (acquiring > 1) {
          resource.item.emit('close', 'RabbitMQ hates your face');
        } else {
          resource.item.emit('error', new Error('you didda dum ting'));
        }
      });

      resource.once('closed', function (reason) {
        closeReason = reason;
        done();
      });
    });

    it('should re-acquire (retry)', function () {
      acquiring.should.equal(2);
    });

    it('should capture that resource was closed', function () {
      closeReason.should.eql('RabbitMQ hates your face');
    });

    it('should end in closed state', function () {
      resource.state.should.equal('closed');
    });

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item);
    });

    after(function () {
      acquiredHandle.off();
      acquiringHandle.off();
    });
  });

  describe('when acquired resource is released locally', function () {
    var resource, closeReason;
    var acquiring = 0;
    var acquiredHandle, acquiringHandle;
    before(function (done) {
      var factory = function () {
        return new Promise(function (resolve) {
          process.nextTick(function () {
            resolve(new Resource());
          });
        });
      };

      resource = new Monad({ name: 'test' }, 'resource', factory, Resource, (x) => {
        x.close();
        x.emit('released');
      });

      acquiringHandle = resource.on('acquiring', function () {
        acquiring++;
      });

      acquiredHandle = resource.on('acquired', function () {
        resource.release();
        resource.item.emit('close', 'Blah blah blah closed');
      });

      resource.once('released', function () {
        done();
      });
    });

    it('should emit acquiring once (no retries)', function () {
      acquiring.should.equal(1);
    });

    it('should capture that resource was closed', function () {
      should.not.exist(closeReason);
    });

    it('should end in released state', function () {
      resource.state.should.equal('released');
    });

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item);
    });

    after(function () {
      acquiredHandle.off();
      acquiringHandle.off();
    });
  });

  describe('when operating against a released resource', function () {
    var resource;
    var acquiring = 0;
    var acquiredHandle, acquiringHandle;
    before(function (done) {
      var factory = function () {
        return new Promise(function (resolve) {
          process.nextTick(function () {
            resolve(new Resource());
          });
        });
      };

      resource = new Monad({ name: 'test' }, 'resource', factory, Resource, (x) => {
        x.close();
        x.emit('close', 'closed');
      });

      acquiringHandle = resource.on('acquiring', function () {
        acquiring++;
      });

      acquiredHandle = resource.on('acquired', function () {
        if (acquiring === 1) {
          resource.release();
        }
      });

      resource.once('releasing', function () {
        resource.item.emit('close', 'user closed closefully');
      });

      resource.once('released', function () {
        done();
      });
    });

    it('should not re-acquire on operation', function () {
      acquiring.should.equal(1);
    });

    it('should not resolve operation after release', function () {
      return resource.sayHi().should.be.rejectedWith("Cannot invoke operation 'sayHi' on released resource 'test'");
    });

    it('should end in a released state', function () {
      resource.state.should.equal('released');
    });

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item);
    });

    after(function () {
      acquiredHandle.off();
      acquiringHandle.off();
    });
  });

  describe('when operating against a closed resource', function () {
    var resource, opResult;
    var acquiring = 0;
    var acquiredHandle, acquiringHandle;
    before(function (done) {
      var factory = function () {
        return new Promise(function (resolve) {
          process.nextTick(function () {
            resolve(new Resource());
          });
        });
      };

      resource = new Monad({ name: 'test' }, 'resource', factory, Resource, (x) => {
        x.close();
        x.emit('close', 'you did this');
      });

      acquiringHandle = resource.on('acquiring', function () {
        acquiring++;
      });

      acquiredHandle = resource.on('acquired', function () {
        if (acquiring === 1) {
          resource.item.emit('close', 'RabbitMQ is sleepy now');
        }
      });

      resource.once('closed', function () {
        opResult = resource.sayHi()
          .then(
            (result) => {
              opResult = result;
              resource.release();
            });
      });

      resource.once('released', function () {
        done();
      });
    });

    it('should re-acquire on operation', function () {
      acquiring.should.equal(2);
    });

    it('should resolve operation after close', function () {
      opResult.should.equal('hello');
    });

    it('should end in a released state', function () {
      resource.state.should.equal('released');
    });

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item);
    });

    after(function () {
      acquiredHandle.off();
      acquiringHandle.off();
    });
  });

  describe('when custom wait options are defined', function () {
    var resource, releasedHandle;
    var options = {
      name: 'test',
      waitMin: 1000,
      waitMax: 30000,
      waitIncrement: 1000
    };
    before(function (done) {
      var factory = function () {
        return Promise.resolve(new Resource());
      };

      resource = new Monad(options, 'resource', factory, Resource, (x) => {
        x.close();
        x.emit('released');
      });

      resource.once('acquired', function () {
        resource.sayHi()
          .then((result) => {
            resource.release();
            resource.item.emit('close', 'closed');
          });
      });

      releasedHandle = resource.on('released', function () {
        done();
      });
    });

    it('should have parameters set by options', function () {
      resource.name.should.equal(options.name);
      resource.waitMin.should.equal(options.waitMin);
      resource.waitMax.should.equal(options.waitMax);
      resource.waitIncrement.should.equal(options.waitIncrement);
    });

    it('should have waitInterval equal to waitMin', function () {
      resource.waitInterval.should.equal(options.waitMin);
    });

    after(function () {
      releasedHandle.off();
    });
  });
});
