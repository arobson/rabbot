require('../setup')
const rabbit = require('../../src/index.js')
const config = require('./configuration')

describe('Direct Reply Queue (replyQueue: \'rabbit\')', function () {
  let messagesToSend
  let harness
  const replies = []

  before(function (done) {
    this.timeout(10000)
    harness = harnessFactory(rabbit, () => {}, messagesToSend)
    rabbit.configure({
      connection: config.directReplyQueue,
      exchanges: [
        {
          name: 'noreply-ex.direct',
          type: 'direct',
          autoDelete: true
        }
      ],
      queues: [
        {
          name: 'noreply-q.direct',
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: 'noreply-ex.direct',
          target: 'noreply-q.direct',
          keys: ''
        }
      ]
    }).then(() => {
      messagesToSend = 3
      harness.handle('no.replyQueue', (req) => {
        req.data.reply({ reply: req.data.body.message })
      })
      for (let i = 0; i < messagesToSend; i++) {
        console.log('lets send some messages')
        rabbit.request('noreply-ex.direct', {
          connectionName: 'directReplyQueue',
          type: 'no.replyQueue',
          body: { message: i },
          routingKey: ''
        })
          .then(
            r => {
              console.log(`ayo`)
              replies.push(r.data.body.reply)
              r.data.ack()
              if (replies.length >= messagesToSend) {
                done()
              } else {
                console.log(`not yet: ${replies.length}`)
              }
            }
          )
      }
    })
  })

  it('should receive all replies', function () {
    harness.received.length.should.equal(messagesToSend)
    replies.should.eql([0, 1, 2])
  })

  after(function () {
    return harness.clean('directReplyQueue')
  })
})
