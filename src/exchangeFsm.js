import fsm from 'mfsm';
import { format } from 'node:util';
import publishLog from './publishLog.js';
import createLog from './log.js';
import defer from './defer.js';
import defaultExchangeFn from './amqp/exchange.js';

const exLog = createLog('rabbot.exchange');

/* log
  * `rabbot.exchange`
    * `debug`:
      * release called
    * publish called
    * `warn`:
      * exchange was released with unconfirmed messages
    * on publish to released exchange
    * publish is rejected because exchange has reached the limit because of pending connection
 */

function unhandle (handlers) {
  handlers.forEach((handle) =>
    handle.off()
  );
}

const Factory = function (options, connection, topology, serializers, exchangeFn) {
  // allows us to optionally provide a mock
  exchangeFn = exchangeFn || defaultExchangeFn;

  const machine = fsm({
    api: {
      _define: function (exchange, stateOnDefined) {
        const onDefinitionError = (err) => {
          this.failedWith = err;
          this.next('failed', err);
        };
        const onDefined = () => {
          this.next(stateOnDefined);
        };
        exchange.define()
          .then(onDefined, onDefinitionError);
      },

      _listen: function () {
        connection.on('unreachable', (err) => {
          err = err || new Error('Could not establish a connection to any known nodes.');
          this._onFailure(err);
          this.next('unreachable');
        });
      },

      _onAcquisition: function (transitionTo, exchange) {
        const handlers = [];

        handlers.push(exchange.channel.once('released', () => {
          this.handle('released', exchange);
        }));

        handlers.push(exchange.channel.once('closed', () => {
          this.handle('closed', exchange);
        }));

        const cleanup = () => {
          unhandle(handlers);
          exchange.release()
            .then(() => {
              this.next('released');
            });
        };

        const onCleanupError = () => {
          const count = this.published.count();
          if (count > 0) {
            exLog.warn("%s exchange '%s', connection '%s' was released with %d messages unconfirmed",
              this.type,
              this.name,
              connection.name,
              count);
          }
          cleanup();
        };

        const releaser = () => {
          return this.published.onceEmptied()
            .then(cleanup, onCleanupError);
        };

        const publisher = function (message) {
          return exchange.publish(message);
        };

        this.publisher = publisher;
        this.releasers.push(releaser);
        this._define(exchange, transitionTo);
      },

      _onClose: function () {
        exLog.info(`Rejecting ${this.published.count()} published messages`);
        this.published.reset();
      },

      _onFailure: function (err) {
        this.failedWith = err;
        this.deferred.forEach((x) => x(err));
        this.deferred = [];
        this.published.reset();
      },

      _removeDeferred: function (reject) {
        const index = this.deferred.indexOf(reject);
        if (index >= 0) {
          this.deferred.splice(index, 1);
        }
      },

      _release: function (closed) {
        const release = this.releasers.shift();
        if (release) {
          return release(closed);
        } else {
          return Promise.resolve();
        }
      },

      check: function () {
        const deferred = defer();
        this.handle('check', deferred);
        return deferred.promise;
      },

      reconnect: function () {
        if (/releas/.test(this.currentState)) {
          this.next('initializing');
        }
        return this.check();
      },

      release: function () {
        exLog.debug('Release called on exchange %s - %s (%d messages pending)', this.name, connection.name, this.published.count());
        return new Promise((resolve) => {
          this.once('released', () => {
            resolve();
          });
          this.handle('release');
        });
      },

      publish: function (message) {
        if (this.currentState !== 'ready' && this.published.count() >= this.limit) {
          exLog.warn("Exchange '%s' has reached the limit of %d messages waiting on a connection",
            this.name,
            this.limit
          );
          return Promise.reject(new Error('Exchange has reached the limit of messages waiting on a connection'));
        }
        const publishTimeout = message.timeout || options.publishTimeout || message.connectionPublishTimeout || 0;
        return new Promise((resolve, reject) => {
          let timeout;
          let timedOut;
          if (publishTimeout > 0) {
            timeout = setTimeout(() => {
              timedOut = true;
              onRejected(new Error('Publish took longer than configured timeout'));
            }, publishTimeout);
          }
          const onPublished = () => {
            resolve();
            this._removeDeferred(reject);
            failedSub.off();
            closedSub.off();
          };
          const onRejected = (err) => {
            reject(err);
            this._removeDeferred(reject);
            failedSub.off();
            closedSub.off();
          };
          const op = (err) => {
            if (err) {
              onRejected(err);
            } else {
              if (timeout) {
                clearTimeout(timeout);
                timeout = null;
              }
              if (!timedOut) {
                return this.publisher(message)
                  .then(onPublished, onRejected);
              }
            }
          };
          const failedSub = this.once('failed', (err) => {
            onRejected(err);
          });
          const closedSub = this.once('closed', (err) => {
            onRejected(err);
          });
          this.deferred.push(reject);
          this.handle('publish', op);
        });
      },

      retry: function () {
        this.next('initializing');
      }
    },
    init: {
      default: 'initializing',
      name: options.name,
      type: options.type,
      publishTimeout: options.publishTimeout || 0,
      replyTimeout: options.replyTimeout || 0,
      limit: (options.limit || 100),
      publisher: undefined,
      releasers: [],
      deferred: [],
      published: publishLog()
    },
    // Note on emit()/state-name coincidence: mfsm's next() automatically
    // emits the state's own name (with whatever data was passed to next())
    // on entry, so onEntry hooks that previously did nothing but manually
    // re-announce their own state name (as monologue.js required) simply
    // omit that call here and thread the payload through next() instead -
    // duplicating it would fire the event twice.
    states: {
      closed: {
        onEntry: function () {
          this._onClose();
        },
        check: function (deferred) {
          this.deferUntil('ready', 'check', deferred);
          this.next('initializing');
        },
        publish: function (op) {
          this.deferUntil('ready', 'publish', op);
          this.next('initializing');
        }
      },
      failed: {
        onEntry: function () {
          this._onFailure(this.failedWith);
        },
        check: function (deferred) {
          deferred.reject(this.failedWith);
          this.emit('failed', this.failedWith);
        },
        release: function (exchange) {
          this._release(exchange)
            .then(() => {
              this.next('released');
            });
        },
        publish: function (op) {
          op(this.failedWith);
        }
      },
      initializing: {
        onEntry: function () {
          exchangeFn(options, topology, this.published, serializers)
            .then((exchange) => {
              this.handle('acquired', exchange);
            });
        },
        acquired: function (exchange) {
          this._onAcquisition('ready', exchange);
        },
        check: function (deferred) {
          this.deferUntil('ready', 'check', deferred);
        },
        closed: function (exchange) {
          this.deferUntil('ready', 'closed', exchange);
        },
        release: function () {
          this.deferUntil('ready', 'release');
        },
        released: function () {
          this.next('initializing');
        },
        publish: function (op) {
          this.deferUntil('ready', 'publish', op);
        }
      },
      ready: {
        onEntry: function () {
          this.emit('defined');
        },
        check: function (deferred) {
          deferred.resolve();
          this.emit('defined');
        },
        release: function () {
          this.deferUntil('released', 'release');
          this.next('releasing');
        },
        closed: function () {
          this.next('closed');
        },
        released: function (exchange) {
          this.deferUntil('releasing', 'released', exchange);
        },
        publish: function (op) {
          op();
        }
      },
      releasing: {
        onEntry: function () {
          this._release()
            .then(() => {
              this.next('released');
            });
        },
        publish: function (op) {
          this.deferUntil('released', 'publish', op);
        },
        release: function () {
          this.deferUntil('released', 'release');
        }
      },
      released: {
        check: function (deferred) {
          this.deferUntil('ready', 'check', deferred);
        },
        release: function () {
          this.emit('released');
        },
        publish: function (op) {
          exLog.warn("Publish called on exchange '%s' after connection was released intentionally. Released connections must be re-established explicitly.", this.name);
          op(new Error(format("Cannot publish to exchange '%s' after intentionally closing its connection", this.name)));
        }
      },
      unreachable: {
        onEntry: function () {
          this.emit('failed', this.failedWith);
        },
        check: function (deferred) {
          deferred.reject(this.failedWith);
          this.emit('failed', this.failedWith);
        },
        publish: function (op) {
          op(this.failedWith);
        }
      }
    }
  });

  // mfsm always defers onEntry (even for the default/initial state set
  // during construction) by a tick via process.nextTick, unlike machina
  // which ran the initial state's _onEnter synchronously. Registering the
  // connection's 'unreachable' listener here - rather than from within
  // 'initializing' state's onEntry - keeps this synchronous with
  // construction, so nothing raised on `connection` immediately after
  // creating the exchange can be missed.
  machine._listen();

  connection.addExchange(machine);
  return machine;
};

export default Factory;
