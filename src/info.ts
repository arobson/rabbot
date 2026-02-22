import { createHash as cryptoHash } from 'crypto';
import { hostname, platform, arch, endianness } from 'os';
import { format } from 'util';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as { version: string };

const host = hostname();
const plat = platform();
const architecture = arch();
const title = process.title;
const pid = process.pid;
const consumerId = format('%s.%s.%s', host, title, pid);
const consistentId = format('%s.%s', host, title);
const toBE = endianness() === 'BE';

export function createConsumerTag(queueName: string): string {
  if (queueName.indexOf(consumerId) === 0) {
    return queueName;
  } else {
    return format('%s.%s', consumerId, queueName);
  }
}

function hash(id: string): number {
  const bytes = cryptoHash('sha256').update(id).digest();
  const num = toBE ? bytes.readInt16BE() : bytes.readInt16LE();
  return num < 0 ? Math.abs(num) + 0xffffffff : num;
}

export function createConsumerHash(): number {
  return hash(consumerId);
}

export function createConsistentHash(): number {
  return hash(consistentId);
}

export function getHostInfo(): string {
  return format('%s (%s %s)', host, plat, architecture);
}

export function getProcessInfo(): string {
  return format('%s (pid: %d)', title, pid);
}

export function getLibInfo(): string {
  return format('rabbot - %s', pkg.version);
}

export const id = consumerId;
export const hostInfo = getHostInfo;
export const libInfo = getLibInfo;
export const processInfo = getProcessInfo;
export const createTag = createConsumerTag;
export const createHash = createConsumerHash;

export default {
  id: consumerId,
  host: getHostInfo,
  lib: getLibInfo,
  process: getProcessInfo,
  createTag: createConsumerTag,
  createHash: createConsumerHash,
  createConsistentHash,
};
