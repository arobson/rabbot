module.exports = function() {
	var rabbit = require("../../src/index.js");

	// variable to hold starting time
	var started = Date.now();

	// variable to hold received count
	var received = 0;

	// expected message count
	var expected = 10000;

	// always setup your message handlers first

	// this handler will handle messages sent from the publisher
	rabbit.handle("#", function(msg) {
		console.log("LEFT Received:", JSON.stringify(msg.body), "routingKey:", msg.fields.routingKey);
		msg.ack();
		if ((++received) === expected) {
			console.log("LEFT Received", received, "messages after", (Date.now() - started), "milliseconds");
		}
	});

	// it can make a lot of sense to share topology definition across
	// services that will be using the same topology to avoid
	// scenarios where you have race conditions around when
	// exchanges, queues or bindings are in place
	require("./topology.js")(rabbit, "right", "left");

	console.log('Set up LEFT OK');
};