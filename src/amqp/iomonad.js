// This is probably not a true monad, but it seems close based on my current understanding.

import fsm from 'mfsm';
import createLog from '../log.js';

const log = createLog('rabbot.io');
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

export default function (options, type, factory, methodNames, close) {
  const machine = fsm({
    api: {
      _acquire: function () {
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
        // bumped on every real (re)acquisition of the underlying amqplib
        // channel/connection - amqp delivery tags are only meaningful for
        // the specific channel instance that issued them, and reset back
        // to 1 on each new channel, so consumers of `channel.generation`
        // use this to detect and discard operations tied to a channel
        // that no longer exists rather than risk acking/nacking a
        // coincidentally-numbered but unrelated message (#47, #155)
        this.generation += 1;
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
            this.handle('blocked');
          }.bind(this));
        this.next('acquired');
      },
      _onAcquisitionError: function (err) {
        log.error(`Acquisition of ${type} '${this.name}' failed with '${err}'`);
        this.handle('failed', err);
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
        return new Promise((resolve, reject) => {
          const acquiredSub = this.once('acquired', () => {
            releasedSub.off();
            resolve(this);
          });
          const releasedSub = this.once('released', () => {
            acquiredSub.off();
            reject(new Error(`Cannot reacquire released ${type} '${this.name}'`));
          });
        });
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
      }
    },
    init: {
      default: 'acquiring',
      id: staticId++,
      item: undefined,
      generation: 0,
      name: options.name,
      waitInterval: 0,
      waitMin: options.waitMin || 0,
      waitMax: options.waitMax || 5000,
      waitIncrement: options.waitIncrement || 100
    },
    // Note on emit()/state-name coincidence: mfsm's next() automatically
    // emits the state's own name on entry, so any state whose onEntry
    // previously did nothing but `this.emit('sameName')` (as the
    // machina/monologue.js version did) simply omits onEntry here -
    // duplicating that emit would fire the event twice. Where an event
    // name is being handled but doesn't share a name with the state being
    // entered (e.g. 'unblocked' transitions into 'acquired', not a state
    // named 'unblocked'), the explicit emit is kept.
    states: {
      acquiring: {
        onEntry: function () {
          this._acquire();
        },
        blocked: function () {
          this.deferUntil('acquired', 'blocked');
        },
        failed: function (err) {
          this.next('failed', err);
        },
        operate: function (call) {
          this.deferUntil('acquired', 'operate', call);
        },
        release: function () {
          this.next('released', this.id);
        },
        released: function () {
          this.next('released', this.id);
        }
      },
      acquired: {
        acquire: function () {
          this.emit('acquired');
        },
        return: function (raw) {
          this.emit('return', raw);
        },
        blocked: function () {
          this.next('blocked');
        },
        failed: function (err) {
          this.next('failed', err);
        },
        operate: function (call) {
          try {
            const result = this.item[call.operation].apply(this.item, call.argList);
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
          this.next('releasing');
        },
        released: function (reason) {
          // the remote end initiated close
          log.warn(`${type} '${this.name}' was closed by the broker with reason '${reason}'`);
          this.closeReason = reason;
          this.next('closed', reason);
        }
      },
      blocked: {
        failed: function (err) {
          this.next('failed', err);
        },
        operate: function (call) {
          this.deferUntil('acquired', 'operate', call);
        },
        release: function () {
          // the user has called release during acquired state
          log.info(`${type} '${this.name}' was closed by the user`);
          this.next('releasing');
        },
        released: function (reason) {
          // the remote end initiated close
          log.warn(`${type} '${this.name}' was closed by the broker with reason '${reason}'`);
          this.closeReason = reason;
          this.next('closed', reason);
        },
        unblocked: function () {
          this.next('acquired');
        }
      },
      closed: {
        onEntry: function () {
          if (this.retry) {
            clearTimeout(this.retry);
          }
          this.item = null;
          this.closeReason = null;
        },
        acquire: function () {
          this.next('acquiring');
        },
        operate: function (call) {
          log.info(`Operation '${call.operation}' invoked on closed ${type} '${this.name}'`);
          this.deferUntil('acquired', 'operate', call);
          this.next('acquiring');
        },
        release: function () {
          this.next('released', this.id);
        },
        released: function () {
          this.next('released', this.id);
        }
      },
      failed: {
        onEntry: function () {
          this.retry = setTimeout(function () {
            if ((this.waitInterval + this.waitIncrement) < this.waitMax) {
              this.waitInterval += this.waitIncrement;
            }
            this.next('acquiring');
          }.bind(this), this.waitInterval);
        },
        acquire: function () {
          if (this.retry) {
            clearTimeout(this.retry);
          }
          this.next('acquiring');
        },
        operate: function (call) {
          this.deferUntil('acquired', 'operate', call);
        },
        release: function () {
          this.next('released', this.id);
        },
        released: function () {
          // this is expected because the close event fires after the error event on a channel or connection
        }
      },
      releasing: {
        onEntry: function () {
          this._release();
        },
        acquire: function () {
          this.deferUntil('released', 'acquire');
        },
        operate: function (call) {
          this.deferUntil('released', 'operate', call);
        },
        release: function () {
          this.deferUntil('released', 'release');
        },
        released: function () {
          this.next('released', this.id);
        }
      },
      released: {
        onEntry: function () {
          this._finalize();
        },
        acquire: function () {
          this.next('acquiring');
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

  methodNames.forEach(name => {
    machine[name] = function () {
      const list = Array.prototype.slice.call(arguments, 0);
      return machine.operate(name, list);
    };
  });
  return machine;
}
