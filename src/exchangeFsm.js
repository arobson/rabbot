const fsm = require('mfsm')
const publishLog = require('./publishLog')
const log = require('./log.js')('rabbot.exchange')
const format = require('util').format
const defer = require('fauxdash').future

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
  handlers.forEach((handle) => {
    if (handle) {
      handle.remove()
    }
  })
}

function getDefinition(options, connection, topology, serializers, exchangeFn) {
  return {
    init: {
      name: options.name,
      default: 'setup',
      type: options.type,
      publishTimeout: options.publishTimeout || 0,
      replyTimeout: options.replyTimeout || 0,
      limit: (options.limit || 100),
      publisher: undefined,
      releasers: [],
      deferred: [],
      published: publishLog()
    },
    api: {
      _define: function (exchange, stateOnDefined) {
        function onDefinitionError (err) {
          this.failedWith = err
          this.next('failed')
        }
        function onDefined () {
          this.next(stateOnDefined)
        }
        exchange.define()
          .then(onDefined.bind(this), onDefinitionError.bind(this))
      },

      _listen: function () {
        connection.on('unreachable', function (err) {
          if (!err || !err.message) {
            err = new Error('Could not establish a connection to any known nodes.')
          }
          this._onFailure(err)
          this.next('unreachable')
        }.bind(this))
      },

      _onAcquisition: function (nextTo, exchange) {
        const handlers = []
        handlers.push(exchange.channel.once('released', function () {
          this.handle('released', exchange)
        }.bind(this)))

        handlers.push(exchange.channel.once('closed', function () {
          this.handle('closed', exchange)
        }.bind(this)))

        function cleanup () {
          unhandle(handlers)
          exchange.release()
            .then(function () {
              this.next('released')
            }.bind(this))
        }

        function onCleanupError () {
          const count = this.published.count()
          if (count > 0) {
            log.warn(`${this.type} exchange '${this.name}', connection '${connection.name}' was released with ${count} messages unconfirmed`)
          }
          cleanup.bind(this)()
        }

        const releaser = function () {
          return this.published.onceEmptied()
            .then(cleanup.bind(this), onCleanupError.bind(this))
        }.bind(this)

        const publisher = function (message) {
          return exchange.publish(message)
        }

        this.publisher = publisher
        this.releasers.push(releaser)
        this._define(exchange, nextTo)
      },

      _onClose: function () {
        log.info(`Rejecting ${this.published.count()} published messages`)
        this.published.reset()
      },

      _onFailure: function (err) {
        this.deferred.forEach((x) => x(err.error))
        this.deferred = []
        this.published.reset()
      },

      _removeDeferred: function (reject) {
        const index = this.deferred.indexOf(reject)
        if (index >= 0) {
          this.deferred.splice(index, 1)
        }
      },

      _release: function (closed) {
        const release = this.releasers.shift()
        if (release) {
          return release(closed)
        } else {
          return Promise.resolve()
        }
      },

      check: function () {
        const deferred = defer()
        this.handle('check', deferred)
        return deferred.promise
      },

      reconnect: function () {
        if (/releas/.test(this.currentState)) {
          this.next('initializing')
        }
        return this.check()
      },

      release: function () {
        log.debug(`Release called on exchange ${this.name} - ${connection.name} (${this.published.count()} messages pending)`)
        return new Promise(function (resolve) {
          this.once('released', function () {
            resolve()
          })
          this.handle('release')
        }.bind(this))
      },

      publish: function (message) {
        if (this.currentState !== 'ready' && this.published.count() >= this.limit) {
          log.warn(`Exchange '${this.name}' has reached the limit of ${this.limit} messages waiting on a connection`)
          return Promise.reject(new Error('Exchange has reached the limit of messages waiting on a connection'))
        }
        const publishTimeout = message.timeout || options.publishTimeout || message.connectionPublishTimeout || 0
        return new Promise(function (resolve, reject) {
          let timeout
          let timedOut
          let failedSub
          let closedSub
          if (publishTimeout > 0) {
            timeout = setTimeout(function () {
              timedOut = true
              onRejected.bind(this)(new Error('Publish took longer than configured timeout'))
            }.bind(this), publishTimeout)
          }
          function onPublished () {
            resolve()
            this._removeDeferred(reject)
            if (failedSub) {
              failedSub.off()
            }
            if (failedSub) {
              closedSub.off()
            }
          }
          function onRejected (err) {
            reject(err)
            this._removeDeferred(reject)
            if (failedSub) {
              failedSub.off()
            }
            if (failedSub) {
              closedSub.off()
            }
          }
          const op = function (err) {
            if (err) {
              onRejected.bind(this)(err)
            } else {
              if (timeout) {
                clearTimeout(timeout)
                timeout = null
              }
              if (!timedOut) {
                return this.publisher(message)
                  .then(onPublished.bind(this), onRejected.bind(this))
              }
            }
          }.bind(this)
          failedSub = this.once('failed', (err) => {
            onRejected.bind(this)(err)
          })
          closedSub = this.once('closed', (err) => {
            onRejected.bind(this)(err)
          })
          this.deferred.push(reject)
          this.handle('publish', op)
        }.bind(this))
      },

      retry: function () {
        this.next('initializing')
      }
    },
    states: {
      closed: {
        onEntry: function () {
          this._onClose()
        },
        check: { deferUntil: 'ready', next: 'initializing'},
        publish: { deferUntil: 'ready', next: 'initializing'}
      },
      failed: {
        onEntry: function () {
          this._onFailure(this.failedWith)
        },
        check: function (deferred) {
          deferred.reject(this.failedWith)
          this.emit('failed', this.failedWith)
        },
        release: function (exchange) {
          this._release(exchange)
            .then(() => {
              this.next('released')
            })
        },
        publish: function (op) {
          op(this.failedWith)
        }
      },
      initializing: {
        onEntry: function () {
          exchangeFn(options, topology, this.published, serializers)
            .then(function (exchange) {
              this.handle('acquired', exchange)
            }.bind(this))
        },
        acquired: function (exchange) {
          this._onAcquisition('ready', exchange)
        },
        check: { deferUntil: 'ready' },
        closed: { deferUntil: 'ready' },
        release: { deferUntil: 'ready' },
        released: { next: 'initializing' },
        publish: { deferUntil: 'ready' },
      },
      ready: {
        onEntry: function () {
          this.emit('defined')
        },
        check: function (deferred) {
          deferred.resolve()
          this.emit('defined')
        },
        release: { deferUntil: 'released', next: 'releasing'},
        closed: function () {
          this.next('closed')
        },
        released: { deferUntil: 'releasing' },
        publish: function (op) {
          op()
        }
      },
      releasing: {
        onEntry: function () {
          this._release()
            .then(function () {
              this.next('released')
            }.bind(this))
        },
        publish: { deferUntil: 'released' },
        release: { deferUntil: 'released' }
      },
      released: {
        onEntry: function () {
        },
        check: { deferUntil: 'ready' },
        release: function () {
          this.emit('released')
        },
        publish: function (op) {
          log.warn(`Publish called on exchange '${this.name}' after connection was released intentionally. Released connections must be re-established explicitly.`)
          op(new Error(format(`Cannot publish to exchange '${this.name}' after intentionally closing its connection`)))
        }
      },
      setup: {
        onEntry: function () {
          this._listen()
          this.next('initializing')
        },
        publish: { deferUntil: 'ready' }
      },
      unreachable: {
        onEntry: function () {
          this.emit('failed', { error: this.failedWith })
        },
        check: function (deferred) {
          deferred.reject(this.failedWith)
          this.emit('failed', { error: this.failedWith })
        },
        publish: function (op) {
          op(this.failedWith)
        }
      }
    }
  }
}

const Factory = function (options, connection, topology, serializers, exchangeFn) {
  exchangeFn = exchangeFn || require('./amqp/exchange')
  const exchange = fsm(getDefinition(options, connection, topology, serializers, exchangeFn))
  connection.addExchange(exchange)
  return exchange
}

Factory.type = 'exchange'

module.exports = Factory
