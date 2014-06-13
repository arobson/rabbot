var _ = require( 'lodash' ),
	amqp = require( 'amqplib' ),
	Monologue = require( 'monologue.js' )( _ ),
	when = require( 'when' ),
	machina = require( 'machina' )( _ ),
	log = require( '../log.js' );


module.exports = function( factory, target, release, disposalEvent ) {
	var disposalEvent = disposalEvent || 'close';
	var PromiseMachine = machina.Fsm.extend( {
		initialState: 'acquiring',
		item: undefined,
		acquire: function() {
			this.handle( 'acquire' );
			return this;
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
			this.handle( 'release' );
		},
		states: {
			'acquiring': {
				_onEnter: function() {
					this.emit( 'acquiring' );
					factory()
						.then( function( o ) {
							this.item = o;
							if( this.item.on ) {
								this.disposeHandle = this.item.once( disposalEvent, function() {
									this.emit( 'lost' );
									this.transition( 'acquiring' );
									this.handle( 'invalidated' );
								}.bind( this ) );
							}
							this.transition( 'acquired' );
						}.bind( this ) )
						.then( null, function( err ) {
							this.lastError = err;
							log.info( { message: 'failure occured acquiring a resource', error: err.stack } );
							this.emit( 'error', err );
							this.transition( 'failed' );
						}.bind( this ) )
						.catch( function( ex ) {
							this.lastError = ex;
							log.info( { message: 'failure occured acquiring a resource', error: ex.stack } );
							this.emit( 'exception', ex );
							this.transition( 'failed' );
						} );
				},
				operate: function( call ) {
					this.deferUntilTransition( 'acquired' );
				}
			},
			'acquired': {
				_onEnter: function() {
					this.emit( 'acquired' );
				},
				operate: function( call ) {
					try {
						var result = this.item[ call.operation ].apply( this.item, call.argList );
						if( result && result.then ) {
							result
								.then( call.resolve )
								.then( null, call.reject );
						} else {
							call.resolve( result );
						}
					} catch( err ) {
						call.reject( err );
					}
				}, 
				invalidated: function() {
					this.transition( 'acquiring' );
				},
				release: function () {
					this.item.removeAllListeners();
					this.emit( 'releasing' );
					if( !this.item ) {
						return;
					}
					if( release ) {
						release( this.item );
					} else {
						this.item.close();
					}
					this.transition( 'released' );
				}
			},
			'released': {
				_onEnter: function() {
					this.emit( 'released' );
				},
				acquire: function() {
					this.transition( 'acquiring' );
				},
				operate: function( call ) {
					this.deferUntilTransition( 'acquired' );
					this.transition( 'acquiring' );
				}
			},
			'failed': {
				_onEnter: function() {
					this.emit( 'failed', this.lastError );
					this.transition( 'acquiring' );
				},
				operate: function( call ) {
					this.deferUntilTransition( 'acquired' );
				}
			}
		}
	} );

	Monologue.mixin( PromiseMachine );
	var machine = new PromiseMachine();
	_.each( target.prototype, function( prop, name ) {
		if( _.isFunction( prop ) ) {
			machine[ name ] = function() { 
				var list = Array.prototype.slice.call( arguments, 0 );
				return machine.operate( name, list );
			}.bind( machine );
		}
	} );
	return machine;
};