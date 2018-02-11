var rabbit = require('../../src/index.js');

const counts = {
  timeout: 0, // variable to hold the timeout
  started: 0, // variable to hold starting time
  received: 0, // variable to hold received count
  batch: 500, // expected batch size
  expected: 1000000 // expected message count
};

// always setup your message handlers first

// this handler will handle messages sent from the publisher
rabbit.handle('publisher.message', function (msg) {
  // console.log( "Received:", JSON.stringify( msg.body ) );
  // msg.ack();
  if (counts.received % 5000 === 0) {
    report();
  }
  if ((++counts.received) >= counts.expected - 1) {
    var diff = Date.now() - counts.started;
    console.log('Received', counts.received, 'messages after', diff, 'milliseconds');
  }
});

function report () {
  var diff = Date.now() - counts.started;
  console.log('Received', counts.received, 'messages after', diff, 'milliseconds');
}

// it can make a lot of sense to share topology definition across
// services that will be using the same topology to avoid
// scenarios where you have race conditions around when
// exchanges, queues or bindings are in place
require('./topology.js')(rabbit, 'messages')
  .then(() => {
    notifyPublisher();
  });

// now that our handlers are set up and topology is defined,
// we can publish a request to let the publisher know we're up
// and ready for messages.

// because we will re-publish after a timeout, the messages will
// expire if not picked up from the queue in time.
// this prevents a bunch of requests from stacking up in the request
// queue and causing the publisher to send multiple bundles
var requestCount = 0;

function notifyPublisher () {
  console.log('Sending request', ++requestCount);
  rabbit.request('wascally-pubsub-requests-x', {
    type: 'subscriber.request',
    replyTimeout: 15000,
    expiresAfter: 6000,
    routingKey: '',
    body: { ready: true, expected: counts.expected, batchSize: counts.batch }
  }).then(function (response) {
    // if we get a response, cancel any existing timeout
    counts.received = 0;
    counts.started = Date.now();
    if (counts.timeout) {
      clearTimeout(counts.timeout);
    }
    console.log('Publisher replied.');
    response.ack();
  });
  counts.timeout = setTimeout(notifyPublisher, 15000);
}
