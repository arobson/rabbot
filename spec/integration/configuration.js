module.exports = {
	connection: {
		name: 'default',
		user: 'guest',
		pass: 'guest',
		server: '127.0.0.1',
		port: 5672,
		vhost: '%2f',
		replyQueue: 'customReplyQueue'
	},

	exchanges: [
		{
			name: 'wascally-ex.direct',
			type: 'direct',
			autoDelete: true
		},
		{
			name: 'wascally-ex.topic',
			type: 'topic',
			alternate: 'wascally-ex.alternate',
			autoDelete: true
		},
		{
			name: 'wascally-ex.fanout',
			type: 'fanout',
			autoDelete: true
		},
		{
			name: 'wascally-ex.request',
			type: 'fanout',
			autoDelete: true
		},
		{
			name: 'wascally-ex.deadend',
			type: 'fanout',
			alternate: 'wascally-ex.alternate',
			autoDelete: true
		},
		{
			name: 'wascally-ex.alternate',
			type: 'fanout',
			autoDelete: true
		},
		{
			name: 'wascally-ex.deadletter',
			type: 'fanout',
			autoDelete: true
		},
		{
			name: 'wascally-ex.consistent-hash',
			type: 'x-consistent-hash',
			autoDelete: true,
			arguments: {
				'hash-header': 'CorrelationId'
			}
		},
		{
			name: 'wascally-ex.no-batch',
			type: 'direct',
			autoDelete: true
		}
	],

	queues: [
		{
			name: 'wascally-q.direct',
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.topic',
			autoDelete: true,
			subscribe: true,
			deadletter: 'wascally-ex.deadletter'
		},
		{
			name: 'wascally-q.general1',
			noAck: true,
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.general2',
			noAck: true,
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.request',
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.alternate',
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.deadletter',
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.hashed1',
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.hashed2',
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.hashed3',
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.hashed4',
			autoDelete: true,
			subscribe: true
		},
		{
			name: 'wascally-q.no-batch',
			autoDelete: true,
			subscribe: true,
			noBatch: true,
			limit: 5
		}
	],

	bindings: [
		{
			exchange: 'wascally-ex.direct',
			target: 'wascally-q.direct',
			keys: ''
		},
		{
			exchange: 'wascally-ex.topic',
			target: 'wascally-q.topic',
			keys: 'this.is.*'
		},
		{
			exchange: 'wascally-ex.fanout',
			target: 'wascally-q.general1',
			keys: []
		},
		{
			exchange: 'wascally-ex.fanout',
			target: 'wascally-q.general2',
			keys: []
		},
		{
			exchange: 'wascally-ex.request',
			target: 'wascally-q.request',
			keys: []
		},
		{
			exchange: 'wascally-ex.deadletter',
			target: 'wascally-q.deadletter',
			keys: []
		},
		{
			exchange: 'wascally-ex.alternate',
			target: 'wascally-q.alternate',
			keys: []
		},
		{
			exchange: 'wascally-ex.consistent-hash',
			target: 'wascally-q.hashed1',
			keys: '100'
		},
		{
			exchange: 'wascally-ex.consistent-hash',
			target: 'wascally-q.hashed2',
			keys: '100'
		},
		{
			exchange: 'wascally-ex.consistent-hash',
			target: 'wascally-q.hashed3',
			keys: '100'
		},
		{
			exchange: 'wascally-ex.consistent-hash',
			target: 'wascally-q.hashed4',
			keys: '100'
		},
		{
			exchange: 'wascally-ex.no-batch',
			target: 'wascally-q.no-batch'
		}
	]
};
