'use strict';

const rabbot = require('../../src/index.js');

rabbot.addConnection({uri: 'amqp://guest:guest@localhost:5672/'})
  .then((con) => {

    const intermediate = (msg) => {
      console.log('wow', msg.body);
      msg.ack();
    };

    return Promise.all([
      rabbot.request('', {routingKey: 'q.some', body: {r:'equest'}}, intermediate)
      .then(intermediate),
      rabbot.request('', {routingKey: 'q.some', body: {r:'equest'}}, intermediate)
      .then(intermediate)])
  })
  .then(() => {
    process.exit(9);
  });
