# Receiving

Covering message handling and subscriptions.

## `rabbot.handle( options, handler )`
## `rabbot.handle( typeName, handler, [queueName], [context] )`

> Notes:
> * Handle calls should happen __before__ starting subscriptions.
> * The message's routing key will be used if the type is missing or empty on incoming messages
> * Specifying `queueName` will cause the handler to handle messages for that queue _only_
> * `typeName` can use AMQP style wild-cards to handle multiple message types - use this with caution!

Message handlers are registered to handle a message based on the typeName. Calling handle will return a reference to the handler that can later be removed. The message that is passed to the handler is the raw Rabbit payload. The body property contains the message body published. The message has `ack`, `nack` (requeue the message), `reply` and `reject` (don't requeue the message) methods control what Rabbit does with the message.

> !IMPORTANT!: ack, nack and reject are effectively noOps when a queue's `noAck` is set to `true`. RabbitMQ does not support nacking or rejection of messages from consumers in `no-ack` mode. This means that error handling and unhandled message strategies won't be able to re-queue messages.

### Options
If using the first form, the options hash can contain the following properties, defaults shown:

```js
{
  queue: "*", // only handle messages from the queue with this name
  type: "#", // handle messages with this type name or pattern
  autoNack: true, // automatically handle exceptions thrown in this handler
  context: null, // control what `this` is when invoking the handler
  handler: null // allows you to just pass the handle function as an option property ... because why not?
}
```

> Notes:
> * using options without a `queue` or `type` specified will handle _all_ messages received by the service because of the defaults.
> * the behavior here differs in that exceptions are handled for you _by default_

### Explicit Error Handling
In this example, any possible error is caught in an explicit try/catch:

```javascript
var handler = rabbit.handle( "company.project.messages.logEntry", function( message ) {
  try {
    // do something meaningful?
    console.log( message.body );
    message.ack();
  } catch( err ) {
    message.nack();
  }
} );

handler.remove();
```

### Automatically Nack On Error

This example shows how to have rabbot wrap all handlers with a try catch that:

 * nacks the message on error
 * console.log that an error has occurred in a handle

```javascript
// after this call, any new callbacks attached via handle will be wrapped in a try/catch
// that nacks the message on an error
rabbit.nackOnError();

var handler = rabbit.handle( "company.project.messages.logEntry", function( message ) {
  console.log( message.body );
  message.ack();
} );

handler.remove();

// after this call, new callbacks attached via handle will *not* be wrapped in a try/catch
rabbit.ignoreHandlerErrors();
```

### Late-bound Error Handling

Provide a strategy for handling errors to multiple handles or attach an error handler after the fact.

```javascript
var handler = rabbit.handle( "company.project.messages.logEntry", function( message ) {
  console.log( message.body );
  message.ack();
} );

handler.catch( function( err, msg ) {
  // do something with the error & message
  msg.nack();
} );
```

### !!! IMPORTANT !!! ####
Failure to handle errors will result in silent failures and lost messages.

## Unhandled Messages

The default behavior is that any message received that doesn't have any elligible handlers will get `nack`'d and sent back to the queue immediately.

> Caution: this can create churn on the client and server as the message will be redelivered indefinitely!

To avoid unhandled message churn, select one of the following mutually exclusive strategies:

### `rabbot.onUnhandled( handler )`

```javascript
rabbit.onUnhandled( function( message ) {
   // handle the message here
} );
```

### `rabbot.nackUnhandled()` - default

Sends all unhandled messages back to the queue.
```javascript
rabbit.nackUnhandled();
```

### `rabbot.rejectUnhandled()`

Rejects unhandled messages so that will will _not_ be requeued. **DO NOT** use this unless there are dead letter exchanges for all queues.
```javascript
rabbit.rejectUnhandled();
```

## Returned Messages

Unroutable messages that were published with `mandatory: true` will be returned. These messages cannot be ack/nack'ed.

### `rabbot.onReturned( handler )`

```javascript
rabbit.onReturned( function( message ) {
   // the returned message
} );
```

## `rabbot.startSubscription( queueName, [exclusive], [connectionName] )`

> Recommendation: set handlers for anticipated types up before starting subscriptions.

Starts a consumer on the queue specified.

 * `exclusive` - makes it so that _only_ this process/connection can consume messages from the queue.
 * `connectionName` - optional arg used when subscribing to a queue on a connection other than `"default"`.

> Caution: using exclusive this way will allow your process to effectively "block" other processes from subscribing to a queue your process did not create. This can cause channel errors and closures on any other processes attempting to subscribe to the same queue. Make sure you know what you're doing.

## Message Format

The following structure shows and briefly explains the format of the message that is passed to the handle callback:

```javascript
{
  // metadata specific to routing & delivery
  fields: {
    consumerTag: "", // identifies the consumer to rabbit
    deliveryTag: #, // identifies the message delivered for rabbit
    redelivered: true|false, // indicates if the message was previously nacked or returned to the queue
    exchange: "" // name of exchange the message was published to,
    routingKey: "" // the routing key (if any) used when published
  },
  properties:{
    contentType: "application/json", // see serialization for how defaults are determined
    contentEncoding: "utf8", // rabbot's default
    headers: {}, // any user provided headers
    correlationId: "", // the correlation id if provided
    replyTo: "", // the reply queue would go here
    messageId: "", // message id if provided
    type: "", // the type of the message published
    appId: "" // not used by rabbot
  },
  content: { "type": "Buffer", "data": [ ... ] }, // raw buffer of message body
  body: , // this could be an object, string, etc - whatever was published
  type: "" // this also contains the type of the message published
  quarantine: true|false // indicates the message arrived on a poison queue
}
```

## `rabbot.stopSubscription( queueName, [connectionName] )`

> !Caution!:
> * This does not affect bindings to the queue, it only stops the flow of messages from the queue to your service.
> * If the queue is auto-delete, this will destroy the queue, dropping messages and losing any messages sent that would have been routed to it.
> * If a network disruption has occurred or does occur, subscription will be restored to its last known state.

Stops consuming messages from the queue. Does not explicitly change bindings on the queue. Does not explicitly release the queue or the channel used to establish the queue. In general, Rabbot works best when queues exist for the lifetime of a service. Starting and stopping queue subscriptions is likely to produce unexpected behaviors (read: avoid it).

## Message API
rabbot defaults to (and assumes) queues are in ack mode. It batches ack and nack operations in order to improve total throughput. Ack/Nack calls do not take effect immediately.

### `message.ack()`
Enqueues the message for acknowledgement.

### `message.nack()`
Enqueues the message for rejection. This will re-enqueue the message.

### `message.reject()`
Rejects the message without re-queueing it. Please use with caution and consider having a dead-letter-exchange assigned to the queue before using this feature.

### `message.reply( message, [options] )`
Acknowledges the messages and sends the message back to the requestor. The `message` is only the body of the reply.

The options hash can specify additional information about the reply and has the following properties (defaults shown:

```javascript
{
  more: `false`, // lets the recipient know more messages are coming as part of this response
  replyType: `initial message type + ".reply"`, // lets the recipient know the type of reply
  contentType: `see serialization for defaults`, // lets you control what serializer is used,
  headers: {}, // allows for custom headers to get added to the reply
}
```

### Queues in `noBatch` mode
rabbot now supports the ability to put queues into non-batching behavior. This causes ack, nack and reject calls to take place against the channel immediately. This feature is ideal when processing messages are long-running and consumer limits are in place. Be aware that this feature does have a significant impact on message throughput.

## Reply Queues
By default, rabbot creates a unique reply queue for each connection which is automatically subscribed to and deleted on connection close. This can be modified or turned off altogether.

Changing the behavior is done by passing one of three values to the `replyQueue` property on the connection hash:

> !!! IMPORTANT !!! rabbot cannot prevent queue naming collisions across services instances or connections when using the first two options.

### Custom Name
Only changes the name of the reply queue that rabbot creates - `autoDelete` and `subscribe` will be set to `true`.

```javascript
rabbit.addConnection( {
  // ...
  replyQueue: "myOwnQueue"
} );
```

### Custom Behavior
To take full control of the queue name and behavior, provide a queue definition in place of the name.

> rabbot provides no defaults - it will only use the definition provided

```javascript
rabbit.addConnection( {
  // ...
  replyQueue: {
    name: "myOwnQueue",
    subscribe: true,
    durable: true
  }
} );
```

## No Automatic Reply Queue
> Only pick this option if request/response isn't in use or when providing a custom overall strategy

```javascript
rabbit.addConnection( {
  // ...
  replyQueue: false
} );
```

## Custom Serializers

Serializers are objects with a `serialize` and `deserialize` method and get assigned to a specific content type. When a message is published or received with a specific `content-type`, rabbot will attempt to look up a serializer that matches. If one isn't found, an error will get thrown.

> Note: you can over-write rabbot's default serializers but probably shouldn't unless you know what you're doing.

### `rabbot.serialize( object )`

The serialize function takes the message content and must return a Buffer object encoded as "utf8".

### `rabbot.deserialize( bytes, encoding )`

The deserialize function takes both the raw bytes and the encoding sent. While "utf8" is the only supported encoding rabbot produces, the encoding is passed in case the message was produced by another library using a different encoding.

### `rabbot.addSerializer( contentType, serializer )`

```javascript
var yaml = require( "js-yaml" );

rabbit.addSerializer( "application/yaml", {
  deserialize: function( bytes, encoding ) {
    return yaml.safeLoad( bytes.toString( encoding || "utf8" ) );
  },
  serialize: function( object ) {
    return new Buffer( yaml.dump( object ), "utf8" );
  }
} );
```

## Failed Serialization

Failed serialization is rejected without requeueing. If you want to catch this, you must:

 * assign a deadletter exchange (DLX) to your queues
 * bind the deadletter queue (DLQ) to the DLX
 * mark the DLQ with `poison: true`
 * handle one of the topic forms:
   * `original.topic.#` - regular and quarantined messages
   * `original.topic.*` - regular and quarantined messages
   * `original.topic.quarantined` - one topic's quarantined messages
   * `#.quarantined` - all quarantined messages

If your handler is getting both regular and quarantined messages, be sure to check the `quarantined` flag on the message to avoid trying to handle it like a usual message (since it will not be deserialized).

### Rationale

Without this approach, nacking a message body that cannot be processed causes the message to be continuously requeued and reprocessed indefinitely and can cause a queue to fill with garbage.
