# rabbot

[![Build Status][travis-image]][travis-url]
[![Coverage Status][coveralls-image]][coveralls-url]
[![Version npm][version-image]][version-url]
[![npm Downloads][downloads-image]][downloads-url]
[![Dependencies][dependencies-image]][dependencies-url]

This is a very opinionated abstraction over amqplib to help simplify the implementation of several messaging patterns on RabbitMQ.

> !Important! - successful use of this library will require a conceptual knowledge of AMQP and an understanding of RabbitMQ.

### Features:

 * Attempt to gracefully handle lost connections and channels
 * Automatically re-assert all topology on re-connection
 * Support the majority of RabbitMQ's extensions
 * Handle batching of acknowledgements and rejections
 * Topology & configuration via JSON (thanks to @JohnDMathis!)
 * Built-in support for JSON, binary and text message bodies
 * Support for custom serialization

### Assumptions & Defaults:

 * Fault-tolerance/resilience over throughput
 * Prefer "at least once delivery"
 * Default to publish confirmation
 * Default to ack mode on consumers
 * Heterogenous services that include statically typed languages
 * JSON as the default serialization provider for object based message bodies

## Documentation You Should Read

 * [Connection Management](https://github.com/zlintz/foo-foo-mq/blob/master/docs/connections.md) - connection management
 * [Topology Setup](https://github.com/zlintz/foo-foo-mq/blob/master/docs/topology.md) - topology configuration
 * [Publishing Guide](https://github.com/zlintz/foo-foo-mq/blob/master/docs/publishing.md) - publishing and requesting
 * [Receiving Guide](https://github.com/zlintz/foo-foo-mq/blob/master/docs/receiving.md) - subscribing and handling of messages
 * [Logging](https://github.com/zlintz/foo-foo-mq/blob/master/docs/logging.md) - how rabbot logs

## Other Documents

 * [Contributor Guide](https://github.com/zlintz/foo-foo-mq/blob/master/HOW_TO_CONTRIBUTE.md)
 * [Code of Conduct](https://github.com/zlintz/foo-foo-mq/blob/master/CODE_OF_CONDUCT.md)
 * [Resources](https://github.com/zlintz/foo-foo-mq/blob/master/RESOURCES.md)
 * [Maintainers](https://github.com/zlintz/foo-foo-mq/blob/master/MAINTAINERS.md)
 * [Contributors](https://github.com/zlintz/foo-foo-mq/blob/master/CONTRIBUTORS.md)
 * [Acknowledgements](https://github.com/zlintz/foo-foo-mq/blob/master/ACKNOWLEDGEMENTS.md)
 * [Change Log](https://github.com/zlintz/foo-foo-mq/blob/master/CHANGELOG.md)
 * [Differences From Wascally](https://github.com/zlintz/foo-foo-mq/blob/master/docs/notwascally.md)

## Demos

 * [pubsub](https://github.com/zlintz/foo-foo-mq/blob/master/demo/pubsub/README.md)

## API Example

This contrived example is here to make it easy to see what the API looks like now that documentation is broken up across multiple pages.



```js
const rabbit = require('foo-foo-mq');

rabbit.handle('MyMessage', (msg) => {
  console.log('received msg', msg.body);
  msg.ack();
});

rabbit.handle('MyRequest', (req) => {
  req.reply('yes?');
});

rabbit.configure({
  connection: {
    name: 'default',
    user: 'guest',
    pass: 'guest',
    host: 'my-rabbot-server',
    port: 5672,
    vhost: '%2f',
    replyQueue: 'customReplyQueue'
  },
  exchanges: [
    { name: 'ex.1', type: 'fanout', autoDelete: true }
  ],
  queues: [
    { name: 'q.1', autoDelete: true, subscribe: true },
  ],
  bindings: [
    { exchange: 'ex.1', target: 'q.1', keys: [] }
  ]
}).then(
  () => console.log('connected!');
);

rabbit.request('ex.1', { type: 'MyRequest' })
  .then(
    reply => {
      console.log('got response:', reply.body);
      reply.ack();
    }
  );

rabbit.publish('ex.1', { type: 'MyMessage', body: 'hello!' });


setTimeout(() => {
  rabbot.shutdown(true)
},5000);
```

## Roadmap
 * improve support RabbitMQ backpressure mechanisms
 * add support for Rabbit's HTTP API

[travis-image]: https://travis-ci.org/zlintz/foo-foo-mq.svg?branch=master
[travis-url]: https://travis-ci.org/zlintz/foo-foo-mq
[coveralls-url]: https://coveralls.io/github/zlintz/foo-foo-mq?branch=master
[coveralls-image]: https://coveralls.io/repos/github/zlintz/foo-foo-mq/badge.svg?branch=master
[version-image]: https://img.shields.io/npm/v/rabbot.svg?style=flat
[version-url]: https://www.npmjs.com/package/foo-foo-mq
[downloads-image]: https://img.shields.io/npm/dm/foo-foo-mq.svg?style=flat
[downloads-url]: https://www.npmjs.com/package/foo-foo-mq
[dependencies-image]: https://img.shields.io/david/zlintz/foo-foo-mq.svg?style=flat
[dependencies-url]: https://david-dm.org/zlintz/foo-foo-mq
