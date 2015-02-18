var _ = require( 'lodash' );
var when = require( 'when' );
var machina = require( 'machina' )( _ );
var Monologue = require( 'monologue.js' )( _ );
var log = require( './log.js' )( 'wascally:queue' );

var Channel = function( options, connection, topology, channelFn ) {

	// allows us to optionally provide a mock
	channelFn = channelFn || require( './amqp/queue' );

	var Fsm = machina.Fsm.extend( {
		name: options.name,
		channel: undefined,
		responseSubscriptions: {},
		signalSubscription: undefined,
		handlers: [],

		check: function() {
			return when.promise( function( resolve, reject ) {
				this.on( 'defined', function() {
					resolve();
				} ).once();
				this.on( 'failed', function( err ) {
					reject( err );
				} ).once();
				this.handle( 'check' );
			}.bind( this ) );
		},

		destroy: function() {
			log.debug( 'Destroy called on queue %s - %s (%d messages pending)',
				this.name, connection.name, this.channel.getMessageCount() );
			return this.channel.destroy()
				.then( function() {
					this.transition( 'destroyed' );
				}.bind( this ) );
		},

		subscribe: function() {
			return when.promise( function( resolve, reject ) {
				var op = function() {
					return this.channel.subscribe()
						.then( resolve, reject );
				}.bind( this );
				this.on( 'failed', function( err ) {
					reject( err );
				} ).once();
				this.handle( 'subscribe', op );
			}.bind( this ) );
		},

		initialState: 'initializing',
		states: {
			'destroyed': {
				_onEnter: function() {
					if ( this.channel.getMessageCount() > 0 ) {
						log.warn( '!!! Queue %s - %s was destroyed with %d pending messages !!!',
							options.name, connection.name, this.channel.getMessageCount() );
					} else {
						log.info( 'Destroyed queue %s - %s', options.name, connection.name );
					}
					_.each( this.handlers, function( handle ) {
						handle.unsubscribe();
					} );
					this.channel = undefined;
					this.emit( 'destroyed' );
				},
				check: function() {
					this.transition( 'initializing' );
					this.deferUntilTransition( 'ready' );
				},
			},
			'failed': {
				_onEnter: function() {
					this.emit( 'failed', this.failedWith );
					this.channel = undefined;
				},
				check: function() {
					this.emit( 'failed', this.failedWith );
				},
				subscribe: function() {
					this.emit( 'failed', this.failedWith );
				}
			},
			'initializing': {
				_onEnter: function() {
					this.channel = channelFn( options, topology );
					var onError = function( err ) {
						this.failedWith = err;
						this.transition( 'failed' );
					}.bind( this );
					var onDefined = function() {
						this.transition( 'ready' );
					}.bind( this );
					this.channel.define()
						.then( onDefined, onError );
					this.handlers.push( this.channel.channel.on( 'released', function() {
						this.handle( 'released' );
					}.bind( this ) ) );
				},
				check: function() {
					this.deferUntilTransition( 'ready' );
				},
				released: function() {
					this.channel.destroy( true );
					this.transition( 'initializing' );
				},
				subscribe: function() {
					this.deferUntilTransition( 'ready' );
				}
			},
			'ready': {
				_onEnter: function() {
					this.emit( 'defined' );
				},
				check: function() {
					this.emit( 'defined' );
				},
				released: function() {
					this.channel.destroy( true );
					this.transition( 'initializing' );
				},
				subscribe: function( op ) {
					op()
						.then( function() {
							log.info( 'Subscription to (%s) queue %s - %s started with consumer tag %s',
								options.noAck ? 'untracked' : 'tracked',
								options.name,
								connection.name,
								this.channel.channel.tag );
						}.bind( this ) );
				}
			}
		}
	} );

	Monologue.mixin( Fsm );
	var fsm = new Fsm();
	fsm.receivedMessages = fsm.channel.messages;
	connection.addQueue( fsm );
	return fsm;
};

module.exports = Channel;
