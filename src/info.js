import crypto from 'node:crypto';
import os from 'node:os';
import { format } from 'node:util';
import { createRequire } from 'node:module';

// semistandard's bundled ESLint (v8) doesn't parse import-attribute syntax
// (`with { type: 'json' }`), so this uses the createRequire interop instead.
const require = createRequire(import.meta.url);
const self = require('../package.json');

const host = os.hostname();
const platform = os.platform();
const architecture = os.arch();
const title = process.title;
const pid = process.pid;
const consumerId = format('%s.%s.%s', host, title, pid);
const consistentId = format('%s.%s', host, title);
const toBE = os.endianness() === 'BE';

function createConsumerTag (queueName) {
  if (queueName.indexOf(consumerId) === 0) {
    return queueName;
  } else {
    return format('%s.%s', consumerId, queueName);
  }
}

function hash (id) {
  // md4 is unavailable under OpenSSL 3.x's default provider (Node >=17);
  // sha1 is only used here as a fast, well-supported digest to derive a
  // short, stable-ish suffix - not for any cryptographic purpose.
  const bytes = crypto.createHash('sha1').update(id).digest();
  const num = toBE ? bytes.readdInt16BE() : bytes.readInt16LE();
  return num < 0 ? Math.abs(num) + 0xffffffff : num;
}

// not great, but good enough for our purposes
function createConsumerHash () {
  return hash(consumerId);
}

function createConsistentHash () {
  return hash(consistentId);
}

function getHostInfo () {
  return format('%s (%s %s)', host, platform, architecture);
}

function getProcessInfo () {
  return format('%s (pid: %d)', title, pid);
}

function getLibInfo () {
  return format('rabbot - %s', self.version);
}

export default {
  id: consumerId,
  host: getHostInfo,
  lib: getLibInfo,
  process: getProcessInfo,
  createTag: createConsumerTag,
  createHash: createConsumerHash,
  createConsistentHash
};
