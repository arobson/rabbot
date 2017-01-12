var amqp = require( "amqplib" );
var _ = require( "lodash" );
var fs = require( "fs" );
var when = require( "when" );
var AmqpConnection = require( "amqplib/lib/callback_model" ).CallbackModel;
var monad = require( "./iomonad" );
var log = require( "../log" )( "rabbot.connection" );
var info = require( "../info" );
var url = require( "url" );

/* log
	* `rabbot.amqp-connection`
	  * `debug`
	    * when amqplib's `connection.close` promise is rejected
	 * `info`
	    * connection attempt
	    * connection success
	    * connection failure
	    * no reachable endpoints
*/

function getArgs( fn ) {
	var fnString = fn.toString();
	return _.map( /[(]([^)]*)[)]/.exec( fnString )[ 1 ].split( ',' ), function( x ) {
		return String.prototype.trim.bind( x )();
	} );
}

function getOption( opts, key, alt ) {
	if ( opts.get && supportsDefaults( opts.get ) ) {
		return opts.get( key, alt );
	} else {
		return opts[ key ] || alt;
	}
}

function getUri( protocol, user, pass, server, port, vhost, heartbeat ) {
	return protocol + user + ":" + pass +
		"@" + server + ":" + port + "/" + vhost +
		"?heartbeat=" + heartbeat;
}

function parseUri( uri ) {
	if( uri ) {
		var parsed = url.parse( uri );
		var authSplit = parsed.auth ? parsed.auth.split( ":" ) : [ null, null ];
		var heartbeat = parsed.query ? parsed.query.split( "&" )[ 0 ].split( "=" )[ 1 ] : null;
		return {
			useSSL: parsed.protocol === "amqps:",
			user: authSplit[ 0 ],
			pass: authSplit[ 1 ],
			host: parsed.hostname,
			port: parsed.port,
			vhost: parsed.pathname ? parsed.pathname.slice( 1 ) : undefined,
			heartbeat: heartbeat
		};
	}
}

function split( x ) {
	if ( _.isNumber( x ) ) {
		return [ x ];
	} else if ( _.isArray( x ) ) {
		return x;
	} else {
		return x.split( "," ).map( trim );
	}
}

function supportsDefaults( opts ) {
	return opts.get && getArgs( opts.get ).length > 1;
}

function trim( x ) {
	return x.trim( ' ' );
}

var Adapter = function( parameters ) {
	var uriOpts = parseUri( parameters.uri );
	_.merge( parameters, uriOpts );
	var hosts = getOption( parameters, "host" );
	var servers = getOption( parameters, "server" );
	var brokers = getOption( parameters, "RABBIT_BROKER" );
	var serverList = brokers || hosts || servers || "localhost";
	var portList = getOption( parameters, "RABBIT_PORT" ) || getOption( parameters, "port", 5672 );

	this.name = parameters ? ( parameters.name || "default" ) : "default";
	this.connectionIndex = 0;
	this.servers = split( serverList );
	this.ports = split( portList );
	this.heartbeat = getOption( parameters, "RABBIT_HEARTBEAT" ) || getOption( parameters, "heartbeat", 30 );
	this.protocol = getOption( parameters, "RABBIT_PROTOCOL" ) || getOption( parameters, "protocol", "amqp://" );
	this.pass = getOption( parameters, "RABBIT_PASSWORD" ) || getOption( parameters, "pass", "guest" );
	this.user = getOption( parameters, "RABBIT_USER" ) || getOption( parameters, "user", "guest" );
	this.vhost = getOption( parameters, "RABBIT_VHOST" ) || getOption( parameters, "vhost", "%2f" );
	var timeout = getOption( parameters, "RABBIT_TIMEOUT" ) || getOption( parameters, "timeout", 2000 );
	var certPath = getOption( parameters, "RABBIT_CERT" ) || getOption( parameters, "certPath" );
	var keyPath = getOption( parameters, "RABBIT_KEY" ) || getOption( parameters, "keyPath" );
	var caPaths = getOption( parameters, "RABBIT_CA" ) || getOption( parameters, "caPath" );
	var passphrase = getOption( parameters, "RABBIT_PASSPHRASE" ) || getOption( parameters, "passphrase" );
	var pfxPath = getOption( parameters, "RABBIT_PFX" ) || getOption( parameters, "pfxPath" );
	var useSSL = certPath || keyPath || passphrase || caPaths || pfxPath;
	this.options = { noDelay: true };
	if ( timeout ) {
		this.options.timeout = timeout;
	}
	if ( certPath ) {
		this.options.cert = fs.existsSync(certPath)? fs.readFileSync( certPath ) : certPath;
	}
	if ( keyPath ) {
		this.options.key = fs.existsSync(keyPath)? fs.readFileSync( keyPath ) : keyPath;
	}
	if ( passphrase ) {
		this.options.passphrase = passphrase;
	}
	if ( pfxPath ) {
		this.options.pfx = fs.existsSync(pfxPath)? fs.readFileSync( pfxPath ) : pfxPath;
	}
	if ( caPaths ) {
		var list = caPaths.split( ',' );
		this.options.ca = _.map( list, function( caPath ) {
			return fs.existsSync(caPath)? fs.readFileSync( caPath ) : caPath;
		} );
	}
	if ( useSSL ) {
		this.protocol = 'amqps://';
	}
	this.options.clientProperties = {
		host: info.host(),
		process: info.process(),
		lib: info.lib()
	};
	this.limit = _.max( [ this.servers.length, this.ports.length ] );
};

