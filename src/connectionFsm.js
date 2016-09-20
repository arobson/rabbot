var _ = require( "lodash" );
var Monologue = require( "monologue.js" );
var when = require( "when" );
var machina = require( "machina" );
var format = require( "util" ).format;
var log = require( "./log.js" )( "rabbot.connection" );

/* events emitted:
	'closing' - close is initiated by user
	'closed' - initiated close has completed
	'connecting' - connection initiated
	'connected' - connection established
	'reconnected' - lost connection recovered
	'failed' - connection lost
	'unreachable' - no end points could be reached within threshold
 	'return' - published message was returned by AMQP
*/

/* logs:
    * `rabbot.connection`
	  * `debug`:
	  	* on successful acquisition of a new channel
	  * `info`:
	  	* user initiated close started
	  	* user initiated close completed
	  * `warn`:
	  	* attempt to acquire a channel during user initiated connection close
	  	* attempt to acquire a channel on a user-closed connection
	  * `error`:
	  	* on failed channel creation
	  	* failed reconnection
*/

var Connection = function( options, connectionFn, channelFn ) {
	channelFn = channelFn || require( './amqp/channel' );
	connectionFn = connectionFn || require( './amqp/connection' );

	var connection;
	var queues = [];
	var exchanges = [];
	var channels = {};

	var Fsm = machina.Fsm.extend( {
		name: options.name || "default",
		initialState: "initializing",
		connected: false,
		consecutiveFailures: 0,
		connectTimeout: undefined,
		failAfter: ( options.failAfter || 60 ) * 1000,

		initialize: function() {
			options.name = this.name;
		},

		_closer: function() {
			connection.close();
		},

		_getChannel: function ( name, confirm, context ) {
      var channel = channels[ name ];
			if ( !channel ) {
				return when.promise( function( resolve ) {
					channel = channelFn.create( connection, name, confirm );
					channels[ name ] = channel;
					channel.on( "acquired", function() {
						this._onChannel.bind( this, name, context );
						resolve( channel );
					}.bind( this ) );
					channel.on( "return", function(raw) {
						this.emit( "return", raw);
					}.bind(this));
				}.bind( this ) );
			} else {
				return when( channel );
			}
		},

		_onChannel: function( name, context, channel ) {
			log.debug( "Acquired channel '%s' on '%s' successfully for '%s'", name, this.name, context );
			return channel;
		},

		_onChannelFailure: function( name, context, error ) {
			log.error( "Failed to create channel '%s' on '%s' for '%s' with %s", name, this.name, error );
			return when.reject( error );
		},

		_reconnect: function() {
			var reacquisitions = _.map( channels, function( channel ) {
				return when.promise( function( resolve ) {
					channel.once( "acquired", function() {
						resolve( channel );
					} );
					channel.acquire();
				}.bind( this ) );
			}.bind( this ) );

			function reacquired() {
				this.emit( "reconnected" );
			}

			function reacquireFailed( err ) {
				log.error( "Could not complete reconnection of '%s' due to %s", err );
				this.transition( "failed" );
				this.handle( "failed", err );
			}

			when.all( reacquisitions )
				.then(
					reacquired.bind( this ),
					reacquireFailed.bind( this )
				);
		},

		_replay: function( ev ) {
			return function( x ) {
				this.handle( ev, x );
			}.bind( this );
		},

		addQueue: function( queue ) {
			queues.push( queue );
		},

		addExchange: function( exchange ) {
			exchanges.push( exchange );
		},

		clearConnectionTimeout: function() {
			if( this.connectionTimeout ) {
				clearTimeout( this.connectionTimeout );
				this.connectionTimeout = null;
			}
		},

		getChannel: function( name, confirm, context ) {
			var deferred = when.defer();
			this.handle( "channel", {
				name: name,
				confirm: confirm,
				context: context,
				deferred: deferred
			} );
			return deferred.promise;
		},

		close: function( reset ) {
			log.info( "Close initiated on connection '%s'", this.name );
			var deferred = when.defer();
			this.handle( "close", deferred );
			return deferred.promise
				.then( function() {
					if( reset ) {
						queues = [];
						exchanges = [];
					}
				} );
		},

		connect: function() {
			this.consecutiveFailures = 0;
			var deferred = when.defer();
			this.handle( "connect", deferred );
			return deferred.promise;
		},

		lastError: function() {
			return connection.lastError;
		},

		setConnectionTimeout: function() {
			if( !this.connectionTimeout ) {
				this.connectionTimeout = setTimeout( function() {
					this.transition( "unreachable" );
				}.bind( this ), this.failAfter );
			}
		},

		states: {
			initializing: {
				_onEnter: function() {
					connection = connectionFn( options );
					this.setConnectionTimeout();
					connection.on( "acquiring", this._replay( "acquiring" ) );
					connection.on( "acquired", this._replay( "acquired" ) );
					connection.on( "failed", this._replay( "failed" ) );
					connection.on( "closed", this._replay( "closed" ) );
					connection.on( "released", this._replay( "released" ) );
				},
				acquiring: function() {
					this.transition( "connecting" );
				},
				acquired: function() {
					this.transition( "connected" );
				},
				channel: function() {
					this.deferUntilTransition( "connected" );
				},
				close: function() {
					this.deferUntilTransition( "connected" );
					this.transition( "connected" );
				},
				connect: function() {
					this.deferUntilTransition( "connected" );
					this.transition( "connecting" );
				},
				failed: function() {
					this.deferUntilTransition();
					this.transition( "connecting" );
				}
			},
			connecting: {
				_onEnter: function() {
					this.setConnectionTimeout();
					connection.acquire()
						.then( null, function() {} );
					this.emit( "connecting" );
				},
				acquired: function() {
					this.transition( "connected" );
				},
				channel: function() {
					this.deferUntilTransition( "connected" );
				},
				close: function() {
					this.deferUntilTransition();
				},
				connect: function() {
					this.deferUntilTransition( "connected" );
				},
				failed: function() {
					this.deferUntilTransition( "failed" );
					this.transition( "failed" );
				}
			},
			connected: {
				_onEnter: function() {
					this.clearConnectionTimeout();
					this.uri = connection.item.uri;
					this.consecutiveFailures = 0;
					if ( this.connected ) {
						this._reconnect();
					}
					this.connected = true;
					this.emit( "connected", connection );
				},
				acquired: function() {
					this.deferUntilTransition( "connecting" );
				},
				channel: function( request ) {
					this._getChannel( request.name, request.confirm, request.context )
						.then(
							request.deferred.resolve,
							request.deferred.reject
						);
				},
				close: function() {
					this.deferUntilTransition( "closed" );
					this.transition( "closing" );
				},
				connect: function( deferred ) {
					deferred.resolve();
					this.emit( "already-connected", connection );
				},
				failed: function() {
					this.deferUntilTransition( "failed" );
					this.transition( "failed" );
				},
				closed: function() {
					this.transition( "connecting" );
				}
			},
			closed: {
				_onEnter: function() {
					this.clearConnectionTimeout();
					log.info( 'Close on connection \'%s\' resolved', this.name );
					this.emit( 'closed', {} );
				},
				acquiring: function() {
					this.transition( "connecting" );
				},
				channel: function() {
					log.warn( "Channel '%s' on '%s' was requested for '%s' which was closed by user. Request will be deferred until connection is re-established explicitly by user." );
					this.deferUntilTransition( "connected" );
				},
				close: function( deferred ) {
					deferred.resolve();
					connection.release();
					this.emit( "closed" );
				},
				connect: function() {
					this.deferUntilTransition( "connected" );
					this.transition( "connecting" );
				},
				failed: function() {
					this.deferUntilTransition( "failed" );
					this.transition( "failed" );
				}
			},
			closing: {
				_onEnter: function() {
					this.emit( "closing" );
					var closeList = queues.concat( exchanges );
					if ( closeList.length ) {
						when.all( _.map( closeList, function( channel ) {
							return channel.release();
						} ) ).then( function() {
							this._closer();
						}.bind( this ) );
					} else {
						this._closer();
					}
				},
				channel: function( request ) {
					log.warn( "Channel '%s' on '%s' was requested for '%s' during user initiated close. Request will be rejected." );
					request.deferred.reject( new Error(
						format( "Illegal request for channel '%s' during close of connection '%s' initiated by user",
							request.name,
							this.name
						)
					) );
				},
				connect: function() {
					this.deferUntilTransition( "closed" );
				},
				close: function() {
					this.deferUntilTransition( "closed" );
				},
				closed: function() {
					this.transition( "closed" );
				},
				released: function() {
					this.transition( "closed" );
				}
			},
			failed: {
				_onEnter: function() {
					this.setConnectionTimeout();
					this.consecutiveFailures ++;
					var tooManyFailures = this.consecutiveFailures >= options.retryLimit;
					if( tooManyFailures ) {
						this.transition( "unreachable" );
					}
				},
				failed: function( err ) {
					this.emit( "failed", err );
				},
				acquiring: function() {
					this.transition( "connecting" );
				},
				channel: function() {
					this.deferUntilTransition( "connected" );
				},
				close: function( deferred ) {
					deferred.resolve();
					connection.release();
					this.emit( "closed" );
				},
				connect: function() {
					this.deferUntilTransition( "connected" );
					this.transition( "connecting" );
				}
			},
			unreachable: {
				_onEnter: function() {
					this.clearConnectionTimeout();
					connection
						.release()
						.then( function() {
							this.emit( "unreachable" );
						}.bind( this ) );
				},
				connect: function() {
					this.consecutiveFailures = 0;
					this.transition( "connecting" );
				}
			}
		}
	} );

	Monologue.mixInto( Fsm );
	return new Fsm();
};

module.exports = Connection;
