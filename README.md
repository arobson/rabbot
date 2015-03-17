# Wascally
This is a very opinionated abstraction over amqplib to help simplify certain common tasks and (hopefully) reduce the effort required to use RabbitMQ in your Node services.

### Features:

 * Gracefully handle re-connections
 * Automatically re-define all topology on re-connection
 * Automatically re-send any unconfirmed messages on re-connection
 * Support the majority of RabbitMQ's extensions
 * Handle batching of acknowledgements and rejections
 * Topology & configuration via the JSON configuration method (thanks to @JohnDMathis!)

### Assumptions & Defaults:

 * Fault-tolerance/resilience over throughput
 * Default to publish confirmation
 * Default to ack mode on consumers
 * Heterogenous services that include statically typed languages
 * JSON as the only serialization provider

### Demos

 * [pubsub](https://github.com/LeanKit-Labs/wascally/blob/master/demo/pubsub/README.md)

# API Reference
This library implements promises for many of the calls via when.js.

## Sending & Receiving Messages

### publish( exchangeName, options, [connectionName] )
This syntax uses an options object rather than arguments, here's an example showing all of the available properties:

```javascript
rabbit.publish( 'exchange.name', {
		routingKey: 'hi',
		type: 'company.project.messages.textMessage',
		correlationId: 'one',
		body: { text: 'hello!' },
		messageId: '100',
		expiresAfter: 1000 // TTL in ms, in this example 1 second
		timestamp: // posix timestamp (long)
		headers: {
			'random': 'application specific value'
		}
	},
	connectionName: '' // another optional way to provide connection name if needed
);
```

### publish( exchangeName, typeName, messageBody, [routingKey], [correlationId], [connectionName] )
Messages bodies are simple objects. A type specifier is required for the message which will be used to set AMQP's properties.type. If no routing key is provided, the type specifier will be used. A routing key of '' will prevent the type specifier from being used.

```javascript
// the first 3 arguments are required
// routing key is optional and defaults to the value of typeName
// connectionName is only needed if you have multiple connections to different servers or vhosts

rabbit.publish( 'log.entries', 'company.project.messages.logEntry', {
		date: Date.now(),
		level: logLevel,
		message: message
	}, 'log.' + logLevel, someValueToCorrelateBy );
```

### request( exchangeName, options, [connectionName] )
This works just like a publish except that the promise returned provides the response (or responses) from the other side.

```javascript
// when multiple responses are provided, all but the last will be provided via the .progress callback.
// the last/only reply will always be provided to the .then callback
rabbit.request( 'request.exchange', {
		// see publish example to see options for the outgoing message
	} )
	.progress( function( reply ) {
		// if multiple replies are provided, all but the last will be sent via the progress callback
	} )
	.then( function( final ) {
		// the last message in a series OR the only reply will be sent to this callback
	} );
```

### handle( typeName, handler, [context] )

> Handle calls should happen __before__ starting subscriptions.

Message handlers are registered to handle a message based on the typeName. Calling handle will return a reference to the handler that can later be removed. The message that is passed to the handler is the raw Rabbit payload. The body property contains the message body published. The message has `ack`, `nack` (requeue the message) and `reject` (don't requeue the message) methods control what Rabbit does with the message.

#### Explicit Error Handling
In this example, any possible error is caught in an explicit try/catch:

```javascript
var handler = rabbit.handle( 'company.project.messages.logEntry', function( message ) {
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
This example shows how to have wascally wrap all handlers with a try catch that:

 * nacks the message on error
 * console.log that an error has occurred in a handle

```javascript
// after this call, any new callbacks attached via handle will be wrapped in a try/catch
// that nacks the message on an error
rabbit.nackOnError();

var handler = rabbit.handle( 'company.project.messages.logEntry', function( message ) {
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
var handler = rabbit.handle( 'company.project.messages.logEntry', function( message ) {
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
In previous versions, if a subscription was started in ack mode (the default) without a handler to process the message, the message would get lost in limbo until the connection (or channel) was closed and then the messages would be returned to the queue. This is very confusing and undesirable behavior. To help protect against this, the new default behavior is that any message received that doesn't have any elligible handlers will get `nack`'d and sent back to the queue immediately.

This is _still_ problematic because it can create churn on the client and server as the message will be redelivered indefinitely.

To change this behavior, use one of the following calls:

> Note: only one of these strategies can be activated at a time

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

### startSubscription( queueName, [connectionName] )

> Recommendation: set handlers for anticipated types up before starting subscriptions.

Starts a consumer on the queue specified. `connectionName` is optional and only required if subscribing to a queue on a connection other than the default one.

## Message API
Wascally defaults to (and assumes) queues are in ack mode. It batches ack and nack operations in order to improve total throughput. Ack/Nack calls do not take effect immediately.

### message.ack()
Enqueues the message for acknowledgement.

### message.nack()
Enqueues the message for rejection. This will re-enqueue the message.

### message.reject()
Rejects the message without re-queueing it. Please use with caution and consider having a dead-letter-exchange assigned to the queue before using this feature.

### message.reply( message, [more], [replyType] )
Acknowledges the messages and sends the message back to the requestor. The `message` is only the body of the reply. Providing true to `more` will cause the message to get sent to the .progress callback of the request promise so that you can send multiple replies. The `replyType` argument sets the type of the reply message. (important when messaging with statically typed languages)

### Queues in `noBatch` mode
Wascally now supports the ability to put queues into non-batching behavior. This causes ack, nack and reject calls to take place against the channel immediately. This feature is ideal when processing messages are long-running and consumer limits are in place. Be aware that this feature does have a significant impact on message throughput.

## Reply Queues
By default, wascally creates a unique reply queue for each connection which is automatically subscribed to and deleted on connection close. This can be modified or turned off altogether.

Changing the behavior is done by passing one of three values to the `replyQueue` property on the connection hash:

> !!! IMPORTANT !!! wascally cannot prevent queue naming collisions across services instances or connections when using the first two options.

### Custom Name
Only changes the name of the reply queue that wascally creates - `autoDelete` and `subscribe` will be set to `true`.

```javascript
rabbit.addConnection( {
	name: 'default',
	replyQueue: 'myOwnQueue',
	user: 'guest',
	pass: 'guest',
	server: '127.0.0.1',
	port: 5672,
	timeout: 2000,
	vhost: '%2f'
} );
```

### Custom Behavior
To take full control of the queue name and behavior, provide a queue definition in place of the name.

> wascally provides no defaults - it will only use the definition provided

```javascript
rabbit.addConnection( {
	name: 'default',
	replyQueue: {
		name: 'myOwnQueue',
		subscribe: 'true',
		durable: true
	},
	user: 'guest',
	pass: 'guest',
	server: '127.0.0.1',
	port: 5672,
	timeout: 2000,
	vhost: '%2f'
} );
```

### No Automatic Reply Queue
> Only pick this option if request/response isn't in use or when providing a custom overall strategy

```javascript
rabbit.addConnection( {
	name: 'default',
	replyQueue: false,
	user: 'guest',
	pass: 'guest',
	server: '127.0.0.1',
	port: 5672,
	timeout: 2000,
	vhost: '%2f'
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
 * alternate 		'alt.exchange'	define an alternate exchange

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
 * queueLimit		2^32			max number of ready messages a queue can hold
 * messageTtl		2^32			time in ms before a message expires on the queue
 * expires			2^32			time in ms before a queue with 0 consumers expires
 * deadLetter 		'dlx.exchange'	the exchange to dead-letter messages to

### bindExchange( sourceExchange, targetExchange, [routingKeys], [connectionName] )
Binds the target exchange to the source exchange. Messages flow from source to target.

### bindQueue( sourceExchange, targetQueue, [routingKeys], [connectionName] )
Binds the target queue to the source exchange. Messages flow from source to target.

## Configuration via JSON

> Note: setting subscribe to true will result in subscriptions starting immediately upon queue creation.

This example shows most of the available options described above.
```javascript
	var settings = {
		connection: {
			user: 'guest',
			pass: 'guest',
			server: '127.0.0.1',
			port: 5672,
			timeout: 2000,
			vhost: '%2fmyhost'
			},
		exchanges:[
			{ name: 'config-ex.1', type: 'fanout'  },
			{ name: 'config-ex.2', type: 'topic', alternate: 'alternate-ex.2', persistent: true },
			{ name: 'dead-letter-ex.2', type: 'fanout' }
			],
		queues:[
			{ name:'config-q.1', limit: 100, queueLimit: 1000 },
			{ name:'config-q.2', subscribe: true, deadLetter: 'dead-letter-ex.2' }
			],
		bindings:[
			{ exchange: 'config-ex.1', target: 'config-q.1', keys: [ 'bob','fred' ] },
			{ exchange: 'config-ex.2', target: 'config-q.2', keys: 'test1' }
		]
	};
```

To establish a connection with all settings in place and ready to go call configure:
```javascript
	var rabbit = require( 'wascally' );

	rabbit.configure( settings ).done( function() {
		// ready to go!
	} );
```

## Closing Connections
Wascally will attempt to resolve all outstanding publishes and recieved messages (ack/nack/reject) before closing the channels and connection. If you would like to defer certain actions until after everything has been safely resolved, then use the promise returned from either close call.

> !!! CAUTION !!! - using reset is dangerous. All topology associated with the connection will be removed meaning wasclly will not be able to re-establish it all should you decide to reconnect.

### close( [connectionName], [reset] )
Closes the connection, optionall resetting all previously defined topology for the connection. The `connectionName` uses `default` if one is not provided.

### closeAll( [reset] )
Closes __all__ connections, optionally resetting the topology for all of them.

## AMQPS, SSL/TLS Support
Providing the following configuration options setting the related environment varibles will cause wascally to attempt connecting via AMQPS. For more details about which settings perform what role, refer to the amqplib's page on [SSL](http://www.squaremobius.net/amqp.node/doc/ssl.html).

```javascript
	connection: { 		// sample connection hash
		caPath: '', 	// comma delimited paths to CA files. RABBIT_CA
		certPath: '', 	// path to cert file. RABBIT_CERT
		keyPath: '',	// path to key file. RABBIT_KEY
		passphrase: '', // passphrase associated with cert/pfx. RABBIT_PASSPHRASE
		pfxPath: ''		// path to pfx file. RABBIT_PFX
	}
```

## Channel Prefetch Limits

Wascally mostly hides the notion of a channel behind the scenes, but still allows you to specify channel options such as the channel prefetch limit. Rather than specifying
this on a channel object, however, it is specified as a `limit` on a queue defintion.

```js
queues: [{
  // ...

  limit: 5
}]

// or

rabbit.addQueue("some.q", {
  // ...

  limit: 5
});
```

This queue configuration will set a prefetch limit of 5 on the channel that is used for consuming this queue.

**Note:** The queue `limit` is not the same as the `queueLimit` option - the latter of which sets the maximum number of messages allowed in the queue.

## Additional Learning Resources

### Watch Me Code
Thanks to Derick Bailey's input, the API and documentation for wascally have improved a lot. You can learn from Derick's hands-on experience in his [Watch Me Code](https://sub.watchmecode.net/categories/rabbitmq/) series.

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
rabbit-plugins enable rabbitmq_consistent_hash_exchange
```

Running gulp will run both sets after every file change and display a coverage summary. To view a detailed report, run gulp coverage once to bring up the browser.

### Style
This project has both an `.editorconfig` and `.esformatter` file to help keep adherance to style simple. Please also take advantage of the `.jshintrc` file and avoid linter warnings.

## Roadmap
 * additional test coverage
 * support RabbitMQ backpressure mechanisms
 * (configurable) limits & behavior when publishing during connectivity issues
 * ability to capture/log unpublished messages on shutdown
 * add support for Rabbit's HTTP API
 * enable better cluster utilization by spreading connections out over all nodes in cluster
