# rabbot

[![Build Status](http://67.205.142.228/api/badges/arobson/rabbot/status.svg)](http://67.205.142.228/arobson/rabbot)
[![Version npm](https://img.shields.io/npm/v/rabbot.svg?style=flat)](https://www.npmjs.com/package/rabbot)
[![npm Downloads](https://img.shields.io/npm/dm/rabbot.svg?style=flat)](https://www.npmjs.com/package/rabbot)
[![Dependencies](https://img.shields.io/david/arobson/rabbot.svg?style=flat)](https://david-dm.org/arobson/rabbot)

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

## Differences from `wascally`

#### Let it fail
A great deal of confusion and edge cases arise from how wascally managed connectivity. Wascally treated any loss of connection or channels equally. This made it hard to predict behavior as a user of the library since any action taken against the API could trigger reconnection after an intentional shutdown. It also made it impossible to know whether a user intended to reconnect a closed connection or if the reconnection was the result of a programming error.

Rabbot does not re-establish connectivity automatically after connections have been intentionally closed _or_ after a failure threshold has been passed. In either of these cases, making API calls will either lead to rejected or indefinitely deferred promises. You, the user, must intentionally re-establish connectivity after closing a connection _or_ once rabbot has exhausted its attempts to connect on your behalf.

*The recommendation is*: if rabbot tells you it can't reach rabbot after exhausting the configured retries, shut your service down and let your monitoring and alerting tell you about it. The code isn't going to fix a network or broker outage by retrying indefinitely and filling up your logs.

#### No more indefinite retention of unpublished messages
Wascally retained published messages indefinitely until a connection and all topology could be established. This meant that a service unable to connect could produce messages until it ran out of memory. It also meant that wascally could reject the promise returned from the publish call but then later publish the message without the ability to inform the caller.

When a connection is lost, or the `unreachable` event is emitted, all promises for publish calls are rejected and all unpublished messages are flushed. Rabbot will not provide any additional features around unpublishable messages - there are no good one-size-fits-all behaviors in these failure scenarios and it is important that developers understand and solve these needs at the service level for their use case.

## Demos

 * [pubsub](https://github.com/arobson/rabbot/blob/master/demo/pubsub/README.md)

# API Reference
This library implements promises for the API calls via when.js.

## Connecting

### addConnection ( options )

The call returns a promise that can be used to determine when the connection to the server has been established.

Options is a hash that can contain the following:
 * `uri` - the AMQP URI. No default. This will be parsed and missing defaults will be supplied.
 * `name` - the name of this connection. Defaults to `"default"`.
 * `host` - the IP address or DNS name of the RabbitMQ server. Defaults to `"localhost"`.
 * `port` - the TCP/IP port on which RabbitMQ is listening. Defaults to `5672`.
 * `vhost` - the named vhost to use in RabbitMQ. Defaults to the root vhost, `"%2f"` ("/").
 * `protocol` - the connection protocol to use. Defaults to "amqp://".
 * `user` - the username used for authentication / authorization with this connection. Defaults to "guest".
 * `pass` - the password for the specified user. Defaults to "guest".
 * `timeout` - how long to wait for a connection to be established. 2 second default.
 * `heartbeat` - how often the client and server check to see if they can still reach each other, specified in seconds. Defaults to `30` (seconds).
 * `replyQueue` - the name of the reply queue to use. Defaults to a queue name unique to the process.
 * `publishTimeout` - the default timeout in milliseconds for a publish call.
 * `replyTimeout` - the default timeout in milliseconds to wait for a reply.
 * `failAfter` - limits how long rabbot will attempt to connect (in seconds). Defaults to `60`.
 * `retryLimit` - limits how many consecutive failed attempts rabbot will make. Defaults to 3.

Note that the "default" connection (by name) is used when any method is called without a connection name supplied.

__Options Example__
```javascript
rabbit.addConnection( {
	user: "someUser",
	pass: "sup3rs3cr3t",
	host: "my-rqm.server",
	port: 5672,
	timeout: 2000,
	vhost: "%2f",
	heartbeat: 10
} );
```

__Equivalent URI Example__
```javascript
rabbit.addConnection( {
	uri: "amqp://someUser:sup3rs3cr3t@my-rqm.server:5672/%2f?heartbeat=10"
} );
```

### `failAfter` and `retryLimit`
rabbot will stop trying to connect/re-connect if either of these thresholds is reached (whichever comes first).

### Cluster Support
rabbot provides the ability to define multiple nodes per connections by supplying either a comma delimited list or array of server IPs or names to the `host` property. You can also specify multuple ports in the same way but make certain that either you provide a single port for all servers or that the number of ports matches the number and order of servers.

### Shutting Down
Both exchanges and queues have asynchronous processes that work behind the scenes processing publish confirms and batching message acknowledgements. To shutdown things in a clean manner, rabbot provides a `shutdown` method that returns a promise which will resolve once all outstanding confirmations and batching have completed and the connection is closed.

### Events
rabbot emits both generic and specific connectivity events that you can bind to in order to handle various states:

* Any Connection
 * `connected` - connection to a broker succeeds
 * `closed` - connection to a broker has closed (intentional)
 * `failed` - connection to a broker was lost (unintentional)
 * `unreachable` - connection failures have reached the limit, no further attempts will be made
* Specific Connection
 * `[connectionName].connection.opened`
 * `[connectionName].connection.closed`
 * `[connectionName].connection.failed`
 * `[connectionName].connection.configured` - emitted once all exchanges, queues and bindings are resolved

The connection object is passed to the event handler for each event. Use the `name` property of the connection object to determine which connection the generic events fired for.

> !IMPORTANT! - rabbot handles connectivity for you, mucking about with the connection directly isn't supported.

### Details about publishing & subscribing related to connectivity

#### Publishing
Rabbot will attempt to retain messages you publish during the attempt to connect which it will publish if a connection can be successfully established. It is important to handle rejection of the publish. Only resolved publishes are guaranteed to have been delivered to the broker.

Rabbot limits the number of messages it will retain for each exchange to 100 by default. After the limit is reached, all further publishes will be rejected automatically. This limit was put in place to prevent unbounded memory consumption.

#### Subscribing
The default batch acknowledgement behavior is the default mode for all queues unless you turn off acknowledgements or turn off batching.

> Warning: batching, while complicated, pays off in terms of throughput and decreased broker load.

If a connection is lost before all the batched resolutions (acks, nacks, rejections) have completed, the unresolved messages will be returned to their respective queues and be delivered to the next consumer. _This is an unavoidable aspect of "at least once delivery"; rabbot's default behavior._

If this is undesirable, your options are to turn of acknowledgements (which puts you in "at most once delivery") or turn off batching (which will incur a significant perf penalty in terms of service throughput and broker load).

## Sending & Receiving Messages

### Publish
The publish call returns a promise that is only resolved once the broker has accepted responsibility for the message (see [Publisher Acknowledgments](https://www.rabbitmq.com/confirms.html) for more details). If a configured timeout is reached, or in the rare event that the broker rejects the message, the promise will be rejected. More commonly, the connection to the broker could be lost before the message is confirmed and you end up with a message in "limbo". rabbot keeps a list of unconfirmed messages that have been published _in memory only_. Once a connection is available and the topology is in place, rabbot will send messages in the order of the publish calls. In the event of a disconnection or unreachable broker, all publish promises that have not been resolved are rejected.

Publish timeouts can be set per message, per exchange or per connection. The most specific value overrides any set at a higher level. There are no default timeouts set at any level. The timer is started as soon as publish is called and only cancelled once rabbot is able to make the publish call on the actual exchange's channel. The timeout is cancelled once publish is called and will not result in a rejected promise due to time spent waiting on a confirmation.

> Caution: rabbot does _not_ limit the growth of pending published messages. If a service cannot connect to Rabbit due to misconfiguration or the broker being down, publishing lots of messages can lead to out-of-memory errors. It is the consuming services responsibility to handle these kinds of scenarios.

#### Serializers
rabbot associates serialization techniques for messages with mimeTypes which can now be set when publishing a message. Out of the box, it really only supports 3 types of serialization:

 * `"text/plain"`
 * `"application/json"`
 * `"application/octet-stream"`

You can register your own serializers using `addSerializer` but make sure to do so on both the sending and receiving side of the message.

### publish( exchangeName, options, [connectionName] )
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

### request( exchangeName, options, [connectionName] )
This works just like a publish except that the promise returned provides the response (or responses) from the other side. A `replyTimeout` is available in the options that controls how long rabbot will wait for a reply before removing the subscription for the request to prevent memory leaks.

> Note: the default replyTimeout will be double the publish timeout or 1 second if no publish timeout was ever specified.

```javascript
// when multiple responses are provided, all but the last will be passed to an optional progress callback.
// the last/only reply will always be provided to the .then callback
rabbit.request( "request.exchange", {
		// see publish example to see options for the outgoing message
	}, function ( reply ) {
    // if multiple replies are provided, all but the last will be sent to this callback
  } )
	.then( function( final ) {
		// the last message in a series OR the only reply will be sent to this callback
	} );
```

### handle( typeName, handler, [queueName], [context] )
### handle( options, handler )

> Notes:
> * Handle calls should happen __before__ starting subscriptions.
> * The message's routing key will be used if the type is missing or empty on incoming messages
> * Specifying `queueName` will cause the handler to handle messages for that queue _only_
> * `typeName` can use AMQP style wild-cards to handle multiple message types - use this with caution!

Message handlers are registered to handle a message based on the typeName. Calling handle will return a reference to the handler that can later be removed. The message that is passed to the handler is the raw Rabbit payload. The body property contains the message body published. The message has `ack`, `nack` (requeue the message), `reply` and `reject` (don't requeue the message) methods control what Rabbit does with the message.

> !IMPORTANT!: ack, nack and reject are effectively noOps when a queue's `noAck` is set to `true`. RabbitMQ does not support nacking or rejection of messages from consumers in `no-ack` mode. This means that error handling and unhandled message strategies won't be able to re-queue messages.

#### Options
If using the second format, the options hash can contain the following properties, defaults shown:

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

#### Explicit Error Handling
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

#### Automatically Nack On Error
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

#### Late-bound Error Handling
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

#### !!! IMPORTANT !!! ####
Failure to handle errors will result in silent failures and lost messages.

### Unhandled Messages
The default behavior is that any message received that doesn't have any elligible handlers will get `nack`'d and sent back to the queue immediately.

> Caution: this can create churn on the client and server as the message will be redelivered indefinitely!

To avoid unhandled message churn, select one of the following mutually exclusive strategies:

#### onUnhandled( handler )
```javascript
rabbit.onUnhandled( function( message ) {
	 // handle the message here
} );
```

#### nackUnhandled() - default
Sends all unhandled messages back to the queue.
```javascript
rabbit.nackUnhandled();
```

#### rejectUnhandled()
Rejects unhandled messages so that will will _not_ be requeued. **DO NOT** use this unless there are dead letter exchanges for all queues.
```javascript
rabbit.rejectUnhandled();
```

### Returned Messages
Unroutable messages that were published with `mandatory: true` will be returned. These messages cannot be ack/nack'ed.

#### onReturned( handler )
```javascript
rabbit.onReturned( function( message ) {
	 // the returned message
} );
```

### startSubscription( queueName, [exclusive], [connectionName] )

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
}
```

### stopSubscription( queueName, [connectionName] )

> !Caution!:
> * This does not affect bindings to the queue, it only stops the flow of messages from the queue to your service.
> * If the queue is auto-delete, this will destroy the queue, dropping messages and losing any messages sent that would have been routed to it.
> * If a network disruption has occurred or does occur, subscription will be restored to its last known state.

Stops consuming messages from the queue. Does not explicitly change bindings on the queue. Does not explicitly release the queue or the channel used to establish the queue. In general, Rabbot works best when queues exist for the lifetime of a service. Starting and stopping queue subscriptions is likely to produce unexpected behaviors (read: avoid it).

## Message API
rabbot defaults to (and assumes) queues are in ack mode. It batches ack and nack operations in order to improve total throughput. Ack/Nack calls do not take effect immediately.

### message.ack()
Enqueues the message for acknowledgement.

### message.nack()
Enqueues the message for rejection. This will re-enqueue the message.

### message.reject()
Rejects the message without re-queueing it. Please use with caution and consider having a dead-letter-exchange assigned to the queue before using this feature.

### message.reply( message, [options] )
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

### No Automatic Reply Queue
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

### serialize( object )
The serialize function takes the message content and must return a Buffer object encoded as "utf8".

### deserialize( bytes, encoding )
The deserialize function takes both the raw bytes and the encoding sent. While "utf8" is the only supported encoding rabbot produces, the encoding is passed in case the message was produced by another library using a different encoding.

### addSerializer( contentType, serializer )

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

## Managing Topology

### addExchange( exchangeName, exchangeType, [options], [connectionName] )
The call returns a promise that can be used to determine when the exchange has been created on the server.

Valid exchangeTypes:
 * 'direct'
 * 'fanout'
 * 'topic'

Options is a hash that can contain the following:
 * autoDelete		true|false		delete when consumer count goes to 0
 * durable 			true|false		survive broker restarts
 * persistent 		true|false		a.k.a. persistent delivery, messages saved to disk
 * alternate 		"alt.exchange"	define an alternate exchange
 * publishTimeout	2^32			timeout in milliseconds for publish calls to this exchange
 * replyTimeout		2^32			timeout in milliseconds to wait for a reply
 * limit 			2^16			the number of unpublished messages to cache while waiting on connection

### addQueue( queueName, [options], [connectionName] )
The call returns a promise that can be used to determine when the queue has been created on the server.

Options is a hash that can contain the following:
 * autoDelete		true|false		delete when consumer count goes to 0
 * durable 			true|false		survive broker restarts
 * exclusive		true|false		limits queue to the current connection only (danger)
 * subscribe		true|false		auto-start the subscription
 * limit 			2^16			max number of unacked messages allowed for consumer
 * noAck			true|false 		the server will remove messages from the queue as soon as they are delivered
 * noBatch			true|false 		causes ack, nack & reject to take place immediately
 * noCacheKeys		true|false 		disable cache of matched routing keys to prevent unbounded memory growth
 * queueLimit		2^32			max number of ready messages a queue can hold
 * messageTtl		2^32			time in ms before a message expires on the queue
 * expires			2^32			time in ms before a queue with 0 consumers expires
 * deadLetter 		"dlx.exchange"	the exchange to dead-letter messages to
 * deadLetterRoutingKey   ""    the routing key to add to a dead-lettered message
 * maxPriority		2^8				the highest priority this queue supports
 * unique			'hash'|'id'|'consistent' creates a unique queue name by including the client id or hash in the name

#### unique
The unique option has 3 different possible values, each with its own behavior:

 * `hash` - results in a unique positive integer per process. Use when queue recovery is not a concern.
 * `consistent` - results in a unique positive integer based on machine name and process title. Use when queue recovery is required.
 * `id` - creates a consumer tag consisting of the machine name, process title and process id. Use when readability is desired and queue recovery is not a concern.

> Note: the concept of queue recovery is that the same queue name will be generated in the event of a process restart. If using `hash` or `id`, the pid is used and a different queue name will be generated each time the process starts.

### bindExchange( sourceExchange, targetExchange, [routingKeys], [connectionName] )
Binds the target exchange to the source exchange. Messages flow from source to target.

### bindQueue( sourceExchange, targetQueue, [routingKeys], [connectionName] )
Binds the target queue to the source exchange. Messages flow from source to target.

## Configuration via JSON

> Note: setting subscribe to true will result in subscriptions starting immediately upon queue creation.

This example shows most of the available options described above as well as logging options available through [whistlepunk](https://github.com/leankit-labs/whistlepunk).
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
		],
		logging: {
			adapters: {
				stdOut: { // adds a console logger at the "info" level
					level: 3,
					bailIfDebug: true
				}
			}
		}
	};
```

To establish a connection with all settings in place and ready to go call configure:
```javascript
	var rabbit = require( "rabbot" );

	rabbit.configure( settings ).done( function() {
		// ready to go!
	} );
```

## Managing Connections - Retry, Close and Shutdown
rabbot will attempt to resolve all outstanding publishes and recieved messages (ack/nack/reject) before closing the channels and connection intentionally. If you would like to defer certain actions until after everything has been safely resolved, then use the promise returned from either close call.

> !!! CAUTION !!! - using reset is dangerous. All topology associated with the connection will be removed locally meaning rabbot will _not_ be able to re-establish it all should you decide to reconnect.

### close( [connectionName], [reset] )
Closes the connection, optionally resetting all previously defined topology for the connection. The `connectionName` is `default` if one is not provided.

### closeAll( [reset] )
Closes __all__ connections, optionally resetting the topology for all of them.

### retry()
After an `unhandled` event is raised by rabbot, not further attempts to connect will be made unless `retry` is called.

```js
// How to create a zombie
var rabbit = require( "rabbot" );

rabbit.on( "unreachable", function() {
  rabbit.retry();
} );

```

### shutdown()
Once a connection is established, rabbot will keep the process running unless you call `shutdown`. This is because most services shouldn't automatically shutdown at the first accidental disconnection`. Shutdown attempts to provide the same guarantees as close - only allowing the process to exit after publishing and resolving received messages.

## AMQPS, SSL/TLS Support
Providing the following configuration options setting the related environment varibles will cause rabbot to attempt connecting via AMQPS. For more details about which settings perform what role, refer to the amqplib's page on [SSL](http://www.squaremobius.net/amqp.node/doc/ssl.html).

```javascript
	connection: { 		// sample connection hash
		caPath: "", 	// comma delimited paths to CA files. RABBIT_CA
		certPath: "", 	// path to cert file. RABBIT_CERT
		keyPath: "",	// path to key file. RABBIT_KEY
		passphrase: "", // passphrase associated with cert/pfx. RABBIT_PASSPHRASE
		pfxPath: ""		// path to pfx file. RABBIT_PFX
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

## Logging
As mentioned in the configuration, logging is provided by [whistlepunk](https://github.com/leankit-labs/whistlepunk). While you can easily write your own adapters for it, it supports a standard output adapter and a DEBUG based adapter by default. When troubleshooting, you can prefix starting your process with `DEBUG=rabbot.*` to see all rabbot related log messages. It's worth noting that the `rabbot.queue.#` and `rabbot.exchange.#` logging namespaces will be very high volume since that is where rabbot reports all messages published and subscribed at the debug level.

## A Note About Etiquette
Rabbot was created to address a need at work. Any time I spend on it during work hours is to ensure that it does what my employer needs it to. The considerable amount of time I've spent on wascally and now rabbot outside of work hours is because I love open source software and the community want to contribute. I hope that you find this library useful and that it makes you feel like your job or project was easier.

That said, I am often troubled by how often users of open source libraries become demanding consumers rather than active participants. Please keep a cordial/professional tone when reporting issues or requesting help. Feature requests or issue reports that have an entitled or disrespectful tone will be ignored and closed. All of us in open source are benefiting from a considerable amount of knowledge and effort for $0; please keep this in mind when frustrated about a defect, design flaw or missing feature.

While I appreciate suggestions for how to make things better, I'd much rather see participation in the form of pull requests. I'd be happy to help you out if there are parts of the code base you're uncomfortable with.

## Additional Learning Resources

### Watch Me Code
Thanks to Derick Bailey's input, the API and documentation for rabbot have improved a lot. You can learn from Derick's hands-on experience in his [Watch Me Code](https://sub.watchmecode.net/categories/rabbitmq/) series.

### RabbitMQ In Action
Alvaro Vidella and Jason Williams literally wrote the book on [RabbitMQ](http://www.manning.com/videla/).

### Enterprise Integration Patterns
Gregor Hophe and Bobby Woolf's definitive work on messaging. The [site](http://www.enterpriseintegrationpatterns.com/) provides basic descriptions of the patterns and the [book](http://www.amazon.com/Enterprise-Integration-Patterns-Designing-Deploying/dp/0321200683) goes into a lot of detail.

I can't recommend this book highly enough; understanding the patterns will provide you with the conceptual tools need to be successful.

## Contributing
PRs with insufficient coverage, broken tests or deviation from the style will not be accepted.

### Behavior & Integration Tests
PRs should include modified or additional test coverage in both integration and behavioral specs. Integration tests assume RabbitMQ is running on localhost with guest/guest credentials and the consistent hash exchange plugin enabled. You can enable the plugin with the following command:

```bash
rabbitmq-plugins enable rabbitmq_consistent_hash_exchange
```

Running gulp will run both sets after every file change and display a coverage summary. To view a detailed report, run gulp coverage once to bring up the browser.

### Docker

rabbot now provides a `Dockerfile` and npm scripts you can use to create an image and container to run the tests. If you're on Linux or have the new Docker for OS X/Windows, this should be very straight-forward. Under the hood, it uses the official RabbitMQ Docker image. It will forward RabbitMQ's default ports to `localhost`.

*If you already have a working RabbitMQ container with 5672 forwarded to your localhost, you don't need any of this.*

The first time, you can build the Docker image with the following:
```bash
$ npm run build-image
```

After that, create a daemonized container based off the image with:
```bash
$ npm run start-image
```

Now you have a daemonized rabbitmq Docker container with the port `5672` and management console at `15672` (the defaults) using `guest` and `guest` for the login, `/` as the vhost and the consistent hash exchange plugin enabled.

You can access the management console at `http://localhost:15672`.

Click here for more information on [Docker](http://docker.com) and [official RabbitMQ Docker image](https://registry.hub.docker.com/_/rabbitmq/).

*To run tests once you have RabbitMQ up:*

```bash
$ gulp
```

OR

```bash
$ mocha spec/**
```

### Style
This project has both an `.editorconfig` and `.esformatter` file to help keep adherance to style simple. Please also take advantage of the `.jshintrc` file and avoid linter warnings.

## Roadmap
 * improve support RabbitMQ backpressure mechanisms
 * add support for Rabbit's HTTP API
