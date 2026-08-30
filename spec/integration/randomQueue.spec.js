import '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
Demonstrates a few things:
 * Getting a random queue name from Rabbit
 * Publishing to the default exchange
 * Using the queue name as a routing key to
   deliver the message to the queue

It shows that you _can_ move messages between services with minimal configuration.
*/
describe('Random Queue Name', function () {
  let harness;
  let queueName;
  before((done) => {
    rabbit.configure({
      connection: config.connection,
      exchanges: [
      ],
      queues: [
      ],
      bindings: [
      ]
    }).then(() => {
      harness.handle('rando', undefined, queueName);
      rabbit.addQueue('', { autoDelete: true, subscribe: true })
        .then(function (queue) {
          queueName = queue.name;
          rabbit.publish('', { type: 'rando', routingKey: queueName, body: 'one' });
          rabbit.publish('', { type: 'rando', routingKey: queueName, body: Buffer.from('two') });
          rabbit.publish('', { type: 'rando', routingKey: queueName, body: [0x62, 0x75, 0x66, 0x66, 0x65, 0x72] });
        });
    });
    harness = harnessFactory(rabbit, done, 3);
  });

  it('should deliver all messages to the randomly generated queue', function () {
    const results = harness.received.map((m) => ({
      body: m.body.toString(),
      queue: m.queue
    }));
    sortBy(results, 'body').should.eql(
      [
        { body: '98,117,102,102,101,114', queue: queueName },
        { body: 'one', queue: queueName },
        { body: 'two', queue: queueName }
      ]);
  });

  after(function () {
    return harness.clean('default');
  });
});
