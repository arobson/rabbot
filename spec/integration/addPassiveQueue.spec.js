require('../setup');
const rabbit = require('../../src/index.js');

describe('Adding Queues', function () {
  describe('when the queue does not already exist', function () {
    it('should error on addQueue in passive mode', function () {
      return rabbit.configure({
        connection: {
          name: 'passiveErrorWithNoQueue'
        }
      }).then(() => {
        return rabbit.addQueue('no-queue-here', { passive: true }, 'passiveErrorWithNoQueue')
          .then(
            () => { throw new Error('Should not have succeeded in the checkQueue call'); },
            (err) => {
              err.toString().should.contain("Failed to create queue 'no-queue-here' on connection 'passiveErrorWithNoQueue' with 'Error: Operation failed: QueueDeclare; 404 (NOT-FOUND)");
            });
      });
    });
    after(function () {
      rabbit.reset();
      return rabbit.shutdown('passiveErrorWithNoQueue');
    });
  });

  describe('when the queue does exist', function () {
    const existingQueueName = 'totes-exists-already';
    it('should NOT error on addQueue when in passive mode', function () {
      return rabbit.configure({
        connection: {
          name: 'passiveEnabledWithExistingQueue'
        },
        queues: [
          { name: existingQueueName, connection: 'passiveEnabledWithExistingQueue' }
        ]
      }).then(() => {
        return rabbit.addQueue(existingQueueName, { passive: true }, 'passiveEnabledWithExistingQueue');
      });
    });

    after(function () {
      return rabbit.deleteQueue(existingQueueName, 'passiveEnabledWithExistingQueue')
        .then(() => {
          rabbit.reset();
          return rabbit.shutdown();
        });
    });
  });
});
