const log = require('./log')('rabbot.configuration');

/* log
  * `rabbot.configuration`
    * error
      * configuration failed (in exchange, queue or bindings)
*/

module.exports = function (Broker) {
  Broker.prototype.configure = function (config) {
    const emit = this.emit.bind(this);
    const configName = config.name || 'default';
    this.configurations[ configName ] = config;
    this.configuring[ configName ] = new Promise(function (resolve, reject) {
      function onExchangeError (connection, err) {
        log.error('Configuration of %s failed due to an error in one or more exchange settings: %s', connection.name, err);
        reject(err);
      }

      function onQueueError (connection, err) {
        log.error('Configuration of %s failed due to an error in one or more queue settings: %s', connection.name, err.stack);
        reject(err);
      }

      function onBindingError (connection, err) {
        log.error('Configuration of %s failed due to an error in one or more bindings: %s', connection.name, err.stack);
        reject(err);
      }

      function createExchanges (connection) {
        connection.configureExchanges(config.exchanges)
          .then(
            createQueues.bind(null, connection),
            onExchangeError.bind(null, connection)
          );
      }

      function createQueues (connection) {
        connection.configureQueues(config.queues)
          .then(
            createBindings.bind(null, connection),
            onQueueError.bind(null, connection)
          );
      }

      function createBindings (connection) {
        connection.configureBindings(config.bindings, connection.name)
          .then(
            finish.bind(null, connection),
            onBindingError.bind(null, connection)
          );
      }

      function finish (connection) {
        emit(connection.name + '.connection.configured', connection);
        resolve();
      }

      this.addConnection(config.connection)
        .then(
          function (connection) {
            createExchanges(connection);
            return connection;
          },
          reject
        );
    }.bind(this));
    return this.configuring[ configName ];
  };
};
