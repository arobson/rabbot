import bole from 'bole';
import debugFactory from 'debug';

const log = bole;
const debug = debugFactory;
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

export default function (config) {
  if (typeof config === 'string') {
    return log(config);
  } else {
    log.output(config);
    return log;
  }
}
