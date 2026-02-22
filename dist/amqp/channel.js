import createIOMonad from './iomonad.js';
import log from '../log.js';
const logger = log('rabbot.channel');
// Placeholder target for prototype proxying
class AmqpChannelTarget {
    ack(_message, _allUpTo) { }
    nack(_message, _allUpTo, _requeue) { }
    reject(_message, _requeue) { }
    prefetch(_count) { }
    publish(_exchange, _routingKey, _content, _options, _callback) { return false; }
    sendToQueue(_queue, _content, _options) { return false; }
    assertQueue(_queue, _options) { return Promise.resolve(); }
    assertExchange(_exchange, _type, _options) { return Promise.resolve(); }
    checkExchange(_exchange) { return Promise.resolve(); }
    deleteExchange(_exchange, _options) { return Promise.resolve(); }
    deleteQueue(_queue, _options) { return Promise.resolve(); }
    bindQueue(_queue, _source, _pattern, _args) { return Promise.resolve(); }
    unbindQueue(_queue, _source, _pattern, _args) { return Promise.resolve(); }
    bindExchange(_destination, _source, _pattern, _args) { return Promise.resolve(); }
    unbindExchange(_destination, _source, _pattern, _args) { return Promise.resolve(); }
    purgeQueue(_queue) { return Promise.resolve(); }
    consume(_queue, _onMessage, _options) { return Promise.resolve(); }
    cancel(_consumerTag) { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    get consumers() { return new Map(); }
    tag;
}
function closeChannel(name, channel) {
    const ch = channel;
    if (ch.close) {
        ch.close().catch((err) => {
            logger.debug('Error during close of channel `%s` - `%s`', name, err);
        });
    }
}
export default {
    create(connection, name, confirm) {
        const method = confirm ? 'createConfirmChannel' : 'createChannel';
        const factory = () => connection[method]();
        return createIOMonad({ name }, 'channel', factory, AmqpChannelTarget, closeChannel.bind(null, name));
    },
};
//# sourceMappingURL=channel.js.map