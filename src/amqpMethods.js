// amqplib's package.json "exports" field blocks any deep import into its
// internal lib/*.js modules, and even without that block, the internal
// class that older rabbot versions reflected over to auto-discover method
// names (amqplib/lib/callback_model.js) no longer defines them via static
// prototype assignment in amqplib 2.x - it was restructured around the
// promise-native classes in lib/channel_model.js. Rather than depend on
// either of those unversioned internals, this is a small, rabbot-owned
// list of amqplib's stable, publicly documented Connection/Channel API
// surface (https://amqp-node.github.io/amqplib/channel_api.html), used by
// amqp/iomonad.js to build its operation proxies. Confirmed against
// amqplib 2.0.1's lib/channel_model.js Connection/Channel/ConfirmChannel
// classes.

export const CONNECTION_METHODS = [
  'close',
  'createChannel',
  'createConfirmChannel'
];

export const CHANNEL_METHODS = [
  'close',
  'assertQueue',
  'checkQueue',
  'deleteQueue',
  'purgeQueue',
  'bindQueue',
  'unbindQueue',
  'assertExchange',
  'checkExchange',
  'deleteExchange',
  'bindExchange',
  'unbindExchange',
  'publish',
  'sendToQueue',
  'consume',
  'cancel',
  'get',
  'ack',
  'ackAll',
  'nack',
  'nackAll',
  'reject',
  'recover',
  'prefetch',
  'waitForConfirms'
];
