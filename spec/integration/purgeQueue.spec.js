require('../setup')
const rabbit = require('../../src/index.js')
const config = require('./configuration')

/*
  Tests that queues are purged according to expected behavior:
   - auto-delete queues to NOT unsubscribed first
   - normal queues stop subscription first
   - after purge, subscription is restored
   - purging returns purged message count
   - purging does not break or disrupt channels
*/
describe('Purge Queue', function () {
  describe('when not subcribed', function () {
    before(function () {
      return rabbit.configure({
        connection: config.connection,
        exchanges: [
          {
            name: 'rabbot-ex.purged',
            type: 'topic',
            alternate: 'rabbot-ex.alternate',
            autoDelete: true
          }
        ],
        queues: [
          {
            name: 'rabbot-q.purged',
            autoDelete: true,
            subscribe: false,
            deadletter: 'rabbot-ex.deadletter'
          }
        ],
        bindings: [
          {
            exchange: 'rabbot-ex.purged',
            target: 'rabbot-q.purged',
            keys: 'this.is.#'
          }
        ]
      })
        .then(
          () =>
            Promise.all([
              rabbit.publish('rabbot-ex.purged', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' }),
              rabbit.publish('rabbot-ex.purged', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' }),
              rabbit.publish('rabbot-ex.purged', { type: 'topic', routingKey: 'this.is.not.wine.wtf', body: 'socrates' })
            ])
        )
    })

    it('should have purged expected message count', function () {
      return rabbit.purgeQueue('rabbot-q.purged')
        .then(
          (purged) => {
            console.log(purged)
            purged.should.equal(3)
          }
        )
    })

    it('should not re-subscribe to queue automatically (when not already subscribed)', function () {
      rabbit.getQueue('rabbot-q.purged')
        .currentState.should.equal('ready')
    })

    after(function () {
      return rabbit.deleteQueue('rabbot-q.purged')
        .then(
          () => rabbit.close('default', true)
        )
    })
  })

  describe('when subcribed', function () {
    describe.only('and queue is autodelete', function () {
      let purgeCount
      let harness
      let handler
      before(function (done) {
        harness = harnessFactory(rabbit, () => {}, 1)
        harness.handle('topic', (m) => {
          setTimeout(() => {
            m.ack()
          }, 10)
        })
        rabbit.configure({
          connection: config.connection,
          exchanges: [
            {
              name: 'rabbot-ex.purged-2',
              type: 'topic',
              alternate: 'rabbot-ex.alternate',
              autoDelete: true
            }
          ],
          queues: [
            {
              name: 'rabbot-q.purged-2',
              autoDelete: true,
              subscribe: true,
              limit: 1,
              deadletter: 'rabbot-ex.deadletter'
            }
          ],
          bindings: [
            {
              exchange: 'rabbot-ex.purged-2',
              target: 'rabbot-q.purged-2',
              keys: 'this.is.#'
            }
          ]
        })
          .then(
            () => {
              return Promise.all([
                rabbit.publish('rabbot-ex.purged-2', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' }),
                rabbit.publish('rabbot-ex.purged-2', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' }),
                rabbit.publish('rabbot-ex.purged-2', { type: 'topic', routingKey: 'this.is.not.wine.wtf', body: 'socrates' })
              ])
            }
          )
          .then(
            () => {
              return rabbit.purgeQueue('rabbot-q.purged-2')
                .then(
                  count => {
                    purgeCount = count
                    done()
                  }
                )
            }
          )
        rabbit.onUnhandled(() => console.log('shit'))
      })

      it('should have purged some messages', function () {
        purgeCount.should.be.greaterThan(0);
        (purgeCount + harness.received.length).should.eql(3)
        harness.clean()
      })

      it('should re-subscribe to queue automatically (when not already subscribed)', function (done) {
        this.timeout(50000)
        // rabbit.getQueue('rabbot-q.purged-2')
        //   .currentState.should.equal('subscribed')
        //harness.clean()
        handler = rabbit.handle('topic2', (m) => {
          console.log('hi')
          m.ack()
          done()
        })
        rabbit.onUn
        rabbit.publish('rabbot-ex.purged-2', { type: 'topic2', routingKey: 'this.is.easy', body: 'stapler' })
        rabbit.publish('rabbot-ex.purged-2', { type: 'topic2', routingKey: 'this.is.easy', body: 'stapler' })
        rabbit.publish('rabbot-ex.purged-2', { type: 'topic2', routingKey: 'this.is.easy', body: 'stapler' })
        rabbit.publish('rabbot-ex.purged-2', { type: 'topic2', routingKey: 'this.is.easy', body: 'stapler' })
      })

      after(function () {
        return rabbit.deleteQueue('rabbot-q.purged-2')
          .then(
            () => {
              handler.remove()
              return rabbit.close('default', true)
            }
          )
      })
    })

    describe('and queue is not autodelete', function () {
      let purgeCount
      let harness
      let handler
      before(function (done) {
        rabbit.configure({
          connection: config.connection,
          exchanges: [
            {
              name: 'rabbot-ex.purged-3',
              type: 'topic',
              alternate: 'rabbot-ex.alternate',
              autoDelete: true
            }
          ],
          queues: [
            {
              name: 'rabbot-q.purged-3',
              autoDelete: false,
              subscribe: true,
              limit: 1,
              deadletter: 'rabbot-ex.deadletter'
            }
          ],
          bindings: [
            {
              exchange: 'rabbot-ex.purged-3',
              target: 'rabbot-q.purged-3',
              keys: 'this.is.#'
            }
          ]
        })
          .then(
            () => {
              return Promise.all([
                rabbit.publish('rabbot-ex.purged-3', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' }),
                rabbit.publish('rabbot-ex.purged-3', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' }),
                rabbit.publish('rabbot-ex.purged-3', { type: 'topic', routingKey: 'this.is.not.wine.wtf', body: 'socrates' })
              ])
            }
          )
          .then(
            () => {
              return rabbit.purgeQueue('rabbot-q.purged-3')
                .then(
                  count => {
                    purgeCount = count
                    done()
                  }
                )
            }
          )
        harness = harnessFactory(rabbit, () => {}, 1)
        harness.handle('topic', (m) => {
          setTimeout(() => {
            m.ack()
          }, 100)
        })
      })

      it('should have purged some messages', function () {
        purgeCount.should.be.greaterThan(0);
        (purgeCount + harness.received.length).should.eql(3)
      })

      it('should re-subscribe to queue automatically (when not already subscribed)', function (done) {
        rabbit.getQueue('rabbot-q.purged-3')
          .state.should.equal('subscribed')
        harness.clean()
        handler = rabbit.handle('topic', (m) => {
          m.ack()
          done()
        })
        rabbit.publish('rabbot-ex.purged-3', { type: 'topic', routingKey: 'this.is.easy', body: 'stapler' })
      })

      after(function () {
        return rabbit.deleteQueue('rabbot-q.purged-3')
          .then(
            () => {
              handler.remove()
              return rabbit.close('default', true)
            }
          )
      })
    })
  })
})
