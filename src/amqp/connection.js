var amqp = require( 'amqplib' ),
	_ = require( 'lodash' ),
	when = require( 'when' ),
	AmqpConnection = require( 'amqplib/lib/callback_model' ).CallbackModel,
	Promiser = require( './promiseMachine.js');

module.exports = function( options ) {

	var getOption = function( key, alt ) {
			if( options.get ) {
				return options.get( key, alt );
			} else {
				return options[ key ] || alt;
			}
		},
		split = function( x ) {
			if( _.isNumber( x ) ) {
				return [ x ];
			} else if( _.isArray( x ) ) {
				return x;
			} else {
				return x.split( ',' ).map( trim );
			}
		},
		trim = function( x ) { return x.trim( ' ' ); },
		options = options || {},
		connectionIndex = 0;
		serverList = getOption( 'RABBIT_BROKER' ) || getOption( 'server', 'localhost' ),
		portList = getOption( 'RABBIT_PORT', 5672 ),
		servers = split( serverList ),
		ports = split( portList ),
		limit = _.max( [ servers.length, ports.length ] ),

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
						amqp.connect( nextUri, { noDelay: true } )
							.then( resolve )
							.then( null, function( err ) {
								attempted.push( nextUri );
								bumpIndex();
								attempt( err );
							} );
					} else {
						reject( 'No endpoints could be reached' );
					}
				};
				attempt();
			} );
		},

		close = function( connection ) {
			connection.close();
		},

		getNextUri = function() {
			var server = getNext( servers ),
				port = getNext( ports );
				uri = getUri( server, port );
			return uri;
		},

		getNext = function( list ) {
			if( connectionIndex >= list.length ) {
				return list[ 0 ];
			} else {
				return list[ connectionIndex ];
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
		}

		return new Promiser( connect, AmqpConnection, close, 'close' );
};