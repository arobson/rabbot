const fsm = require('mfsm')
const format = require('util').format
const log = require('./log.js')('rabbot.connection')
const defer = require('fauxdash').future

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

function getDefinition(options, connectionFn, channelFn) {
  let connection
  let queues = []
  let exchanges = []
  const channels = {}
  return {
    init: {
      name: options.name || 'default',
      default: 'initializing',
      connected: false,
      consecutiveFailures: 0,
      connectTimeout: undefined,
      failAfter: (options.failAfter || 60) * 1000,
    },
    api: {
      initialize: function () {
        options.name = this.name
      },

      _closer: function () {
        connection.close()
      },

      _getChannel: function (name, confirm, context) {
        let channel = channels[name]
        if (!channel || /releas/.test(channel.state)) {
          return new Promise((resolve) => {
            channel = channelFn.create(connection, name, confirm)
            channels[name] = channel
            channel.on('acquired', () => {
              this._onChannel.bind(this, name, context)
              resolve(channel)
            })
            channel.on('return', (raw) => {
              this.emit('return', raw)
            })
          })
        } else {
          return Promise.resolve(channel)
        }
      },

      _onChannel: function (name, context, channel) {
        log.debug(`Acquired channel '${name}' on '${this.name}' successfully for '${context}'`)
        return channel
      },

      _onChannelFailure: function (name, context, error) {
        log.error(`Failed to create channel '${name}' on '${this.name}' for '${context}' with ${error}`)
        return Promise.reject(error)
      },

      _reconnect: function () {
        const keys = Object.keys(channels)
        const reacquisitions = keys.map((channelName) =>
          new Promise((resolve) => {
            const channel = channels[channelName]
            channel.once('acquired', function () {
              resolve(channel)
            })
            channel.acquire()
          })
        )

        const reacquired = () => {
          this.emit('reconnected')
        }

        const reacquireFailed = err => {
          connection.lastError = err
          log.error(`Could not complete reconnection of '${this.name}' due to ${err}`)
          this.forward('failed', 'failed', err)
        }

        Promise.all(reacquisitions)
          .then(
            reacquired.bind(this),
            reacquireFailed.bind(this)
          )
      },

      _replay: function (ev) {
        return function (data) {
          this.handle(ev, data)
        }.bind(this)
      },

      addQueue: function (queue) {
        queues.push(queue)
      },

      addExchange: function (exchange) {
        exchanges.push(exchange)
      },

      clearConnectionTimeout: function () {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout)
          this.connectionTimeout = null
        }
      },

      getChannel: function (name, confirm, context) {
        const deferred = defer()
        this.handle('channel', {
          name: name,
          confirm: confirm,
          context: context,
          deferred: deferred
        })
        return deferred.promise
      },

      close: function (reset) {
        log.info(`Close initiated on connection '${this.name}' '${this.currentState}'`)
        const deferred = defer()
        this.handle('close', deferred)
        return deferred.promise
          .then(function () {
            if (reset) {
              queues = []
              exchanges = []
            }
          })
      },

      connect: function () {
        this.consecutiveFailures = 0
        const deferred = defer()
        this.handle('connect', deferred)
        return deferred.promise
      },

      lastError: function () {
        return connection.lastError
      },

      setConnectionTimeout: function () {
        if (!this.connectionTimeout) {
          this.connectionTimeout = setTimeout(() => {
            this.next('unreachable')
          }, this.failAfter)
        }
      }
    },
    states: {
      initializing: {
        onEntry: function () {
          connection = connectionFn(options)
          this.setConnectionTimeout()
          connection.on('acquiring', this._replay('acquiring'))
          connection.on('acquired', this._replay('acquired'))
          connection.on('failed', e => {
            connection.lastError = e
            this._replay('failed')(e)
          })
          connection.on('closed', this._replay('closed'))
          connection.on('released', this._replay('released'))
        },
        acquiring: { next: 'connecting' },
        acquired: { next: 'connected' },
        channel: { after: 'connected' },
        close: { forward: 'closed' },
        connect: { next: 'connecting', after: 'connected' },
        failed: { next: 'connecting', after: '*' }
      },
      connecting: {
        onEntry: function () {
          this.setConnectionTimeout()
          connection.acquire()
            .then(null, function () {})
        },
        acquiring: function() {},
        acquired: { next: 'connected' },
        channel: { after: 'connected' },
        close: { after: '*' },
        connect: { after: 'connected' },
        failed: function (data) {
          this.forward('failed', 'failed', data)
        }
      },
      connected: {
        onEntry: function () {
          this.clearConnectionTimeout()
          this.uri = connection.item.uri
          this.consecutiveFailures = 0
          if (this.connected) {
            this._reconnect()
          } else {
            this.connected = true
          }
        },
        // acquired: { deferUntil: 'connecting' },
        acquired: function () {
        },
        channel: function (request) {
          this._getChannel(request.name, request.confirm, request.context)
            .then(
              request.deferred.resolve,
              request.deferred.reject
            )
        },
        close: { after: 'closed', next: 'closing' },
        connect: function (deferred) {
          deferred.resolve()
          this.emit('already-connected', connection)
        },
        failed: function (data) {
          this.forward('failed', 'failed', data)
        },
        closed: { next: 'connecting' }
      },
      closed: {
        onEntry: function () {
          this.clearConnectionTimeout()
          log.info(`Close on connection '${this.name}' resolved`)
        },
        acquiring: { next: 'connecting' },
        channel: function (request) {
          log.warn(`Channel '${request.name}' was requested for '${this.name}' which was closed by user. Request will be deferred until connection is re-established explicitly by user.`)
          this.deferUntil('connected')
        },
        close: function (deferred) {
          deferred.resolve()
          connection.release()
          this.emit('closed')
        },
        connect: { deferUntil: 'connected', next: 'connecting' },
        failed: function (data) {
          this.forward('failed', 'failed', data)
        }
      },
      closing: {
        onEntry: function () {
          const closeList = queues.concat(exchanges)
          if (closeList.length) {
            Promise
              .all(closeList.map((channel) => {
                const promy = channel.release ?
                  channel.release() :
                  Promise.resolve(true)
                return promy
              }))
              .then(() => {
                this._closer()
              })
          } else {
            this._closer()
          }
        },
        channel: function (request) {
          log.warn(`Channel '${request.name}' was requested for '${this.name}' during user initiated close. Request will be rejected.`)
          request.deferred.reject(new Error(
            `Illegal request for channel '${request.name}' during close of connection '${this.name}' initiated by user`,
          ))
        },
        connect: { deferUntil: 'closed' },
        deferUntil: { next: 'closed' },
        close: { deferUntil: 'closed' },
        closed: { next: 'closed' },
        released: { next: 'closed' }
      },
      failed: {
        onEntry: function () {
          this.setConnectionTimeout()
          this.consecutiveFailures++
          const tooManyFailures = this.consecutiveFailures >= options.retryLimit
          if (tooManyFailures) {
            this.next('unreachable')
          }
        },
        failed: function (err) {
          this.emit('failed', err)
        },
        acquiring: { next: 'connecting' },
        channel: { after: 'connected' },
        close: function (deferred) {
          deferred.resolve()
          connection.release()
          this.emit('closed')
        },
        connect: { after: 'connected', next: 'connecting' }
      },
      unreachable: {
        onEntry: function () {
          this.clearConnectionTimeout()
          connection
            .release()
        },
        connect: function () {
          this.consecutiveFailures = 0
          this.next('connecting')
        },
        close: function (deferred) {
          deferred.resolve()
          connection.release()
          this.emit('closed')
        }
      }
    }
  }
}

const Connection = function (options, connectionFn, channelFn) {
  channelFn = channelFn || require('./amqp/channel')
  connectionFn = connectionFn || require('./amqp/connection')
  return fsm(getDefinition(options, connectionFn, channelFn))
}

module.exports = Connection
