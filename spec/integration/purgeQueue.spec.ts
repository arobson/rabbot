import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { harnessFactory } from '../setup.js';
import rabbit from '../../src/index.js';
import config from './configuration.js';

/*
  Tests that queues are purged according to expected behavior:
   - auto-delete queues to NOT unsubscribed first
   - normal queues stop subscription first
   - after purge, subscription is restored
   - purging returns purged message count
   - purging does not break or disrupt channels
*/
describe('Purge Queue', function () {
  describe('when not subcribed', function () {
    beforeAll(function () {
      return rabbit.configure({
        connection: config.connection,
        exchanges: [
          {
            name: 'rabbot-ex.purged',
            type: 'topic',
            alternate: 'rabbot-ex.alternate',
            autoDelete: true
          }
        ],
        queues: [
          {
            name: 'rabbot-q.purged',
            autoDelete: true,
            subscribe: false,
            deadletter: 'rabbot-ex.deadletter'
          }
        ],
        bindings: [
          {
            exchange: 'rabbot-ex.purged',
            target: 'rabbot-q.purged',
            keys: 'this.is.#'
          }
        ]
      })
        .then(
          () =>
            Promise.all([
              rabbit.publish('rabbot-ex.purged', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' }),
              rabbit.publish('rabbot-ex.purged', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' }),
              rabbit.publish('rabbot-ex.purged', { type: 'topic', routingKey: 'this.is.not.wine.wtf', body: 'socrates' })
            ])
        );
    });

    it('should have purged expected message count', function () {
      return rabbit.purgeQueue('rabbot-q.purged')
        .then(
          (purged: any) => {
            expect(purged).toBe(3);
          }
        );
    });

    it('should not re-subscribe to queue automatically (when not already subscribed)', function () {
      expect((rabbit as any).getQueue('rabbot-q.purged').state).toBe('ready');
    });

    afterAll(function () {
      return rabbit.deleteQueue('rabbot-q.purged')
        .then(
          () => rabbit.close('default', true)
        );
    });
  });

  describe('when subcribed', function () {
    describe('and queue is autodelete', function () {
      let purgeCount: number;
      let harness: ReturnType<typeof harnessFactory>;
      let handler: any;
      beforeAll(() => new Promise<void>((done) => {
        rabbit.configure({
          connection: config.connection,
          exchanges: [
            {
              name: 'rabbot-ex.purged-2',
              type: 'topic',
              alternate: 'rabbot-ex.alternate',
              autoDelete: true
            }
          ],
          queues: [
            {
              name: 'rabbot-q.purged-2',
              autoDelete: true,
              subscribe: true,
              limit: 1,
              deadletter: 'rabbot-ex.deadletter'
            }
          ],
          bindings: [
            {
              exchange: 'rabbot-ex.purged-2',
              target: 'rabbot-q.purged-2',
              keys: 'this.is.#'
            }
          ]
        })
          .then(
            () => {
              return Promise.all([
                rabbit.publish('rabbot-ex.purged-2', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' }),
                rabbit.publish('rabbot-ex.purged-2', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' }),
                rabbit.publish('rabbot-ex.purged-2', { type: 'topic', routingKey: 'this.is.not.wine.wtf', body: 'socrates' })
              ]);
            }
          )
          .then(
            () => {
              return rabbit.purgeQueue('rabbot-q.purged-2')
                .then(
                  (count: any) => {
                    purgeCount = count;
                    done();
                  }
                );
            }
          );
        harness = harnessFactory(rabbit, () => {}, 1);
        harness.handle('topic', (m: any) => {
          setTimeout(() => {
            m.ack();
          }, 100);
        });
      }));

      it('should have purged some messages', function () {
        expect(purgeCount).toBeGreaterThan(0);
        expect(purgeCount + harness.received.length).toEqual(3);
      });

      it('should re-subscribe to queue automatically (when not already subscribed)', function () {
        return new Promise<void>((done) => {
          expect((rabbit as any).getQueue('rabbot-q.purged-2').state).toBe('subscribed');
          harness.clean();
          handler = rabbit.handle('topic', (m: any) => {
            m.ack();
            done();
          });
          rabbit.publish('rabbot-ex.purged-2', { type: 'topic', routingKey: 'this.is.easy', body: 'stapler' });
        });
      });

      afterAll(function () {
        return rabbit.deleteQueue('rabbot-q.purged-2')
          .then(
            () => {
              handler.off();
              return rabbit.close('default', true);
            }
          );
      });
    });

    describe('and queue is not autodelete', function () {
      let purgeCount: number;
      let harness: ReturnType<typeof harnessFactory>;
      let handler: any;
      beforeAll(() => new Promise<void>((done) => {
        rabbit.configure({
          connection: config.connection,
          exchanges: [
            {
              name: 'rabbot-ex.purged-3',
              type: 'topic',
              alternate: 'rabbot-ex.alternate',
              autoDelete: true
            }
          ],
          queues: [
            {
              name: 'rabbot-q.purged-3',
              autoDelete: false,
              subscribe: true,
              limit: 1,
              deadletter: 'rabbot-ex.deadletter'
            }
          ],
          bindings: [
            {
              exchange: 'rabbot-ex.purged-3',
              target: 'rabbot-q.purged-3',
              keys: 'this.is.#'
            }
          ]
        })
          .then(
            () => {
              return Promise.all([
                rabbit.publish('rabbot-ex.purged-3', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' }),
                rabbit.publish('rabbot-ex.purged-3', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' }),
                rabbit.publish('rabbot-ex.purged-3', { type: 'topic', routingKey: 'this.is.not.wine.wtf', body: 'socrates' })
              ]);
            }
          )
          .then(
            () => {
              return rabbit.purgeQueue('rabbot-q.purged-3')
                .then(
                  (count: any) => {
                    purgeCount = count;
                    done();
                  }
                );
            }
          );
        harness = harnessFactory(rabbit, () => {}, 1);
        harness.handle('topic', (m: any) => {
          setTimeout(() => {
            m.ack();
          }, 100);
        });
      }));

      it('should have purged some messages', function () {
        expect(purgeCount).toBeGreaterThan(0);
        expect(purgeCount + harness.received.length).toEqual(3);
      });

      it('should re-subscribe to queue automatically (when not already subscribed)', function () {
        return new Promise<void>((done) => {
          expect((rabbit as any).getQueue('rabbot-q.purged-3').state).toBe('subscribed');
          harness.clean();
          handler = rabbit.handle('topic', (m: any) => {
            m.ack();
            done();
          });
          rabbit.publish('rabbot-ex.purged-3', { type: 'topic', routingKey: 'this.is.easy', body: 'stapler' });
        });
      });

      afterAll(function () {
        return rabbit.deleteQueue('rabbot-q.purged-3')
          .then(
            () => {
              handler.off();
              return rabbit.close('default', true);
            }
          );
      });
    });
  });
});
