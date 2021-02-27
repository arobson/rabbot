// This is probably not a true monad, but it seems close based on my current understanding.

const fsm = require('mfsm')
const log = require('../log.js')('rabbot.io')
let staticId = 0

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

function getDefinition (options, type, factory, close) {
  return {
    init: {
      identifier: staticId++,
      default: 'acquiring',
      item: undefined,
      name: options.name,
      waitInterval: 0,
      waitMin: options.waitMin || 0,
      waitMax: options.waitMax || 5000,
      waitIncrement: options.waitIncrement || 100,
      eventHandlers: []
    },
    api: {
      _acquire: function () {
        log.debug(`Attempting acquisition of ${type} '${this.name}'`)
        factory()
          .then(
            this._onAcquisition.bind(this),
            this._onAcquisitionError.bind(this)
          )
      },
      _clearEventHandlers: function () {
        if (this.item) {
          this.item.removeAllListeners('blocked')
          this.item.removeAllListeners('unblocked')
        }
      },
      _delegate: function(event, data) {
        if (this.item) {
          this.item.emit(event, data)
        } else {
          log.warn(`attempted to delegate event ${event} without resource`)
        }
      },
      _finalize: function () {
        if (this.retry) {
          clearTimeout(this.retry)
        }
        if (this.item && this.item.removeAllListeners) {
          this.item.removeAllListeners()
        }
        this.item = null
      },
      _onAcquisition: function (instance) {
        this.item = instance
        this.waitInterval = this.waitMin
        log.debug(`Acquired ${type} '${this.name}' successfully`)
        // amqplib primitives emit close and error events
        this.item.on('return', (raw) => {
          this.handle('return', raw)
        })
        this.item.once('close', (info) => {
          info = info || 'No information provided'
          this._clearEventHandlers()
          this.handle('released', info)
        })
        this.item.on('error', (err) => {
          log.error(`Error emitted by ${type} '${this.name}' - '${err.stack}'`)
          this._clearEventHandlers()
          this.handle('failed', err)
        })
        this.item
          .on('unblocked', () => {
            log.warn(`${type} '${this.name}' was unblocked by the broker`)
            this.handle('unblocked')
          })
          .on('blocked', () => {
            log.warn(`${type} '${this.name}' was blocked by the broker`)
            this.handle('blocked')
          })
        this.next('acquired')
      },
      _onAcquisitionError: function (err) {
        log.error(`Acquisition of ${type} '${this.name}' failed with '${err}'`)
        this.handle('failed', err)
      },
      _release: function () {
        if (this.retry) {
          clearTimeout(this.retry)
        }
        if (this.item) {
          // go through close procedure for resource
          if (close) {
            try {
              close(this.item)
            } catch (ex) {
              log.warn(`${type} '${this.name}' threw an exception on close: ${ex}`)
              this.handle('released')
            }
          } else {
            try {
              this.item.close()
            } catch (ex) {
              log.warn(`${type} '${this.name}' threw an exception on close: ${ex}`)
              this.handle('released')
            }
          }
        } else {
          this.handle('released')
        }
      },
      acquire: function () {
        this.handle('acquire')
        return new Promise(function (resolve, reject) {
          this.once('acquired', () => {
            resolve(this)
          })
          this.once('released', () => {
            reject(new Error(`Cannot reacquire released ${type} '${this.name}'`))
          })
        })
      },
      operate: function (call, args) {
        const op = { operation: call, argList: args, index: this.index }
        const promise = new Promise(function (resolve, reject) {
          op.resolve = resolve
          op.reject = reject
        })
        this.handle('operate', op)
        return promise.then(null, function (err) {
          return Promise.reject(err)
        })
      },
      release: function () {
        if (this.retry) {
          clearTimeout(this.retry)
        }
        return new Promise((resolve) => {
          this.once('released', function () {
            resolve()
          })
          this.handle('release')
        })
      }
    },
    states: {
      acquiring: {
        onEntry: function () {
          this._acquire()
        },
        blocked: { deferUntil: 'acquired' },
        failed: { next: 'failed' },
        operate: { deferUntil: 'acquired' },
        release: { next: 'released' },
        released: { next: 'released' }
      },
      acquired: {
        onEntry: { emit: 'acquired' },
        acquire: { emit: 'acquired' },
        return: { emit: 'acquired' },
        blocked: { next: 'blocked' },
        failed: { next: 'blocked' },
        operate: function (call) {
          try {
            const result = this.item[call.operation].apply(this.item, call.argList)
            if (result && result.then) {
              result
                .then(call.resolve, call.reject)
            } else {
              call.resolve(result)
            }
          } catch (err) {
            call.reject(err)
          }
        },
        release: function () {
          // the user has called release during acquired state
          log.info(`${type} '${this.name}' was closed by the user`)
          this.next('releasing')
        },
        released: function (reason) {
          // the remote end initiated close
          log.warn(`${type} '${this.name}' was closed by the broker with reason '${reason}'`)
          this.closeReason = reason
          this.next('closed', this.closeReason)
        }
      },
      blocked: {
        failed: { next: 'failed' },
        operate: { deferUntil: 'acquired' },
        release: function () {
          // the user has called release during acquired state
          log.info(`${type} '${this.name}' was closed by the user`)
          this.next('releasing')
        },
        released: function (reason) {
          // the remote end initiated close
          log.warn(`${type} '${this.name}' was closed by the broker with reason '${reason}'`)
          this.closeReason = reason
          this.next('closed')
        },
        unblocked: { next: 'acquired' }
      },
      closed: {
        onEntry: function () {
          if (this.retry) {
            clearTimeout(this.retry)
          }
          this.item = null
          this.closeReason = null
        },
        acquire: { next: 'acquiring' },
        operate: {
          info: (data) => `Operation '${data.operation}' invoked on closed ${type} '${this.name}'`,
          afted: 'acquired',
          forward: 'acquiring'
        },
        release: { next: 'released' },
        released: { next: 'released' }
      },
      failed: {
        onEntry: function () {
          this.retry = setTimeout(() => {
            if ((this.waitInterval + this.waitIncrement) < this.waitMax) {
              this.waitInterval += this.waitIncrement
            }
            this.next('acquiring')
          }, this.waitInterval)
        },
        acquire: function () {
          console.trace(`called acquire from failed`)
          if (this.retry) {
            clearTimeout(this.retry)
          }
          this.next('acquiring')
        },
        operate: { deferUntil: 'acquired' },
        release: { next: 'released' },
        released: function () {
          // this is expected because the close event fires after the error event on a channel or connection
        }
      },
      releasing: {
        onEntry: function () {
          this._release()
        },
        acquire: { deferUntil: 'released' },
        operate: { deferUntil: 'released' },
        release: { deferUntil: 'released' },
        released: { next: 'released' }
      },
      released: {
        onEntry: function () {
          this._finalize()
        },
        acquire: { next: 'acquiring' },
        operate: function (call) {
          log.warn(`Operation '${call.operation}' invoked on released ${type} '${this.name}' - reacquisition is required.`)
          call.reject(new Error(`Cannot invoke operation '${call.operation}' on released ${type} '${this.name}'`))
        },
        release: { emit: 'released' },
        released: { emit: 'released' }
      }
    }
  }
}

module.exports = function (options, type, factory, target, close) {
  const machine = fsm(getDefinition(options, type, factory, close))
  const names = Object.getOwnPropertyNames(target.prototype)
  names.forEach(name => {
    const prop = target.prototype[name]
    if (typeof prop === 'function') {
      machine[name] = function () {
        const list = Array.prototype.slice.call(arguments, 0)
        return machine.operate(name, list)
      }
    }
  })
  return machine
}
