module.exports = {
  connection: {
    name: 'default',
    user: 'guest',
    pass: 'guest',
    host: '127.0.0.1',
    port: 5672,
    vhost: '%2f',
    replyQueue: 'customReplyQueue'
  },
  differentVhost: {
    name: 'differentVhost',
    user: 'guest',
    pass: 'guest',
    host: '127.0.0.1',
    port: 5672,
    vhost: '%2fdifferent',
    replyQueue: 'customReplyQueue'
  },

  noReplyQueue: {
    name: 'noReplyQueue',
    user: 'guest',
    pass: 'guest',
    server: '127.0.0.1',
    port: 5672,
    vhost: '%2f',
    replyQueue: false
  },

  directReplyQueue: {
    name: 'directReplyQueue',
    user: 'guest',
    pass: 'guest',
    server: '127.0.0.1',
    port: 5672,
    vhost: '%2f',
    replyQueue: 'rabbit'
  }
};
