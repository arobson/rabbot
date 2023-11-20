const AmqpChannel = require('amqplib/lib/callback_model').Channel
const monad = require('./iomonad.js')
const log = require('../log')('rabbot.channel')

/* log
  * `rabbot.channel`
    * `debug`
      * when amqplib's `channel.close` promise is rejected
*/

function close (name, channel) {
  if (channel.close) {
    return channel.close()
      .then(null, function (err) {
        // since calling close on channel could reject the promise
        // (see connection close's comment) this catches and logs it
        // for debug level
        log.debug(
          `Error was reported during close of connection '${name}' - '${err}'`
        )
      })
  } else {
    return Promise.resolve()
  }
}

module.exports = {
  create: function (connection, name, confirm) {
    const method = confirm ? 'createConfirmChannel' : 'createChannel'
    const factory = function () {
      return connection[method]()
    }
    const channel = monad({ name }, 'channel', factory, AmqpChannel, close.bind(null, name))
    return channel
  }
}
