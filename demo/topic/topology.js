module.exports = function(rabbit, subscribeTo, connectionName) {
	return rabbit.configure({

		// define the exchanges
		exchanges: [{
			name: "topic-example-x",
			type: "topic",
			autoDelete: true
		}],

		// setup the queues, only subscribing to the one this service
		// will consume messages from
		queues: [{
			name: "topic-example-left-q",
			autoDelete: true,
			subscribe: subscribeTo === "left"
		}, {
			name: "topic-example-right-q",
			autoDelete: true,
			subscribe: subscribeTo === "right"
		}],

		// binds exchanges and queues to one another
		bindings: [{
			exchange: "topic-example-x",
			target: "topic-example-left-q",
			keys: ["left"]
		}, {
			exchange: "topic-example-x",
			target: "topic-example-right-q",
			keys: ["right"]
		}]
	}).then(function() {
    var config = {
      name: connectionName,
			user: "guest",
			pass: "guest",
			server: [ "127.0.0.1" ],
			port: 5672,
			vhost: "%2f",
			timeout: 1000,
			failAfter: 30,
			retryLimit: 400
		};
    return rabbit.addConnection(config);
	}, function(err) {
    console.error('Could not connect or configure:', err);
  });
};