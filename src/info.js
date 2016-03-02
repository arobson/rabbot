var crypto = require( "crypto" );
var os = require( "os" );
var format = require( "util" ).format;
var self = require( "../package.json" );

var host = os.hostname();
var platform = os.platform();
var architecture = os.arch();
var title = process.title;
var pid = process.pid;
var consumerId = format( '%s.%s.%s', host, title, pid );
var consistentId = format( '%s.%s', host, title );
var toBE = os.endianness() === "BE";

function createConsumerTag( queueName ) {
	if( queueName.indexOf( consumerId ) === 0 ) {
		return queueName;
	} else {
		return format( "%s.%s", consumerId, queueName );
	}
}

function hash( id ) {
	var bytes = crypto.createHash( "md4" ).update( id ).digest();
	var num = toBE ? bytes.readdInt16BE() : bytes.readInt16LE();
	return num < 0 ? Math.abs( num ) + 0xffffffff : num;
}

// not great, but good enough for our purposes
function createConsumerHash() {
	return hash( consumerId );
}

function createConsistentHash() {
	return hash( consistentId );
}

function getHostInfo() {
	return format( "%s (%s %s)", host, platform, architecture );
}

function getProcessInfo() {
	return format( "%s (pid: %d)", title, pid );
}

function getLibInfo() {
	return format( "rabbot - %s", self.version );
}

module.exports = {
	id: consumerId,
	host: getHostInfo,
	lib: getLibInfo,
	process: getProcessInfo,
	createTag: createConsumerTag,
	createHash: createConsumerHash,
	createConsistentHash: createConsistentHash
};