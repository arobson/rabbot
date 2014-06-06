var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' ),
	postal = require( 'postal' ),
	dispatch = postal.channel( 'rabbit.dispatch' ),
	responses = postal.channel( 'rabbit.responses' ),
	signal = postal.channel( 'rabbit.ack' );

var calls = { 
		ack: 'betterAck', 
		nack: 'betterNack' 
	};

var Channel = function( name, model, connection ) {
	this.name = name;
	this.model = model;
	this.debuffering = false;
	this.lastAck = -1;
	this.lastNack = -1;
	this.firstAck = undefined;
	this.firstNack = undefined;
	this.connection = connection;
	this.pendingMessages = [];
	this.receivedMessages = [];
	this.responseSubscriptions = {};
	this.receivedCount = 0;
	this._sequenceNo = 0;
	this.signalSubscription = undefined;

	_.bindAll( this );
};

Channel.prototype._ackOrNackSequence = function() {
		try {
			var firstMessage = this.receivedMessages[ 0 ];
			if ( firstMessage === undefined ) {
				return;
			}
			var firstResult = firstMessage.result;
				sequenceEnd = firstMessage.tag,
				call = calls[ firstResult ];
			if( firstResult == 'pending' ) {
				return;
			} else {
				for ( var i = 1; i < _.size( this.receivedMessages ) - 1; i++ ) {
					if ( this.receivedMessages[ i ].result !== firstResult ) {
						break;
					}
					sequenceEnd = this.receivedMessages[ i ].tag;
				}
				if( call ) {
					this[ call ]( sequenceEnd, true );
				}
			}
		} catch ( err ) {
			console.log( 'Error in _ackOrNackSequence', err.stack );
		}
	};

Channel.prototype._listenForAck = function() {
	this.signalSubscription = signal.subscribe( '#', function() {
		this.batchAck();
	}.bind( this ) );
};

Channel.prototype._ignoreAck = function() {
	if( this.signalSubscription ) {
		this.signalSubscription.unsubscribe();
	}
};

Channel.prototype.batchAck = function() {
	this.acking = this.acking !== undefined ? this.acking : false;
	if ( !this.acking ) {
		this.acking = true;
		var hasPending = ( _.findIndex( this.receivedMessages, { result: 'pending' } ) > 0 ),
			hasAck = this.firstAck,
			hasNack = this.firstNack;

		//Just acksPending
		if ( !hasPending && !hasNack && hasAck ) {
			this.betterAckAll();
		}
		//Just nacksPending
		else if ( !hasPending && hasNack && !hasAck ) {
			this.betterNackAll();
		}
		//acksPending or nacksPending
		else if ( hasNack || hasAck ) {
			this._ackOrNackSequence();
		}
		//Only pending
		this.acking = false;
	}
};

Channel.prototype.addPendingMessage = function( options ) {
	var seqNo = ++this._sequenceNo;
	options.sequenceNo = seqNo
	this.pendingMessages[ seqNo ] = options;
	return options;
};

Channel.prototype.betterAck = function( tag, inclusive ) {
	this.lastAck = tag;
	this.setResult( tag, 'ack', inclusive );
};

Channel.prototype.betterNack = function( tag, inclusive ) {
	this.lastNack = tag;
	this.setResult( tag, 'nack', inclusive );
};

Channel.prototype.betterAckAll = function() {
	this.lastAck = _.findLast( this.receivedMessages, function( message ) {
		return message.result === 'ack';
	} ).tag;
	_.remove( this.receivedMessages, function( message ) {
		return message.result === 'ack';
	} );
	this.firstAck = undefined;
	this.model.ackAll();
};

Channel.prototype.betterNackAll = function() {
	this.lastNack = _.findLast( this.receivedMessages, function( message ) {
		return message.result === 'nack';
	} ).tag;
	_.remove( this.receivedMessages, function( message ) {
		return message.result === 'nack';
	} );
	this.firstNack = undefined;
	this.model.nackAll();
};

