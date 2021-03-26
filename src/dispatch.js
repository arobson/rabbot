const Dispatcher = require('topic-dispatch')

module.exports = {
    signal: Dispatcher(),
    received: Dispatcher(),
    replies: Dispatcher()
}
