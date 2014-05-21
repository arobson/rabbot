var _ = require( 'lodash' ),
	amqp = require( 'amqplib' ),
	Monologue = require( 'monologue.js' )( _ ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' ),
	bunyan = require( 'bunyan' ),
	fs = require( 'fs' );

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
	};

	Connection.prototype.getUri = function() {
		return ( this.RABBIT_PROTOCOL || 'amqp://' ) +
			( this.user || this.RABBIT_USER || 'guest' ) +
			':' +
			( this.pass || this.RABBIT_PASSWORD || 'guest' ) +
			'@' +
			( this.server || this.RABBIT_BROKER || 'localhost' ) +
			':' +
			( this.port || this.RABBIT_PORT || 5672 ) +
			'/' +
			( this.vhost || this.RABBIT_VHOST || '%2f' ) +
			'?heartbeat=' +
			( this.heartBeat || this.RABBIT_HEARTBEAT || 2000 );
	};

	Connection.prototype.connect = function( broker ) {
		var uri = this.getUri();
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
					this.broker.emit( this.name + '.connection.failed', {
						name: this.name,
						err: err
					} );
					this.broker.emit( 'errorLogged' );
					this.handle = undefined;
					this.log.error( {
						error: err,
						reason: 'Attempt to connect with uri "' + uri + '" failed'
					} );
					reject( err );
				}.bind( this ) );
		}.bind( this ) );
	};

	Monologue.mixin( Connection );

module.exports = Connection;