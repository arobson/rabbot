// This is probably not a true monad, but it seems close based on my current understanding.

const Monologue = require('monologue.js');
const machina = require('machina');
const log = require('../log.js')('rabbot.io');
let staticId = 0;

/* state definitions
  acquiring - waiting to get back a connection or channel
  acquired - an open connection or channel was established
  closed - the broker closed the channel or connection
  failed - a temporary state between retries
  released - release happens due to user action _or_ after all attempts to connect are exhausted
*/

/* events emitted:
  `acquiring` - in the process of acquisition
  `acquired` - channel or connection is available
  `return` - published message was returned by AMQP
  `failed` - acquisition failed
  `closed` - broker terminated the connection or channel
  `released` - closed in response to a user action _or_ after exhausting allowed attempts
*/

/* log:
  * `rabbot.io`
    * `debug`:
      * attempting acquisition
      * successful acquisition
    * `info`:
    * closing due to a user call
    * operation is called on a closed resource
    * `warn`:
    * closed by the broker
    * operation is called on a released resource
    * exception when calling built-in close
    * the channel/connection is blocked
    * the channel/connection is unblocked
    * `error`:
    * failure due to protocol or connectivity
    * failure due to an exception (bad code)
*/

module.exports = function (options, type, factory, target, close) {
  var IOMonad = machina.Fsm.extend({
    id: staticId++,
    initialState: 'acquiring',
    item: undefined,
    name: options.name,
    waitInterval: 0,
    waitMin: options.waitMin || 0,
    waitMax: options.waitMax || 5000,
    waitIncrement: options.waitIncrement || 100,
    eventHandlers: [],
    _acquire: function () {
      process.nextTick(function () {
        this.emit('acquiring');
      }.bind(this));
      log.debug(`Attempting acquisition of ${type} '${this.name}'`);
      factory()
        .then(
          this._onAcquisition.bind(this),
          this._onAcquisitionError.bind(this)
        );
    },
    _clearEventHandlers: function () {
      if (this.item) {
        this.item.removeAllListeners('blocked');
        this.item.removeAllListeners('unblocked');
      }
    },
    _finalize: function () {
      if (this.item && this.item.removeAllListeners) {
        this.item.removeAllListeners();
      }
      this.item = null;
    },
    _onAcquisition: function (instance) {
      this.item = instance;
      this.waitInterval = this.waitMin;
      log.debug(`Acquired ${type} '${this.name}' successfully`);
      // amqplib primitives emit close and error events
      this.item.on('return', function (raw) {
        this.handle('return', raw);
      }.bind(this));
      this.item.once('close', function (info) {
        info = info || 'No information provided';
        this._clearEventHandlers();
        this.handle('released', info);
      }.bind(this));
      this.item.on('error', function (err) {
        log.error(`Error emitted by ${type} '${this.name}' - '${err.stack}'`);
        this._clearEventHandlers();
        this.emit('failed', err);
        this.handle('failed', err);
      }.bind(this));
      this.item
        .on('unblocked', function () {
          log.warn(`${type} '${this.name}' was unblocked by the broker`);
          this.emit('unblocked');
          this.handle('unblocked');
        }.bind(this))
        .on('blocked', function () {
          log.warn(`${type} '${this.name}' was blocked by the broker`);
          this.emit('blocked');
          this.handle('blocked');
        }.bind(this));
      this.transition('acquired');
    },
    _onAcquisitionError: function (err) {
      log.error(`Acquisition of ${type} '${this.name}' failed with '${err}'`);
      this.emit('failed', err);
      this.handle('failed');
    },
    _release: function () {
      if (this.retry) {
        clearTimeout(this.retry);
      }
      if (this.item) {
        // go through close procedure for resource
        if (close) {
          try {
            close(this.item);
          } catch (ex) {
            log.warn(`${type} '${this.name}' threw an exception on close: ${ex}`);
            this.handle('released');
          }
        } else {
          try {
            this.item.close();
          } catch (ex) {
            log.warn(`${type} '${this.name}' threw an exception on close: ${ex}`);
            this.handle('released');
          }
        }
      } else {
        this.handle('released');
      }
    },
    acquire: function () {
      this.handle('acquire');
      return new Promise(function (resolve, reject) {
        this.once('acquired', function () {
          resolve(this);
        }.bind(this));
        this.once('released', function () {
          reject(new Error(`Cannot reacquire released ${type} '${this.name}'`));
        });
      }.bind(this));
    },
    operate: function (call, args) {
      const op = { operation: call, argList: args, index: this.index };
      const promise = new Promise(function (resolve, reject) {
        op.resolve = resolve;
        op.reject = reject;
      });
      this.handle('operate', op);
      return promise.then(null, function (err) {
        return Promise.reject(err);
      });
    },
    release: function () {
      if (this.retry) {
        clearTimeout(this.retry);
      }
      return new Promise(function (resolve) {
        this.once('released', function () {
          resolve();
        });
        this.handle('release');
      }.bind(this));
    },
    states: {
      acquiring: {
        _onEnter: function () {
          this._acquire();
        },
        blocked: function () {
          this.deferUntilTransition('acquired');
        },
        failed: function () {
          this.transition('failed');
        },
        operate: function () {
          this.deferUntilTransition('acquired');
        },
        release: function () {
          this.transition('released');
        },
        released: function () {
          this.transition('released');
        }
      },
      acquired: {
        _onEnter: function () {
          this.emit('acquired');
        },
        acquire: function () {
          this.emit('acquired');
        },
        return: function (raw) {
          this.emit('return', raw);
        },
        blocked: function () {
          this.transition('blocked');
        },
        failed: function () {
          this.transition('failed');
        },
        operate: function (call) {
          try {
            var result = this.item[ call.operation ].apply(this.item, call.argList);
            if (result && result.then) {
              result
                .then(call.resolve, call.reject);
            } else {
              call.resolve(result);
            }
          } catch (err) {
            call.reject(err);
          }
        },
        release: function () {
          // the user has called release during acquired state
          log.info(`${type} '${this.name}' was closed by the user`);
          this.transition('releasing');
        },
        released: function (reason) {
          // the remote end initiated close
          log.warn(`${type} '${this.name}' was closed by the broker with reason '${reason}'`);
          this.closeReason = reason;
          this.transition('closed');
        }
      },
      blocked: {
        failed: function () {
          this.transition('failed');
        },
        operate: function () {
          this.deferUntilTransition('acquired');
        },
        release: function () {
          // the user has called release during acquired state
          log.info(`${type} '${this.name}' was closed by the user`);
          this.transition('releasing');
        },
        released: function (reason) {
          // the remote end initiated close
          log.warn(`${type} '${this.name}' was closed by the broker with reason '${reason}'`);
          this.closeReason = reason;
          this.transition('closed');
        },
        unblocked: function () {
          this.transition('acquired');
        }
      },
      closed: {
        _onEnter: function () {
          if (this.retry) {
            clearTimeout(this.retry);
          }
          this.emit('closed', this.closeReason);
          this.item = null;
          this.closeReason = null;
        },
        acquire: function () {
          this.transition('acquiring');
        },
        operate: function (call) {
          log.info(`Operation '${call.operation}' invoked on closed ${type} '${this.name}'`);
          this.deferUntilTransition('acquired');
          this.transition('acquiring');
        },
        release: function () {
          this.transition('released');
        },
        released: function () {
          this.transition('released');
        }
      },
      failed: {
        _onEnter: function () {
          this.retry = setTimeout(function () {
            if ((this.waitInterval + this.waitIncrement) < this.waitMax) {
              this.waitInterval += this.waitIncrement;
            }
            this.transition('acquiring');
          }.bind(this), this.waitInterval);
        },
        acquire: function () {
          if (this.retry) {
            clearTimeout(this.retry);
          }
          this.transition('acquiring');
        },
        operate: function () {
          this.deferUntilTransition('acquired');
        },
        release: function () {
          this.transition('released');
        },
        released: function () {
          // this is expected because the close event fires after the error event on a channel or connection
        }
      },
      releasing: {
        _onEnter: function () {
          this._release();
        },
        acquire: function () {
          this.deferUntilTransition('released');
        },
        operate: function () {
          this.deferUntilTransition('released');
        },
        release: function () {
          this.deferUntilTransition('released');
        },
        released: function () {
          this.transition('released');
        }
      },
      released: {
        _onEnter: function () {
          this._finalize();
          this.emit('released', this.id);
        },
        acquire: function () {
          this.transition('acquiring');
        },
        operate: function (call) {
          log.warn(`Operation '${call.operation}' invoked on released ${type} '${this.name}' - reacquisition is required.`);
          call.reject(new Error(`Cannot invoke operation '${call.operation}' on released ${type} '${this.name}'`));
        },
        release: function () {
          this.emit('released');
        },
        released: function () {
          this.emit('released');
        }
      }
    }
  });

  Monologue.mixInto(IOMonad);
  var machine = new IOMonad();

  const names = Object.getOwnPropertyNames(target.prototype);
  names.forEach(name => {
    const prop = target.prototype[ name ];
    if (typeof prop === 'function') {
      machine[ name ] = function () {
        var list = Array.prototype.slice.call(arguments, 0);
        return machine.operate(name, list);
      };
    }
  });
  return machine;
};
