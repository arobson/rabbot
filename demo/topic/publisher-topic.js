// require( 'when/monitor/console' );
var rabbit = require('../../src/index.js');

// it can make a lot of sense to share topology definition across
// services that will be using the same topology to avoid
// scenarios where you have race conditions around when
// exchanges, queues or bindings are in place
require('./topology.js')(rabbit, null, 'default')
  .then(function () {
    console.log('EVERYTHING IS PEACHY');
    publish(10000);
  });

rabbit.on('unreachable', function () {
  console.log(':(');
  process.exit();
});

function publish (total) {
  var i;

  var send = function (x) {
    var direction = (x % 2 === 0) ? 'left' : 'right';
    rabbit.publish('topic-example-x', {
      routingKey: direction,
      type: direction,
      body: {
        message: 'Message ' + x
      }
    }).then(function () {
      console.log('published message', x);
    });
  };

  for (i = 0; i < total; i++) {
    send(i);
  }
  rabbit.shutdown();
}
