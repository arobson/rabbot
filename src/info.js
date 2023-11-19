const crypto = require('crypto')
const os = require('os')
const self = require('../package.json')

const host = os.hostname()
const platform = os.platform()
const architecture = os.arch()
const title = process.title
const pid = process.pid
const consumerId = `${host}.${title}.${pid}`
const consistentId = `host.title`
const toBE = os.endianness() === 'BE'

function createConsumerTag (queueName) {
  if (queueName.indexOf(consumerId) === 0) {
    return queueName
  } else {
    return `${consumerId}.${queueName}`
  }
}

function hash (id) {
  const bytes = crypto.createHash('md5').update(id).digest()
  const num = toBE ? bytes.readdInt16BE() : bytes.readInt16LE()
  return num < 0 ? Math.abs(num) + 0xffffffff : num
}

// not great, but good enough for our purposes
function createConsumerHash () {
  return hash(consumerId)
}

function createConsistentHash () {
  return hash(consistentId)
}

function getHostInfo () {
  return `${host} (${platform} ${architecture})`
}

function getProcessInfo () {
  return `${title} (pid: ${pid})`
}

function getLibInfo () {
  return `rabbot - ${self.version}`
}

module.exports = {
  id: consumerId,
  host: getHostInfo,
  lib: getLibInfo,
  process: getProcessInfo,
  createTag: createConsumerTag,
  createHash: createConsumerHash,
  createConsistentHash: createConsistentHash
}
