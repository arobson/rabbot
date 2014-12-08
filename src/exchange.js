var _ = require( 'lodash' );
var when = require( 'when' );
var pipeline = require( 'when/pipeline' );
var postal = require( 'postal' );
var dispatch = postal.channel( 'rabbit.dispatch' );
var responses = postal.channel( 'rabbit.responses' );
var StatusList = require( './statusList.js' );
var machina = require( 'machina' )( _ );
var Monologue = require( 'monologue.js' )( _ );
var log = require( './log.js' );

var Channel = function( options, connection, topology ) {

	var aliasOptions = function( options, aliases ) {
		var aliased = _.transform( options, function( result, value, key ) {
			var alias = aliases[ key ];
			result[ alias || key ] = value;
		} );
		return _.omit( aliased, Array.prototype.slice.call( arguments, 2 ) );
	};

	var Fsm = machina.Fsm.extend( {
			name: options.name,
			channel: undefined,
			pendingMessages: {},
			_sequenceNo: 0,
			handlers: [],
			_addPendingMessage: function( message ) {
				var seqNo = ( ++ this._sequenceNo );
				message.sequenceNo = seqNo;
				this.pendingMessages[ seqNo ] = message;
				return message;
			},

			_define: function() {
				if( options.persistent ) {
					this.persistent = true;
				}
				var valid = aliasOptions( options, {
					alternate: 'alternateExchange'
				}, 'persistent' );
				var promise = this.channel.assertExchange( options.name, options.type, valid );
				promise.then( function() {
					this.handle( 'defined' );
				}.bind( this ) );
			},

			_getChannel: function() {
				if( !this.channel ) {
					var channel = connection.createChannel( true );
					this.channel = channel;
					channel.on( 'acquired', function() {
						this.handle( 'define' );
					}.bind( this ) );
					channel.on( 'released', function() {
							this.handle( 'released' );
					}.bind( this ) );
				} else {
					this.channel.acquire(); 
				}
			},

			_publish: function( message, resolve, reject ) {
				var baseHeaders = {
					'CorrelationId': message.correlationId
				};
				message.headers = _.merge( baseHeaders, message.headers );
				var payload = new Buffer( JSON.stringify( message.body ) ),
					publishOptions = {
						type: message.type || '',
						contentType: 'application/json',
						contentEncoding: 'utf8',
						correlationId: message.correlationId || '',
						replyTo: message.replyTo || topology.replyQueue,
						messageId: message.messageId || message.id || '',
						timestamp: message.timestamp,
						appId: message.appId || '',
						headers: message.headers,
						expiration: message.expiresAfter || undefined
					},
					seqNo;
				if ( !message.sequenceNo ) {
					message = this._addPendingMessage( message );
				}
				seqNo = message.sequenceNo || this._sequenceNo; // create a closure around sequence
				if ( this.persistent ) {
					publishOptions.persistent = true;
				}
				var effectiveKey = message.routingKey === '' ? '' : message.routingKey || publishOptions.type;
				this.channel.publish(
					this.name,
					effectiveKey,
					payload,
					publishOptions,
					function( err ) {
						if ( err == null ) { // jshint ignore:line
							delete this.pendingMessages[ seqNo ];
							resolve();
						} else {
							reject( err );
						}
					}.bind( this ) );
			},

			check: function() {
				return when.promise( function( resolve ) {
					this.on( 'defined', function() {
						resolve();
					} ).once();
					this.handle( 'check' );
				}.bind( this ) );
			},

			destroy: function() {
				this.transition( 'destroyed' );
			},

			publish: function( message ) {
				return when.promise( function( resolve, reject ) {
					var op = function() {
						this._publish( message, resolve, reject );
					}.bind( this );
					this.handle( 'publish', op );
				}.bind( this ) );
			},

			republish: function() {
				if( _.keys( this.pendingMessages ).length > 0 ) {
					var promises = _.map( this.pendingMessages, function( message ) {
						return when.promise( function( resolve, reject ) {
							this._publish( message, resolve, reject );
						}.bind( this ) );
					}.bind( this ) );
					return when.all( promises );
				} else {
					return when( true );
				}
			},

			initialState: 'setup',
			states: {
				'setup': {
					_onEnter: function() {
						this.handlers.push( topology.on( 'bindings-completed', function() {
							this.handle( 'bindings-completed' );
						}.bind( this) ) );
						this.handlers.push( connection.on( 'reconnected', function() {
							this.transition( 'reconnecting' );
						}.bind( this ) ) );
						this.transition( 'initializing' );
					}
				},
				'destroyed': {
					_onEnter: function() {
						_.each( this.handlers, function( handle ) {
							handle.unsubscribe();
						} );
						this.channel.destroy();
						this.channel = undefined;
					}
				},
				'initializing': {
					_onEnter: function() {
						this._getChannel();
					},
					define: function() {
						this._define();
					},
					defined: function() {
						this.transition( 'ready' );
					},
					released: function() {
						this.transition( 'released' );
					},
					publish: function() {
						this.deferUntilTransition( 'ready' );
					}
				},
				'reconnecting': {
					_onEnter: function() {
						this._getChannel();
					},
					define: function() {
						this._define();
					},
					defined: function() {
						this.emit( 'defined' );
					},
					'bindings-completed': function() {
						this.republish()
							.then( function() {
								this.transition( 'ready' );
							}.bind( this ) )
							.then( null, function( err ) { console.log( err.stack ); } );
					},
					released: function() {
						this.transition( 'released' );
					},
					publish: function() {
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
						this.transition( 'released' );
					},
					publish: function( op ) {
						op();
					}
				},
				'released': {
					publish: function( op ) {
						this.deferUntilTransition( 'ready' );
						this.transition( 'initializing' );
					}
				}
			}
	} );

	Monologue.mixin( Fsm );
	var fsm = new Fsm();
	return fsm;
};

module.exports = Channel;