Channel.prototype.publish = function( message ) {
	var baseHeaders = {
		'CorrelationId': message.correlationId
	}
	message.headers = _.merge( baseHeaders, message.headers );
	return when.promise( function( resolve, reject ) {
		
		var payload = new Buffer( JSON.stringify( message.body ) ),
			options = {
				type: message.type || '',
				contentType: 'application/json',
				contentEncoding: 'utf8',
				correlationId: message.correlationId || '',
				replyTo: message.replyTo || this.connection.replyTo,
				messageId: message.messageId || message.id || '',
				timestamp: message.timestamp,
				appId: message.appId || '',
				headers: message.headers
			},
			seqNo;
		if ( !message.sequenceNo ) {
			message = this.addPendingMessage( message );
		}
		seqNo = message.sequenceNo || this._sequenceNo; // create a closure around sequence
		if ( this.persistent ) {
			options.persistent = true;
		}
		var effectiveKey = message.routingKey == '' ? '' : options.type;
		this.model.publish(
			this.name,
			effectiveKey,
			payload,
			options,
			function( err ) {
				if ( err === null ) {
					delete this.pendingMessages[ seqNo ];
					resolve();
				} else {
					reject( err );
				}
			}.bind( this ) );
	}.bind( this ) );
};

Channel.prototype.setResult = function( tag, result, inclusive ) {
	_.remove( this.receivedMessages, function( message ) {
		return message.tag <= tag;
	} );
	var nextAck = _.find( this.receivedMessages, {
		'result': 'ack'
	} ),
		nextNack = _.find( this.receivedMessages, {
		'result': 'nack'
	} );
	this.firstAck = nextAck ? nextAck.tag : undefined;
	this.firstNack = nextNack ? nextNack.tag : undefined;

	switch ( result ) {
		case 'ack':
			this.model.ack( {
				fields: {
					deliveryTag: tag
				}
			}, inclusive );
			break;
		case 'nack':
			this.model.nack( {
				fields: {
					deliveryTag: tag
				}
			}, inclusive );
			break;
	}
};

Channel.prototype.subscribe = function() {
	this._listenForAck();
	this.connection.addSubscription( this.name );
	return this.model.consume( this.name, function( raw ) {
		var correlationId = raw.properties.correlationId;
		raw.body = JSON.parse( raw.content.toString( 'utf8' ) );
		var pending = {
			tag: raw.fields.deliveryTag,
			result: 'pending'
		};
		this.receivedMessages.push( pending );
		this.receivedCount ++;

		raw.setResult = function( tag, result ) {
			pending.result = result;
		};
		raw.ack = function() {
			this.firstAck = this.firstAck || raw.fields.deliveryTag;
			raw.setResult( raw.fields.deliveryTag, 'ack' );
		}.bind( this );
		raw.nack = function() {
			this.firstNack = this.firstNack || raw.fields.deliveryTag;
			raw.setResult( raw.fields.deliveryTag, 'nack' );
		}.bind( this );
		raw.reply = function( reply, more ) {
			var replyTo = raw.properties.replyTo;
				options = {
					correlationId: raw.properties.messageId,
					body: reply,
					headers: {}
				};
			raw.ack();
			if( !more ) {
				options.headers[ 'sequence_end' ] = true;
			} else {
				var initial = this.responseSubscriptions[ correlationId ].position || 0;
				options.headers[ 'position' ] = initial;
				this.responseSubscriptions[ correlationId ].position = initial + 1;
			}
			if( replyTo ) {
				this.connection
					._createExchange( { name: replyTo, type: 'direct', autoDelete: true } )
						.then( function( exchange ) {
							exchange.publish( options );
						} );
			}
		}.bind( this );
		if( raw.fields.exchange == this.connection.replyTo ) {
			responses.publish( correlationId, raw );
		} else {
			dispatch.publish( raw.properties.type, raw );
		}
	}.bind( this ) );
};

module.exports = Channel;