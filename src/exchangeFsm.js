var _ = require( "lodash" );
var when = require( "when" );
var machina = require( "machina" );
var Monologue = require( "monologue.js" );
var publishLog = require( "./publishLog" );
var exLog = require( "./log.js" )( "rabbot.exchange" );
var format = require( "util" ).format;

/* log
	* `rabbot.exchange`
	  * `debug`:
	    * release called
		* publish called
	  * `warn`:
	    * exchange was released with unconfirmed messages
		* on publish to released exchange
		* publish is rejected because exchange has reached the limit because of pending connection
 */

function unhandle( handlers ) {
  _.each( handlers, function( handle ) {
    handle.unsubscribe();
  } );
}

var Factory = function( options, connection, topology, serializers, exchangeFn ) {

	// allows us to optionally provide a mock
	exchangeFn = exchangeFn || require( "./amqp/exchange" );

	var Fsm = machina.Fsm.extend( {
		name: options.name,
		type: options.type,
		publishTimeout: options.publishTimeout || 0,
		replyTimeout: options.replyTimeout || 0,
		limit: ( options.limit || 100 ),
    publisher: undefined,
		releasers: [],
		deferred: [],
		published: publishLog(),

		_define: function( exchange, stateOnDefined ) {
			function onDefinitionError( err ) {
        this.failedWith = err;
				this.transition( "failed" );
			}
			function onDefined() {
				this.transition( stateOnDefined );
			}
			exchange.define()
				.then( onDefined.bind( this ), onDefinitionError.bind( this ) );
		},

		_listen: function() {
			connection.on( "unreachable", function( err ) {
        err = err || new Error( "Could not establish a connection to any known nodes." );
        this._onFailure( err );
        this.transition( "unreachable" );
      }.bind( this ) );
		},

		_onAcquisition: function( transitionTo, exchange ) {
      var handlers = [];

			handlers.push( exchange.channel.once( "released", function() {
				this.handle( "released", exchange );
			}.bind( this ) ) );

      handlers.push( exchange.channel.once( "closed", function() {
				this.handle( "closed", exchange );
			}.bind( this ) ) );

      function cleanup() {
        unhandle( handlers );
        exchange.release()
          .then( function() {
              this.transition( "released" );
            }.bind( this )
          );
      }

      function onCleanupError() {
        var count = this.published.count();
        if ( count > 0 ) {
          exLog.warn( "%s exchange '%s', connection '%s' was released with %d messages unconfirmed",
            this.type,
            this.name,
            connection.name,
            count );
        }
        cleanup.bind( this )();
      }

      var releaser = function() {
        return this.published.onceEmptied()
          .then( cleanup.bind( this ), onCleanupError.bind( this ) );
      }.bind( this );

      var publisher = function( message ) {
        return exchange.publish( message )
      }.bind( this );

      this.publisher = publisher;
      this.releasers.push( releaser );
			this._define( exchange, transitionTo );
		},

		_onFailure: function( err ) {
			this.failedWith = err;
			_.each( this.deferred, function( x ) {
				x( err );
			} );
			this.deferred = [];
			this.published.reset();
		},

		_removeDeferred: function( reject ) {
			var index = _.indexOf( this.deferred, reject );
			if ( index >= 0 ) {
				this.deferred.splice( index, 1 );
			}
		},

    _release: function( closed ) {
      var release = this.releasers.shift();
      if( release ) {
        return release( closed );
      } else {
        return when();
      }
    },

		check: function() {
			var deferred = when.defer();
			this.handle( "check", deferred );
			return deferred.promise;
		},

		release: function() {
			exLog.debug( "Release called on exchange %s - %s (%d messages pending)", this.name, connection.name, this.published.count() );
			return when.promise( function( resolve ) {
				this.once( "released", function() {
					resolve();
				} );
				this.handle( "release" );
			}.bind( this ) );
		},

		publish: function( message ) {
			if( this.state !== "ready" && this.published.count() >= this.limit ) {
				exLog.warn( "Exchange '%s' has reached the limit of %d messages waiting on a connection",
					this.name,
					this.limit
				);
				return when.reject( "Exchange has reached the limit of messages waiting on a connection" );
			}
			var publishTimeout = message.timeout || options.publishTimeout || message.connectionPublishTimeout || 0;
			return when.promise( function( resolve, reject ) {
				var timeout, timedOut, failedSub;
				if( publishTimeout > 0 ) {
					timeout = setTimeout( function() {
						timedOut = true;
						onRejected.bind( this )( new Error( "Publish took longer than configured timeout" ) );
					}.bind( this ), publishTimeout );
				}
				function onPublished() {
					resolve();
					this._removeDeferred( reject );
					failedSub.unsubscribe();
				}
				function onRejected( err ) {
					reject( err );
					this._removeDeferred( reject );
					failedSub.unsubscribe();
				}
				var op = function( err ) {
					if( err ) {
						onRejected.bind( this )( err );
					} else {
						if( timeout ) {
							clearTimeout( timeout );
							timeout = null;
						}
						if( !timedOut ) {
							return this.publisher( message )
								.then( onPublished.bind( this ), onRejected.bind( this ) );
						}
					}
				}.bind( this );
				failedSub = this.once( "failed", function( err ) {
					onRejected.bind( this )( err );
				}.bind( this ) );
				this.deferred.push( reject );
				this.handle( "publish", op );
			}.bind( this ) );
		},

		retry: function() {
			this.transition( 'initializing' );
		},

		initialState: "setup",
		states: {
			closed: {
				_onEnter: function() {
					this.emit( "closed" );
				},
				check: function() {
					this.deferUntilTransition( "ready" );
					this.transition( "initializing" );
				},
				publish: function() {
					this.deferUntilTransition( "ready" );
				}
			},
			failed: {
				_onEnter: function() {
					this._onFailure( this.failedWith );
					this.emit( "failed", this.failedWith );
				},
				check: function( deferred ) {
					deferred.reject( this.failedWith );
					this.emit( "failed", this.failedWith );
				},
				release: function( exchange ) {
          this._release( exchange )
            .then( function() {
              this.transition( "released" );
            }.bind( this ) );
				},
				publish: function( op ) {
					op( this.failedWith );
				}
			},
			initializing: {
				_onEnter: function() {
					exchangeFn( options, topology, this.published, serializers )
						.then( function( exchange ) {
							this.handle( "acquired", exchange );
						}.bind( this ) );
				},
				acquired: function( exchange ) {
					this._onAcquisition( "ready", exchange );
				},
				check: function() {
					this.deferUntilTransition( "ready" );
				},
				closed: function() {
					this.deferUntilTransition( "ready" );
				},
				release: function() {
					this.deferUntilTransition( "ready" );
				},
				released: function() {
					this.transition( "initializing" );
				},
				publish: function() {
					this.deferUntilTransition( "ready" );
				}
			},
			ready: {
				_onEnter: function() {
					this.emit( "defined" );
				},
				check: function( deferred ) {
					deferred.resolve();
					this.emit( "defined" );
				},
				release: function() {
					this.deferUntilTransition( "released" );
					this.transition( "releasing" );
				},
				closed: function() {
					this.transition( "closed" );
				},
				released: function() {
					this.deferUntilTransition( "releasing" );
				},
				publish: function( op ) {
					op();
				}
			},
			releasing: {
				_onEnter: function() {
          this._release()
            .then( function() {
              this.transition( "released" );
            }.bind( this ) );
				},
				publish: function() {
					this.deferUntilTransition( "released" );
				},
				release: function() {
					this.deferUntilTransition( "released" );
				}
			},
			released: {
				_onEnter: function() {
					this.emit( "released" );
				},
				check: function() {
					this.deferUntilTransition( "ready" );
				},
				release: function() {
					this.emit( "released" );
				},
				publish: function( op ) {
					exLog.warn( "Publish called on exchange '%s' after connection was released intentionally. Released connections must be re-established explicitly.", this.name );
					op( new Error( format( "Cannot publish to exchange '%s' after intentionally closing its connection", this.name ) ) );
				}
			},
			setup: {
				_onEnter: function() {
					this._listen();
					this.transition( "initializing" );
				}
			},
			unreachable: {
				_onEnter: function() {
					this.emit( "failed", this.failedWith );
				},
				check: function( deferred ) {
					deferred.reject( this.failedWith );
					this.emit( "failed", this.failedWith );
				},
				publish: function( op ) {
					op( this.failedWith );
				}
			}
		}
	} );

	Monologue.mixInto( Fsm );
	var fsm = new Fsm();
	connection.addExchange( fsm );
	return fsm;
};

module.exports = Factory;
