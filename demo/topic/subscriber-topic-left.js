module.exports = function (rabbit) {
  // variable to hold starting time
  const started = Date.now()

  // variable to hold received count
  let received = 0

  // expected message count
  const expected = 10000

  // always setup your message handlers first

  // this handler will handle messages sent from the publisher
  rabbit.handle({
    queue: 'topic-example-left-q',
    type: '#'
  }, function (msg) {
    console.log('LEFT Received:', JSON.stringify(msg.body), 'routingKey:', msg.fields.routingKey)
    msg.ack()
    if ((++received) === expected) {
      console.log('LEFT Received', received, 'messages after', (Date.now() - started), 'milliseconds')
    }
  })

  // it can make a lot of sense to share topology definition across
  // services that will be using the same topology to avoid
  // scenarios where you have race conditions around when
  // exchanges, queues or bindings are in place
  require('./topology.js')(rabbit, 'left', 'left')

  console.log('Set up LEFT OK')
}
