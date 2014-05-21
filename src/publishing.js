var _ = require( 'lodash' ),
	when = require( 'when' );

module.exports = function( Broker, log ) {

	Broker.prototype.addPendingMessage = function( exchangeName, type, message, routingKey, correlationId, connectionName ) {
		var seqNo = ++this._sequenceNo,
			msgDetails = {
				exchangeName: exchangeName,
				type: type,
				message: message,
				routingKey: routingKey || type,
				correlationId: correlationId,
				connectionName: connectionName || 'default',
				sequenceNo: seqNo
			};
		this.pendingMessages[ seqNo ] = msgDetails;
		return message;
	};

	Broker.prototype.publish = function( exchangeName, type, message, routingKey, correlationId, connectionName, sequenceNo ) {
		connectionName = connectionName || 'default';
		return when.promise( function( resolve, reject ) {
			this.getConnection( connectionName )
				.done( function() {
					var exchange = this.getExchange( exchangeName, connectionName ),
						payload = new Buffer( JSON.stringify( message ) ),
						options = {
							type: type,
							contentType: 'application/json',
							contentEncoding: 'utf8',
							correlationId: correlationId,
							headers: {
								'CorrelationId': correlationId
							}
						},
						seqNo;
					if ( exchange ) {
						try {
							if ( !sequenceNo ) {
								message = this.addPendingMessage( exchangeName, type, message, routingKey, correlationId, connectionName );
							}
							seqNo = sequenceNo || this._sequenceNo; // create a closure around sequence
							if ( exchange.persistent ) {
								options.persistent = true;
							}
							exchange.model.publish(
								exchangeName,
								routingKey || type,
								payload,
								options,
								function( err ) {
									if ( err === null ) {
										delete this.pendingMessages[ seqNo ];
										this.emit( 'messageConfirmed', seqNo );
										resolve();
									} else {
										this.emit( 'messageNotConfirmed', seqNo );
										reject( err );
									}
								}.bind( this ) );
						} catch ( err ) {
							this.emit( 'errorLogged' );
							this.log.error( {
								error: err.stack,
								reason: 'Error publishing message; sequenceNo=' + seqNo
							} );
							reject( err );
						}
					} else {
						this.emit( 'errorLogged' );
						var err = 'Cannot publish message ' + seqNo + ' to missing exchange ' + exchangeName;
						this.log.error( err );
						reject( err );
					}
				}.bind( this ) );
		}.bind( this ) );
	};

	Broker.prototype.sendPendingMessages = function() {
		var results = _.map( this.pendingMessages, function( message ) {
			try {
				var connection = this.connections[ message.connectionName ];
				if ( connection && connection.exchanges[ message.exchangeName ] ) {
					this.publish( message.exchangeName, message.type, message.message, message.routingKey, message.correlationId, message.connectionName, message.sequenceNo );
				}
				return true;
			} catch ( err ) {
				this.emit( 'errorLogged' );
				this.log.error( {
					error: err,
					reason: 'Failed to re-send message "' + JSON.stringify( message ) + '"'
				} );
				return false;
			}
		}.bind( this ) );
		return _.reduce( results, function( aggregate, result ) {
			return aggregate && result;
		} );
	};

};