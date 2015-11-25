var _ = require( 'lodash' );
var Monologue = require( 'monologue.js' );
var when = require( 'when' );
var machina = require( 'machina' );
var log = require( './log.js' )( 'wascally.connection' );

var Connection = function( options, connectionFn, channelFn ) {
	channelFn = channelFn || require( './amqp/channel' );
	connectionFn = connectionFn || require( './amqp/connection' );

	var connection;
	var queues = [];
	var exchanges = [];

	var Fsm = machina.Fsm.extend( {
		name: options.name || 'default',
		initialState: 'initializing',
		reconnected: false,

		_closer: function() {
			connection.close().then( function() {
				this.transition( 'closed' );
			}.bind( this ) );
		},

		addQueue: function( queue ) {
			queues.push( queue );
		},

		addExchange: function( exchange ) {
			exchanges.push( exchange );
		},

		close: function( reset ) {
			var deferred = when.defer();
			this.handle( 'close', deferred );
			return deferred.promise.then( function() {
				if( reset ) {
					queues = [];
					exchanges = [];
				}
			} );
		},

		createChannel: function( confirm ) {
			this.connect();
			return channelFn.create( connection, confirm );
		},

		connect: function() {
			var deferred = when.defer();
			this.handle( 'connect', deferred );
			return deferred.promise;
		},

		lastError: function() {
			return connection.lastError;
		},

		replay: function( ev ) {
			return function( x ) {
				this.emit( ev, x );
				this.handle( ev, x );
			}.bind( this );
		},

		states: {
			'initializing': {
				_onEnter: function() {
					connection = connectionFn( options );
					connection.on( 'acquiring', this.replay( 'acquiring' ) );
					connection.on( 'acquired', this.replay( 'acquired' ) );
					connection.on( 'failed', this.replay( 'failed' ) );
					connection.on( 'lost', this.replay( 'lost' ) );
				},
				'acquiring': function() {
					this.transition( 'connecting' );
				},
				'acquired': function() {
					this.transition( 'connected' );
				},
				'close': function() {
					this.deferUntilTransition( 'connected' );
					this.transition( 'connected' );
				},
				'connect': function() {
					this.deferUntilTransition( 'connected' );
					this.transition( 'connecting' );
				},
				'failed': function( err ) {
					this.transition( 'failed' );
					this.emit( 'failed', err );
				}
			},
			'connecting': {
				_onEnter: function() {
					setTimeout( function() {
						connection.acquire();
					}, 0 );
				},
				'acquired': function() {
					this.transition( 'connected' );
				},
				'close': function() {
					this.deferUntilTransition( 'connected' );
					this.transition( 'connected' );
				},
				'connect': function() {
					this.deferUntilTransition( 'connected' );
				},
				'failed': function( err ) {
					this.transition( 'failed' );
					this.emit( 'failed', err );
				}
			},
			'connected': {
				_onEnter: function() {
					if ( this.reconnected ) {
						this.emit( 'reconnected' );
					}
					this.reconnected = true;
					this.emit( 'connected', connection );
				},
				'failed': function( err ) {
					this.emit( 'failed', err );
					this.transition( 'connecting' );
				},
				'lost': function() {
					this.transition( 'connecting' );
				},
				'close': function() {
					this.deferUntilTransition( 'closed' );
					this.transition( 'closing' );
				},
				'connect': function( deferred ) {
					deferred.resolve();
					this.emit( 'already-connected', connection );
				}
			},
			'closed': {
				_onEnter: function() {
					log.info( 'Closed connection to %s', this.name );
					this.emit( 'closed', {} );
				},
				'acquiring': function() {
					this.transition( 'connecting' );
				},
				'close': function( deferred ) {
					deferred.resolve();
					connection.release();
					this.emit( 'closed' );
				},
				'connect': function() {
					this.deferUntilTransition( 'connected' );
					this.transition( 'connecting' );
				},
				'failed': function( err ) {
					this.emit( 'failed', err );
				}
			},
			'closing': {
				_onEnter: function() {
					var closeList = queues.concat( exchanges );
					if ( closeList.length ) {
						when.all( _.map( closeList, function( channel ) {
							return channel.destroy();
						} ) ).then( function() {
							this._closer();
						}.bind( this ) );
					} else {
						this._closer();
					}
				},
				'connect': function() {
					this.deferUntilTransition( 'closed' );
				},
				close: function() {
					this.deferUntilTransition( 'closed' );
				}
			},
			'failed': {
				'close': function( deferred ) {
					deferred.resolve();
					connection.destroy();
					this.emit( 'closed' );
				},
				'connect': function() {
					this.deferUntilTransition( 'connected' );
					this.transition( 'connecting' );
				}
			}
		}
	} );

	Monologue.mixInto( Fsm );
	return new Fsm();
};

module.exports = Connection;
