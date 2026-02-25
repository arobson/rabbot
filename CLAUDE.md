# rabbot

An opinionated RabbitMQ client that simplifies topology management, pub/sub, and request/reply patterns. Handles connection resilience and topology re-assertion automatically. Built on `mfsm` (state machines for connection/exchange/queue lifecycle) and `topic-dispatch` (internal event routing).

## Mental Model

1. Call `configure()` once with your full topology — connection, exchanges, queues, bindings.
2. Register `handle()` callbacks for message types **before** starting subscriptions.
3. Publish with `publish()` or do request/reply with `request()`.
4. Always `ack()`, `nack()`, or `reject()` every received message — unacked messages block the queue.

## Minimal Setup

```typescript
import rabbit from 'rabbot'

await rabbit.configure({
  connection: {
    host: 'localhost',
    port: 5672,
    user: 'guest',
    pass: 'guest',
    vhost: '/',
    heartbeat: 30
  },
  exchanges: [
    { name: 'events', type: 'topic', durable: true }
  ],
  queues: [
    { name: 'my-service', durable: true, subscribe: true }
  ],
  bindings: [
    { exchange: 'events', target: 'my-service', keys: ['order.#'] }
  ]
})

// Register handlers BEFORE configure (or before subscribe: true takes effect)
rabbit.handle('order.created', (msg) => {
  console.log(msg.body)
  msg.ack()
})
```

## Topology Reference

### Exchange types
- `'topic'` — AMQP-style routing key matching
- `'direct'` — exact routing key match
- `'fanout'` — broadcast to all bound queues

### Key exchange options
```typescript
{ name: 'ex', type: 'topic', durable: true, persistent: true, publishTimeout: 5000, noConfirm: false }
```

### Key queue options
```typescript
{
  name: 'q',
  durable: true,
  subscribe: true,        // auto-start subscription on configure
  limit: 10,             // prefetch (max unacked messages)
  noAck: false,          // true = no ack required (at-most-once)
  noBatch: false,        // true = ack immediately (lower throughput)
  deadLetter: 'dlx',    // exchange for rejected/expired messages
  unique: 'hash'        // 'hash' | 'id' | 'consistent' for unique queue names
}
```

### Bindings
```typescript
{ exchange: 'ex', target: 'q', keys: ['order.*', 'user.#'] }
{ exchange: 'source-ex', target: 'dest-ex', keys: ['#'] }  // exchange-to-exchange
```

## Publishing

```typescript
// Basic publish — type is required; used as routing key if routingKey is omitted
await rabbit.publish('events', {
  type: 'order.created',
  body: { orderId: 42, total: 99.99 },
  routingKey: 'order.created',   // defaults to type if not set
  persistent: true,              // survive broker restart
  contentType: 'application/json',  // inferred from body type if omitted
  headers: { source: 'checkout-service' },
  timeout: 5000                  // ms; reject promise if unconfirmed
})

// Bulk publish (more efficient for batches)
await rabbit.bulkPublish({
  'events': [
    { type: 'order.created', body: { orderId: 1 } },
    { type: 'order.updated', body: { orderId: 2 } }
  ]
})
```

## Receiving Messages

```typescript
// Handle by type name
rabbit.handle('order.created', (msg) => {
  const data = msg.body          // deserialized body
  const type = msg.type          // message type string
  const redelivered = msg.fields.redelivered
  msg.ack()                      // always do one of these:
  // msg.nack()                  // re-queue the message
  // msg.reject()                // discard (don't re-queue — use with DLX)
})

// Handle with options
rabbit.handle({
  queue: 'my-queue',     // restrict to specific queue; default: '*' (all queues)
  type: 'order.#',       // AMQP wildcard; default: '#' (all types)
  autoNack: true         // auto-nack on handler exception; default: false
}, (msg) => {
  msg.ack()
})

// Remove a handler
const handler = rabbit.handle('order.created', fn)
handler.remove()
```

## Request / Reply

```typescript
// Requester
const reply = await rabbit.request('events', {
  type: 'get.user',
  body: { userId: 42 },
  replyTimeout: 5000  // ms to wait for reply
})
reply.ack()
console.log(reply.body)

// Replier
rabbit.handle('get.user', (req) => {
  const user = db.getUser(req.body.userId)
  req.reply(user)  // acks the request and sends reply
})
```

## Connection Management

```typescript
// Graceful shutdown — waits for pending acks/publishes
await rabbit.shutdown()

// Close specific connection
await rabbit.close('default')

// After unreachable event, re-enable retry
rabbit.on('unreachable', () => rabbit.retry())
```

## Unhandled Message Strategy

Choose one (default is `nackUnhandled`):

```typescript
rabbit.nackUnhandled()          // default: re-queue unhandled messages (can cause churn!)
rabbit.rejectUnhandled()        // discard unhandled — only safe with DLX configured
rabbit.onUnhandled((msg) => {   // custom strategy
  msg.reject()
})
```

## Gotchas

- **Always ack/nack/reject**: Every message must be resolved. Unresolved messages block the queue up to the `limit` (prefetch) count.
- **Register handlers before subscriptions**: If a queue has `subscribe: true`, messages can arrive during `configure()`. Set up handlers first.
- **`nackUnhandled` causes churn**: Unhandled messages are re-queued and immediately redelivered in a loop. Either handle all message types or use `rejectUnhandled` with a dead-letter exchange.
- **Confirm mode overhead**: The default confirm mode ensures delivery but adds latency and memory overhead. Set `noConfirm: true` on exchanges where you can tolerate fire-and-forget.
- **Publish buffering**: rabbot buffers up to 100 messages per exchange while connecting. Beyond that, publishes are rejected. Do not publish to rabbot before a connection is established at high volume.
- **`noAck: true` queues**: `nack()` and `reject()` are no-ops. Messages are removed from the queue on delivery; you lose at-least-once guarantees.
- **`noBatch: false` (default)**: Acks are batched for throughput. Use `noBatch: true` only for long-running handlers where you need immediate ack confirmation.
- **Connection URI alternative**: `{ uri: 'amqp://user:pass@host:5672/%2f?heartbeat=10' }` is equivalent to the individual field form.

## Internal Architecture

- `mfsm` — connection, exchange, and queue each run as an FSM tracking states like `connecting`, `connected`, `unreachable`
- `topic-dispatch` — routes internal events and message type dispatch
- Confirm mode is managed per-exchange channel
- Ack batching runs as a background process per queue channel
