## 0.2.*

### 0.2.5

 * #65 - Bug Fix: setting replyQueue to false caused publish to fail silently.
 * #63 - Add `uri` property to connection object emitted for 'connected' event.
 * #61 - Bug Fix: correct SSL URIs - thanks, @longplay
 * Improvements to connection clean up (specifically around resolving outstanding messages on queues)
 * ConnectionFSM - Only emit 'connected' when establishing a new connection, use 'already-connected' otherwise.

### 0.2.4
Thanks to @dvideby0 and @neverfox for identifying and providing code to help reproduce bugs #39 and #57.

 * #39, #57 - Bug fix: acking responses did not resolve them causing them to pile up in a response queue
 * Bug fix: setting replyQueue to false throws exceptions
 * Bug fix: replying from a service with replyQueue set to false fails
 * Spec update - request spec in integration tests failed to ack messages causing closeAll to hang

### 0.2.3
 * #47 - Added support for `noBatch` to queues, thanks @derickbailey!
 * #45 - Bug fix: port option was being ignored, thanks @esatterwhite

### 0.2.2
Bug fix - `bindExchanges` flat out broken. Thanks to @leobispo for the catch & fix.

### 0.2.1

Special thanks to @neverfox for finding and reportig #38 & #39 - both serious problems and very difficult to find/reproduce in any kind of automated test.

 * #38, #39 - I/O getting blocked when publishing at high frequencies (think for/while loops).
 	* Removed one-time `failed` event handler from publish call
 	* Cache reject callbacks from publish
 	* On publish confirmation, remove reject from deferred array
 	* On exchange connection failure, invoke all rejects in deferred array
 * #37 - document use of close and closeAll calls
 * Correct improper use of .then( null, ... ) which was creating additional promises.
 * Update whistlepunk version
 * Include biggulp to simplify the gulpfile (yay?)

### 0.2.0

 * Add logging support via whistlepunk
 * Add logging statements to assist with troubleshooting/debugging
 * #24 - Connection should not close until after all queues have completed batch processing (only applies to user initiated connection shutdown)
 * #30 - Escape passwords to be connection URI safe
 * #17, #19 - Unhandled messages
  * Nack unhandled messages by default
  * Provide configurable strategies for handling unhandled messages
 * #26 - Support custom reply queue definitions per connection
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
