# Managing Topology

## Configuration via JSON (recommended)

This is the recommended approach to creating topology with rabbot. Configuration should only happen once per service. If a disconnect takes place, rabbot will attempt to re-establish the connection and all topology, including previously established subscriptions.

> Note: setting subscribe to true will result in subscriptions starting immediately upon queue creation; be sure to have handlers created *before hand*.

This example shows most of the available options described above.
```javascript
  var settings = {
    connection: {
      user: "guest",
      pass: "guest",
      server: "127.0.0.1",
      // server: "127.0.0.1, 194.66.82.11",
      // server: ["127.0.0.1", "194.66.82.11"],
      port: 5672,
      timeout: 2000,
      vhost: "%2fmyhost"
      },
    exchanges:[
      { name: "config-ex.1", type: "fanout", publishTimeout: 1000 },
      { name: "config-ex.2", type: "topic", alternate: "alternate-ex.2", persistent: true },
      { name: "dead-letter-ex.2", type: "fanout" }
      ],
    queues:[
      { name:"config-q.1", limit: 100, queueLimit: 1000 },
      { name:"config-q.2", subscribe: true, deadLetter: "dead-letter-ex.2" }
      ],
    bindings:[
      { exchange: "config-ex.1", target: "config-q.1", keys: [ "bob","fred" ] },
      { exchange: "config-ex.2", target: "config-q.2", keys: "test1" }
    ]
  };
```

To establish a connection with all settings in place and ready to go call configure:
```javascript
  var rabbit = require( "rabbot" );

  rabbit.configure( settings ).done( function() {
    // ready to go!
  } );
```

## `rabbot.addExchange( exchangeName, exchangeType, [options], [connectionName] )`

The call returns a promise that can be used to determine when the exchange has been created on the server.

Valid exchangeTypes:
 * 'direct'
 * 'fanout'
 * 'topic'

Options is a hash that can contain the following:

| option | type | description | default  |
|--:|:-:|:--|:-:|
| **autoDelete** | boolean | delete when consumer count goes to 0 | `false` |
| **durable** | boolean | survive broker restarts | `false` |
| **persistent** | boolean | a.k.a. persistent delivery, messages saved to disk | `false` |
| **alternate** | string |  define an alternate exchange | |
| **publishTimeout** | 2^32 | timeout in milliseconds for publish calls to this exchange ||
| **replyTimeout** | 2^32 | timeout in milliseconds to wait for a reply | |
| **limit** | 2^16 | the number of unpublished messages to cache while waiting on connection | |
| **noConfirm** | boolean | prevents rabbot from creating the exchange in confirm mode | false |

## `rabbot.addQueue( queueName, [options], [connectionName] )`

The call returns a promise that can be used to determine when the queue has been created on the server.

Options is a hash that can contain the following:

| option | type | description | default  |
|--:|:-:|:--|:-:|
| **autoDelete** | boolean | delete when consumer count goes to 0 | |
| **durable** | boolean | survive broker restarts | false |
| **exclusive** | boolean | limits queue to the current connection only (danger) | false |
| **subscribe** | boolean | auto-start the subscription | false |
| **limit** | 2^16 |max number of unacked messages allowed for consumer | |
| **noAck** | boolean | the server will remove messages from the queue as soon as they are delivered | false |
| **noBatch** | boolean | causes ack, nack & reject to take place immediately | false |
| **noCacheKeys** | boolean | disable cache of matched routing keys to prevent unbounded memory growth | false |
| **queueLimit** | 2^32 |max number of ready messages a queue can hold | |
| **messageTtl** | 2^32 |time in ms before a message expires on the queue | |
| **expires** | 2^32 |time in ms before a queue with 0 consumers expires | |
| **deadLetter** | string | the exchange to dead-letter messages to | |
| **deadLetterRoutingKey** | string | the routing key to add to a dead-lettered message
| **maxPriority** | 2^8 | the highest priority this queue supports | |
| **unique** | `"hash", `"id", "consistent"` | creates a unique queue name by including the client id or hash in the name | |
| **poison** | boolean | indicates that this queue is specifically for poison / rejected messages| false |

### unique

The unique option has 3 different possible values, each with its own behavior:

 * `hash` - results in a unique positive integer per process. Use when queue recovery is not a concern.
 * `consistent` - results in a unique positive integer based on machine name and process title. Use when queue recovery is required.
 * `id` - creates a consumer tag consisting of the machine name, process title and process id. Use when readability is desired and queue recovery is not a concern.

> Note: the concept of queue recovery is that the same queue name will be generated in the event of a process restart. If using `hash` or `id`, the pid is used and a different queue name will be generated each time the process starts.

You can specify unique queues by their friendly-name when handling and subscribing. To get the actual assigned queue name (which you should not need), you can use:

```js
const realQueueName = rabbot.getQueue('friendly-q-name').uniqueName;
```

### poison

If you want to capture instances where messages have no serializer or failed to deserialize properly, you can create a dead-letter exchange and bind it to a queue where you set `poison: true` so that in the event of further errors, rabbot will continue to deliver the message without deserialization.

 * `body` will be set to the raw Buffer
 * `quarantine` will be set to `true` as well

## `rabbot.bindExchange( sourceExchange, targetExchange, [routingKeys], [connectionName] )`

Binds the target exchange to the source exchange. Messages flow from source to target.

## `rabbot.bindQueue( sourceExchange, targetQueue, [routingKeys], [connectionName] )`

Binds the target queue to the source exchange. Messages flow from source to target.

## `rabbot.purgeQueue( queueName, [connectionName] )`

Returns a promise that will resolve to the number of purged messages. Purging is a very complicated operation and should not be used without an appreciation for nuances in how amqp delivery and rabbot's ack system works.

When purge is called in rabbot, first it checks to see if any messages are in the queue before it bothers moving on to try to purge. "That's a race condition!" - right, but so is purging.

Purging in rabbot does _not_ remove the queue bindings for you. **If** the queue is marked as `autoDelete: true`, rabbot cannot even stop the subscription for you because doing so will cause the queue to be deleted, removing its bindings and any upstream exchanges bound to it marked with `autoDelete: true` that don't have other bindings at the moment.

In the even that the queue isn't `autoDelete`, the subscription will be halted for the duration of the purge operation and then rabbot will attempt to re-establish subscription to the queue after.

Anytime lots of operations are taking place against an amqp channel, there are opportunities for unexpected behaviors in terms of message arrival or even channel loss. It's important to understand the context you're in when calling `purgeQueue` and I recommend limiting its application.

## Channel Prefetch Limits

rabbot mostly hides the notion of a channel behind the scenes, but still allows you to specify channel options such as the channel prefetch limit. Rather than specifying
this on a channel object, however, it is specified as a `limit` on a queue defintion.

```js
queues: [{
  // ...

  limit: 5
}]

// or

rabbit.addQueue( "some.q", {
  // ...

  limit: 5
});
```

This queue configuration will set a prefetch limit of 5 on the channel that is used for consuming this queue.

**Note:** The queue `limit` is not the same as the `queueLimit` option - the latter of which sets the maximum number of messages allowed in the queue.


