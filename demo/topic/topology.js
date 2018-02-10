module.exports = function (rabbit) {
  return rabbit.configure({

    // arguments used to establish a connection to a broker
    connection: {
      user: 'guest',
      pass: 'guest',
      server: [ '127.0.0.1' ],
      port: 5672,
      vhost: '%2f',
      timeout: 1000,
      failAfter: 30,
      retryLimit: 400
    },

    // define the exchanges
    exchanges: [ {
      name: 'topic-example-x',
      type: 'topic',
      autoDelete: true
    } ],

    // setup the queues, only subscribing to the one this service
    // will consume messages from
    queues: [ {
      name: 'topic-example-left-q',
      autoDelete: true,
      subscribe: true
    }, {
      name: 'topic-example-right-q',
      autoDelete: true,
      subscribe: true
    } ],

    // binds exchanges and queues to one another
    bindings: [ {
      exchange: 'topic-example-x',
      target: 'topic-example-left-q',
      keys: [ 'left' ]
    }, {
      exchange: 'topic-example-x',
      target: 'topic-example-right-q',
      keys: [ 'right' ]
    } ]
  }).then(null, function (err) {
    console.error('Could not connect or configure:', err);
  });
};
