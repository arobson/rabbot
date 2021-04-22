require('../setup.js')
const _ = require('fauxdash')
const topologyFn = require('../../src/topology')
const noOp = function () {}
const info = require('../../src/info')
const Dispatcher = require('topic-dispatch')

function connectionFn () {
  let handlers = {}

  const connection = {
    name: 'default',
    fail: function (err) {
      this.state = 'failed'
      this.lastErr = err
      this.emit('failed', err)
    },
    getChannel: noOp,
    handlers: handlers,
    lastErr: '',
    lastError: function () {
      return this.lastErr
    },
    state: ''
  }
  const final = _.melter({}, connection, Dispatcher())
  return {
    instance: final,
    mock: sinon.mock(final)
  }
}

function delayedPromise () {
  const {promise, resolve} = _.future()
  setTimeout(() => resolve(), 20)
  return promise
}

function initContext (options, name) {
  const connection = connectionFn()
  const Exchange = function () {
    return ex
  }
  const Queue = function () {
    return q
  }
  Exchange.type = 'exchange'
  Queue.type = 'queue'
  const ex = Dispatcher()
  const q = Dispatcher()
  ex.check = function () {
    return Promise.resolve()
  }
  q.check = function () {
    q.emit('defined')
    return Promise.resolve()
  }
  ex.reconnect = delayedPromise
  ex.release = delayedPromise
  q.reconnect = delayedPromise
  q.release = delayedPromise

  const control = {
    define: noOp,
    bindQueue: noOp,
    bindExchange: noOp,
    deleteExchange: noOp,
    deleteQueue: noOp,
    unbindExchange: noOp,
    unbindQueue: noOp
  }
  controlMock = sinon.mock(control)
  const uniqueQueueName = 'top-q-' + info.createHash()

  const ctx = {
    connection,
    control,
    controlMock,
    createTopology: () => {
      return topologyFn(connection.instance, options || {}, {}, undefined, undefined, Exchange, Queue, name || 'test')
        .then(t => {
          ctx.topology = t
          return t
        })
    },
    emitDefined: (delay = 0) => {
      setTimeout(function () {
        q.emit('defined')
      }, 0 + delay)
      setTimeout(function () {
        ex.emit('defined')
      }, 20 + delay)
    },
    emitFailure: (delay = 0) => {
      setTimeout(function () {
        connection.instance.fail(new Error('no such server!'))
      }, delay)
    },
    ex,
    Exchange,
    expectSuccess: () => {
      connection.mock
        .expects('getChannel')
        .atLeast(1)
        .resolves(control)
    },
    q,
    Queue,
    reconnect: () => {
      connection.instance.emit('reconnected')
    },
    uniqueQueueName
  }
  return ctx
}

