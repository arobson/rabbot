var _ = require( 'lodash' ),
	amqp = require( 'amqplib' ),
	Monologue = require( 'monologue.js' )( _ ),
	when = require( 'when' ),
	pipeline = require( 'when/sequence' ),
	bunyan = require( 'bunyan' ),
	fs = require( 'fs' ),
	machina = require( 'machina' )( _ ),
	newChannel = require( './amqp/channel.js' ),
	newConnection = require( './amqp/connection.js' );

var Connection = function( options ) {
	
	var channels = {},
		definitions = {
			bindings: {},
			exchanges: {},
			queues: {},
			subscriptions: {}
		},
		connection = undefined;

	var Fsm = machina.Fsm.extend( {
		name: options.name || 'default',
		initialState: 'initializing',
		reconnected: false,
		close: function() {
			return when.promise( function( resolve, reject ) {
				this.on( 'closed', resolve );
				this.handle( 'close' );
			}.bind( this ) );
		},

		createChannel: function( confirm ) {
			this.connect();
			return newChannel.create( connection, confirm );
		},

		connect: function() {
			return when.promise( function( resolve, reject ) {
				this.on( 'connected', function() {
					resolve();
				} );
				this.handle( 'connect' );
			}.bind( this ) );
		},

		replay: function( ev ) {
			return function( x ) {
				this.handle( ev, x );
			}.bind( this );
		},

		states: {
			'initializing': {
				_onEnter: function() {
					connection = newConnection( options );
					connection.on( 'acquiring', this.replay( 'acquiring' ) );
					connection.on( 'acquired', this.replay( 'acquired' ) );
					connection.on( 'failed', this.replay( 'failed' ) );
					connection.on( 'lost', this.replay( 'lost' ) );
				},
				'acquiring': function() {
					this.transition( 'connected' ); 
				},
				'acquired': function() {
					this.transition( 'connected' );
				},
				'close': function( err ) {
					this.deferUntilTransition( 'connected' );
					this.transition( 'closed' );
				},
				'failed': function( err ) {
					this.emit( 'failed', err );
				}
			},
			'connecting': {
				_onEnter: function() {
					connection.acquire();
				},
				'acquired': function() {
					this.transition( 'connected' );
				},
				'close': function( err ) {
					this.deferUntilTransition( 'connected' );
				},
				'failed': function( err ) {
					this.emit( 'failed', err );
				}
			},
			'connected': {
				_onEnter: function() {
					if( this.reconnected ) {
						this.emit( 'reconnected' );
					}
					this.reconnected = true;
					this.emit( 'connected' );
				},
				'failed': function( err ) {
					this.emit( 'failed', err );
					this.transition( 'connecting' );
				},
				'lost': function( err ) {
					this.transition( 'connecting' );
				},
				'close': function() {
					connection.release();
					this.transition( 'closed' );
				},
				'connect': function() {
					this.emit( 'connected' );
				}
			},
			'closed': {
				_onEnter: function() {
					this.emit( 'closed', {} );
				},
				'acquiring': function() {
					this.transition( 'connecting' );
				},
				'close': function( err ) {
					connection.release();
					this.emit( 'closed' );
				},
				'connect': function() {
					this.transition( 'connecting' );
				},
				'failed': function( err ) {
					this.emit( 'failed', err );
				}
			}
		}
	} );

	Monologue.mixin( Fsm );
	return new Fsm();
};

module.exports = Connection;