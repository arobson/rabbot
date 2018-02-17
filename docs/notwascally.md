## Differences from `wascally`

If you used wascally, rabbot's API will be familiar, but the behavior is quite different. This section explains the differences in behavior and design.

### Let it fail

A great deal of confusion and edge cases arise from how wascally managed connectivity. Wascally treated any loss of connection or channels equally. This made it hard to predict behavior as a user of the library since any action taken against the API could trigger reconnection after an intentional shutdown. It also made it impossible to know whether a user intended to reconnect a closed connection or if the reconnection was the result of a programming error.

Rabbot does not re-establish connectivity automatically after connections have been intentionally closed _or_ after a failure threshold has been passed. In either of these cases, making API calls will either lead to rejected or indefinitely deferred promises. You, the user, must intentionally re-establish connectivity after closing a connection _or_ once rabbot has exhausted its attempts to connect on your behalf.

*The recommendation is*: if rabbot tells you it can't reach rabbot after exhausting the configured retries, shut your service down and let your monitoring and alerting tell you about it. The code isn't going to fix a network or broker outage by retrying indefinitely and filling up your logs.

### No more indefinite retention of unpublished messages

Wascally retained published messages indefinitely until a connection and all topology could be established. This meant that a service unable to connect could produce messages until it ran out of memory. It also meant that wascally could reject the promise returned from the publish call but then later publish the message without the ability to inform the caller.

When a connection is lost, or the `unreachable` event is emitted, all promises for publish calls are rejected and all unpublished messages are flushed. Rabbot will not provide any additional features around unpublishable messages - there are no good one-size-fits-all behaviors in these failure scenarios and it is important that developers understand and solve these needs at the service level for their use case.
