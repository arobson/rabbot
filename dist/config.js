import log from './log.js';
const logger = log('rabbot.configuration');
export default function configMixin(Broker) {
    Broker.prototype.configure = function (config) {
        const emit = this.emit.bind(this);
        const configName = config.name || 'default';
        this.configurations[configName] = config;
        this.configuring[configName] = new Promise((resolve, reject) => {
            const onExchangeError = (connection, err) => {
                logger.error('Configuration of %s failed due to an error in one or more exchange settings: %s', connection.name, err);
                reject(err);
            };
            const onQueueError = (connection, err) => {
                logger.error('Configuration of %s failed due to an error in one or more queue settings: %s', connection.name, err.stack);
                reject(err);
            };
            const onBindingError = (connection, err) => {
                logger.error('Configuration of %s failed due to an error in one or more bindings: %s', connection.name, err.stack);
                reject(err);
            };
            const createExchanges = (connection) => {
                connection.configureExchanges(config.exchanges)
                    .then(() => createQueues(connection), (err) => onExchangeError(connection, err));
            };
            const createQueues = (connection) => {
                connection.configureQueues(config.queues)
                    .then(() => createBindings(connection), (err) => onQueueError(connection, err));
            };
            const createBindings = (connection) => {
                connection.configureBindings(config.bindings, connection.name)
                    .then(() => finish(connection), (err) => onBindingError(connection, err));
            };
            const finish = (connection) => {
                emit(connection.name + '.connection.configured', connection);
                resolve();
            };
            this.addConnection(config.connection)
                .then((connection) => {
                createExchanges(connection);
                return connection;
            }, reject);
        });
        return this.configuring[configName];
    };
}
//# sourceMappingURL=config.js.map