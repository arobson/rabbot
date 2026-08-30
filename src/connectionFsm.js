import fsm from 'mfsm';
import { format } from 'node:util';
import createLog from './log.js';
import defer from './defer.js';
import defaultChannelFn from './amqp/channel.js';
import defaultConnectionFn from './amqp/connection.js';

const log = createLog('rabbot.connection');

/* events emitted:
  'closing' - close is initiated by user
  'closed' - initiated close has completed
  'connecting' - connection initiated
  'connected' - connection established
  'reconnected' - lost connection recovered
  'failed' - connection lost
  'unreachable' - no end points could be reached within threshold
  'return' - published message was returned by AMQP
*/

/* logs:
    * `rabbot.connection`
    * `debug`:
      * on successful acquisition of a new channel
    * `info`:
      * user initiated close started
      * user initiated close completed
    * `warn`:
      * attempt to acquire a channel during user initiated connection close
      * attempt to acquire a channel on a user-closed connection
    * `error`:
      * on failed channel creation
      * failed reconnection
*/

const Connection = function (options, connectionFn, channelFn) {
  channelFn = channelFn || defaultChannelFn;
  connectionFn = connectionFn || defaultConnectionFn;
  // resolved up front (rather than written back after construction) so
  // connectionFn/iomonad see the same, already-defaulted name everything
  // else in this factory does
  options.name = options.name || 'default';

  const connection = connectionFn(options);
  let queues = [];
  let exchanges = [];
  const channels = {};

  const machine = fsm({
    api: {
      _closer: function () {
        connection.close();
      },

      _getChannel: function (name, confirm, context) {
        let channel = channels[name];
        if (!channel || /releas/.test(channel.currentState)) {
          return new Promise((resolve) => {
            channel = channelFn.create(connection, name, confirm);
            channels[name] = channel;
            channel.on('acquired', () => {
              this._onChannel.bind(this, name, context);
              resolve(channel);
            });
            channel.on('return', (raw) => {
              this.emit('return', raw);
            });
          });
        } else {
          return Promise.resolve(channel);
        }
      },

      _onChannel: function (name, context, channel) {
        log.debug("Acquired channel '%s' on '%s' successfully for '%s'", name, this.name, context);
        return channel;
      },

      _onChannelFailure: function (name, context, error) {
        log.error("Failed to create channel '%s' on '%s' for '%s' with %s", name, this.name, error);
        return Promise.reject(error);
      },

      _reconnect: function () {
        const keys = Object.keys(channels);
        const reacquisitions = keys.map((channelName) =>
          new Promise((resolve) => {
            const channel = channels[channelName];
            channel.once('acquired', function () {
              resolve(channel);
            });
            channel.acquire();
          })
        );

        const reacquired = () => {
          this.emit('reconnected');
        };

        const reacquireFailed = (err) => {
          log.error("Could not complete reconnection of '%s' due to %s", err);
          this.next('failed', err);
        };

        Promise.all(reacquisitions)
          .then(reacquired, reacquireFailed);
      },

      _replay: function (ev) {
        return (x) => {
          this.handle(ev, x);
        };
      },

      addQueue: function (queue) {
        queues.push(queue);
      },

      addExchange: function (exchange) {
        exchanges.push(exchange);
      },

      clearConnectionTimeout: function () {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
      },

      getChannel: function (name, confirm, context) {
        const deferred = defer();
        this.handle('channel', {
          name,
          confirm,
          context,
          deferred
        });
        return deferred.promise;
      },

      close: function (reset) {
        log.info("Close initiated on connection '%s'", this.name);
        const deferred = defer();
        this.handle('close', deferred);
        return deferred.promise
          .then(function () {
            if (reset) {
              queues = [];
              exchanges = [];
            }
          });
      },

      connect: function () {
        this.consecutiveFailures = 0;
        const deferred = defer();
        this.handle('connect', deferred);
        return deferred.promise;
      },

      lastError: function () {
        return connection.lastError;
      },

      setConnectionTimeout: function () {
        if (!this.connectionTimeout) {
          this.connectionTimeout = setTimeout(() => {
            this.next('unreachable');
          }, this.failAfter);
        }
      }
    },
    init: {
      default: 'initializing',
      name: options.name,
      connected: false,
      consecutiveFailures: 0,
      connectTimeout: undefined,
      failAfter: (options.failAfter || 60) * 1000
    },
    // Note on emit()/state-name coincidence: mfsm's next() automatically
    // emits the state's own name (with whatever data was passed to next())
    // on entry, so onEntry hooks that previously did nothing but manually
    // re-announce their own state name (as monologue.js required) simply
    // omit that call here and thread the payload through next() instead -
    // duplicating it would fire the event twice.
    states: {
      initializing: {
        acquiring: function () {
          this.next('connecting');
        },
        acquired: function () {
          this.next('connected', connection);
        },
        channel: function (request) {
          this.deferUntil('connected', 'channel', request);
        },
        close: function (deferred) {
          this.deferUntil('connected', 'close', deferred);
          this.next('connected', connection);
        },
        connect: function (deferred) {
          this.deferUntil('connected', 'connect', deferred);
          this.next('connecting');
        },
        failed: function (err) {
          this.deferUntil('connecting', 'failed', err);
          this.next('connecting');
        }
      },
      connecting: {
        onEntry: function () {
          this.setConnectionTimeout();
          connection.acquire()
            .then(null, function () {});
        },
        acquired: function () {
          this.next('connected', connection);
        },
        channel: function (request) {
          this.deferUntil('connected', 'channel', request);
        },
        close: function (deferred) {
          this.deferUntil(null, 'close', deferred);
        },
        connect: function (deferred) {
          this.deferUntil('connected', 'connect', deferred);
        },
        failed: function (err) {
          this.next('failed', err);
        }
      },
      connected: {
        onEntry: function () {
          this.clearConnectionTimeout();
          this.uri = connection.item.uri;
          this.consecutiveFailures = 0;
          if (this.connected) {
            this._reconnect();
          }
          this.connected = true;
        },
        acquired: function () {
          this.deferUntil('connecting', 'acquired');
        },
        channel: function (request) {
          this._getChannel(request.name, request.confirm, request.context)
            .then(
              request.deferred.resolve,
              request.deferred.reject
            );
        },
        close: function (deferred) {
          this.deferUntil('closed', 'close', deferred);
          this.next('closing');
        },
        connect: function (deferred) {
          deferred.resolve();
          this.emit('already-connected', connection);
        },
        failed: function (err) {
          this.next('failed', err);
        },
        closed: function () {
          this.next('connecting');
        }
      },
      closed: {
        onEntry: function () {
          this.clearConnectionTimeout();
          log.info('Close on connection \'%s\' resolved', this.name);
        },
        acquiring: function () {
          this.next('connecting');
        },
        channel: function (request) {
          log.warn("Channel '%s' on '%s' was requested for '%s' which was closed by user. Request will be deferred until connection is re-established explicitly by user.");
          this.deferUntil('connected', 'channel', request);
        },
        close: function (deferred) {
          deferred.resolve();
          connection.release();
          this.emit('closed');
        },
        connect: function (deferred) {
          this.deferUntil('connected', 'connect', deferred);
          this.next('connecting');
        },
        failed: function (err) {
          this.next('failed', err);
        }
      },
      closing: {
        onEntry: function () {
          const closeList = queues.concat(exchanges);
          if (closeList.length) {
            Promise
              .all(closeList.map((channel) => channel.release()))
              .then(() => this._closer());
          } else {
            this._closer();
          }
        },
        channel: function (request) {
          log.warn("Channel '%s' on '%s' was requested for '%s' during user initiated close. Request will be rejected.");
          request.deferred.reject(new Error(
            format("Illegal request for channel '%s' during close of connection '%s' initiated by user",
              request.name,
              this.name
            )
          ));
        },
        connect: function (deferred) {
          this.deferUntil('closed', 'connect', deferred);
        },
        close: function (deferred) {
          this.deferUntil('closed', 'close', deferred);
        },
        closed: function () {
          this.next('closed', {});
        },
        released: function () {
          this.next('closed', {});
        }
      },
      failed: {
        onEntry: function () {
          this.setConnectionTimeout();
          this.consecutiveFailures++;
          const tooManyFailures = this.consecutiveFailures >= options.retryLimit;
          if (tooManyFailures) {
            this.next('unreachable');
          }
        },
        failed: function (err) {
          this.emit('failed', err);
        },
        acquiring: function () {
          this.next('connecting');
        },
        channel: function (request) {
          this.deferUntil('connected', 'channel', request);
        },
        close: function (deferred) {
          deferred.resolve();
          connection.release();
          this.emit('closed');
        },
        connect: function (deferred) {
          this.deferUntil('connected', 'connect', deferred);
          this.next('connecting');
        }
      },
      unreachable: {
        onEntry: function () {
          this.clearConnectionTimeout();
          return connection.release();
        },
        connect: function () {
          this.consecutiveFailures = 0;
          this.next('connecting');
        }
      }
    }
  });

  // mfsm always defers onEntry (even for the default/initial state set
  // during construction) by a tick via process.nextTick, unlike machina
  // which ran the initial state's _onEnter synchronously. Wiring the
  // connection's listeners here - rather than from within 'initializing'
  // state's onEntry - keeps this synchronous with construction, so
  // nothing the connection raises immediately can be missed.
  machine.setConnectionTimeout();
  connection.on('acquiring', machine._replay('acquiring'));
  connection.on('acquired', machine._replay('acquired'));
  connection.on('failed', machine._replay('failed'));
  connection.on('closed', machine._replay('closed'));
  connection.on('released', machine._replay('released'));

  return machine;
};

export default Connection;
