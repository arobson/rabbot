var rabbit = require('../../src/index.js');
var fs = require('fs');

rabbit.log(
  { level: 'debug', stream: fs.createWriteStream('./debug.log'), objectMode: true }
);
// always setup your message handlers first

// this handler will respond to the subscriber request and trigger
// sending a bunch of messages
rabbit.handle('subscriber.request', function (msg) {
  console.log('Got subscriber request');
  // replying to the message also ack's it to the queue
  msg.reply({ getReady: 'forawesome' }, 'publisher.response');
  setTimeout(() => publish(msg.body.batchSize, msg.body.expected), 0);
});

// it can make a lot of sense to share topology definition across
// services that will be using the same topology to avoid
// scenarios where you have race conditions around when
// exchanges, queues or bindings are in place
require('./topology.js')(rabbit, 'requests')
  .then(function (x) {
    console.log('ready');
  });

rabbit.on('unreachable', function () {
  console.log(':(');
  process.exit();
});

function publish (batchSize, total) {
  var subtotal = total;
  if (total > batchSize) {
    subtotal = batchSize;
  }
  var pending = new Array(subtotal);
  total -= subtotal;
  var lost = 0;
  for (let i = 0; i < subtotal; i++) {
    pending.push(
      rabbit.publish('wascally-pubsub-messages-x', {
        type: 'publisher.message',
        body: { message: `Message ${i}` }
      }).then(
        null,
        (e) => {
          lost++;
          throw e;
        }
      )
    );
  }
  if (total > 0) {
    Promise.all(pending)
      .then(() => {
        console.log(`just published ${batchSize} messages ... boy are my arms tired?`);
        setTimeout(() => publish(batchSize, total), 0);
      },
      () => {
        console.log(`${lost} MESSAGES LOST!`);
        setTimeout(() => publish(batchSize, total), 0);
      });
  }
}
