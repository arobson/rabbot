## Logging

As of v2, logging uses [bole](https://github.com/rvagg/bole) because it defaults to machine parsable logs, minimalistic and easy to write stream adapters for.

A DEBUG adapter that works just like before is already included in rabbot, so you can still prefix the service with `DEBUG=rabbot.*` to get rabbot specific output.

> Note: `rabbot.queue.*` and `rabbot.exchange.*` are high volume namespaces since that is where all published and subscribed messages get reported.

### Attaching Custom Loggers

A log call is now exposed directly to make it easier to attach streams to the bole instance:

```js
const rabbot = require( "rabbot" );

// works like bole's output call
rabbot.log( [
  { level: "info", stream: process.stdout },
  { level: "debug", stream: fs.createWriteStream( "./debug.log" ), objectMode: true }
] );
```
