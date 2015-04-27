module.exports = {
	connection: {
		name: 'default',
		user: 'guest',
		pass: 'guest',
		server: '127.0.0.1',
		port: 5672,
		vhost: '%2f',
		replyQueue: false
	},
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
};
