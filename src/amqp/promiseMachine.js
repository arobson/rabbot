var _ = require( 'lodash' );
var Monologue = require( 'monologue.js' );
var when = require( 'when' );
var machina = require( 'machina' );
var log = require( '../log.js' )( 'wascally.iomonad' );

var staticId = 0;

module.exports = function( factory, target, release, disposalEvent ) {
	disposalEvent = disposalEvent || 'close';
	var PromiseMachine = machina.Fsm.extend( {
		id: staticId++,
		initialState: 'acquiring',
		item: undefined,
		waitInterval: 0,
		waitMax: 5000,
		_acquire: function() {
			this.emit( 'acquiring' );
			function onAcquisitionError( err ) {
				log.debug( 'Resource acquisition failed with \'%s\'', err );
				this.emit( 'failed', err );
				this.handle( 'failed' );
			}
			function onAcquired( o ) {
				this.item = o;
				this.waitInterval = 0;
				if ( this.item.on ) {
					this.disposeHandle = this.item.once( disposalEvent, function( /* err */ ) {
						this.emit( 'lost' );
						this.transition( 'released' );
					}.bind( this ) );
					this.item.once( 'error', function( /* err */ ) {
						this.transition( 'failed' );
					}.bind( this ) );
				}
				this.transition( 'acquired' );
			}
			function onException( ex ) {
				log.debug( 'Resource acquisition failed with \'%s\'', ex );
				this.emit( 'failed', ex );
				this.handle( 'failed' );
			}
			factory()
				.then( onAcquired.bind( this ), onAcquisitionError.bind( this ) )
				.catch( onException.bind( this ) );
		},
		_dispose: function() {
			if ( this.item ) {
				if ( this.item.removeAllListeners ) {
					this.item.removeAllListeners();
				}
				if ( !this.item ) {
					return;
				}
				if ( release ) {
					release( this.item );
				} else {
					this.item.close();
				}
				this.item = undefined;
			}
		},
		acquire: function() {
			this.handle( 'acquire' );
			return this;
		},
		destroy: function() {
			if ( this.retry ) {
				clearTimeout( this.retry );
			}
			this.handle( 'destroy' );
		},
		operate: function( call, args ) {
			var op = { operation: call, argList: args, index: this.index },
				promise = when.promise( function( resolve, reject ) {
					op.resolve = resolve;
					op.reject = reject;
				} );
			this.handle( 'operate', op );
			return promise;
		},
		release: function() {
			if ( this.retry ) {
				clearTimeout( this.retry );
			}
			this.handle( 'release' );
		},
		states: {
			'acquiring': {
				_onEnter: function() {
					this._acquire();
				},
				failed: function() {
					setTimeout( function() {
						this.transition( 'failed' );
						if ( ( this.waitInterval + 100 ) < this.waitMax ) {
							this.waitInterval += 100;
						}
					}.bind( this ), this.waitInterval );
				},
				destroy: function() {
					this._dispose();
					this.transition( 'destroyed' );
				},
				release: function() {
					this._dispose();
					this.transition( 'released' );
				},
				operate: function() {
					this.deferUntilTransition( 'acquired' );
				}
			},
			'acquired': {
				_onEnter: function() {
					this.emit( 'acquired' );
				},
				destroy: function() {
					this._dispose();

					this.transition( 'destroyed' );
				},
				operate: function( call ) {
					try {
						var result = this.item[ call.operation ].apply( this.item, call.argList );
						if ( result && result.then ) {
							result
								.then( call.resolve )
								.then( null, call.reject );
						} else {
							call.resolve( result );
						}
					} catch (err) {
						call.reject( err );
					}
				},
				invalidated: function() {
					this.transition( 'acquiring' );
				},
				release: function() {
					this._dispose();
					this.transition( 'released' );
				}
			},
			'destroyed': {
				_onEnter: function() {
					this.emit( 'destroyed', this.id );
				}
			},
			'released': {
				_onEnter: function() {
					this.emit( 'released', this.id );
				},
				acquire: function() {
					this.transition( 'acquiring' );
				},
				operate: function() {
					this.deferUntilTransition( 'acquired' );
					this.transition( 'acquiring' );
				},
				destroy: function() {
					this.transition( 'destroyed' );
				}
			},
			'failed': {
				_onEnter: function() {
					this.emit( 'failed', this.lastError );
					this.retry = setTimeout( function() {
						this.transition( 'acquiring' );
						if ( ( this.waitInterval + 100 ) < this.waitMax ) {
							this.waitInterval += 100;
						}
					}.bind( this ), this.waitInterval );
				},
				destroy: function() {
					this._dispose();
					this.transition( 'destroyed' );
				},
				operate: function() {
					this.deferUntilTransition( 'acquired' );
				}
			}
		}
	} );

	Monologue.mixInto( PromiseMachine );
	var machine = new PromiseMachine();
	_.each( target.prototype, function( prop, name ) {
		if ( _.isFunction( prop ) ) {
			machine[ name ] = function() {
				var list = Array.prototype.slice.call( arguments, 0 );
				return machine.operate( name, list );
			}.bind( machine );
		}
	} );
	return machine;
};
