const machina = require('machina');
const Monologue = require('monologue.js');
const publishLog = require('./publishLog');
const exLog = require('./log.js')('rabbot.exchange');
const format = require('util').format;
const defer = require('./defer');

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
    handle.unsubscribe()
  );
}

const Factory = function (options, connection, topology, serializers, exchangeFn) {
  // allows us to optionally provide a mock
  exchangeFn = exchangeFn || require('./amqp/exchange');
  const Fsm = machina.Fsm.extend({
    name: options.name,
    type: options.type,
    publishTimeout: options.publishTimeout || 0,
    replyTimeout: options.replyTimeout || 0,
    limit: (options.limit || 100),
    publisher: undefined,
    releasers: [],
    deferred: [],
    published: publishLog(),

    _define: function (exchange, stateOnDefined) {
      function onDefinitionError (err) {
        this.failedWith = err;
        this.transition('failed');
      }
      function onDefined () {
        this.transition(stateOnDefined);
      }
      exchange.define()
        .then(onDefined.bind(this), onDefinitionError.bind(this));
    },

    _listen: function () {
      connection.on('unreachable', function (err) {
        err = err || new Error('Could not establish a connection to any known nodes.');
        this._onFailure(err);
        this.transition('unreachable');
      }.bind(this));
    },

    _onAcquisition: function (transitionTo, exchange) {
      const handlers = [];

      handlers.push(exchange.channel.once('released', function () {
        this.handle('released', exchange);
      }.bind(this)));

      handlers.push(exchange.channel.once('closed', function () {
        this.handle('closed', exchange);
      }.bind(this)));

      function cleanup () {
        unhandle(handlers);
        exchange.release()
          .then(function () {
            this.transition('released');
          }.bind(this)
          );
      }

      function onCleanupError () {
        var count = this.published.count();
        if (count > 0) {
          exLog.warn("%s exchange '%s', connection '%s' was released with %d messages unconfirmed",
            this.type,
            this.name,
            connection.name,
            count);
        }
        cleanup.bind(this)();
      }

      const releaser = function () {
        return this.published.onceEmptied()
          .then(cleanup.bind(this), onCleanupError.bind(this));
      }.bind(this);

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
      var deferred = defer();
      this.handle('check', deferred);
      return deferred.promise;
    },

    reconnect: function () {
      if (/releas/.test(this.state)) {
        this.transition('initializing');
      }
      return this.check();
    },

    release: function () {
      exLog.debug('Release called on exchange %s - %s (%d messages pending)', this.name, connection.name, this.published.count());
      return new Promise(function (resolve) {
        this.once('released', function () {
          resolve();
        });
        this.handle('release');
      }.bind(this));
    },

    publish: function (message) {
      if (this.state !== 'ready' && this.published.count() >= this.limit) {
        exLog.warn("Exchange '%s' has reached the limit of %d messages waiting on a connection",
          this.name,
          this.limit
        );
        return Promise.reject(new Error('Exchange has reached the limit of messages waiting on a connection'));
      }
      var publishTimeout = message.timeout || options.publishTimeout || message.connectionPublishTimeout || 0;
      return new Promise(function (resolve, reject) {
        var timeout;
        var timedOut;
        var failedSub;
        var closedSub;
        if (publishTimeout > 0) {
          timeout = setTimeout(function () {
            timedOut = true;
            onRejected.bind(this)(new Error('Publish took longer than configured timeout'));
          }.bind(this), publishTimeout);
        }
        function onPublished () {
          resolve();
          this._removeDeferred(reject);
          failedSub.unsubscribe();
          closedSub.unsubscribe();
        }
        function onRejected (err) {
          reject(err);
          this._removeDeferred(reject);
          failedSub.unsubscribe();
          closedSub.unsubscribe();
        }
        var op = function (err) {
          if (err) {
            onRejected.bind(this)(err);
          } else {
            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }
            if (!timedOut) {
              return this.publisher(message)
                .then(onPublished.bind(this), onRejected.bind(this));
            }
          }
        }.bind(this);
        failedSub = this.once('failed', (err) => {
          onRejected.bind(this)(err);
        });
        closedSub = this.once('closed', (err) => {
          onRejected.bind(this)(err);
        });
        this.deferred.push(reject);
        this.handle('publish', op);
      }.bind(this));
    },

    retry: function () {
      this.transition('initializing');
    },

    initialState: 'setup',
    states: {
      closed: {
        _onEnter: function () {
          this._onClose();
          this.emit('closed');
        },
        check: function () {
          this.deferUntilTransition('ready');
          this.transition('initializing');
        },
        publish: function () {
          this.deferUntilTransition('ready');
          this.transition('initializing');
        }
      },
      failed: {
        _onEnter: function () {
          this._onFailure(this.failedWith);
          this.emit('failed', this.failedWith);
        },
        check: function (deferred) {
          deferred.reject(this.failedWith);
          this.emit('failed', this.failedWith);
        },
        release: function (exchange) {
          this._release(exchange)
            .then(function () {
              this.transition('released');
            }.bind(this));
        },
        publish: function (op) {
          op(this.failedWith);
        }
      },
      initializing: {
        _onEnter: function () {
          exchangeFn(options, topology, this.published, serializers)
            .then(function (exchange) {
              this.handle('acquired', exchange);
            }.bind(this));
        },
        acquired: function (exchange) {
          this._onAcquisition('ready', exchange);
        },
        check: function () {
          this.deferUntilTransition('ready');
        },
        closed: function () {
          this.deferUntilTransition('ready');
        },
        release: function () {
          this.deferUntilTransition('ready');
        },
        released: function () {
          this.transition('initializing');
        },
        publish: function () {
          this.deferUntilTransition('ready');
        }
      },
      ready: {
        _onEnter: function () {
          this.emit('defined');
        },
        check: function (deferred) {
          deferred.resolve();
          this.emit('defined');
        },
        release: function () {
          this.deferUntilTransition('released');
          this.transition('releasing');
        },
        closed: function () {
          this.transition('closed');
        },
        released: function () {
          this.deferUntilTransition('releasing');
        },
        publish: function (op) {
          op();
        }
      },
      releasing: {
        _onEnter: function () {
          this._release()
            .then(function () {
              this.transition('released');
            }.bind(this));
        },
        publish: function () {
          this.deferUntilTransition('released');
        },
        release: function () {
          this.deferUntilTransition('released');
        }
      },
      released: {
        _onEnter: function () {
          this.emit('released');
        },
        check: function () {
          this.deferUntilTransition('ready');
        },
        release: function () {
          this.emit('released');
        },
        publish: function (op) {
          exLog.warn("Publish called on exchange '%s' after connection was released intentionally. Released connections must be re-established explicitly.", this.name);
          op(new Error(format("Cannot publish to exchange '%s' after intentionally closing its connection", this.name)));
        }
      },
      setup: {
        _onEnter: function () {
          this._listen();
          this.transition('initializing');
        },
        publish: function () {
          this.deferUntilTransition('ready');
        }
      },
      unreachable: {
        _onEnter: function () {
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

  Monologue.mixInto(Fsm);
  const fsm = new Fsm();
  connection.addExchange(fsm);
  return fsm;
};

module.exports = Factory;
