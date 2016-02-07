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
var toBE = os.endianness() === "BE";

function createConsumerTag( queueName ) {
	return format( "%s.%s", consumerId, queueName );
}

// not great, but good enough for our purposes
function createConsumerHash() {
	var bytes = crypto.createHash( "md4" ).update( consumerId ).digest();
	var num = toBE ? bytes.readdInt16BE() : bytes.readInt16LE();
	return num < 0 ? Math.abs( num ) + 0xffffffff : num;
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
	createHash: createConsumerHash
};