require('../setup.js')
const exchangeFsm = require('../../src/exchangeFsm')
const defer = require('fauxdash').future
const Dispatcher = require('topic-dispatch')
const noop = () => {}
const _ = require('fauxdash')

function exchangeFn (options) {
  const channel = {
    name: options.name,
    type: options.type,
    channel: Dispatcher(),
    define: noop,
    release: noop,
    publish: noop
  }
  const channelMock = sinon.mock(channel)

  return {
    mock: channelMock,
    factory: function () {
      return Promise.resolve(channel)
    }
  }
}

describe('Exchange FSM', function () {
  describe('when connection is unreachable', function () {
    let connection, topology, exchange, channelMock, options, error
    let published
    before(function (done) {
      options = { name: 'test', type: 'test' }
      connection = Dispatcher()
      connection.addExchange = noop
      topology = Dispatcher()

      const ex = exchangeFn(options)
      channelMock = ex.mock
      channelMock
        .expects('define')
        .once()
        .returns({ then: () => {
          return new Promise((res, rej) => {
            setTimeout(resolve, 5000)
          })
        } })

      exchange = exchangeFsm(options, connection, topology, {}, ex.factory)
      published = [1, 2, 3].map(() => exchange.publish({}).catch(e => e ? e.message || e : e))
      exchange.once('failed', function (err) {
        error = err.error
        done()
      })
      exchange.once('initializing', () => {
        connection.emit('unreachable', {})
      })
    })

    it('should have emitted failed with an error', function () {
      return error.toString().should.equal('Error: Could not establish a connection to any known nodes.')
    })

    it('should reject all published promises', function () {
      return published.map((promise) =>
        promise.should.eventually.equal('Could not establish a connection to any known nodes.')
      )
    })

    it('should be in unreachable state', function () {
      exchange.currentState.should.equal('unreachable')
    })

    describe('when publishing in unreachable state', function () {
      let error

      before(function () {
        return exchange.publish({}).catch(function (err) {
          error = err
        })
      })

      it('should reject publish with an error', function () {
        error.toString().should.equal('Error: Could not establish a connection to any known nodes.')
      })

      it('should clean up the "failed" subscription', function () {
        //exchange._subscriptions.failed.should.have.lengthOf(0)
      })
    })

    describe('when checking in unreachable state', function () {
      it('should reject check with an error', function () {
        return exchange.check().should.be.rejectedWith('Could not establish a connection to any known nodes.')
      })
    })
  })

  describe('when definition has failed with error', function () {
    let connection, topology, exchange, channelMock, options
    let published
    before(function () {
      options = { name: 'test', type: 'test' }
      connection = Dispatcher()
      connection.addExchange = noop
      topology = Dispatcher()

      const ex = exchangeFn(options)
      channelMock = ex.mock
      const deferred = defer()
      channelMock
        .expects('define')
        .once()
        .returns(deferred.promise)

      exchange = exchangeFsm(options, connection, topology, {}, ex.factory)
      published = [1, 2, 3].map(() =>
        exchange.publish({})
          .then(null, (err) => err.message)
      )
      deferred.reject(new Error('nope'))
      return Promise.all(published)
    })

    it('should be in failed state', function () {
      exchange.currentState.should.equal('failed')
    })

    it('should reject all published promises', function () {
      published.forEach((promise) => {
        promise.should.eventually.equal('nope')
      })
    })

    describe('when publishing in unreachable state', function () {
      let error

      before(function () {
        return exchange.publish({}).catch(function (err) {
          error = err
        })
      })

      it('should reject publish with an error', function () {
        error.toString().should.equal('Error: nope')
      })

      it('should clean up the "failed" subscription', function () {
        // exchange._subscriptions.failed.should.have.lengthOf(0)
      })
    })

    describe('when checking in unreachable state', function () {
      it('should reject check with an error', function () {
        return exchange.check().should.be.rejectedWith('nope')
      })
    })
  })

  describe('when initializing succeeds', function () {
    let connection, topology, exchange, ex, channelMock, options, error

    before(function (done) {
      options = { name: 'test', type: 'test' }
      connection = Dispatcher()
      connection.addExchange = noop
      topology = Dispatcher()

      ex = exchangeFn(options)
      channelMock = ex.mock
      channelMock
        .expects('define')
        .once()
        .returns(Promise.resolve())

      exchange = exchangeFsm(options, connection, topology, {}, ex.factory)
      exchange.once('failed', function (err) {
        error = err
        done()
      })
      exchange.once('defined', function () {
        done()
      })
    })

    it('should not have failed', function () {
      should.not.exist(error)
    })

    it('should be in ready state', function () {
      exchange.currentState.should.equal('ready')
    })

    describe('when publishing in ready state', function () {
      let promise

      before(function () {
        channelMock
          .expects('publish')
          .once()
          .returns(Promise.resolve(true))

        promise = exchange.publish({})

        return promise
      })

      it('should resolve publish without error', function () {
        return promise.should.be.fulfilled
      })

      it('should clean up the "failed" subscription', function () {
        // Should only have a single failed subscription from the outer "before" block
        // exchange._subscriptions.failed.should.have.lengthOf(1)
      })
    })

    describe('when checking in ready state', function () {
      it('should resolve check without error', function () {
        exchange.check().should.be.fulfilled // eslint-disable-line no-unused-expressions
      })
    })

    describe('when channel is closed', function () {
      before(function (done) {
        channelMock
          .expects('define')
          .once()
          .returns(Promise.resolve())
        exchange.once('defined', function () {
          done()
        })

        exchange.once('closed', function () {
          exchange.check()
        })

        ex.factory().then(function (e) {
          e.channel.emit('closed')
        })
      })

      it('should reinitialize without error', function () {
        should.not.exist(error)
      })
    })

    describe('when releasing', function () {
      before(function () {
        exchange.published.add({})
        exchange.published.add({})
        exchange.published.add({})

        channelMock
          .expects('release')
          .once()
          .resolves()

        setTimeout(function () {
          exchange.published.remove({ sequenceNo: 0 })
          exchange.published.remove({ sequenceNo: 1 })
          exchange.published.remove({ sequenceNo: 2 })
        }, 200)

        return exchange.release()
      })

      // it('should remove handlers from topology and connection', function () {
      //   _.flatten(_.values(connection.handlers)).length.should.equal(1)
      //   _.flatten(_.values(topology.handlers)).length.should.equal(0)
      // })

      it('should release channel instance', function () {
        should.not.exist(exchange.channel)
      })

      describe('when publishing to a released channel', function () {
        before(function () {
          channelMock
            .expects('define')
            .never()

          channelMock
            .expects('publish')
            .never()
        })

        it('should reject publish', function () {
          return exchange.publish({}).should.be.rejectedWith('Cannot publish to exchange \'test\' after intentionally closing its connection')
        })

        it('should not make any calls to underlying exchange channel', function () {
          channelMock.verify()
        })
      })
    })

    after(function () {
      connection.removeAllListeners()
      topology.removeAllListeners()
      channelMock.restore()
    })
  })
})