describe('Topology', function () {
  describe('when initializing with default reply queue', function () {
    let ctx
    before(function (done) {
      ctx = initContext({})
      ctx.expectSuccess()
      controlMock
        .expects('bindQueue')
        .once()
        .withArgs(ctx.uniqueQueueName, 'top-ex')
        .returns(Promise.resolve())
      ctx.createTopology()
        .then(topology => {
          Promise.all([
            topology.createExchange({ name: 'top-ex', type: 'topic' }),
            topology.createQueue({ name: 'top-q', unique: 'hash' })
          ]).then(function () {
            return topology.configureBindings({ exchange: 'top-ex', target: 'top-q' })
          }).then(function () {
            done()
          })
          ctx.emitDefined()
        })
        ctx.emitDefined()
    })

    it('should create default reply queue', function () {
      ctx.topology.replyQueue.should.eql(
        {
          name: 'test.response.queue',
          uniqueName: 'test.response.queue',
          autoDelete: true,
          subscribe: true
        }
      )
    })

    it('should bind queue', function () {
      ctx.controlMock.verify()
    })

    after(function() {
      ctx.connection.mock.verify()
    })

    describe('when recovering from disconnection', function () {
      before(function (done) {
        ctx.controlMock = sinon.mock(ctx.control)
        ctx.expectSuccess()
        ctx.controlMock
          .expects('bindQueue')
          .once()
          .withArgs(ctx.uniqueQueueName, 'top-ex')
          .returns(Promise.resolve())
        ctx.controlMock
          .expects('bindExchange')
          .never()

        ctx.topology.connection.once('bindings.completed', () => {
          done()
        })
        ctx.reconnect()
        ctx.emitDefined()
      })

      it('should recreate default reply queue', function () {
        ctx.topology.replyQueue.should.eql(
          {
            name: 'test.response.queue',
            uniqueName: 'test.response.queue',
            autoDelete: true,
            subscribe: true
          }
        )
      })

      it('should bindQueue', function () {
        ctx.controlMock.verify()
      })
    })
  })

  describe('when initializing with custom reply queue', function () {
    let ctx

    before(function (done) {
      const options = {
        replyQueue: {
          name: 'mine',
          uniqueName: 'mine',
          autoDelete: false,
          subscribe: true
        }
      }
      ctx = initContext(options)
      ctx.createTopology()
        .then(topology => {
          done()
        })
      ctx.emitDefined()
    })

    it('should create custom reply queue', function () {
      ctx.topology.replyQueue.should.eql(
        {
          name: 'mine',
          uniqueName: 'mine',
          autoDelete: false,
          subscribe: true
        }
      )
    })

    describe('when recovering from disconnection', function () {
      before(function (done) {
        ctx.topology.connection.once('bindings.completed', function (bindings) {
          done()
        })
        ctx.reconnect()
      })

      it('should recreate custom reply queue', function () {
        ctx.topology.replyQueue.should.eql(
          {
            name: 'mine',
            uniqueName: 'mine',
            autoDelete: false,
            subscribe: true
          }
        )
      })
    })
  })

  describe('when initializing with no reply queue', function () {
    let ctx
    before(function (done) {
      const options = {
        replyQueue: false
      }
      ctx = initContext(options)
      ctx.createTopology()
        .then(() => {
          done()
        })
      ctx.emitDefined()
    })

    it('should not create reply queue', function () {
      ctx.topology.definitions.queues.should.eql({})
    })
  })

  describe('when creating valid exchange', function () {
    let ctx
    before(function (done) {
      ctx = initContext()
      ctx.createTopology()
        .then(topology => {
          topology.createExchange({ name: 'noice' })
            .then(function (created) {
              exchange = created
              done()
            })
          ctx.emitDefined()
        })
      ctx.emitDefined()
    })

    it('should create exchange', function () {
      exchange.should.eql(ctx.ex)
    })

    it('should add exchange to channels', function () {
      should.exist(ctx.topology.primitives['exchange:noice'])
    })
  })

  describe('when creating a duplicate exchange', function () {
    let ctx
    before(function (done) {
      ctx = initContext()
      ctx.createTopology()
        .then(topology => {
          topology.createExchange({ name: 'noice' })
          topology.createExchange({ name: 'noice' })
            .then(created => {
              exchange = created
              done()
            })
          ctx.emitDefined()
        })
      ctx.emitDefined()
    })

    it('should create exchange', function () {
      exchange.should.eql(ctx.ex)
    })

    it('should add exchange to channels', function () {
      should.exist(ctx.topology.primitives['exchange:noice'])
    })
  })

  describe('when creating invalid exchange', function () {
    let ctx
    before(function (done) {
      ctx = initContext()
      ctx.createTopology()
        .then(topology => {
          topology.createExchange({ name: 'badtimes' })
            .catch(err => {
              error = err
              done()
            })
          process.nextTick(() => {
            ctx.ex.emit('failed', new Error('time limit exceeded'))
          })
        })
      ctx.emitDefined()
    })

    it('should reject with error', function () {
      error.toString().should.contain(`Error: Failed to create exchange 'badtimes' on connection 'default' with Error: time limit exceeded`)
    })

    it('should not add invalid exchanges to channels', function () {
      should.not.exist(ctx.topology.primitives['exchange:badtimes'])
    })
  })

  describe('when creating invalid queue', function () {
    let ctx
    before(function (done) {
      ctx = initContext({ replyQueue: false })
      ctx.createTopology()
        .then(topology => {
          topology.createQueue({ name: 'badtimes' })
            .catch(err => {
              error = err
              done()
            })
          process.nextTick(() =>
            ctx.q.emit('failed', new Error('time limit exceeded'))
          )
        })
      ctx.emitDefined()
    })

    it('should reject with error', function () {
      error.toString().should.contain(`Error: Failed to create queue 'badtimes' on connection 'default' with Error: time limit exceeded`)
    })

    it('should not add invalid queues to channels', function () {
      should.not.exist(ctx.topology.primitives['queue:badtimes'])
    })
  })

  describe('when deleting an existing exchange', function () {
    let ctx
    before(function (done) {
      ctx = initContext()
      ctx.controlMock
        .expects('deleteExchange')
        .once()
        .withArgs('noice')
        .returns(Promise.resolve())
      ctx.expectSuccess()
      ctx.createTopology()
        .then(topology => {
          topology.createExchange({ name: 'noice' })
            .then(function (created) {
              exchange = created
              topology.deleteExchange('noice')
                .then(function () {
                  done()
                })
            })
            ctx.emitDefined()
        })
        ctx.emitDefined()
    })

    it('should have created exchange', function () {
      exchange.should.eql(ctx.ex)
    })

    it('should remove exchange from channels', function () {
      should.not.exist(ctx.topology.primitives['exchange:noice'])
    })
  })

  describe('when deleting an existing queue', function () {
    let ctx
    before(function (done) {
      ctx = initContext()
      ctx.controlMock
        .expects('deleteQueue')
        .once()
        .withArgs('noice')
        .returns(Promise.resolve())
      ctx.expectSuccess()
      ctx.createTopology()
        .then(topology => {
          topology.createQueue({ name: 'noice' })
            .then(function (created) {
              queue = created
              topology.deleteQueue('noice')
                .then(function () {
                  done()
                })
            })
            ctx.emitDefined()
        })
      ctx.emitDefined()
    })

    it('should have created queue', function () {
      queue.should.eql(ctx.q)
    })

    it('should remove queue from channels', function () {
      should.not.exist(ctx.topology.primitives['queue:noice'])
    })
  })

  describe('when creating an exchange to exchange binding with no keys', function () {
    let ctx
    before(function () {
      ctx = initContext()
      ctx.controlMock
        .expects('bindExchange')
        .once()
        .withArgs('to', 'from', '')
        .returns(Promise.resolve())
      ctx.expectSuccess()
      const promise = ctx.createTopology()
        .then(topology => {
          return topology.createBinding({ source: 'from', target: 'to' })
        })
      ctx.emitDefined()
      return promise
    })

    it('should add binding to definitions', function () {
      ctx.topology.definitions.bindings['from->to'].should.eql({ source: 'from', target: 'to' })
    })
  })

  describe('when removing an exchange to exchange binding with no keys', function () {
    let ctx
    before(function () {
      ctx = initContext()
      ctx.controlMock
        .expects('bindExchange')
        .once()
        .withArgs('to', 'from', '')
        .returns(Promise.resolve())
      ctx.controlMock
        .expects('unbindExchange')
        .once()
        .withArgs('to', 'from', '')
        .returns(Promise.resolve())
      ctx.expectSuccess()
      const promise = ctx.createTopology()
        .then(topology => {
          return topology.createBinding({ source: 'from', target: 'to' })
            .then(topology.removeBinding({ source: 'from', target: 'to' }))
        })
      ctx.emitDefined()
      return promise
    })

    it('should remove binding from definitions', function () {
      should.not.exist(ctx.topology.definitions.bindings['from->to'])
    })
  })

  describe('when creating an exchange to queue binding with no keys', function () {
    let ctx
    before(function () {
      ctx = initContext()
      ctx.controlMock.expects('bindQueue')
        .withArgs('to', 'from', 'a.*')
        .returns(Promise.resolve())
        ctx.controlMock.expects('bindQueue')
        .withArgs('to', 'from', 'b.*')
        .returns(Promise.resolve())
      ctx.expectSuccess()
      const promise = ctx.createTopology()
        .then(topology => {
          return topology.createBinding({ source: 'from', target: 'to', keys: undefined, queue: true })
            .catch(_.noop)
        })
      ctx.emitDefined()
      return promise
    })

    it('should add binding to definitions', function () {
      ctx.topology.definitions.bindings['from->to'].should.eql(
        { source: 'from', target: 'to', keys: undefined, queue: true }
      )
    })
  })

  describe('when removing an exchange to queue binding with no keys', function () {
    let ctx
    before(function () {
      ctx = initContext()
      controlMock.expects('bindQueue')
        .withArgs('to', 'from', 'a.*')
        .returns(Promise.resolve())
      controlMock.expects('bindQueue')
        .withArgs('to', 'from', 'b.*')
        .returns(Promise.resolve())
      controlMock.expects('unbindQueue')
        .withArgs('to', 'from', 'a.*')
        .returns(Promise.resolve())
      controlMock.expects('unbindQueue')
        .withArgs('to', 'from', 'b.*')
        .returns(Promise.resolve())
      ctx.expectSuccess()
      const promise = ctx.createTopology()
        .then(topology => {
          return topology.createBinding({ source: 'from', target: 'to', keys: undefined, queue: true })
            .catch(_.noop)
            .then(topology.removeBinding({ source: 'from', target: 'to' }))
        })
      ctx.emitDefined()
      return promise
    })

    it('should remove binding from definitions', function () {
      should.not.exist(ctx.topology.definitions.bindings['from->to'])
    })
  })

  describe('when creating an exchange to queue binding with keys', function () {
    let ctx
    before(function () {
      ctx = initContext()
      ctx.controlMock.expects('bindQueue')
        .withArgs('to', 'from', 'a.*')
        .returns(Promise.resolve())
      ctx.controlMock.expects('bindQueue')
        .withArgs('to', 'from', 'b.*')
        .returns(Promise.resolve())
      ctx.expectSuccess()
      const promise = ctx.createTopology()
        .then(topology => {
          return topology.createBinding({ source: 'from', target: 'to', keys: ['a.*', 'b.*'], queue: true })
        })
      ctx.emitDefined()
      return promise
    })

    it('should add binding to definitions', function () {
      ctx.topology.definitions.bindings['from->to:a.*:b.*'].should.eql(
        { source: 'from', target: 'to', keys: ['a.*', 'b.*'], queue: true }
      )
    })
  })

  describe('when removing an exchange to queue binding with keys', function () {
    let ctx
    before(function () {
      ctx = initContext()
      ctx.controlMock.expects('bindQueue')
        .withArgs('to', 'from', 'a.*')
        .returns(Promise.resolve())
      ctx.controlMock.expects('bindQueue')
        .withArgs('to', 'from', 'b.*')
        .returns(Promise.resolve())
      ctx.controlMock.expects('unbindQueue')
        .withArgs('to', 'from', 'a.*')
        .returns(Promise.resolve())
      ctx.controlMock.expects('unbindQueue')
        .withArgs('to', 'from', 'b.*')
        .returns(Promise.resolve())
      ctx.expectSuccess()
      const promise = ctx.createTopology()
        .then(topology => {
          return topology.createBinding({ source: 'from', target: 'to', keys: ['a.*', 'b.*'], queue: true })
            .then(topology.removeBinding({ source: 'from', target: 'to' }))
        })
      ctx.emitDefined()
      return promise
    })

    it('should remove binding from definitions', function () {
      should.not.exist(ctx.topology.definitions.bindings['from->to'])
    })
  })

  describe('when a connection to rabbit cannot be established', function () {
    let ctx
    before(function () {
      ctx = initContext()
      ctx.exp
      const promise = ctx.createTopology()
        .catch(err => {
          error = err
        })
      ctx.emitFailure()
      return promise
    })

    it('should reject topology promise with connection error', function () {
      error.toString().should.contain(
        `Error: Failed to create exchange '\' on connection 'default' with Error: no such server!`)
    })
  })
})
