var _ = require( 'lodash' );
var when = require( 'when' );
var machina = require( 'machina' )( _ );
var Monologue = require( 'monologue.js' )( _ );
var publishLog = require( './publishLog' );
var exLog = require( './log.js' )( 'wascally:exchange' );

var Channel = function( options, connection, topology, channelFn ) {

	// allows us to optionally provide a mock
	channelFn = channelFn || require( './amqp/exchange' );

	var Fsm = machina.Fsm.extend( {
		name: options.name,
		type: options.type,
		channel: undefined,
		handlers: [],
		deferred: [],
		published: publishLog(),

		_define: function( stateOnDefined ) {
			function onDefinitionError( err ) {
				this.failedWith = err;
				this.transition( 'failed' );
			}
			function onDefined() {
				this.transition( stateOnDefined );
			}
			this.channel.define()
				.then( onDefined.bind( this ), onDefinitionError.bind( this ) );
		},

		_listen: function() {
			this.handlers.push( topology.on( 'bindings-completed', function() {
				this.handle( 'bindings-completed' );
			}.bind( this ) ) );
			this.handlers.push( connection.on( 'reconnected', function() {
				this.transition( 'reconnecting' );
			}.bind( this ) ) );
			this.handlers.push( this.on( 'failed', function( err ) {
				_.each( this.deferred, function( x ) {
					x( err );
				} );
				this.deferred = [];
			}.bind( this ) ) );
		},

		_removeDeferred: function( reject ) {
			var index = _.indexOf( this.deferred, reject );
			if ( index >= 0 ) {
				this.deferred.splice( index, 1 );
			}
		},

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
			exLog.debug( 'Destroy called on exchange %s - %s (%d messages pending)', this.name, connection.name, this.published.count() );
			this.transition( 'destroying' );
			if ( this.channel ) {
				return this.channel.destroy()
					.then( function() {
						this.transition( 'destroyed' );
					}.bind( this ) );
			} else {
				this.transition( 'destroyed' );
				return when.resolve();
			}
		},

		publish: function( message ) {
			exLog.info( 'Publish called in state', this.state );
			return when.promise( function( resolve, reject ) {
				function onPublished() {
					resolve();
					this._removeDeferred( reject );
				}
				function onRejected( err ) {
					reject( err );
					this._removeDeferred( reject );
				}
				var op = function() {
					return this.channel.publish( message )
						.then( onPublished.bind( this ), onRejected.bind( this ) );
				}.bind( this );
				this.deferred.push( reject );
				this.handle( 'publish', op );
			}.bind( this ) );
		},

		republish: function() {
			var undelivered = this.published.reset();
			if ( undelivered.length > 0 ) {
				var promises = _.map( undelivered, this.channel.publish.bind( this.channel ) );
				return when.all( promises );
			} else {
				return when( true );
			}
		},

		initialState: 'setup',
		states: {
			'setup': {
				_onEnter: function() {
					this._listen();
					this.transition( 'initializing' );
				}
			},
			'destroying': {
				publish: function() {
					this.deferUntilTransition( 'destroyed' );
				}
			},
			'destroyed': {
				_onEnter: function() {
					if ( this.published.count() > 0 ) {
						exLog.warn( '%s exchange %s - %s was destroyed with %d messages unconfirmed',
							this.type,
							this.name,
							connection.name,
							this.published.count() );
					}
					_.each( this.handlers, function( handle ) {
						handle.unsubscribe();
					} );
					this.channel = undefined;
				},
				'bindings-completed': function() {
					this.deferUntilTransition( 'reconnected' );
				},
				check: function() {
					this.deferUntilTransition( 'ready' );
				},
				publish: function() {
					this.transition( 'reconnecting' );
					this.deferUntilTransition( 'ready' );
				}
			},
			'initializing': {
				_onEnter: function() {
					this.channel = channelFn( options, topology, this.published );
					this.channel.channel.once( 'released', function() {
						this.handle( 'released' );
					}.bind( this ) );
					this._define( 'ready' );
				},
				check: function() {
					this.deferUntilTransition( 'ready' );
				},
				released: function() {
					this.transition( 'initializing' );
				},
				publish: function() {
					this.deferUntilTransition( 'ready' );
				}
			},
			'failed': {
				_onEnter: function() {
					this.emit( 'failed', this.failedWith );
					this.channel = undefined;
				},
				check: function() {
					this.emit( 'failed', this.failedWith );
				},
				publish: function() {
					this.emit( 'failed', this.failedWith );
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
					this.transition( 'initializing' );
				},
				publish: function( op ) {
					op();
				}
			},
			'reconnecting': {
				_onEnter: function() {
					this._listen();
					this.channel = channelFn( options, topology, this.published );
					this._define( 'reconnected' );
				},
				'bindings-completed': function() {
					this.deferUntilTransition( 'reconnected' );
				},
				check: function() {
					this.deferUntilTransition( 'ready' );
				},
				publish: function() {
					this.deferUntilTransition( 'ready' );
				}
			},
			'reconnected': {
				_onEnter: function() {
					this.emit( 'defined' );
				},
				'bindings-completed': function() {
					var onRepublished = function() {
						this.transition( 'ready' );
					}.bind( this );
					var onRepublishFailed = function( err ) {
						exLog.error( 'Failed to republish %d messages on %s exchange, %s - %s with: %s',
							this.published.count(),
							this.type,
							this.name,
							connection.name,
							err );
					}.bind( this );
					this.republish()
						.then( onRepublished, onRepublishFailed );
				},
				check: function() {
					this.deferUntilTransition( 'ready' );
				},
				publish: function() {
					this.deferUntilTransition( 'ready' );
				},
				released: function() {
					this.transition( 'initializing' );
				},
			}
		}
	} );

	Monologue.mixin( Fsm );
	var fsm = new Fsm();
	connection.addExchange( fsm );
	return fsm;
};

module.exports = Channel;
