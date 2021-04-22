const fsm = require('mfsm')
const format = require('util').format
const log = require('./log.js')('rabbot.queue')
const defer = require('./defer')

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
  handlers.forEach((handle) => {
    if (handle) {
      handle.remove()
    }
  })
}

function getDefinition(options, connection, topology, serializers, queueFn) {
  return {
    init: {
      name: options.name,
      default: 'initializing',
      uniqueName: options.uniqueName,
      responseSubscriptions: {},
      signalSubscription: undefined,
      subscribed: false,
      subscriber: undefined,
      purger: undefined,
      unsubscribers: [],
      releasers: []
    },
    api: {
      _define: function (queue) {
        const onError = function (err) {
          this.failedWith = err
          this.next('failed')
        }.bind(this)
        const onDefined = function (defined) {
          if (!this.name) {
            this.name = defined.queue
            options.name = defined.queue
            queue.messages.changeName(this.name)
            topology.renameQueue(defined.queue)
          }
          this.next('ready')
        }.bind(this)
        queue.define()
          .then(onDefined, onError)
      },

      _listen: function (queue) {
        const handlers = []
        const emit = this.emit.bind(this)

        const unsubscriber = function () {
          return queue.unsubscribe()
        }

        const onPurge = function (messageCount) {
          log.info(`Purged ${messageCount} messages from queue '${options.name}' - ${connection.name}`)
          this.handle('purged', messageCount)
        }.bind(this)

        const purger = function () {
          return queue
            .purge()
            .then(onPurge)
            .catch(function (err) {
              emit('purgeFailed', err)
            })
        }

        const onSubscribe = function () {
          log.info(
            `Subscription to (${options.noAck ? 'untracked' : 'tracked'}) queue ${options.name} - ${connection.name} started with consumer tag ${queue.channel.tag}`
          )
          this.unsubscribers.push(unsubscriber)
          this.handle('subscribed')
        }.bind(this)

        const subscriber = function (exclusive) {
          return queue
            .subscribe(!!exclusive)
            .then(onSubscribe)
            .catch(function (err) {
              emit('subscribeFailed', err)
            })
        }

        const releaser = function (closed) {
          // remove handlers established on queue
          unhandle(handlers)
          if (queue && queue.getMessageCount() > 0) {
            log.warn(`!!! Queue ${options.name} - ${connection.name} was released with ${queue.getMessageCount()} pending messages !!!`)
          } else if (queue) {
            log.info(`Released queue ${options.name} - ${connection.name}`)
          }

          if (!closed) {
            queue.release()
              .then(function () {
                this.handle('released')
              }.bind(this))
          }
        }.bind(this)

        this.subscriber = subscriber
        this.releasers.push(releaser)
        this.purger = purger

        handlers.push(queue.channel.on('acquired', function () {
          this._define(queue)
        }.bind(this)))
        handlers.push(queue.channel.on('released', function () {
          this.handle('released', queue)
        }.bind(this)))
        handlers.push(queue.channel.on('closed', function () {
          this.handle('closed', queue)
        }.bind(this)))
        handlers.push(connection.on('unreachable', function (err) {
          err = err || new Error('Could not establish a connection to any known nodes.')
          this.handle('unreachable', queue)
        }.bind(this)))

        if (options.subscribe) {
          this.handle('subscribe')
        }
      },

      _release: function (closed) {
        const release = this.releasers.shift()
        if (release) {
          release(closed)
        } else {
          return Promise.resolve()
        }
      },

      check: function () {
        const deferred = defer()
        this.handle('check', deferred)
        return deferred.promise
      },

      purge: function () {
        return new Promise(function (resolve, reject) {
          let _handlers
          function cleanResolve (ev, result) {
            unhandle(_handlers)
            resolve(result)
          }
          function cleanReject (ev, err) {
            unhandle(_handlers)
            this.next('failed')
            reject(err)
          }
          _handlers = [
            this.once('purged', cleanResolve),
            this.once('purgeFailed', cleanReject.bind(this)),
            this.once('failed', cleanReject.bind(this))
          ]
          this.handle('purge')
        }.bind(this))
      },

      reconnect: function () {
        if (/releas/.test(this.state)) {
          this.next('initializing')
        }
        return this.check()
      },

      release: function () {
        return new Promise(function (resolve, reject) {
          let _handlers
          function cleanResolve () {
            unhandle(_handlers)
            resolve()
          }
          function cleanReject (ev, err) {
            unhandle(_handlers)
            reject(err)
          }
          _handlers = [
            this.once('released', cleanResolve.bind(this)),
            this.once('failed', cleanReject.bind(this)),
            this.once('unreachable', cleanReject.bind(this)),
            this.once('noqueue', cleanResolve.bind(this))
          ]
          this.handle('release')
        }.bind(this))
      },

      retry: function () {
        this.next('initializing')
      },

      subscribe: function (exclusive) {
        options.subscribe = true
        options.exclusive = exclusive
        return new Promise(function (resolve, reject) {
          let _handlers
          function cleanResolve () {
            unhandle(_handlers)
            resolve()
          }
          function cleanReject (ev, err) {
            unhandle(_handlers)
            this.next('failed')
            reject(err)
          }
          _handlers = [
            this.once('subscribed', cleanResolve),
            this.once('subscribeFailed', cleanReject.bind(this)),
            this.once('failed', cleanReject.bind(this))
          ]
          this.handle('subscribe')
        }.bind(this))
      },

      unsubscribe: function () {
        options.subscribe = false
        const unsubscriber = this.unsubscribers.shift()
        if (unsubscriber) {
          return unsubscriber()
        } else {
          return Promise.reject(new Error('No active subscription presently exists on the queue'))
        }
      }
    },
    states: {
      closed: {
        onEntry: function () {
          this.subscribed = false
          this._release(true)
          this.emit('closed')
        },
        check: { deferUntil: 'ready', next: 'initializing' },
        purge: { deferUntil: 'ready' },
        subscribe: { deferUntil: 'ready' }
      },
      failed: {
        onEntry: function () {
          this.subscribed = false
          this.emit('failed', this.failedWith)
        },
        check: function (deferred) {
          if (deferred) {
            deferred.reject(this.failedWith)
          }
          this.emit('failed', this.failedWith)
        },
        release: function (queue) {
          if (queue) {
            this._removeHandlers()
            queue.release()
              .then(function () {
                this.handle('released', queue)
              })
          }
        },
        released: function () {
          this.next('released')
        },
        purge: function () {
          this.emit('purgeFailed', this.failedWith)
        },
        subscribe: function () {
          this.emit('subscribeFailed', this.failedWith)
        }
      },
      initializing: {
        onEntry: function () {
          queueFn(options, topology, serializers)
            .then(
              queue => {
                this.lastQueue = queue
                this.handle('acquired', queue)
              },
              err => {
                this.failedWith = err
                this.next('failed')
              }
            )
        },
        acquired: function (queue) {
          this.receivedMessages = queue.messages
          this._define(queue)
          this._listen(queue)
        },
        check: { deferUntil: 'ready' },
        release: { deferUntil: 'ready' },
        closed: { deferUntil: 'ready' },
        purge: { deferUntil: 'ready' },
        subscribe: { deferUntil: 'ready' }
      },
      ready: {
        onEntry: function () {
          this.emit('defined')
        },
        check: function (deferred) {
          deferred.resolve()
        },
        closed: function () {
          this.next('closed')
        },
        purge: function () {
          if (this.purger) {
            this.next('purging')
            return this.purger()
          }
        },
        release: function () {
          this.next('releasing')
          this.handle('release')
        },
        released: function () {
          this._release(true)
          this.next('initializing')
        },
        subscribe: function () {
          if (this.subscriber) {
            return this.forward('subscribing', 'subscribe')
          }
        },
        subscribed: { forward: 'subscribed' }
      },
      purging: {
        closed: function () {
          this.next('closed')
        },
        purged: { forward: 'purged' },
        release: function () {
          this.next('releasing')
          this.handle('release')
        },
        released: function () {
          this._release(true)
          this.next('initializing')
        },
        subscribe: { deferUntil: 'subscribed' }
      },
      purged: {
        check: function (deferred) {
          deferred.resolve()
        },
        closed: function () {
          this.next('closed')
        },
        release: function () {
          this.next('releasing')
          this.handle('release')
        },
        released: function () {
          this._release(true)
          this.next('initializing')
        },
        purged: function (result) {
          this.emit('purged', result)
          if (this.subscribed && this.subscriber) {
            this.subscribe()
              .then(
                null,
                () => {
                  this.subscribed = false
                }
              )
          } else {
            this.next('ready')
          }
        },
        subscribe: { forward: 'ready' }
      },
      releasing: {
        release: function () {
          this._release(false)
        },
        released: { next: 'released' }
      },
      released: {
        onEntry: function () {
          this.subscribed = false
        },
        check: function (deferred) {
          deferred.reject(new Error(
            `Cannot establish queue '${this.name}' after intentionally closing its connection`
          ))
        },
        purge: function () {
          this.emit('purgeFailed', new Error(
            `Cannot purge to queue '${this.name}' after intentionally closing its connection`
          ))
        },
        release: function () {
          this.emit('released')
        },
        subscribe: function () {
          this.emit('subscribeFailed', new Error(
            `Cannot subscribe to queue '${this.name}' after intentionally closing its connection`
          ))
        }
      },
      subscribing: {
        onEntry: function() {
          return this.subscriber()
        },
        closed: { next: 'closed' },
        //purge: { deferUntil: 'ready' },
        release: function () {
          this.next('releasing')
          this.handle('release')
        },
        released: function () {
          this._release(true)
          this.next('initializing')
        },
        subscribe: { next: 'subscribed' },
        subscribed: { forward: 'subscribed' }
      },
      subscribed: {
        check: function (deferred) {
          deferred.resolve()
        },
        closed: { next: 'closed' },
        purge: { forward: 'ready' },
        release: function () {
          this.next('releasing')
          this.handle('release')
        },
        released: function () {
          this._release(true)
          this.next('initializing')
        },
        subscribed: function () {
          this.subscribed = true
          this.emit('subscribed', {})
        }
      },
      unreachable: {
        check: function (deferred) {
          deferred.reject(new Error(
            `Cannot establish queue '${this.name}' when no nodes can be reached`
          ))
        },
        purge: function () {
          this.emit('purgeFailed', new Error(
            `Cannot purge queue '${this.name}' when no nodes can be reached`
          ))
        },
        subscribe: function (sub) {
          this.emit('subscribeFailed', new Error(
            `Cannot subscribe to queue '${this.name}' when no nodes can be reached`
          ))
        }
      }
    }
  }
}

const Factory = function (options, connection, topology, serializers, queueFn) {
  // allows us to optionally provide a mock
  queueFn = queueFn || require('./amqp/queue')
  const queue = fsm(getDefinition(options, connection, topology, serializers, queueFn))
  connection.addQueue(queue)
  return queue
}

Factory.type = 'queue'

module.exports = Factory
