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

	var messages = new StatusList(),
		Fsm = machina.Fsm.extend( {
			name: options.name,
			channel: undefined,
			responseSubscriptions: {},
			signalSubscription: undefined,
			
			_addPendingMessage: function( message ) {
				var seqNo = ++this._sequenceNo;
				message.sequenceNo = seqNo;
				this.pendingMessages[ seqNo ] = message;
				return message;
			},

			_define: function() {
				var valid = aliasOptions( options, {
						queueLimit: 'maxLength',
						deadLetter: 'deadLetterExchange'
					}, 'subscribe', 'limit' ),
					promise = this.channel.assertQueue( options.name, valid );
				promise.then( function() {
					this.handle( 'defined' );
				}.bind( this ) );
				if ( options[ 'limit' ] ) {
					this.channel.prefetch( options[ 'limit' ] );
				}
				if ( options.subscribe ) {
					this.subscribe();
				}
				return promise;
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

			_subscribe: function() {
				messages._listenForSignal();
				return this.channel.consume( this.name, function( raw ) {
					var correlationId = raw.properties.correlationId;
					raw.body = JSON.parse( raw.content.toString( 'utf8' ) );
					var ops = messages.addMessage( raw.fields.deliveryTag );
					raw.ack = ops.ack;
					raw.nack = ops.nack;
					raw.reply = function( reply, more ) {
						var replyTo = raw.properties.replyTo;
							options = {
								correlationId: raw.properties.messageId,
								body: reply,
								headers: {}
							};
						ops.ack();
						if( !more ) {
							options.headers[ 'sequence_end' ] = true;
						} else {
							var initial = this.responseSubscriptions[ correlationId ].position || 0;
							options.headers[ 'position' ] = initial;
							this.responseSubscriptions[ correlationId ].position = initial + 1;
						}
						if( replyTo ) {
							topology.createExchange( { name: replyTo, type: 'direct', autoDelete: true } )
								.then( function( exchange ) {
									exchange.publish( options );
								} );
						}
					}.bind( this );
					if( raw.fields.exchange == topology.replyTo ) {
						responses.publish( correlationId, raw );
					} else {
						dispatch.publish( raw.properties.type, raw );
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

			subscribe: function() {
				this.subscribed = true;
				var op = function() {
					this._subscribe();
				}.bind( this );
				this.handle( 'subscribe', op );
			},
			
			initialState: 'setup',
			states: {
				'setup': {
					_onEnter: function() {
						connection.on( 'reconnected', function() {
							this.transition( 'initializing' );
						}.bind( this ) );
						messages.on( 'ack', function( data ) {
							this.channel.ack( { fields: { deliveryTag: data.tag } }, data.inclusive );
						}.bind( this ) );

						messages.on( 'nack', function( data ) {
							this.channel.nack( { fields: { deliveryTag: data.tag } }, data.inclusive );
						}.bind( this ) );

						messages.on( 'ackAll', function() {
							this.channel.ackAll();
						}.bind( this ) );

						messages.on( 'nackAll', function() {
							this.channel.nackAll();
						}.bind( this ) );
						this.transition( 'initializing' );
					}
				},
				'initializing': {
					_onEnter: function() {
						this._getChannel();
					},
					define: function() {
						this.transition( 'defining' );
					},
					defined: function() {
						this.transition( 'ready' );
					},
					released: function() {
						this.transition( 'initializing' );
					},
					subscribe: function() {
						this.deferUntilTransition( 'ready' );
					}
				},
				'defining': {
					_onEnter: function() {
						this._define();
					},
					define: function() {
						this.transition( 'defining' );
					},
					defined: function() {
						this.transition( 'ready' );
					},
					released: function() {
						this._define();
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
						this.transition( 'released' );
					},
					subscribe: function( op ) {
						var tag = op();
					}
				},
				'released': {
					subscribe: function( op ) {
						this.deferUntilTransition( 'ready' );
						this.transition( 'initializing' );
					}
				}
			}
	} );

	Monologue.mixin( Fsm );
	var fsm = new Fsm();
	fsm.receivedMessages = messages;
	return fsm;
};

module.exports = Channel;