const machina = require('machina');
const format = require('util').format;
const Monologue = require('monologue.js');
Monologue.mixInto(machina.Fsm);
const log = require('./log.js')('rabbot.queue');
const defer = require('./defer');

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
    handle.unsubscribe()
  );
}

var Factory = function (options, connection, topology, serializers, queueFn) {
  // allows us to optionally provide a mock
  queueFn = queueFn || require('./amqp/queue');

  var Fsm = machina.Fsm.extend({
    name: options.name,
    uniqueName: options.uniqueName,
    responseSubscriptions: {},
    signalSubscription: undefined,
    subscribed: false,
    subscriber: undefined,
    purger: undefined,
    unsubscribers: [],
    releasers: [],

    _define: function (queue) {
      var onError = function (err) {
        this.failedWith = err;
        this.transition('failed');
      }.bind(this);
      var onDefined = function (defined) {
        if (!this.name) {
          this.name = defined.queue;
          options.name = defined.queue;
          queue.messages.changeName(this.name);
          topology.renameQueue(defined.queue);
        }
        this.transition('ready');
      }.bind(this);
      queue.define()
        .then(onDefined, onError);
    },

    _listen: function (queue) {
      var handlers = [];
      var emit = this.emit.bind(this);

      var unsubscriber = function () {
        return queue.unsubscribe();
      };

      var onPurge = function (messageCount) {
        log.info(`Purged ${messageCount} queue ${options.name} - ${connection.name}`);
        this.handle('purged', messageCount);
      }.bind(this);

      var purger = function () {
        return queue
          .purge()
          .then(onPurge)
          .catch(function (err) {
            emit('purgeFailed', err);
          });
      };

      var onSubscribe = function () {
        log.info('Subscription to (%s) queue %s - %s started with consumer tag %s',
          options.noAck ? 'untracked' : 'tracked',
          options.name,
          connection.name,
          queue.channel.tag);
        this.unsubscribers.push(unsubscriber);
        this.handle('subscribed');
      }.bind(this);

      var subscriber = function (exclusive) {
        return queue
          .subscribe(!!exclusive)
          .then(onSubscribe)
          .catch(function (err) {
            emit('subscribeFailed', err);
          });
      };

      var releaser = function (closed) {
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
            .then(function () {
              this.handle('released');
            }.bind(this));
        }
      }.bind(this);

      this.subscriber = subscriber;
      this.releasers.push(releaser);
      this.purger = purger;

      handlers.push(queue.channel.on('acquired', function () {
        this._define(queue);
      }.bind(this))
      );
      handlers.push(queue.channel.on('released', function () {
        this.handle('released', queue);
      }.bind(this))
      );
      handlers.push(queue.channel.on('closed', function () {
        this.handle('closed', queue);
      }.bind(this))
      );
      handlers.push(connection.on('unreachable', function (err) {
        err = err || new Error('Could not establish a connection to any known nodes.');
        this.handle('unreachable', queue);
      }.bind(this))
      );

      if (options.subscribe) {
        this.handle('subscribe');
      }
    },

    _release: function (closed) {
      var release = this.releasers.shift();
      if (release) {
        release(closed);
      } else {
        return Promise.resolve();
      }
    },

    check: function () {
      var deferred = defer();
      this.handle('check', deferred);
      return deferred.promise;
    },

    purge: function () {
      return new Promise(function (resolve, reject) {
        var _handlers;
        function cleanResolve (result) {
          unhandle(_handlers);
          resolve(result);
        }
        function cleanReject (err) {
          unhandle(_handlers);
          this.transition('failed');
          reject(err);
        }
        _handlers = [
          this.once('purged', cleanResolve),
          this.once('purgeFailed', cleanReject.bind(this)),
          this.once('failed', cleanReject.bind(this))
        ];
        this.handle('purge');
      }.bind(this));
    },

    reconnect: function () {
      if (/releas/.test(this.state)) {
        this.transition('initializing');
      }
      return this.check();
    },

    release: function () {
      return new Promise(function (resolve, reject) {
        var _handlers;
        function cleanResolve () {
          unhandle(_handlers);
          resolve();
        }
        function cleanReject (err) {
          unhandle(_handlers);
          reject(err);
        }
        _handlers = [
          this.once('released', cleanResolve),
          this.once('failed', cleanReject),
          this.once('unreachable', cleanReject),
          this.once('noqueue', cleanResolve)
        ];
        this.handle('release');
      }.bind(this));
    },

    retry: function () {
      this.transition('initializing');
    },

    subscribe: function (exclusive) {
      options.subscribe = true;
      options.exclusive = exclusive;
      return new Promise(function (resolve, reject) {
        var _handlers;
        function cleanResolve () {
          unhandle(_handlers);
          resolve();
        }
        function cleanReject (err) {
          unhandle(_handlers);
          this.transition('failed');
          reject(err);
        }
        _handlers = [
          this.once('subscribed', cleanResolve),
          this.once('subscribeFailed', cleanReject.bind(this)),
          this.once('failed', cleanReject.bind(this))
        ];
        this.handle('subscribe');
      }.bind(this));
    },

    unsubscribe: function () {
      options.subscribe = false;
      var unsubscriber = this.unsubscribers.shift();
      if (unsubscriber) {
        return unsubscriber();
      } else {
        return Promise.reject(new Error('No active subscription presently exists on the queue'));
      }
    },

    initialState: 'initializing',
    states: {
      closed: {
        _onEnter: function () {
          this.subscribed = false;
          this._release(true);
          this.emit('closed');
        },
        check: function () {
          this.deferUntilTransition('ready');
          this.transition('initializing');
        },
        purge: function () {
          this.deferUntilTransition('ready');
        },
        subscribe: function () {
          this.deferUntilTransition('ready');
        }
      },
      failed: {
        _onEnter: function () {
          this.subscribed = false;
          this.emit('failed', this.failedWith);
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
              .then(function () {
                this.handle('released', queue);
              });
          }
        },
        released: function () {
          this.transition('released');
        },
        purge: function () {
          this.emit('purgeFailed', this.failedWith);
        },
        subscribe: function () {
          this.emit('subscribeFailed', this.failedWith);
        }
      },
      initializing: {
        _onEnter: function () {
          queueFn(options, topology, serializers)
            .then(
              queue => {
                this.lastQueue = queue;
                this.handle('acquired', queue);
              },
              err => {
                this.failedWith = err;
                this.transition('failed');
              }
            );
        },
        acquired: function (queue) {
          this.receivedMessages = queue.messages;
          this._define(queue);
          this._listen(queue);
        },
        check: function () {
          this.deferUntilTransition('ready');
        },
        release: function () {
          this.deferUntilTransition('ready');
        },
        closed: function () {
          this.deferUntilTransition('ready');
        },
        purge: function () {
          this.deferUntilTransition('ready');
        },
        subscribe: function () {
          this.deferUntilTransition('ready');
        }
      },
      ready: {
        _onEnter: function () {
          this.emit('defined');
        },
        check: function (deferred) {
          deferred.resolve();
        },
        closed: function () {
          this.transition('closed');
        },
        purge: function () {
          if (this.purger) {
            this.transition('purging');
            return this.purger();
          }
        },
        release: function () {
          this.transition('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.transition('initializing');
        },
        subscribe: function () {
          if (this.subscriber) {
            this.deferAndTransition('subscribing');
            return this.subscriber();
          }
        }
      },
      purging: {
        closed: function () {
          this.transition('closed');
        },
        purged: function () {
          this.deferAndTransition('purged');
        },
        release: function () {
          this.transition('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.transition('initializing');
        },
        subscribe: function () {
          this.deferUntilTransition('subscribed');
        }
      },
      purged: {
        check: function (deferred) {
          deferred.resolve();
        },
        closed: function () {
          this.transition('closed');
        },
        release: function () {
          this.transition('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.transition('initializing');
        },
        purged: function (result) {
          this.emit('purged', result);
          if (this.subscribed && this.subscriber) {
            this.subscribe()
              .then(
                null,
                () => {
                  this.subscribed = false;
                }
              );
          } else {
            this.transition('ready');
          }
        },
        subscribe: function () {
          this.deferAndTransition('ready');
        }
      },
      releasing: {
        release: function () {
          this._release(false);
        },
        released: function () {
          this.transition('released');
        }
      },
      released: {
        _onEnter: function () {
          this.subscribed = false;
          this.emit('released');
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
          this.transition('closed');
        },
        purge: function () {
          this.deferUntilTransition('ready');
        },
        release: function () {
          this.transition('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.transition('initializing');
        },
        subscribe: function () {
          this.transition('subscribed');
        }
      },
      subscribed: {
        check: function (deferred) {
          deferred.resolve();
        },
        closed: function () {
          this.transition('closed');
        },
        purge: function () {
          this.deferUntilTransition('ready');
          this.transition('ready');
        },
        release: function () {
          this.transition('releasing');
          this.handle('release');
        },
        released: function () {
          this._release(true);
          this.transition('initializing');
        },
        subscribed: function () {
          this.subscribed = true;
          this.emit('subscribed', {});
        }
      },
      unreachable: {
        check: function (deferred) {
          deferred.reject(new Error(format("Cannot establish queue '%s' when no nodes can be reached", this.name)));
        },
        purge: function () {
          this.emit('purgeFailed', new Error(format("Cannot purge queue '%s' when no nodes can be reached", this.name)));
        },
        subscribe: function (sub) {
          this.emit('subscribeFailed', new Error(format("Cannot subscribe to queue '%s' when no nodes can be reached", this.name)));
        }
      }
    }
  });

  var fsm = new Fsm();
  connection.addQueue(fsm);
  return fsm;
};

module.exports = Factory;
