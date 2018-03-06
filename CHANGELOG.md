# Change Log

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

<a name="2.1.0"></a>
# [2.1.0](https://github.com/arobson/rabbot/compare/v1.1.0...v2.1.0) (2018-02-18)


### Bug Fixes

* ([#104](https://github.com/arobson/rabbot/issues/104)) improve poison message handling ([9d5ccc3](https://github.com/arobson/rabbot/commit/9d5ccc3))
* ([#109](https://github.com/arobson/rabbot/issues/109)) randomize initial connection index based on pid or hostname ([2d6f372](https://github.com/arobson/rabbot/commit/2d6f372))
* ([#74](https://github.com/arobson/rabbot/issues/74)) correct errors in direct reply queue implementation ([cccdf09](https://github.com/arobson/rabbot/commit/cccdf09))
* ([#78](https://github.com/arobson/rabbot/issues/78)) make it possible to handle messages from a unique queue using the alias/friendly name ([50045a8](https://github.com/arobson/rabbot/commit/50045a8))
* correct issue where publishes and requests before connection or configuration had completed would get lost ([1f58c0b](https://github.com/arobson/rabbot/commit/1f58c0b))
* remove remaining lodash references in core that got missed ([9aa3b04](https://github.com/arobson/rabbot/commit/9aa3b04))


### Features

* ([#87](https://github.com/arobson/rabbot/issues/87)) add support for scatter-gather pattern via request ([db23b48](https://github.com/arobson/rabbot/commit/db23b48))
* ([#93](https://github.com/arobson/rabbot/issues/93)) add support for bulkPublish operation ([d2df5ea](https://github.com/arobson/rabbot/commit/d2df5ea))
* add support for purging queues ([19a678d](https://github.com/arobson/rabbot/commit/19a678d))



<a name="2.1.0"></a>
# [2.1.0](https://github.com/arobson/rabbot/compare/v1.1.0...v2.1.0) (2018-02-18)


### Bug Fixes

* ([#104](https://github.com/arobson/rabbot/issues/104)) improve poison message handling ([9d5ccc3](https://github.com/arobson/rabbot/commit/9d5ccc3))
* ([#109](https://github.com/arobson/rabbot/issues/109)) randomize initial connection index based on pid or hostname ([2d6f372](https://github.com/arobson/rabbot/commit/2d6f372))
* ([#74](https://github.com/arobson/rabbot/issues/74)) correct errors in direct reply queue implementation ([cccdf09](https://github.com/arobson/rabbot/commit/cccdf09))
* ([#78](https://github.com/arobson/rabbot/issues/78)) make it possible to handle messages from a unique queue using the alias/friendly name ([50045a8](https://github.com/arobson/rabbot/commit/50045a8))
* correct issue where publishes and requests before connection or configuration had completed would get lost ([1f58c0b](https://github.com/arobson/rabbot/commit/1f58c0b))


### Features

* ([#87](https://github.com/arobson/rabbot/issues/87)) add support for scatter-gather pattern via request ([db23b48](https://github.com/arobson/rabbot/commit/db23b48))
* ([#93](https://github.com/arobson/rabbot/issues/93)) add support for bulkPublish operation ([d2df5ea](https://github.com/arobson/rabbot/commit/d2df5ea))
* add support for purging queues ([19a678d](https://github.com/arobson/rabbot/commit/19a678d))




# rabbot

## 2.0.0

 * Allow publisher confirms to be turned off per exchange
 * Moving towards ES6 features
 * Clean up cases where arguments were being re-written (perf issue)
 * Reduce cases where properties are introduced to hashes after instantiation (perf issue)
 * Rewrite tests into single modules with individual config to make contributing & maintenance easier
 * Move build system to Travis
 * Use coveralls to track code coverage
 * Remove lodash dependency
 * Remove when dependency
 * Change logging to bole
 * Change commit style to conventional commits
 * Adopt semistandard as format style
 * Improve README badges
 * Break docs into multiple docs
 * Add code of conduct
 * Add contributor guidelines
 * #80 - fixes issue where multiple messages were nack'd in nobatch mode
 * #42 - fixes issue regarding broken build status
 * Fixes for: #120, #107, #97, #42

## 1.0.x

### 1.1.0
 * feature (#72) - support sending persistent messages to default exchanges (thanks @bmatson!)
 * feature (#66) - support passing SSL certs as string (thanks @mrfelton!)
 making progress callback an optional argument
 * #71 - leave error handler attached to connection object to try and prevent errors from being thrown from the AMQP library
 * #69 - fixes an issue where the `*.connection.configured` event was not correctly being raised
 * #64 - added mention of `deadLetterRoutingKey` option to queue declaration
 * #57 - fixes (with breaking change) by removing dependency on deprecated when feature and

### 1.0.8
 * #52 - serialize arrays as JSON by default
 * Change connection timeout to default to 2 seconds
 * #49 - bug fix for exchange recreation when reconnecting
 * #33, #54 - bug fixes around graceful shutdown

### 1.0.7
 * #50 - deleting queue after starting subscription causes channel error
 * bug fix - ensure correct SNI is used with SSL connections when using multiple endpoints
 * improvement - switch UUID lib to `uuid` since `node-uuid` is deprecated

### 1.0.6
 * #38 - Correct race conditions in queueFsm and exchangeFsm causing errors during reconnection
 * #37 - Add ability to capture Rabbit generated queue names
 * #36 - Make options optional for addExchange and addQueue
 * #19 - Add support for publishing arrays directly (as buffers)
 * Added Drone build
 * Update dependencies to latest
 * Defect - queues and exchanges with the same name shared channels causing serious problems
 * Improvement - add support for default exchange
 * Improvement - changed from jshint to eslint

### 1.0.5

 * Improvement - remove Vagrant in favor of just using Dockerfile, updated instructions

### 1.0.4

 * Bug Fix - Publish no longer throws errors if made before calling addConnection or configure or if exchange does not exist

### 1.0.3

 * Bug Fix - #26 - fixed a bug preventing `bindQueue` from working on unique queues
 * Bug Fix - #22 - addConnection did not return a promise (thanks @mkozjak)
 * Enhancement - publishing a number as a body gets converted to a string (thanks @brandonpsmith)
 * Enhancement - routing keys can be changed on binding (thanks @droidenator)

### 1.0.2

 * Bug fix - corrected bug causing connection.unreachable event not to be prefixed with connection name correctly (thanks @Cyri-L)

### 1.0.1

* Bug fix - uri parsing should not including leading slash between host specification and vhost
* Add section to README about logging

* Feature - add default and custom strategies for returned mandatory messages

### 1.0.0 - issues addressed from wascally
 * 103 - gulp test no longer throws expect.js errors
 * 111 - support exclusive subscriptions when calling `startSubscription`
 * 112 - add `shutdown` method to allow node to exit
 * 116 - support multiple serializers
 * 119, 115, 107 - resubscribe to all previously subscribed queues after reconnect
 * 121 - `rejectUnhandled` should now correctly reject unhandled messages
 * 122 - guarantee support for type and routing keys set to `''`
 * Feature - `unique` property on queue creation allows for "single use" exclusive queues with TTL
 	* "hash" adds a numeric value
 	* "id" uses client id for clearer ownership
 * Feature - add machine and process info to connection properties for easier identification in management console
 * Feature - consumer tags are now based on "client id"
 * Feature - handlers can now be scoped/limited by queue name
 * Feature - allow custom limits for deferred published messages
 * Feature - add support for AMQP URIs when defining connections
 * Feature - add ability to stop a running subscription to the queue
 * Improvement - use "client id" to create response queue names
 * Improvement - more warning level logging around channel and connection disruption
 * Improvement - ensure UTC timestamps are put on published messages
 * Improvemet - reject `reply` promise with error if no `replyTo` address is provided
 * Improvement - set appId to "client id" on publish
 * Improvement - introduce limit to the number of messages an exchange will cache waiting for a connection
 * Improvement - handle blocked and unblocked broker events internally
 * Improvement - limit the number of messages stored per exchange while waiting on a connection
 * Bug fix - do not resolve close on connection until all publishes have been confirmed
 * Bug fix - use reject instead of nack when queues are in noBatch
 * Bug fix - noop nacks and rejections when consuming in no-ack mode
 * Bug fix - channels closed by the broker should still be re-acquired with redefined primitives
 * Bug fix - check for existence of headers before checking for direct-reply-to header. Thanks Matt Young (@mashu-daishi)
 * Breaking - no longer recover automatically from a user terminated connection
 * Breaking - limit number/duration of connection retries
 * Breaking - messages are not auto-re-published when a connection or channel fails

#### Significant or Breaking changes
 * reply signature has changed to support control over serialziation
 * response queues are named very differently, shouldn't break code, but worth noting
 * `wascally.iomonad` logging namespace changed to `wascally.io`
 * timeouts added to requests

# wascally - preserved for history

## 0.2.*

### 0.2.10
 * 107 - Correct improper connection timeout configuration and update README
 * Update dependencies to latest versions
 * Use latest whistlepunk log api

### 0.2.9
 * 91 - Provide publish timeout
 * 98 - No-op duplicate exchange, queue and binding declarations
 * 96 - Fall back to routing key if no type is provided for routing
 * 94 - Update amqplib dependnecy to 0.4.0 to support Node 4
 * 77 - Add explanation of connection events
 * 95 - Add test coverage for wildcards in handle
 * Change log namespaces to use '.' delimiter instead of ':'
 * Add example for VirtualBox in Vagrantfile.sample - thanks, @josephfrazier
 * Correct configuration and README regarding ports, credentials, and clustering - thanks again, @josephfrazier

### 0.2.8
 * Bug fix - Resolve issue #64 working with node-config no longer throws exceptions by avoiding `get` call
 * Minor improvement to README to better explain publish promises

### 0.2.7
 * Bug fix - correct memory leak in req/res by leveraging new postal feature

### 0.2.6
 * Bug fix - calling destroy on a queue or exchange should defer until they are in ready state.
 * Update machine and monologue versions
 * Remove when.promise and event handles in favor of deferred promises and transitions

### 0.2.5

 * 65 - Bug Fix: setting replyQueue to false caused publish to fail silently.
 * 63 - Add `uri` property to connection object emitted for 'connected' event.
 * 61 - Bug Fix: correct SSL URIs - thanks, @longplay
 * Improvements to connection clean up (specifically around resolving outstanding messages on queues)
 * ConnectionFSM - Only emit 'connected' when establishing a new connection, use 'already-connected' otherwise.

### 0.2.4
Thanks to @dvideby0 and @neverfox for identifying and providing code to help reproduce bugs 39 and 57.

 * 39, 57 - Bug fix: acking responses did not resolve them causing them to pile up in a response queue
 * Bug fix: setting replyQueue to false throws exceptions
 * Bug fix: replying from a service with replyQueue set to false fails
 * Spec update - request spec in integration tests failed to ack messages causing closeAll to hang

### 0.2.3
 * 47 - Added support for `noBatch` to queues, thanks @derickbailey!
 * 45 - Bug fix: port option was being ignored, thanks @esatterwhite

### 0.2.2
Bug fix - `bindExchanges` flat out broken. Thanks to @leobispo for the catch & fix.

### 0.2.1

Special thanks to @neverfox for finding and reportig 38 & 39 - both serious problems and very difficult to find/reproduce in any kind of automated test.

 * 38, 39 - I/O getting blocked when publishing at high frequencies (think for/while loops).
 	* Removed one-time `failed` event handler from publish call
 	* Cache reject callbacks from publish
 	* On publish confirmation, remove reject from deferred array
 	* On exchange connection failure, invoke all rejects in deferred array
 * 37 - document use of close and closeAll calls
 * Correct improper use of .then( null, ... ) which was creating additional promises.
 * Update whistlepunk version
 * Include biggulp to simplify the gulpfile (yay?)

### 0.2.0

 * Add logging support via whistlepunk
 * Add logging statements to assist with troubleshooting/debugging
 * 24 - Connection should not close until after all queues have completed batch processing (only applies to user initiated connection shutdown)
 * 30 - Escape passwords to be connection URI safe
 * 17, 19 - Unhandled messages
  * Nack unhandled messages by default
  * Provide configurable strategies for handling unhandled messages
 * 26 - Support custom reply queue definitions per connection
 * Add behavioral specs to improve coverage and testing story
 * Fix bug in `reject` batching implementation
 * Refactor of exchange and queue implementation into channel behavior and FSM
 * Reject exchange and queue creation promises on failure
 * Reject publish and subscribe calls on failed exchanges and queues
 * Bug fix - closing a connection didn't reliably clean up channels, exchanges and queues
 * Bug fix - a failed connection that had been closed would continue to attempt reconnecting in the background
 * Bug fix - configure doesn't reject the promise if a connection cannot be established

### prerelease 8
 * Add connection timeout
 * Add @derickbailey to contributor list

### prerelease 7
 * Add demos and documentation to better explain handlers
 * Allow replies to provide a `replyType` without specifying `more` parameter
 * Add support for per-message expiration
 * Add support for reject (nack without re-queue)
 * Code clean-up / addressing linting errors
 * Fix README issues
 * Correct typo in spec
 * Code clean-up / addressing linting errors
