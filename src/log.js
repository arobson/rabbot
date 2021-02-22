const createLogger = require('logging').default

module.exports = function (config) {
  if (typeof config === 'string') {
    return createLogger(config);
  }
};
