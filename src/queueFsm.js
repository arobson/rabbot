var _ = require( 'lodash' );
var when = require( 'when' );
var machina = require( 'machina' );
var Monologue = require( 'monologue.js' );
Monologue.mixInto( machina.Fsm );
var log = require( './log.js' )( 'wascally.queue' );

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
			var deferred = when.defer();
			this.handle( 'check', deferred );
			return deferred.promise;
		},

		destroy: function() {
			return when.promise( function( resolve ) {
				log.debug( 'Destroy called on queue %s - %s (%d messages pending)',
					this.name, connection.name, this.channel.getMessageCount() );
				this.on( 'destroyed', function() {
					resolve();
				} ).once();
				this.handle( 'destroy' );
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
					this.channel.destroy()
						.then( function() {
							this.channel = undefined;
							this.emit( 'destroyed' );
						}.bind( this ) );
				},
				destroy: function() {
					this.emit( 'destroyed' );
				},
				check: function() {
					this.deferUntilTransition( 'ready' );
					this.transition( 'initializing' );
				},
			},
			'failed': {
				_onEnter: function() {
					this.emit( 'failed', this.failedWith );
					this.channel = undefined;
				},
				check: function( deferred ) {
					if( deferred ) {
						deferred.reject( this.failedWith );
					}
				},
				destroy: function() {
					this.deferUntilTransition( 'ready' );
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
				destroy: function() {
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
				check: function( deferred ) {
					deferred.resolve();
				},
				destroy: function() {
					this.transition( 'destroyed' );
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

	var fsm = new Fsm();
	fsm.receivedMessages = fsm.channel.messages;
	connection.addQueue( fsm );
	return fsm;
};

module.exports = Channel;
