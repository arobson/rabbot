var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' ),
	postal = require( 'postal' ),
	dispatch = postal.channel( 'rabbit.dispatch' ),
	responses = postal.channel( 'rabbit.responses' ),
	StatusList = require( './statusList.js' ),
	machina = require( 'machina' )( _ ),
	Monologue = require( 'monologue.js' )( _ ),
	log = require( './log.js' );

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
			pendingMessages: [],
			_sequenceNo: 0,
			
			_addPendingMessage: function( message ) {
				var seqNo = ++this._sequenceNo;
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
					}.bind( this ) )
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
						replyTo: message.replyTo || topology.replyTo,
						messageId: message.messageId || message.id || '',
						timestamp: message.timestamp,
						appId: message.appId || '',
						headers: message.headers
					},
					seqNo;
				if ( !message.sequenceNo ) {
					message = this._addPendingMessage( message );
				}
				seqNo = message.sequenceNo || this._sequenceNo; // create a closure around sequence
				if ( this.persistent ) {
					publishOptions.persistent = true;
				}
				var effectiveKey = message.routingKey == '' ? '' : publishOptions.type;
				this.channel.publish(
					this.name,
					effectiveKey,
					payload,
					publishOptions,
					function( err ) {
						if ( err == null ) {
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

			publish: function( message ) {
				return when.promise( function( resolve, reject ) {
					var op = function() {
						this._publish( message, resolve, reject );
					}.bind( this );
					this.handle( 'publish', op );
				}.bind( this ) );
			},

			initialState: 'setup',
			states: {
				'setup': {
					_onEnter: function() {
						topology.on( 'bindings-completed', function() {
							this.handle( 'bindings-completed' );
						}.bind( this) );
						connection.on( 'reconnected', function() {
							this.transition( 'reconnecting' );
						}.bind( this ) );
						this.transition( 'initializing' );
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
						this.transition( 'ready' );
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