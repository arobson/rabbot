var _ = require( 'lodash' ),
	uuid = require( 'node-uuid' ),
	amqp = require( 'amqplib' ),
	Monologue = require( 'monologue.js' )( _ ),
	when = require( 'when' ),
	pipeline = require( 'when/sequence' ),
	bunyan = require( 'bunyan' ),
	fs = require( 'fs' ),
	machina = require( 'machina' )( _ ),
	Channel = require( './channel.js' );

	var trim = function( x ) { return x.trim( ' ' ); },
		split = function( x ) {
			if( _.isNumber( x ) ) {
				return [ x ];
			} else if( _.isArray( x ) ) {
				return x;
			} else {
				return x.split( ',' ).map( trim );
			}
		},
		toArray = function( x, list ) {
			if( _.isArray( x ) ) { 
				return x; 
			}
			if( _.isObject( x ) && list ) {
				return _.map( x, function( item ) { 
					return item; 
				} );
			}
			if( _.isUndefined( x ) || _.isEmpty( x ) ) {
				return [];
			}
			return [ x ];
		};

	var Connection = function( options, broker ) {
		var channels = {},
			definitions = {
				bindings: {},
				exchanges: {},
				queues: {},
				subscriptions: {}
			},
			options = options || {},
			broker = broker,
			connectionIndex = 0;

		var getOption = function( key, alt ) {
				if( options.get ) {
					return options.get( key, alt );
				} else {
					return options[ key ] || alt;
				}
			},
			serverList = getOption( 'RABBIT_BROKER' ) || getOption( 'server', 'localhost' ),
			portList = getOption( 'RABBIT_PORT', 5672 ),
			servers = split( serverList ),
			ports = split( portList ),
			limit = _.max( [ servers.length, ports.length ] ),

			aliasOptions = function( options, aliases ) {
				var aliased = _.transform( options, function( result, value, key ) {
					var alias = aliases[ key ];
					result[ alias || key ] = value;
				} );
				return _.omit( aliased, Array.prototype.slice.call( arguments, 2 ) );
			},

			bumpIndex = function() {
				if( limit - 1 > connectionIndex ) {
					connectionIndex ++;
				} else {
					connectionIndex = 0;
				}
			},

			connect = function() {
				return when.promise( function( resolve, reject ) {
					var attempted = [],
						attempt,
						nextUri;
					attempt = function() {
						nextUri = getNextUri();
						if( _.indexOf( attempted, nextUri ) < 0 ) {
							tryUri( nextUri )
								.then( null, function( err ) {
									attempt();
								} )
								.then( resolve );
							attempted.push( nextUri );
						} else {
							reject( 'No endpoints could be reached' );
						}
					};
					attempt();
				} );
			},

			getNextUri = function() {
				var server = getServer(),
					port = getPort();
					uri = getUri( server, port );
				return uri;
			},

			getPort = function() {
				if( connectionIndex >= ports.length ) {
					return ports[ 0 ];
				} else {
					return ports[ connectionIndex ];
				}
			},

			getServer = function() {
				if( connectionIndex >= servers.length ) {
					return servers[ 0 ];
				} else {
					return servers[ connectionIndex ];
				}
			},

			getUri = function( server, port ) {
				return ( this.RABBIT_PROTOCOL || 'amqp://' ) +
					( this.user || this.RABBIT_USER || 'guest' ) +
					':' +
					( this.pass || this.RABBIT_PASSWORD || 'guest' ) +
					'@' + server + ':' + port + '/' +
					( this.vhost || this.RABBIT_VHOST || '%2f' ) +
					'?heartbeat=' +
					( this.heartBeat || this.RABBIT_HEARTBEAT || 2000 );
			},

			tryConnect = function( fsm ) {
				connect()
					.then( function( connection ) {
						fsm.handle( 'connected', connection );
					} )
					.then( null, function( err ) {
						fsm.handle( 'connection-failed', err );
					} )
					.catch( function( err ) {
						broker.log.error( {
							error: err.stack,
							reason: 'Could not connect due to errors in wascally'
						} );
					} );
			},

			tryUri = function( uri ) {
				return when.promise( function( resolve, reject ) {
					amqp
						.connect( uri )
						.then( resolve, 
							function( err ) {
								bumpIndex();
								reject( err );
							}
						)
						.then( null, function( err ) {
							bumpIndex();
							reject( err );
						} );
				} );
			};

		var Fsm = machina.Fsm.extend( {
			name: options.name || 'default',
			connection: undefined,
			initialState: 'connecting',
			timeBetweenRetries: .250,

			_createBinding: function( options ) {
				var id = [ options.source, options.target ].join( '->' );
				definitions.bindings[ id ] = options;
				var actualKeys = [ '' ],
					term = options.queue ? 'queue' : 'exchange',
					call = options.queue ? 'bindQueue' : 'bindExchange',
					source = options.source,
					target = options.target,
					keys = options.keys;
				if( keys && keys.length > 0 ) {
					actualKeys = _.isArray( keys ) ? keys : [ keys ];
				}

				return when.promise( function( resolve, reject ) {
					var bindAll = function( channel ) {
							var bindings = _.map( actualKeys, function( key ) {
								var promise;
								try {
									promise = channel.model[ call ]( target, source, key );
								} catch( err ) {
									promise = when( false );
								}
								return promise;
							} );
							when.all( bindings )
								.then( null, function( err ) {
									if( channels[ 'exchange:' + source ] )
									{
										broker.log.error( {
											error: err.stack,
											reason: 'Retrying a bindining due to a race condition'
										} );
										acquire();
									} else {
										broker.log.error( {
											error: err.stack,
											reason: 'Binding ' + term + ' "' + target + '" to exchange ""' + source + ' with keys "' + JSON.stringify( keys ) + '" failed.'
										} );
										reject( err );
									}
								}.bind( this ) )
								.then( function() {
									resolve( id );
								} );
						}.bind( this ), 
						acquire = function() {
							this.getChannel( 'control' )
								.then( null, function( err ) {
									broker.log.error( {
										error: err.stack,
										reason: 'Could not get the control channel to bind' + term + ' "' + target + '" to exchange ""' + source + ' with keys "' + JSON.stringify( keys ) + '"'
									} );
									reject( err );
								}.bind( this ) )
								.then( function( channel ) {
									bindAll( channel );
								} )
							}.bind( this );
					acquire();
				}.bind( this ) );
			},

			_createExchange: function( options ) {
				definitions.exchanges[ options.name ] = options;
				var channelName = 'exchange:' + options.name;
				return when.promise( function( resolve, reject ) {
					this.getChannel( channelName, true )
						.then( null, function( err ) {
							reject( err );
						} )
						.then( function( channel ) {
							if( channel === undefined ) {
								reject( 'NOPE' );
							} else {
								if ( options.persistent ) {
									channel.persistent = true;
								}
								var valid = aliasOptions( options, {
									alternate: 'alternateExchange'
								}, 'persistent' );
								channel.model.assertExchange( options.name, options.type, valid )
									.then( null, function( err ) {
										broker.log.error( {
											error: err,
											reason: 'Could not create exchange "' + JSON.stringify( options ) + '" on connection "' + this.name + '".'
										} );
										reject( err );
									}.bind( this ) )
									.then( function() {
										resolve( channel );
									} );
							}
						}.bind( this ) );
				}.bind( this ) );
			},

			_createQueue: function( options ) {
				definitions.queues[ options.name ] = options;
				var channelName = 'queue:' + options.name;
				return when.promise( function( resolve, rject ) {
					this.getChannel( channelName )
						.then( null, function( err ) {
							reject( err );
						} )
						.then( function( channel ) {
							var name = options.name,
								valid = aliasOptions( options, {
									queueLimit: 'maxLength',
									deadLetter: 'deadLetterExchange'
								}, 'subscribe', 'limit' ),
								result = channel.model.assertQueue( name, valid );
							if ( options[ 'limit' ] ) {
								channel.model.prefetch( options[ 'limit' ] );
							}
							if ( options.subscribe ) {
								channel.subscribe( name );
							}
							result
								.then( null, function( err ) {
									broker.log.error( {
										error: err,
										reason: 'Could not create queue "' + JSON.stringify( options ) + '" on connection "' + connectionName + '".'
									} );
									reject( err );
								}.bind( this ) )
								.then( function() {
									resolve( channel );
								} );
						}.bind( this ) );
				}.bind( this ) );
			},

			addSubscription: function( queue ) {
				definitions.subscriptions[ queue ] = true;
			},

			configureBindings: function( bindingDef, list ) {
				return when.promise( function( resolve, reject ) {
					if ( _.isUndefined( bindingDef ) ) {
						resolve();
					} else {
						var actualDefinitions = toArray( bindingDef, list ),
							bindings = _.map( actualDefinitions, function( def ) {
								var q = definitions.queues[ def.target ];
									return this._createBinding( 
											{ 
												source: def.exchange || def.source, 
												target: def.target,
												keys: def.keys,
												queue: q !== undefined 
											} );
									}.bind( this ) );
						if( bindings.length == 0 ) {
							resolve();
						} else {
							when.all( bindings )
								.then( null, function( err ) {
									reject( err );
								} )
								.then( function( list ) {
									resolve();
								} );
						}
					}
				}.bind( this ) );
			},

			configureQueues: function( queueDef, list ) {
				return when.promise( function( resolve, reject ) {
					if ( _.isUndefined( queueDef ) ) {
						resolve();
					} else {
						var actualDefinitions = toArray( queueDef, list ),
							queues = _.map( actualDefinitions, function( def ) {
								return this._createQueue( def );
							}.bind( this ) );
						when.all( queues )
							.then( null, function( err ) {
								reject( err );
							} )
							.then( function( list ) {
								resolve( list );
							} );
					}
				}.bind( this ) );
			},

			configureExchanges: function( exchangeDef, list ) {
				return when.promise( function( resolve, reject ) {
					if ( _.isUndefined( exchangeDef ) ) {
						resolve();
					} else {
						var actualDefinitions = toArray( exchangeDef, list ),
							exchanges = _.map( actualDefinitions, function( def ) {
								return this._createExchange( def );
							}.bind( this ) );
						when.all( exchanges )
							.then( null, function( err ) {
								reject( err );
							} )
							.then( function( list ) {
								resolve( list );
							} );
					}
				}.bind( this ) );
			},

			cleanup: function() {
				channels = {};
				connectionIndex = 0;
			},

			close: function() {
				return when.promise( function( resolve, reject ) {
					this.on( 'closed', function() {
						resolve( this );
					}.bind( this ) );
					this.transition( 'closing' );
				}.bind( this ) );
			},

			connect: function() {
				return when.promise( function( resolve, reject ) {
					if( this.isAvailable() ) {
						resolve( this );
					}
					else {
						this.on( 'connected', function() {
							resolve( this );
						}.bind( this ) ).once();
						this.on( 'connection.failed', function( err ) {
							reject( err );
						} ).once();
						this.transition( 'connecting' );
					}
				}.bind( this ) );
			},

			createReplyExchange: function() {
				if( !this.responseId ) {
					this.responseId = uuid.v1();
					this.replyTo = [ this.responseId, 'response' ].join( '.' ),
					this.replyQueue = [ this.responseId, 'response', 'queue' ].join( '.' );
					var promises = [
							this._createExchange( { name: this.replyTo, type: 'direct', autoDelete: true } ),
							this._createQueue( { name: this.replyQueue, autoDelete: true } )
								.then( function( channel ) {
									channel.subscribe();
								} )
						];
					return when.all( promises )
						.then( function() {
							this._createBinding( { source: this.replyTo, target: this.replyQueue, keys: [], queue: true } );
						}.bind( this ) );
				} else {
					return when( true );
				}
			},

			getChannel: function( name, confirm ) {
				var nameParts = name.split( ':' ),
					objectName =  nameParts.length > 1 ? nameParts[ 1 ] : name;
				return when.promise( function( resolve, reject ) {
					var create = function( connection ) {
						var method = confirm ? 'createConfirmChannel' : 'createChannel';
						connection[ method ]()
							.then( function( model ) {
								var channel = new Channel( objectName, model, this );
								channels[ name ] = channel;
								model.on( 'error', function( err ) {
									broker.log.error( {
										error: err.stack,
										reason: 'An invalid channel operation caused Rabbit to close channel ' + objectName
									} );
									connection[ method ]().then( function( m ) {
										channel.model = m;
									} );
								} );
								resolve( channel );
							}.bind( this ) )
							.then( null, function( err ) {
								reject( err );
							} );
					}.bind( this );
					if( this.isAvailable() ) {
						var channel = channels[ name ];
						if( !channel ) {
							create( this.connection );
						} else {
							resolve( channel );
						}
					} else {
						this.on( 'connected', function() {
							create( this.connection );
						}.bind( this ) ).once();
						this.connect();
					}
				}.bind( this ) );
			},

			isAvailable: function() {
				return this.state == 'open' || this.state == 'creating-prerequisites';
			},

			reconnect: function() {
				this.cleanup();
				this.connect();
			},

			reset: function() {
				channels = {};
				definitions = {
					bindings: {},
					exchanges: {},
					queues: {},
					subscriptions: {}
				};
			},

			states: {
				'connecting': {
					_onEnter: function() {
						this.timeBetweenRetries = .25;
						tryConnect( this );
					},
					'connected': function( connection ) {
						this.connection = connection;
						connection.on( 'close', function() {
							this.handle( 'disconnected' );
						}.bind( this ) );
						this.transition( 'creating-prerequisites' );
					},
					'connection-failed': function( err ) {
						this.emit( 'connection.failed', err );
						setTimeout( 
							function() {
								tryConnect( this );
							}.bind( this ), 
							( this.timeBetweenRetries * 1000 ) 
						);
						this.timeBetweenRetries += .25;
					}
				},
				'creating-prerequisites': {
					_onEnter: function() {
						var setupQueues = when.promise( function( resolve, reject ) {
							this.configureQueues( definitions.queues, true )
								.then( function( queues ) {
									_.each( queues, function( queue ) {
										if( definitions.subscriptions[ queue.name ] ) {
											queue.subscribe();
										}
									}.bind( this ) );
									resolve();
								}.bind( this ) );
						}.bind( this ) );
						when.all( [
							this.configureExchanges( definitions.exchanges, true ),
							setupQueues
						] )
						.then( function() {
							this.configureBindings( definitions.bindings, true )
								.then( function() {
									this.transition( 'open' );
								}.bind( this ) );
						}.bind( this ) );
					}
				},
				'open': {
					_onEnter: function() {
						this.createReplyExchange();
						this.emit( 'connected' );
					},
					'disconnected': function() {
						this.reconnect();
					}
				},
				'closing': {
					_onEnter: function() {
						if( this.priorState == 'open' || this.priorState == 'creating-prerequisites' ) {
							this.connection.close();
						}
						this.transition( 'closed' );
					}
				},
				'closed': {
					_onEnter: function() {
						this.emit( 'closed', this );
						this.cleanup();
					}
				}
			}
		} );

		Monologue.mixin( Fsm );
		return new Fsm();
	};

module.exports = Connection;