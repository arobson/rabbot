module.exports = {
	connection: {
		name: "default",
		user: "guest",
		pass: "guest",
		host: "127.0.0.1",
		port: 5672,
		vhost: "%2f",
		replyQueue: "customReplyQueue"
	},

	exchanges: [
		{
			name: "rabbot-ex.direct",
			type: "direct",
			autoDelete: true
		},
		{
			name: "rabbot-ex.topic",
			type: "topic",
			alternate: "rabbot-ex.alternate",
			autoDelete: true
		},
		{
			name: "rabbot-ex.fanout",
			type: "fanout",
			autoDelete: true
		},
		{
			name: "rabbot-ex.request",
			type: "fanout",
			autoDelete: true
		},
		{
			name: "rabbot-ex.deadend",
			type: "fanout",
			alternate: "rabbot-ex.alternate",
			autoDelete: true
		},
		{
			name: "rabbot-ex.alternate",
			type: "fanout",
			autoDelete: true
		},
		{
			name: "rabbot-ex.deadletter",
			type: "fanout",
			autoDelete: true
		},
		{
			name: "rabbot-ex.consistent-hash",
			type: "x-consistent-hash",
			autoDelete: true,
			arguments: {
				"hash-header": "CorrelationId"
			}
		},
		{
			name: "rabbot-ex.no-batch",
			type: "direct",
			autoDelete: true
		},
		{
			name: "rabbot-ex.no-ack",
			type: "direct",
			autoDelete: true
		}
	],

	queues: [
		{
			name: "rabbot-q.direct",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.topic",
			autoDelete: true,
			subscribe: true,
			deadletter: "rabbot-ex.deadletter"
		},
		{
			name: "rabbot-q.general1",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.general2",
			noAck: true,
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.request",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.alternate",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.deadletter",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.hashed1",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.hashed2",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.hashed3",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.hashed4",
			autoDelete: true,
			subscribe: true
		},
		{
			name: "rabbot-q.no-batch",
			autoDelete: true,
			subscribe: true,
			noBatch: true,
			limit: 5
		},
		{
			name: "rabbot-q.no-ack",
			autoDelete: true,
			subscribe: true,
			noAck: true,
			limit: 5
		}
	],

	bindings: [
		{
			exchange: "rabbot-ex.direct",
			target: "rabbot-q.direct",
			keys: []
		},
		{
			exchange: "rabbot-ex.topic",
			target: "rabbot-q.topic",
			keys: "this.is.*"
		},
		{
			exchange: "rabbot-ex.fanout",
			target: "rabbot-q.general1",
			keys: []
		},
		{
			exchange: "rabbot-ex.fanout",
			target: "rabbot-q.general2",
			keys: []
		},
		{
			exchange: "rabbot-ex.request",
			target: "rabbot-q.request",
			keys: []
		},
		{
			exchange: "rabbot-ex.deadletter",
			target: "rabbot-q.deadletter",
			keys: []
		},
		{
			exchange: "rabbot-ex.alternate",
			target: "rabbot-q.alternate",
			keys: []
		},
		{
			exchange: "rabbot-ex.consistent-hash",
			target: "rabbot-q.hashed1",
			keys: "100"
		},
		{
			exchange: "rabbot-ex.consistent-hash",
			target: "rabbot-q.hashed2",
			keys: "100"
		},
		{
			exchange: "rabbot-ex.consistent-hash",
			target: "rabbot-q.hashed3",
			keys: "100"
		},
		{
			exchange: "rabbot-ex.consistent-hash",
			target: "rabbot-q.hashed4",
			keys: "100"
		},
		{
			exchange: "rabbot-ex.no-batch",
			target: "rabbot-q.no-batch"
		},
		{
			exchange: "rabbot-ex.no-ack",
			target: "rabbot-q.no-ack"
		}
	]
};
