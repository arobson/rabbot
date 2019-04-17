'use strict';

const rabbot = require('../../src/index.js');

rabbot.addConnection({uri: 'amqp://guest:guest@localhost:5672/', replyQueue: false})
  .then((con) => {
    let counter = 0;
    rabbot.handle('#', (msg) => {
      msg.ack();
      setTimeout(() => {
        console.log('sending intermediate 1')
        msg.reply({msg: 'int1', counter: counter++}, {
          more: true,
          headers: {},
          replyType: '',
        });
      }, 100);

      setTimeout(() => {
        console.log('sending last message')
        msg.reply({msg: 'end', counter: counter++});
      }, 300);
    });

    return rabbot.addQueue('q.some');
  })
  .then(() => {
    return rabbot.startSubscription('q.some');
  });