Adapter.prototype.connect = function() {
	return when.promise( function( resolve, reject ) {
		var attempted = [];
		var attempt;
		attempt = function() {
			var nextUri = this.getNextUri();
			log.info( "Attempting connection to '%s' (%s)", this.name, nextUri );
			function onConnection( connection ) {
				connection.uri = nextUri;
				log.info( "Connected to '%s' (%s)", this.name, nextUri );
				resolve( connection );
			}
			function onConnectionError( err ) {
				log.info( "Failed to connect to '%s' (%s) with, '%s'", this.name, nextUri, err );
				attempted.push( nextUri );
				this.bumpIndex();
				if( attempted.length < this.limit ) {
					attempt( err );
				} else {
					log.info( "Cannot connect to `%s` - all endpoints failed", this.name );
					reject( "No endpoints could be reached" );
				}
			}
			if ( _.indexOf( attempted, nextUri ) < 0 ) {
				amqp.connect( nextUri, Object.assign( { servername: url.parse(nextUri).hostname }, this.options ))
					.then( onConnection.bind( this ), onConnectionError.bind( this ) );
			} else {
				log.info( "Cannot connect to `%s` - all endpoints failed", this.name );
				reject( "No endpoints could be reached" );
			}
		}.bind( this );
		attempt();
	}.bind( this ) );
};

Adapter.prototype.bumpIndex = function() {
	if ( this.limit - 1 > this.connectionIndex ) {
		this.connectionIndex++;
	} else {
		this.connectionIndex = 0;
	}
};

Adapter.prototype.getNextUri = function() {
	var server = this.getNext( this.servers );
	var port = this.getNext( this.ports );
	var uri = getUri( this.protocol, this.user, escape( this.pass ), server, port, this.vhost, this.heartbeat );
	return uri;
};

Adapter.prototype.getNext = function( list ) {
	if ( this.connectionIndex >= list.length ) {
		return list[ 0 ];
	} else {
		return list[ this.connectionIndex ];
	}
};

module.exports = function( options ) {
	var close = function( connection ) {
		connection.close()
			.then( null, function( err ) {
				// for some reason calling close always gets a rejected promise
				// I can't imagine a good reason for this, so I'm basically
				// only showing this at the debug level
				log.debug( "Error was reported during close of connection `%s` - `%s`", options.name, err );
			} );
	};
	var adapter = new Adapter( options );
	return monad( options.name, "connection", adapter.connect.bind( adapter ), AmqpConnection, close );
};
