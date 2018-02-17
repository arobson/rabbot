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

### unique

The unique option has 3 different possible values, each with its own behavior:

 * `hash` - results in a unique positive integer per process. Use when queue recovery is not a concern.
 * `consistent` - results in a unique positive integer based on machine name and process title. Use when queue recovery is required.
 * `id` - creates a consumer tag consisting of the machine name, process title and process id. Use when readability is desired and queue recovery is not a concern.

> Note: the concept of queue recovery is that the same queue name will be generated in the event of a process restart. If using `hash` or `id`, the pid is used and a different queue name will be generated each time the process starts.

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

## Managing Connections - Retry, Close and Shutdown

These methods should not see regular use inside of a typical long-running service unless you have a highly specialized use-case where you can pre-empt error conditions effectively and perform a graceful shutdown.

Realize that this is rare and that it's ok for services to fail and restart by a service management layer or cluster orchestration (Docker, especially in the context of something like Kubernetes).

During intentional connection close or shutdown, rabbot will attempt to resolve all outstanding publishes and recieved messages (ack/nack/reject) before closing the channels and connection intentionally. If you would like to defer certain actions until after everything has been safely resolved, then use the promise returned from either close call.

> !!! CAUTION !!! - passing reset is dangerous. All topology associated with the connection will be removed locally meaning rabbot will _not_ be able to re-establish it all should you decide to reconnect. It's really there to support integration teardown.

### `rabbot.close( [connectionName], [reset] )`

Closes the connection, optionally resetting all previously defined topology for the connection. The `connectionName` is `default` if one is not provided.

### `rabbot.closeAll( [reset] )`

Closes __all__ connections, optionally resetting the topology for all of them.

### `rabbot.retry()`

After an `unhandled` event is raised by rabbot, not further attempts to connect will be made unless `retry` is called.

It's worth noting that you should be pairing this with monitoring and alerting on your Broker so that you aren't relying on indefinite retry. Your goal should not be services that never restart. Your goal should be building systems resilient to failures (by allowing them to crash and restart gracefully).

```js
// How to create a zombie
var rabbit = require( "rabbot" );

rabbit.on( "unreachable", function() {
  rabbit.retry();
} );

```

### `rabbot.shutdown()`

Once a connection is established, rabbot will keep the process running unless you call `shutdown`. This is because most services shouldn't automatically shutdown at the first accidental disconnection`. Shutdown attempts to provide the same guarantees as close - only allowing the process to exit after publishing and resolving received messages.

## AMQPS, SSL/TLS Support

Providing the following configuration options setting the related environment varibles will cause rabbot to attempt connecting via AMQPS. For more details about which settings perform what role, refer to the amqplib's page on [SSL](http://www.squaremobius.net/amqp.node/doc/ssl.html).

```javascript
  connection: {     // sample connection hash
    caPath: "",   // comma delimited paths to CA files. RABBIT_CA
    certPath: "",   // path to cert file. RABBIT_CERT
    keyPath: "",  // path to key file. RABBIT_KEY
    passphrase: "", // passphrase associated with cert/pfx. RABBIT_PASSPHRASE
    pfxPath: ""   // path to pfx file. RABBIT_PFX
  }
```

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


