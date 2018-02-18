# Publishing

In confirm mode (the default for exchanges), the publish call returns a promise that is only resolved once the broker has confirmed the publish (see [Publisher Acknowledgments](https://www.rabbitmq.com/confirms.html) for more details). If a configured timeout is reached, or in the rare event that the broker rejects the message, the promise will be rejected. More commonly, the connection to the broker could be lost before the message is confirmed and you end up with a message in "limbo". rabbot keeps a list of unconfirmed messages that have been published _in memory only_. Once a connection is available and the topology is in place, rabbot will send messages in the order of the publish calls. In the event of a disconnection or unreachable broker, all publish promises that have not been resolved are rejected.

Publish timeouts can be set per message, per exchange or per connection. The most specific value overrides any set at a higher level. There are no default timeouts set at any level. The timer is started as soon as publish is called and only cancelled once rabbot is able to make the publish call on the actual exchange's channel. The timeout is cancelled once publish is called and will not result in a rejected promise due to time spent waiting on a confirmation.

> Caution: rabbot does _not_ limit the growth of pending published messages. If a service cannot connect to Rabbit due to misconfiguration or the broker being down, publishing lots of messages can lead to out-of-memory errors. It is the consuming services responsibility to handle these kinds of scenarios.

Confirm mode is not without an overhead cost. This can be turned off, per exchange, by setting `noConfirm: true`. Confirmation results in increased memory overhead on the client and broker. When off, the promise will _always_ resolve when the connection and exchange are available.

#### Serializers

rabbot associates serialization techniques for messages with mimeTypes which can now be set when publishing a message. Out of the box, it really only supports 3 types of serialization:

 * `"text/plain"`
 * `"application/json"`
 * `"application/octet-stream"`

You can register your own serializers using `addSerializer` but make sure to do so on both the sending and receiving side of the message.

## `rabbot.publish( exchangeName, options, [connectionName] )`

Things to remember when publishing a message:

 * A type sepcifier is required so that the recipient knows what kind of message its getting and which handler should process it
 * If `contentType` is provided, then that will be used for the message's contentType
 * If `body` is an object or an array, it will be serialized as JSON and `contentType` will be "application/json"
 * If `body` is a string, it will be sent as a utf8 encoded string and `contentType` will be "text/plain"
 * If `body` is a Buffer, it will be sent as a byte array and `contentType` will be "application/octet-stream"
 * By default, the type specifier will be used if no routing key is undefined
 * Use a routing key of `""` to prevent the type specifier from being used as the routing key
 * Non-persistent messages in a queue will be lost on server restart, default is non-persistent.  Persistence can be set on either an exchange when it is created via addExchange, or when sending a message (needed when using "default" exchanges since non-persistent publish is the default)

This example shows all of the available properties (including those which get set by default):

### Example
```javascript
rabbit.publish( "exchange.name",
  {
    routingKey: "hi",
    type: "company.project.messages.textMessage",
    correlationId: "one",
    contentType: "application/json",
    body: { text: "hello!" },
    messageId: "100",
    expiresAfter: 1000 // TTL in ms, in this example 1 second
    timestamp: // posix timestamp (long)
    mandatory: true, //Must be set to true for onReturned to receive unqueued message
    persistent: true, //If either message or exchange defines persistent=true queued messages will be saved to disk.
    headers: {
      random: "application specific value"
    },
    timeout: // ms to wait before cancelling the publish and rejecting the promise
  },
  connectionName: "" // another optional way to provide connection name if needed
);
```

## `rabbot.request( exchangeName, options, [connectionName] )`

This works just like a publish except that the promise returned provides the response (or responses) from the other side. A `replyTimeout` is available in the options that controls how long rabbot will wait for a reply before removing the subscription for the request to prevent memory leaks.

> Note: the default replyTimeout will be double the publish timeout or 1 second if no publish timeout was ever specified.

Request provides for two ways to get multiple responses; one is to allow a single replier to stream a set of responses back and the other is to send a request to multiple potential responders and wait until a specific number comes back.

### Expecting A Singe Reply

```js
// request side
const parts = [];
rabbit.request('request.ex', {
    type: 'request',
    body: id
  })
  .then( reply => {
    // done - do something with all the data?
    reply.ack();
  });

// receiver sides
rabbit.handle('request', (req) => {
  req.reply(database.get(req.id));
});
```

### Expecting A Stream

`reply` takes an additional hash argument where you can set `more` to `true` to indicate there are more messages incoming as part of the reply.

In this case, the third argument to the `request` function will get every message **except** the last.

```js
// request side
const parts = [];
rabbit.request('request.ex', {
    type: 'request',
    body: id
  },
  reply => {
    parts.push(part);
    part.ack();
  })
  .then( final => {
    // done - do something with all the data?
    final.ack();
  });

// receiver side
rabbit.handle('request', (req) => {
  const stream = data.getById(req.body);
  stream.on('data', data => {
    req.reply(data, { more: true });
  });
  stream.on('end', () => {
    req.reply({ body: 'done' });
  });
  stream.on('error', (err) => {
    req.reply({ body: { error: true, detail: err.message });
  });
});
```

### Scatter-Gather

In scatter-gather: the recipients don't know how many of them there are and don't have to be aware that they are participating in scatter-gather/race-conditions.

They just reply. The limit is applied on the requesting side by setting a `expects` property on the outgoing message to let rabbot how many messages to collect before stopping and considering the request satisfied.

Normally this is done with mutliple responders on the other side of a topic or fanout exchange.

> !IMPORTANT! - messages beyond the limit are treated as unhandled. You'll need to have an unhandled message strategy in place or at least understand how rabbot deals with them by default.

```js
// request side
const parts = [];
rabbit.request('request.ex', {
    type: 'request',
    body: id,
    limit: 3 // will stop after 3 even if many more reply
  },
  reply => {
    parts.push(part);
    part.ack();
  })
  .then( final => {
    // done - do something with all the data?
    final.ack();
  });

// receiver sides
rabbit.handle('request', (req) => {
  req.reply(database.get(req.id));
});
```

## `rabbot.bulkPublish( set, [connectionName] )`

This creates a promise for a set of publishes to one or more exchanges on the same connection.

It is a little more efficient than calling `publish` repeatedly as it performs the precondition checks up-front, a single time before it beings the publishing.

It supports two separate formats for specifying a set of messages: hash and array.

### Hash Format

Each key is the name of the exchange to publish to and the value is an array of messages to send. Each element in the array follows the same format as the `publish` options.

The exchanges are processed serially, so this option will not work if you want finer control over sending messages to multiple exchanges in interleaved order.

```js
rabbot.publish({
  'exchange-1': [
    { type: 'one', body: '1' },
    { type: 'one', body: '2' }
  ],
  'exchange-2': [
    { type: 'two', body: '1' },
    { type: 'two', body: '2' }
  ]
}).then(
  () => // a list of the messages of that succeeded,
  failed => // a list of failed messages and the errors `{ err, message }`
)
```

### Array Format

Each element in the array follows the format of `publish`'s option but requires the `exchange` property to control which exchange to publish each message to.

```js
rabbot.publish([
  { type: 'one', body: '1', exchange: 'exchange-1' },
  { type: 'one', body: '2', exchange: 'exchange-1' },
  { type: 'two', body: '1', exchange: 'exchange-2' },
  { type: 'two', body: '2', exchange: 'exchange-2' }
}).then(
  () => // a list of the messages of that succeeded,
  failed => // a list of failed messages and the errors `{ err, message }`
)
```
