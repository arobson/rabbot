import fsm from 'mfsm';
import { format } from 'node:util';
import createLog from './log.js';
import defer from './defer.js';
import defaultQueueFn from './amqp/queue.js';

const log = createLog('rabbot.queue');

/* log
  * `rabbot.queue`
    * `debug`
      * release called
    * `info`
      * subscription started
      * queue released
    * `warn`
      * queue released with pending messages
*/

function unhandle (handlers) {
  handlers.forEach((handle) =>
    handle.off()
  );
}

const Factory = function (options, connection, topology, serializers, queueFn) {
  // allows us to optionally provide a mock
  queueFn = queueFn || defaultQueueFn;

  const machine = fsm({
    api: {
      _define: function (queue) {
        const onError = (err) => {
          this.failedWith = err;
          this.next('failed', err);
        };
        const onDefined = (defined) => {
          if (!this.name) {
            this.name = defined.queue;
            options.name = defined.queue;
            queue.messages.changeName(this.name);
            topology.renameQueue(defined.queue);
          }
          this.next('ready');
        };
        queue.define()
          .then(onDefined, onError);
      },

      _listen: function (queue) {
        const handlers = [];
        const emit = (...args) => this.emit(...args);

        const unsubscriber = function () {
          return queue.unsubscribe();
        };

        const onPurge = (messageCount) => {
          log.info(`Purged ${messageCount} queue ${options.name} - ${connection.name}`);
          this.next('purged', messageCount);
        };

        const purger = function () {
          return queue
            .purge()
            .then(onPurge)
            .catch(function (err) {
              emit('purgeFailed', err);
            });
        };

        const onSubscribe = () => {
          log.info('Subscription to (%s) queue %s - %s started with consumer tag %s',
            options.noAck ? 'untracked' : 'tracked',
            options.name,
            connection.name,
            queue.channel.tag);
          this.unsubscribers.push(unsubscriber);
          this.subscribed = true;
          this.next('subscribed', {});
        };

        const subscriber = function (exclusive) {
          return queue
            .subscribe(!!exclusive)
            .then(onSubscribe)
            .catch(function (err) {
              emit('subscribeFailed', err);
            });
        };

        const releaser = (closed) => {
          // remove handlers established on queue
          unhandle(handlers);
          if (queue && queue.getMessageCount() > 0) {
            log.warn('!!! Queue %s - %s was released with %d pending messages !!!',
              options.name, connection.name, queue.getMessageCount());
          } else if (queue) {
            log.info('Released queue %s - %s', options.name, connection.name);
          }

          if (!closed) {
            queue.release()
              .then(() => {
                this.handle('released');
              });
          }
        };

        this.subscriber = subscriber;
        this.releasers.push(releaser);
        this.purger = purger;

        handlers.push(queue.channel.on('acquired', () => {
          // a channel-level protocol error (e.g. broker-forced close from
          // a consumer ack-timeout precondition_failed) always reaches
          // amqplib as 'error' *before* 'close' (see amqplib's
          // Channel#accept ChannelClose case), so the underlying channel
          // resource recovers via its own acquired/failed retry loop
          // without ever visiting this queue's own 'closed' state below.
          // Redeclaring alone leaves the consumer gone for good, so
          // re-subscribe here too when one was active - mirroring the
          // same re-subscribe-after-redefine pattern the 'purged' state
          // already uses (#202)
          const shouldResubscribe = options.subscribe;
          this._define(queue);
          if (shouldResubscribe) {
            this.once('defined', () => {
              this.handle('subscribe');
            });
          }
        }));
        handlers.push(queue.channel.on('released', () => {
          this.handle('released', queue);
        }));
        handlers.push(queue.channel.on('closed', () => {
          this.handle('closed', queue);
        }));
        handlers.push(connection.on('unreachable', (err) => {
          err = err || new Error('Could not establish a connection to any known nodes.');
          this.handle('unreachable', queue);
        }));

        if (options.subscribe) {
          this.handle('subscribe');
        }
      },

      _release: function (closed) {
        const release = this.releasers.shift();
        if (release) {
          release(closed);
        } else {
          return Promise.resolve();
        }
      },

      check: function () {
        const deferred = defer();
        this.handle('check', deferred);
        return deferred.promise;
      },

      purge: function () {
        return new Promise((resolve, reject) => {
          const cleanResolve = (result) => {
            unhandle(_handlers);
            resolve(result);
          };
          const cleanReject = (err) => {
            unhandle(_handlers);
            this.next('failed', err);
            reject(err);
          };
          const _handlers = [
            this.once('purged', cleanResolve),
            this.once('purgeFailed', cleanReject),
            this.once('failed', cleanReject)
          ];
          this.handle('purge');
        });
      },

      reconnect: function () {
        if (/releas/.test(this.currentState)) {
          this.next('initializing');
        }
        return this.check();
      },

      release: function () {
        return new Promise((resolve, reject) => {
          const cleanResolve = () => {
            unhandle(_handlers);
            resolve();
          };
          const cleanReject = (err) => {
            unhandle(_handlers);
            reject(err);
          };
          const _handlers = [
            this.once('released', cleanResolve),
            this.once('failed', cleanReject),
            this.once('unreachable', cleanReject),
            this.once('noqueue', cleanResolve)
          ];
          this.handle('release');
        });
      },

      retry: function () {
        this.next('initializing');
      },

      subscribe: function (exclusive) {
        options.subscribe = true;
        options.exclusive = exclusive;
        return new Promise((resolve, reject) => {
          const cleanResolve = () => {
            unhandle(_handlers);
            resolve();
          };
          const cleanReject = (err) => {
            unhandle(_handlers);
            this.next('failed', err);
            reject(err);
          };
          const _handlers = [
            this.once('subscribed', cleanResolve),
            this.once('subscribeFailed', cleanReject),
            this.once('failed', cleanReject)
          ];
          this.handle('subscribe');
        });
      },

      unsubscribe: function () {
        options.subscribe = false;
        const unsubscriber = this.unsubscribers.shift();
        if (unsubscriber) {
          return unsubscriber();
        } else {
          return Promise.reject(new Error('No active subscription presently exists on the queue'));
        }
      }
    },
    init: {
      default: 'initializing',
      name: options.name,
      uniqueName: options.uniqueName,
      responseSubscriptions: {},
      signalSubscription: undefined,
      subscribed: false,
      subscriber: undefined,
      purger: undefined,
      unsubscribers: [],
      releasers: []
    },
    // Note on emit()/state-name coincidence: mfsm's next() automatically
    // emits the state's own name (with whatever data was passed to next())
    // on entry, so onEntry hooks that previously did nothing but manually
    // re-announce their own state name (as monologue.js required) simply
    // omit that call here and thread the payload through next() instead -
    // duplicating it would fire the event twice.
    //
    // 'subscribed' is a deliberate exception: the FSM used to transition
    // into a state named 'subscribed' *eagerly*, well before the real
    // amqp subscription was confirmed, while the *public* 'subscribed'
    // event was only meant to fire on real completion (via a second,
    // later dispatch once the underlying subscribe() promise resolved).
    // Relying on mfsm's auto-emit here would deliver that public event -
    // and resolve subscribe()'s promise - prematurely. So the eager
    // mid-flight transition is dropped entirely; only the real completion
    // (onSubscribe, above) transitions into 'subscribed'.
    states: {
      closed: {
        onEntry: function () {
          this.subscribed = false;
          this._release(true);
          // reached when the channel closes with no preceding protocol
          // error - e.g. a connection-level drop cascades to its channels
          // via a bare close (amqplib's Connection#_closeChannels calls
          // Channel#toClosed directly, with no 'error' emitted first).
          // Recover the same way an application-driven check() would
          // rather than sitting here silently forever (#202)
          this.next('initializing');
        },
        check: function (deferred) {
          this.deferUntil('ready', 'check', deferred);
          this.next('initializing');
        },
        purge: function () {
          this.deferUntil('ready', 'purge');
        },
        subscribe: function () {
          this.deferUntil('ready', 'subscribe');
        }
      },
      failed: {
        onEntry: function () {
          this.subscribed = false;
        },
        check: function (deferred) {
          if (deferred) {
            deferred.reject(this.failedWith);
          }
          this.emit('failed', this.failedWith);
        },
        release: function (queue) {
          if (queue) {
            this._removeHandlers();
            queue.release()
              .then(() => {
                this.handle('released', queue);
              });
          }
        },
        released: function () {
          this.next('released');
        },
        purge: function () {
          this.emit('purgeFailed', this.failedWith);
        },
        subscribe: function () {
          this.emit('subscribeFailed', this.failedWith);
        }
      },
      initializing: {
        onEntry: function () {
          queueFn(options, topology, serializers)
            .then(
              (queue) => {
                this.lastQueue = queue;
                this.handle('acquired', queue);
              },
              (err) => {
                this.failedWith = err;
                this.next('failed', err);
              }
            );
        },
        acquired: function (queue) {
          this.receivedMessages = queue.messages;
          this._define(queue);
          this._listen(queue);
        },
        check: function (deferred) {
          this.deferUntil('ready', 'check', deferred);
        },
        release: function () {
          this.deferUntil('ready', 'release');
        },
        closed: function (queue) {
          this.deferUntil('ready', 'closed', queue);
        },
        purge: function () {
          this.deferUntil('ready', 'purge');
        },
        subscribe: function () {
          this.deferUntil('ready', 'subscribe');
        }
      },
      ready: {
        onEntry: function () {
          this.emit('defined');
        },
        check: function (deferred) {
          deferred.resolve();
        },
        closed: function () {
          this.next('closed');
        },
        purge: function () {
          if (this.purger) {
            this.next('purging');
            return this.purger();
          }
        },
        release: function () {
          this.next('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.next('initializing');
        },
        subscribe: function () {
          if (this.subscriber) {
            this.deferUntil('subscribing', 'subscribe');
            this.next('subscribing');
            return this.subscriber();
          }
        }
      },
      purging: {
        closed: function () {
          this.next('closed');
        },
        purged: function (result) {
          this.next('purged', result);
        },
        release: function () {
          this.next('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.next('initializing');
        },
        subscribe: function () {
          this.deferUntil('subscribed', 'subscribe');
        }
      },
      purged: {
        onEntry: function (result) {
          // 'purged' is auto-emitted by next('purged', result) at the
          // call site that transitions here - no explicit emit needed.
          if (this.subscribed && this.subscriber) {
            this.subscribe()
              .then(
                null,
                () => {
                  this.subscribed = false;
                }
              );
          } else {
            this.next('ready');
          }
        },
        check: function (deferred) {
          deferred.resolve();
        },
        closed: function () {
          this.next('closed');
        },
        release: function () {
          this.next('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.next('initializing');
        },
        subscribe: function () {
          this.deferUntil('ready', 'subscribe');
          this.next('ready');
        }
      },
      releasing: {
        release: function () {
          this._release(false);
        },
        released: function () {
          this.next('released');
        }
      },
      released: {
        onEntry: function () {
          this.subscribed = false;
        },
        check: function (deferred) {
          deferred.reject(new Error(format("Cannot establish queue '%s' after intentionally closing its connection", this.name)));
        },
        purge: function () {
          this.emit('purgeFailed', new Error(format("Cannot purge to queue '%s' after intentionally closing its connection", this.name)));
        },
        release: function () {
          this.emit('released');
        },
        subscribe: function () {
          this.emit('subscribeFailed', new Error(format("Cannot subscribe to queue '%s' after intentionally closing its connection", this.name)));
        }
      },
      subscribing: {
        closed: function () {
          this.next('closed');
        },
        purge: function () {
          this.deferUntil('ready', 'purge');
        },
        release: function () {
          this.next('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.next('initializing');
        }
      },
      subscribed: {
        check: function (deferred) {
          deferred.resolve();
        },
        closed: function () {
          this.next('closed');
        },
        purge: function () {
          this.deferUntil('ready', 'purge');
          this.next('ready');
        },
        release: function () {
          this.next('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.next('initializing');
        }
      },
      unreachable: {
        check: function (deferred) {
          deferred.reject(new Error(format("Cannot establish queue '%s' when no nodes can be reached", this.name)));
        },
        purge: function () {
          this.emit('purgeFailed', new Error(format("Cannot establish queue '%s' when no nodes can be reached", this.name)));
        },
        subscribe: function () {
          this.emit('subscribeFailed', new Error(format("Cannot subscribe to queue '%s' when no nodes can be reached", this.name)));
        }
      }
    }
  });

  connection.addQueue(machine);
  return machine;
};

export default Factory;
