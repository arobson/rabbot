require('../setup.js')
const Monad = require('../../src/amqp/iomonad.js')
const EventEmitter = require('events')
const util = require('util')

const Resource = function () {
  this.closed = false
  EventEmitter.call(this)
}

util.inherits(Resource, EventEmitter)

Resource.prototype.sayHi = function () {
  return 'hello'
}

Resource.prototype.close = function () {
  this.closed = true
  return Promise.resolve(true)
}

describe('IO Monad', function () {
  describe('when resource is acquired successfully', function () {
    let resource, acquiring, opResult
    before(function () {
      const factory = function () {
        return Promise.resolve(new Resource())
      }

      resource = Monad({ name: 'acq-success' }, 'resource', factory, Resource, (x) => {
        x.close()
        return Promise.resolve()
      })

      resource.once('acquiring', function () {
        acquiring = true
      })

      resource.once('acquired', function () {
        opResult = resource.sayHi()
          .then(function (result) {
            opResult = result
            resource.release()
            resource._delegate('close', 'closed')
          })
      })
      return resource.after('released')
    })

    it('should emit acquiring', function () {
      acquiring.should.equal(true)
    })

    it('should end in released state', function () {
      resource.currentState.should.equal('released')
    })

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item)
    })

    it('should resolve operation successfully', function () {
      opResult.should.equal('hello')
    })

    after(function () {
      resource.cleanup()
    })
  })

  describe('when resource is unavailable', function () {
    let resource, error
    let acquiring = 0
    before(function (done) {
      const factory = function () {
        return Promise.reject(new Error('just to be silly'))
      }

      resource = Monad({ name: 'unavailable' }, 'resource', factory, Resource, (x) => {
        x.close()
        x.raise('closed', '')
        return Promise.resolve()
      })

      resource.on('acquiring', function () {
        acquiring++
      })

      resource.on('failed', function (e, err) {
        if (acquiring > 1) {
          error = err
          resource.release()
        }
      })

      resource.once('released', function () {
        done()
      })
    })

    it('should end in released state', function () {
      resource.currentState.should.equal('released')
    })

    it('should have retried acquisition', function () {
      acquiring.should.be.greaterThan(1)
    })

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item)
    })

    it('should have called resource rejection handler', function () {
      error.should.match(/^Error: just to be silly$/)
    })

    after(function () {
      resource.cleanup()
    })
  })

  describe('when acquired resource emits an error', function () {
    let resource, error
    let acquiring = 0
    before(function (done) {
      const factory = function () {
        return Promise.resolve(new Resource())
      }

      resource = Monad({ name: 'error-emitter' }, 'resource', factory, Resource, (x) => {
        x.close()
        return Promise.resolve()
      })

      resource.on('acquiring', function () {
        acquiring++
      })

      resource.on('acquired', function () {
        if (acquiring > 1) {
          resource.release()
          resource._delegate('close', 'closed')
        } else {
          resource._delegate('error', 'E_TOO_MUCH_BUNNIES - there are too many')
        }
      })

      resource.on('failed', function (ev, err) {
        error = error || err
      })

      resource.once('released', function () {
        done()
      })
    })

    it('should re-acquire (retry)', function () {
      acquiring.should.equal(2)
    })

    it('should end in released state', function () {
      resource.currentState.should.equal('released')
    })

    it('should have called resource rejection handler', function () {
      error.should.match(/^E_TOO_MUCH_BUNNIES - there are too many$/)
    })

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item)
    })

    after(function () {
      resource.cleanup()
    })
  })

  describe('when acquired resource is closed remotely', function () {
    let resource, closeReason
    let acquiring = 0
    before(function (done) {
      const factory = function () {
        return new Promise(function (resolve) {
          process.nextTick(function () {
            resolve(new Resource())
          })
        })
      }

      resource = Monad({ name: 'remote-close' }, 'resource', factory, Resource, (x) => {
        x.close()
        return Promise.resolve()
      })

      resource.on('acquiring', function () {
        acquiring++
      })

      resource.on('acquired', function () {
        if (acquiring > 1) {
          resource._delegate('close', 'RabbitMQ hates your face')
        } else {
          resource._delegate('error', new Error('this does not work'))
        }
      })

      resource.once('closed', function (ev, reason) {
        closeReason = reason
        done()
      })
    })

    it('should re-acquire (retry)', function () {
      acquiring.should.equal(2)
    })

    it('should capture that resource was closed', function () {
      closeReason.should.eql('RabbitMQ hates your face')
    })

    it('should end in closed state', function () {
      resource.currentState.should.equal('closed')
    })

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item)
    })

    after(function () {
      resource.cleanup()
    })
  })

  describe('when acquired resource is released locally', function () {
    let resource, closeReason
    let acquiring = 0
    before(function (done) {
      const factory = function () {
        return new Promise(function (resolve) {
          process.nextTick(function () {
            resolve(new Resource())
          })
        })
      }

      resource = Monad({ name: 'local-release' }, 'resource', factory, Resource, (x) => {
        x.close()
        return Promise.resolve()
      })

      resource.on('acquiring', function () {
        acquiring++
      })

      resource.on('acquired', function () {
        resource.release()
        resource._delegate('close', 'Blah blah blah closed')
      })

      resource.once('released', function () {
        done()
      })
    })

    it('should emit acquiring once (no retries)', function () {
      acquiring.should.equal(1)
    })

    it('should capture that resource was closed', function () {
      should.not.exist(closeReason)
    })

    it('should end in released state', function () {
      resource.currentState.should.equal('released')
    })

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item)
    })

    after(function () {
      resource.cleanup()
    })
  })

  describe('when operating against a released resource', function () {
    let resource
    let acquiring = 0
    before(function (done) {
      const factory = function () {
        return new Promise(function (resolve) {
          process.nextTick(function () {
            resolve(new Resource())
          })
        })
      }

      resource = Monad({ name: 'released' }, 'resource', factory, Resource, (x) => {
        x.close()
        return Promise.resolve()
      })

      resource.on('acquiring', function () {
        acquiring++
      })

      resource.on('acquired', function () {
        if (acquiring === 1) {
          resource.release()
        }
      })

      resource.once('releasing', function () {
        resource._delegate('close', 'user closed closefully')
      })

      resource.once('released', function () {
        done()
      })
    })

    it('should not re-acquire on operation', function () {
      acquiring.should.equal(1)
    })

    it('should not resolve operation after release', function () {
      return resource.sayHi().should.be.rejectedWith("Cannot invoke operation 'sayHi' on released resource 'released'")
    })

    it('should end in a released state', function () {
      resource.currentState.should.equal('released')
    })

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item)
    })

    after(function () {
      resource.cleanup()
    })
  })

  describe('when operating against a closed resource', function () {
    let resource, opResult
    let acquiring = 0
    before(function (done) {
      const factory = function () {
        return new Promise(function (resolve) {
          process.nextTick(function () {
            resolve(new Resource())
          })
        })
      }

      resource = Monad({ name: 'closed' }, 'resource', factory, Resource, (x) => {
        x.close()
        return Promise.resolve()
      })

      resource.on('acquiring', function () {
        acquiring++
      })

      resource.on('acquired', function () {
        if (acquiring === 1) {
          resource._delegate('close', 'RabbitMQ is sleepy now')
        }
      })

      resource.once('closed', function () {
        opResult = resource.sayHi()
          .then(
            (result) => {
              opResult = result
              resource.release()
            })
      })

      resource.once('released', function () {
        done()
      })
    })

    it('should re-acquire on operation', function () {
      acquiring.should.equal(2)
    })

    it('should resolve operation after close', function () {
      opResult.should.equal('hello')
    })

    it('should end in a released state', function () {
      resource.currentState.should.equal('released')
    })

    it('should not retain handle to resource', function () {
      should.not.exist(resource.item)
    })

    after(function () {
      resource.cleanup()
    })
  })

  describe('when custom wait options are defined', function () {
    let resource
    const options = {
      name: 'test',
      waitMin: 1000,
      waitMax: 30000,
      waitIncrement: 1000
    }
    before(function (done) {
      const factory = function () {
        return Promise.resolve(new Resource())
      }

      resource = Monad(options, 'custom', factory, Resource, (x) => {
        x.close()
        return Promise.resolve()
      })

      resource.once('acquired', function () {
        resource.sayHi()
          .then((result) => {
            resource.release()
            resource._delegate('close', 'closed')
          })
      })

      resource.on('released', function () {
        done()
      })
    })

    it('should have parameters set by options', function () {
      resource.name.should.equal(options.name)
      resource.waitMin.should.equal(options.waitMin)
      resource.waitMax.should.equal(options.waitMax)
      resource.waitIncrement.should.equal(options.waitIncrement)
    })

    it('should have waitInterval equal to waitMin', function () {
      resource.waitInterval.should.equal(options.waitMin)
    })

    after(function () {
      resource.cleanup()
    })
  })
})
