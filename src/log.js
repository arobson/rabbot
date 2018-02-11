// var log = require( "whistlepunk" ).log;
const log = require('bole');
const debug = require('debug');
const debugEnv = process.env.DEBUG;

const debugOut = {
  write: function (data) {
    const entry = JSON.parse(data);
    debug(entry.name)(entry.level, entry.message);
  }
};

if (debugEnv) {
  log.output({
    level: 'debug',
    stream: debugOut
  });
}

module.exports = function (config) {
  if (typeof config === 'string') {
    return log(config);
  } else {
    log.output(config);
    return log;
  }
};
