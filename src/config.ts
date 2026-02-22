import log from './log.js';

const logger = log('rabbot.configuration');

interface Config {
  name?: string;
  connection?: unknown;
  exchanges?: unknown;
  queues?: unknown;
  bindings?: unknown;
}

interface BrokerLike {
  configurations: Record<string, Config>;
  configuring: Record<string, Promise<void>>;
  addConnection: (opts: unknown) => Promise<{ name: string; configureExchanges: (def: unknown) => Promise<void>; configureQueues: (def: unknown) => Promise<void>; configureBindings: (def: unknown, name: string) => Promise<void> }>;
  emit: (event: string, data: unknown) => void;
  configure: (config: Config) => Promise<void>;
}

export default function configMixin(Broker: { prototype: BrokerLike }): void {
  Broker.prototype.configure = function (this: BrokerLike, config: Config): Promise<void> {
    const emit = this.emit.bind(this);
    const configName = config.name || 'default';
    this.configurations[configName] = config;
    this.configuring[configName] = new Promise<void>((resolve, reject) => {
      type ConnType = { name: string; configureExchanges: (def: unknown) => Promise<void>; configureQueues: (def: unknown) => Promise<void>; configureBindings: (def: unknown, name: string) => Promise<void> };

      const onExchangeError = (connection: { name: string }, err: unknown) => {
        logger.error('Configuration of %s failed due to an error in one or more exchange settings: %s', connection.name, err);
        reject(err);
      };

      const onQueueError = (connection: { name: string }, err: unknown) => {
        logger.error('Configuration of %s failed due to an error in one or more queue settings: %s', connection.name, (err as Error).stack);
        reject(err);
      };

      const onBindingError = (connection: { name: string }, err: unknown) => {
        logger.error('Configuration of %s failed due to an error in one or more bindings: %s', connection.name, (err as Error).stack);
        reject(err);
      };

      const createExchanges = (connection: ConnType) => {
        connection.configureExchanges(config.exchanges)
          .then(
            () => createQueues(connection),
            (err: unknown) => onExchangeError(connection, err)
          );
      };

      const createQueues = (connection: ConnType) => {
        connection.configureQueues(config.queues)
          .then(
            () => createBindings(connection),
            (err: unknown) => onQueueError(connection, err)
          );
      };

      const createBindings = (connection: ConnType) => {
        connection.configureBindings(config.bindings, connection.name)
          .then(
            () => finish(connection),
            (err: unknown) => onBindingError(connection, err)
          );
      };

      const finish = (connection: { name: string }) => {
        emit(connection.name + '.connection.configured', connection);
        resolve();
      };

      this.addConnection(config.connection)
        .then(
          (connection) => {
            createExchanges(connection);
            return connection;
          },
          reject
        );
    });
    return this.configuring[configName];
  };
}
