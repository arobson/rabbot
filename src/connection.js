var _ = require( 'lodash' ),
	amqp = require( 'amqplib' ),
	Monologue = require( 'monologue.js' )( _ ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' ),
	bunyan = require( 'bunyan' ),
	fs = require( 'fs' );

	var trim = function( x ) { return x.trim( ' ' ); },
		split = function( x ) {
			if( _.isNumber( x ) ) {
				return [ x ];
			} else if( _.isArray( x ) ) {
				return x;
			} else {
				return x.split( ',' ).map( trim );
			}
		};

	var Connection = function( options, broker ) {
		options = options || {};
		this.channels = {};
		this.exchanges = {};
		this.queues = {};
		this.consuming = [];
		this.reconnectTasks = [];
		_.map( options, function( val, key ) {
			this[ key ] = val;
		}.bind( this ) );
		this.name = options.name || 'default';
		this.broker = broker;
		this.connectionIndex = 0;

		var server = this.server || this.RABBIT_BROKER || 'localhost',
			port = this.port || this.RABBIT_PORT || 5672;

		this.servers = split( server );
		this.ports = split( port );
		this.limit = _.max( [ this.servers.length, this.ports.length ] );
	};

	Connection.prototype.bumpIndex = function() {
		if( this.limit - 1 > this.connectionIndex ) {
			this.connectionIndex ++;
		} else {
			this.connectionIndex = 0;
		}
	};

	Connection.prototype.getPort = function() {
		if( this.connectionIndex >= this.ports.length ) {
			return this.ports[ 0 ];
		} else {
			return this.ports[ this.connectionIndex ];
		}
	}

	Connection.prototype.getServer = function() {
		if( this.connectionIndex >= this.servers.length ) {
			return this.servers[ 0 ];
		} else {
			return this.servers[ this.connectionIndex ];
		}
	}

	Connection.prototype.getUri = function( server, port ) {
		return ( this.RABBIT_PROTOCOL || 'amqp://' ) +
			( this.user || this.RABBIT_USER || 'guest' ) +
			':' +
			( this.pass || this.RABBIT_PASSWORD || 'guest' ) +
			'@' + server + ':' + port + '/' +
			( this.vhost || this.RABBIT_VHOST || '%2f' ) +
			'?heartbeat=' +
			( this.heartBeat || this.RABBIT_HEARTBEAT || 2000 );
	};

	Connection.prototype.getNextUri = function() {
		var server = this.getServer(),
			port = this.getPort();
			uri = this.getUri( server, port );
		return uri;
	};

	Connection.prototype.connect = function() {
		return when.promise( function( resolve, reject ) {
			var attempted = [];
			var nextUri;
			tryConnect = function() {
				nextUri = this.getNextUri();
				if( _.indexOf( attempted, nextUri) < 0 ) {
					this.tryUri( nextUri )
						.then( null, function( err ) {
							tryConnect();
						} )
						.then( resolve );
					attempted.push( nextUri );
				} else {
					reject( 'No endpoints could be reached' );
				}
			}.bind( this );
			tryConnect();
		}.bind( this ) );
	};

	Connection.prototype.tryUri = function( uri ) {
		return when.promise( function( resolve, reject ) {
			amqp
				.connect( uri )
				.then( function( conn ) {
					this.handle = conn;
					this.isOpen = true;
					conn.on( 'close', function() {
						this.broker.emit( this.name + '.connection.closed', this );
					}.bind( this ) );

					this.broker.emit( this.name + '.connection.opened', this );
					if ( this.name === 'default' ) {
						this.broker.emit( 'connected', this );
					}

					if ( this.reconnectTasks.length > 0 ) {
						// re-execute all reconnectTasks
						pipeline( this.reconnectTasks )
							.done( function() {
								this.broker.sendPendingMessages();
								resolve( this );
							}.bind( this ) );
					} else {
						this.broker.sendPendingMessages();
						resolve( this );
					}
				}.bind( this ) )
				.then( null, function( err ) {
					this.bumpIndex();
					this.broker.emit( this.name + '.connection.failed', {
						name: this.name,
						err: err
					} );
					this.broker.emit( 'errorLogged' );
					this.handle = undefined;
					this.broker.log.error( {
						error: err,
						reason: 'Attempt to connect with uri "' + uri + '" failed'
					} );
					reject( err );
				}.bind( this ) );
		}.bind( this ) );
	};

	Monologue.mixin( Connection );

module.exports = Connection;