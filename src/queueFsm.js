var _ = require( "lodash" );
var when = require( "when" );
var machina = require( "machina" );
var format = require( "util" ).format;
var Monologue = require( "monologue.js" );
Monologue.mixInto( machina.Fsm );
var log = require( "./log.js" )( "rabbot.queue" );

/* log
	* `rabbot.queue`
	  * `debug`
	    * release called
	  * `info`
	    * subscription started
	    * queue released
	  * `warn`
	    * queue released with pending messages
*/

var Factory = function( options, connection, topology, serializers, queueFn ) {

	// allows us to optionally provide a mock
	queueFn = queueFn || require( "./amqp/queue" );

	var Fsm = machina.Fsm.extend( {
		name: options.name,
		queue: undefined,
		responseSubscriptions: {},
		signalSubscription: undefined,
		handlers: [],

		_define: function() {
			var onError = function( err ) {
				this.failedWith = err;
				this.transition( "failed" );
			}.bind( this );
			var onDefined = function() {
				this.transition( "ready" );
			}.bind( this );
			this.queue.define()
				.then( onDefined, onError );
		},

		check: function() {
			var deferred = when.defer();
			this.handle( "check", deferred );
			return deferred.promise;
		},

		release: function() {
			return when.promise( function( resolve ) {
				if( this.queue ) {
					log.debug( "Release called on queue %s - %s (%d messages pending)",
						this.name, connection.name, this.queue.getMessageCount() );
				}
				this.on( "released", function() {
					resolve();
				} ).once();
				this.handle( "release" );
			}.bind( this ) );
		},

		retry: function() {
			this.transition( 'initializing' );
		},

		subscribe: function( exclusive ) {
			options.subscribe = true;
			return when.promise( function( resolve, reject ) {
				var op = function( err ) {
					if( err ) {
						reject( err );
					} else {
						return this.queue.subscribe( exclusive )
							.then( resolve, reject );	
					}
				}.bind( this );
				this.once( "failed", function( err ) {
					reject( err );
				} );
				this.handle( "subscribe", op );
			}.bind( this ) );
		},

		initialState: "initializing",
		states: {
			closed: {
				_onEnter: function() {
					this.emit( "closed" );
				},
				check: function() {
					this.deferUntilTransition( "ready" );
					this.transition( "initializing" );
				},
				subscribe: function() {
					this.deferUntilTransition( "ready" );
				}
			},
			failed: {
				_onEnter: function() {
					this.emit( "failed", this.failedWith );
					this.queue = undefined;
				},
				check: function( deferred ) {
					if( deferred ) {
						deferred.reject( this.failedWith );
					}
					this.emit( "failed", this.failedWith );
				},
				release: function() {
					_.each( this.handlers, function( handle ) {
						handle.unsubscribe();
					} );
					if( this.queue ) {
						this.queue.release()
							.then( function() {
								this.transition( "released" );
							} );
					}
				},
				subscribe: function( op ) {
					op( this.failedWith );
				}
			},
			initializing: {
				_onEnter: function() {
					queueFn( options, topology, serializers )
						.then( function( queue ) {
							this.handle( "acquired", queue );
						}.bind( this ) );
				},
				acquired: function( queue ) {
					this.queue = queue;
					this.receivedMessages = this.queue.messages;
					this._define();
					this.handlers.push( this.queue.channel.on( "acquired", function() {
							this._define();
						}.bind( this ) ) 
					);
					this.handlers.push( this.queue.channel.on( "released", function() {
							this.handle( "released" );
						}.bind( this ) ) 
					);
					this.handlers.push( this.queue.channel.on( "closed", function() {
							this.handle( "closed" );
						}.bind( this ) ) 
					);
					this.handlers.push( connection.on( "unreachable", function( err ) {
							err = err || new Error( "Could not establish a connection to any known nodes." );
							this._onFailure( err );
							this.transition( "unreachable" );
						}.bind( this ) ) 
					);
				},
				check: function() {
					this.deferUntilTransition( "ready" );
				},
				release: function() {
					this.deferUntilTransition( "ready" );
				},
				closed: function() {
					this.deferUntilTransition( "ready" );
				},
				subscribe: function() {
					this.deferUntilTransition( "ready" );
				}
			},
			ready: {
				_onEnter: function() {
					this.emit( "defined" );
				},
				check: function( deferred ) {
					deferred.resolve();
				},
				closed: function() {
					this.transition( "closed" );
				},
				release: function() {
					this.transition( "releasing" );
				},
				released: function() {
					this.queue.release( true );
					this.transition( "initializing" );
				},
				subscribe: function( op ) {
					op()
						.then( function() {
							log.info( "Subscription to (%s) queue %s - %s started with consumer tag %s",
								options.noAck ? "untracked" : "tracked",
								options.name,
								connection.name,
								this.queue.channel.tag );
						}.bind( this ) );
				}
			},
			releasing: {
				_onEnter: function() {
					if ( this.queue.getMessageCount() > 0 ) {
						log.warn( "!!! Queue %s - %s was released with %d pending messages !!!",
							options.name, connection.name, this.queue.getMessageCount() );
					} else {
						log.info( "released queue %s - %s", options.name, connection.name );
					}
					_.each( this.handlers, function( handle ) {
						handle.unsubscribe();
					} );
					this.queue.release()
						.then( function() {
							this.queue = undefined;
							this.transition( "released" );
						}.bind( this ) );
				}
			},
			released: {
				_onEnter: function() {
					this.emit( "released" );
				},
				release: function() {
					this.emit( "released" );
				},
				check: function( deferred ) {
					deferred.reject( new Error( format( "Cannot establish queue '%s' after intentionally closing its connection", this.name ) ) );
				},
				subscribe: function( op ) {
					op( new Error( format( "Cannot subscribe to queue '%s' after intentionally closing its connection", this.name ) ) );
				}
			},
			unreachable: {
				check: function( deferred ) {
					deferred.reject( new Error( format( "Cannot establish queue '%s' when no nodes can be reached", this.name ) ) );
				},
				subscribe: function( op ) {
					op( new Error( format( "Cannot subscribe to queue '%s' when no nodes can be reached", this.name ) ) );
				}
			}
		}
	} );

	var fsm = new Fsm();
	connection.addQueue( fsm );
	return fsm;
};

module.exports = Factory;
