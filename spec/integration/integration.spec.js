require( "../setup.js" );
var _ = require( "lodash" );
var request = require("request");

var harnessFactory = function( rabbit, cb, expected ) {
	var handlers = [];
	var received = [];
	var unhandled = [];
	var returned = [];
	expected = expected || 1;
	var check = function() {
		if ( ( received.length + unhandled.length + returned.length ) === expected ) {
			cb();
		}
	};

	function defaultHandle( message ) {
		message.ack();
	}

	function wrap( handle ) {
		return function( message ) {
			handle( message );
			received.push( message );
			check();
		};
	}

	function handleFn( type, handle, queueName ) {
		if( _.isObject( type ) ) {
			var options = type;
			options.handler = wrap( options.handler || defaultHandle );
			handlers.push( rabbit.handle( options ) );
		} else {
			handlers.push( rabbit.handle( type, wrap( handle || defaultHandle ), queueName ) );
		}
	}

	function clean() {
		handlers.forEach( function( handle ) {
			handle.remove();
		} );
		handlers = [];
		received = [];
	}

	rabbit.onUnhandled( function( message ) {
		unhandled.push( message );
		message.ack();
		check();
	} );

	rabbit.onReturned( function( message ) {
		returned.push( message );
		check();
	} );

	return {
		add: function( msg ) {
			received.push( msg );
			check();
		},
		received: received,
		clean: clean,
		handle: handleFn,
		handlers: handlers,
		unhandled: unhandled,
		returned: returned
	};
};

describe( "Integration Test Suite", function() {
	var rabbit;
	before( function() {
		rabbit = require( "../../src/index.js" );
	} );

	describe( "when publishing before connected", function() {
		describe( "without a connection defined", function() {
			it( "should reject publish call with missing connection", function() {
				return rabbit.publish( "", { type: "nothing", routingKey: "", body: "" } )
					.should.be.rejectedWith( "Publish failed - no connection default has been configured" );
			} );
		} );

		describe( "with a connection and no exchange defined", function() {
			it( "should reject publish call with missing exchange", function() {
				rabbit.addConnection( {} );
				return rabbit.publish( "missing.ex", { type: "nothing", routingKey: "", body: "" } )
					.should.be.rejectedWith( "Publish failed - no exchange missing.ex on connection default is defined" );
			} );

			after( function() {
				rabbit.reset();
				return rabbit.shutdown();
			} );
		} );

		describe( "with a connection and exchange defined", function() {
			it( "should not error on publish calls", function() {
				rabbit.configure( {
					connection: {
						name: "temp"
					},
					exchanges: {
						name: "simple.ex",
						type: "direct",
						autoDelete: true
					}
				} );
				return rabbit.publish( "simple.ex", { type: "nothing", routingKey: "", body: "", connectionName: "temp" } );
			} );

			after( function() {
				return rabbit.deleteExchange( "simple.ex", "temp" )
						.then( function() {
							rabbit.reset();
							return rabbit.shutdown();
						} );
			} );
		} );
	} );

	describe( "when connected", function() {
		var harnessFn, connected;
		before( function() {
			harnessFn = harnessFactory.bind( undefined, rabbit );
			rabbit.once( "connected", function( c ) {
				connected = c;
			} );
			return rabbit.configure( require( "./configuration.js" ) );
		} );

		it( "should assign uri to connection", function() {
			connected.uri.should.equal( "amqp://guest:guest@127.0.0.1:5672/%2f?heartbeat=30" );
		} );

		describe( "with invalid connection criteria", function() {
			describe( "when attempting a connection", function() {
				var error;
				before( function( done ) {
					rabbit.once( "#.connection.failed", function( err ) {
						error = err;
						done();
					} );

					rabbit.addConnection( {
						name: "silly",
						server: "shfifty-five.gov",
						publishTimeout: 50,
						timeout: 500
					} ).catch( _.noop );

					rabbit.addExchange( { name: "silly-ex" }, "silly" ).then( null, _.noop );
				} );

				it( "should fail to connect", function() {
					error.should.equal( "No endpoints could be reached" );
				} );

				it( "should reject publish after timeout", function() {
					return rabbit.publish( "silly-ex", { body: "test" }, "silly" )
						.then( null, function( err ) {
							console.log( err );
						} );
				} );

				after( function() {
					return rabbit.close( "silly", true );
				} );
			} );

			describe( "when configuring against a bad connection", function() {
				var config;
				before( function() {
					config = {
						connection: {
							name: "silly2",
							server: "beanpaste.org",
							timeout: 500
						},
						exchanges: [
							{
								name: "rabbot-ex.direct",
								type: "direct",
								autoDelete: true
							},
							{
								name: "rabbot-ex.topic",
								type: "topic",
								alternate: "rabbot-ex.alternate",
								autoDelete: true
							}
						],
						queues: [
							{
								name: "rabbot-q.direct",
								autoDelete: true,
								subscribe: true
							},
							{
								name: "rabbot-q.topic",
								autoDelete: true,
								subscribe: true,
								deadletter: "rabbot-ex.deadletter"
							}
						],
						bindings: [
							{
								exchange: "rabbot-ex.direct",
								target: "rabbot-q.direct",
								keys: ''
							},
							{
								exchange: "rabbot-ex.topic",
								target: "rabbot-q.topic",
								keys: "#"
							}
						]
					};
				} );

				it( "should fail to connect", function() {
					return rabbit.configure( config )
						.should.be.rejectedWith(
						"No endpoints could be reached"
					);
				} );

				after( function() {
					rabbit.close( "silly2", true );
				} );
			} );
		} );

		describe( "with topic routes", function() {
			var harness;
			before( function( done ) {
				this.timeout( 10000 );
				harness = harnessFn( done, 3 );
				harness.handle( "topic" );
				rabbit.publish( "rabbot-ex.topic", { type: "topic", routingKey: "this.is.a.test", body: "broadcast" } );
				rabbit.publish( "rabbot-ex.topic", { type: "topic", routingKey: "this.is.sparta", body: "leonidas" } );
				rabbit.publish( "rabbot-ex.topic", { type: "topic", routingKey: "a.test.this.is", body: "yoda" } );
			} );

			it( "should route all messages correctly", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						key: m.fields.routingKey
					};
				} );
				_.sortBy( results, "body" ).should.eql(
					[
						{ body: "broadcast", key: "this.is.a.test" },
						{ body: "leonidas", key: "this.is.sparta" },
						{ body: "yoda", key: "a.test.this.is" },
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with duplicate subscribe calls", function() {
			var harness;
			before( function( done ) {
				this.timeout( 10000 );
				harness = harnessFn( done, 3 );
				harness.handle( "topic" );
				rabbit.startSubscription( "rabbot-q.topic" );
				rabbit.publish( "rabbot-ex.topic", { type: "topic", routingKey: "this.is.a.test", body: "broadcast" } );
				rabbit.publish( "rabbot-ex.topic", { type: "topic", routingKey: "this.is.sparta", body: "leonidas" } );
				rabbit.publish( "rabbot-ex.topic", { type: "topic", routingKey: "a.test.this.is", body: "yoda" } );
			} );

			it( "should not wreck everything", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						key: m.fields.routingKey
					};
				} );
				_.sortBy( results, "body" ).should.eql(
					[
						{ body: "broadcast", key: "this.is.a.test" },
						{ body: "leonidas", key: "this.is.sparta" },
						{ body: "yoda", key: "a.test.this.is" },
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with fanout exchange", function() {
			var harness;
			before( function( done ) {
				harness = harnessFn( done, 2 );
				harness.handle( "fanned" );
				rabbit.publish( "rabbot-ex.fanout", { type: "fanned", routingKey: "this.is.ignored", body: "hello, everyone" } );
			} );

			it( "should route all messages correctly", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						key: m.fields.routingKey
					};
				} );
				results.should.eql(
					[
						{ body: "hello, everyone", key: "this.is.ignored" },
						{ body: "hello, everyone", key: "this.is.ignored" }
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with unhandled messages", function() {
			var harness;
			before( function( done ) {
				harness = harnessFn( done, 2 );
				rabbit.publish( "rabbot-ex.direct", { type: "junk", routingKey: "", body: "uh oh" } );
				rabbit.publish( "rabbot-ex.direct", { type: "garbage", routingKey: "", body: "uh oh" } );
			} );

			it( "should capture messages according to unhandled strategy", function() {
				var results = _.map( harness.unhandled, function( m ) {
					return {
						body: m.body,
						type: m.type
					};
				} );
				results.should.eql(
					[
						{ body: "uh oh", type: "junk" },
						{ body: "uh oh", type: "garbage" }
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with unrouted messages", function() {
			var harness;
			before( function( done ) {
				harness = harnessFn( done, 3 );
				harness.handle( "deadend" );
				rabbit.publish( "rabbot-ex.deadend", { type: "deadend", routingKey: "empty", body: "one" } );
				rabbit.publish( "rabbot-ex.deadend", { type: "deadend", routingKey: "nothing", body: "two" } );
				rabbit.publish( "rabbot-ex.deadend", { type: "deadend", routingKey: "de.nada", body: "three" } );
			} );

			it( "should route all messages correctly", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						key: m.fields.routingKey
					};
				} );
				_.sortBy( results, "body" ).should.eql(
					[
						{ body: "one", key: "empty" },
						{ body: "three", key: "de.nada" },
						{ body: "two", key: "nothing" },
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with requests (within replyTimeout)", function() {
			this.timeout( 3000 );
			var harness, response1, response2, response3;
			before( function( done ) {
				harness = harnessFn( done, 8 );
				harness.handle( "polite", function( q ) {
					q.reply( ":D" );
				} );
				harness.handle( "rude", function( q ) {
					q.reply( ">:@" );
				} );
				harness.handle( "crazy", function( q ) {
					q.reply( '...', { more: true } );
					q.reply( '...', { more: true } );
					q.reply( '...' );
				} );

				rabbit.request( "rabbot-ex.request", { type: "polite", body: "how are you?" } )
					.then( function( response ) {
						response1 = response.body;
						harness.add( response );
						response.ack();
					} );

				rabbit.request( "rabbot-ex.request", { type: "rude", body: "why so dumb?" } )
					.then( function( response ) {
						response2 = response.body;
						harness.add( response );
						response.ack();
					} );

				function onPart( part ) {
					response3 = ( response3 || '' ) + part.body;
					part.ack();
					harness.add( part );
				}
				rabbit.request(
          "rabbot-ex.request",
          { type: "crazy", body: "do you like my yak-hair-shirt?" },
          onPart
        )
				.then( function( response ) {
					onPart( response );
				} );
			} );

			it( "should handle all requests", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body
					};
				} );
				_.sortBy( results, "body" ).should.eql(
					[
						{ body: "..." },
						{ body: "..." },
						{ body: "..." },
						{ body: ":D" },
						{ body: ">:@" },
						{ body: "do you like my yak-hair-shirt?" },
						{ body: "how are you?" },
						{ body: "why so dumb?" },
					] );
			} );

			it( "should capture responses corresponding to the originating request", function() {
				response1.should.equal( ":D" );
				response2.should.equal( ">:@" );
				response3.should.equal( "........." );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with requests (replyTimeout elapsed)", function() {
			this.timeout( 3000 );
			var timeoutError;
			before( function() {
				return rabbit.request( "rabbot-ex.request", { type: "polite", body: "how are you?", replyTimeout: 200 } )
					.then( null, function( err ) {
						timeoutError = err;
					} );
			} );

			it( "should receive rejection with timeout error", function() {
				timeoutError.message.should.eql( "No reply received within the configured timeout of 200 ms" );
			} );
		} );

		describe( "with rejection and dead-letter", function() {
			var harness;
			before( function( done ) {
				harness = harnessFn( done, 2 );
				harness.handlers.push(
					rabbit.handle( "reject", function( env ) {
						if ( harness.received.length < 2 ) {
							env.reject();
						} else {
							env.ack();
						}
						harness.add( env );
					} )
				);
				rabbit.publish( "rabbot-ex.topic", { type: "reject", routingKey: "this.is.rejection", body: "haters gonna hate" } );
			} );

			it( "receive message from bound queue and dead-letter queue", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						key: m.fields.routingKey,
						exchange: m.fields.exchange
					};
				} );
				results.should.eql(
					[
						{ body: "haters gonna hate", key: "this.is.rejection", exchange: "rabbot-ex.topic" },
						{ body: "haters gonna hate", key: "this.is.rejection", exchange: "rabbot-ex.deadletter" }
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with rejectUnhandled and dead-letter", function() {
			var harness;
			before( function( done ) {
				this.timeout( 10000 );
				harness = harnessFn( done, 1 );
				rabbit.rejectUnhandled();
				rabbit.setAckInterval( 500 );
				harness.handle( { queue: "rabbot-q-deadletter" } );
				rabbit.publish( "rabbot-ex.topic", { type: "noonecares", routingKey: "this.is.rejection", body: "haters gonna hate" } );
			} );

			it( "receive message from bound queue and dead-letter queue", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						key: m.fields.routingKey,
						exchange: m.fields.exchange
					};
				} );
				results.should.eql(
					[
						{ body: "haters gonna hate", key: "this.is.rejection", exchange: "rabbot-ex.deadletter" }
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with consistent hash exchange", function() {
			var harness, limit;
			before( function( done ) {
				this.timeout( 4000 );
				limit = 1000;
				harness = harnessFn( done, limit );
				harness.handle( "balanced" );
				for (var i = 0; i < limit; i++) {
					rabbit.publish( "rabbot-ex.consistent-hash", { type: "balanced", correlationId: ( i + i ).toString(), body: "message " + i } );
				}
			} );

			it( "should distribute messages across queues within margin for error", function() {
				var consumers = _.reduce( harness.received, function( acc, m ) {
					var key = m.fields.consumerTag;
					if ( acc[ key ] ) {
						acc[key]++;
					} else {
						acc[ key ] = 1;
					}
					return acc;
				}, {} );
				var quarter = limit / 4;
				var margin = quarter / 4;
				var counts = _.values( consumers );
				_.each( counts, function( count ) {
					count.should.be.closeTo( quarter, margin );
				} );
				_.reduce( counts, function( acc, x ) {
					return acc + x;
				}, 0 ).should.equal( limit );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with noBatch enabled", function() {
			var messagesToSend, harness;

			before( function( done ) {
				this.timeout( 5000 );

				messagesToSend = 10;
				harness = harnessFn( done, messagesToSend );
				var messageCount = 0;

				harness.handle( "no.batch", function( message ) {
					if ( messageCount > 0 ) {
						message.ack();
					}
					messageCount += 1;
				} );

				for (var i = 0; i < messagesToSend; i++) {
					rabbit.publish( "rabbot-ex.no-batch", {
						type: "no.batch",
						body: "message " + i,
						routingKey: ""
					} );
				}
			} );

			it( "should receive all messages", function() {
				harness.received.length.should.equal( messagesToSend );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		// this test is here primarily for use with detailed logging so that
		// one can observe the output and verify that the channel doesn't error
		// and close as a result (which it used to do)
		describe( "with noAck enabled", function() {
			var messagesToSend, harness;

			before( function( done ) {
				this.timeout( 5000 );

				messagesToSend = 1;
				harness = harnessFn( done, 1 );
				var messageCount = 0;

				harness.handle( "no.ack", function( message ) {
					if( messageCount < 1 ) {
						message.reject();
					}
					messageCount += 1;
				} );

				for (var i = 0; i < messagesToSend; i++) {
					rabbit.publish( "rabbot-ex.no-ack", {
						type: "no.ack",
						body: "message " + i,
						routingKey: ""
					} );
				}
			} );

			it( "should receive all messages", function() {
				harness.received.length.should.equal( messagesToSend );
			} );
		} );

		describe( "with wild card type handling", function() {
			var harness;
			before( function( done ) {
				harness = harnessFn( done, 3 );
				harness.handle( "#.a" );
				rabbit.publish( "rabbot-ex.topic", { type: "one.a", routingKey: "this.is.one", body: "one" } );
				rabbit.publish( "rabbot-ex.topic", { type: "two.i.a", routingKey: "this.is.two", body: "two" } );
				rabbit.publish( "rabbot-ex.topic", { type: "three-b.a", routingKey: "this.is.three", body: "three" } );
				rabbit.publish( "rabbot-ex.topic", { type: "a.four", routingKey: "this.is.four", body: "four" } );
			} );

			it( "should handle all message types ending in \"a\"", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						key: m.fields.routingKey
					};
				} );
				_.sortBy( results, "body" ).should.eql(
					[
						{ body: "one", key: "this.is.one" },
						{ body: "three", key: "this.is.three" },
						{ body: "two", key: "this.is.two" }
					] );
			} );

			it( "should not handle message types that don't match the pattern", function() {
				harness.unhandled.length.should.equal( 1 );
				harness.unhandled[ 0 ].body.should.eql( "four" );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with no type present", function() {
			var harness;
			before( function( done ) {
				harness = harnessFn( done, 1 );
				harness.handle( "#.typeless" );
				rabbit.publish( "rabbot-ex.topic", { type: "", routingKey: "this.is.typeless", body: "one" } );
			} );

			it( "should handle based on topic", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						key: m.fields.routingKey
					};
				} );
				_.sortBy( results, "body" ).should.eql(
					[
						{ body: "one", key: "this.is.typeless" }
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with queue specified", function() {
			var harness;
			before( function( done ) {
				harness = harnessFn( done, 3 );
				harness.handle( "", undefined, "rabbot-q.general1" );
				rabbit.publish( "rabbot-ex.fanout", { type: "", routingKey: "", body: "one" } );
				rabbit.publish( "rabbot-ex.fanout", { type: "", routingKey: "", body: "two" } );
				rabbit.publish( "rabbot-ex.fanout", { type: "", routingKey: "", body: "three" } );
			} );

			it( "should handle only messages delivered to queue specified", function() {
				var results = _.map( harness.received, function( m ) {
					return {
						body: m.body,
						queue: m.queue
					};
				} );
				_.sortBy( results, "body" ).should.eql(
					[
						{ body: "one", queue: "rabbot-q.general1" },
						{ body: "three", queue: "rabbot-q.general1" },
						{ body: "two", queue: "rabbot-q.general1" }
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

		describe( "with unroutable messages", function() {
			var harness;
			before( function( done ) {
				harness = harnessFn( done, 2 );
				rabbit.publish( "rabbot-ex.direct", { mandatory: true, routingKey: "completely.un.routable.1", body: "returned message #1" } );
				rabbit.publish( "rabbot-ex.direct", { mandatory: true, routingKey: "completely.un.routable.2", body: "returned message #2" } );
			} );

			it( "should capture messages returned by Rabbit", function() {
				var results = _.map( harness.returned, function( m ) {
					return {
						type: m.type,
						body: m.body
					};
				} );
				results.should.eql(
					[
						{ body: "returned message #1", type: "completely.un.routable.1" },
						{ body: "returned message #2", type: "completely.un.routable.2" }
					] );
			} );

			after( function() {
				harness.clean();
			} );
		} );

    describe( "with random queue name", function() {
      var harness, queueName;
      before( function( done ) {
        harness = harnessFn( done, 3 );
        harness.handle( "rando", undefined, queueName );
        rabbit.addQueue( "", { autoDelete: true, subscribe: true } )
          .then( function( queue ) {
            queueName = queue.name;
            rabbit.publish( "", { type: "rando", routingKey: queueName, body: "one" } );
            rabbit.publish( "", { type: "rando", routingKey: queueName, body: Buffer.from( "two" ) } );
            rabbit.publish( "", { type: "rando", routingKey: queueName, body: [ 0x62, 0x75, 0x66, 0x66, 0x65, 0x72 ] } );
          } );
      } );

      it( "should handle only messages delivered to queue specified", function() {
        var results = _.map( harness.received, function( m ) {
          return {
            body: m.body.toString(),
            queue: m.queue
          };
        } );
        _.sortBy( results, "body" ).should.eql(
          [
            { body: "98,117,102,102,101,114", queue: queueName },
            { body: "one", queue: queueName },
            { body: "two", queue: queueName }
          ] );
      } );

      after( function() {
        harness.clean();
      } );
    } );

    describe( "with no-name exchange", function() {
      var queueName,queueStats, harness;
      this.timeout(6000);
      before( function( done ) {
        harness = harnessFn( done, 3 );
        harness.handle( "persist.1", undefined, queueName );
        rabbit.addQueue( "persist.test", { autoDelete: true, subscribe: false } )
          .then( function( queue ) {
            queueName = queue.name;
            Promise.all(
              [
                rabbit.publish( "", { type: "persist.1", persistent:true, routingKey: queueName, body: "one" } ),
                rabbit.publish( "", { type: "persist.1", routingKey: queueName, body: Buffer.from( "two" ) } ),
                rabbit.publish( "", { type: "persist.1", routingKey: queueName, body: [ 0x62, 0x75, 0x66, 0x66, 0x65, 0x72 ] } )
              ]
            ).then( function() {
              ///crummy solution, but making the API request for stats immediately after publishing misses the messages
              global.setTimeout(function () {
                request.get({
                  url: "http://guest:guest@localhost:15672/api/queues/%2f/persist.test",
                  json:true
                }, function (err, resp, body) {
                  if (!err && resp.statusCode===200) {
                    queueStats = body;
                  }
                  //have to consume the messages for queue to get auto-deleted
                  rabbit.startSubscription("persist.test",false);
                });
              },5000);
              }
            );
          } );
      } );
      it( "should have 1 persistent and 3 total messages", function() {
        queueStats.messages.should.be.equal(3);
        queueStats.messages_persistent.should.be.equal(1);
      } );

      after( function() {
        harness.clean();
      } );
    } );

		after( function() {
			this.timeout( 5000 );
			rabbit.deleteExchange( "rabbot-ex.deadend" ).then( function() {} );
			return rabbit.shutdown();
		} );
	} );
} );

describe( "Integration Test Suite - Alternate Configuration", function() {
	var rabbit, harnessFn;
	before( function() {
		rabbit = require( "../../src/index.js" );
		harnessFn = harnessFactory.bind( undefined, rabbit );
		return rabbit.configure( require( "./alt-configuration.js" ) );
	} );

	describe( "with no replyQueue", function() {
		var harness, messagesToSend;

		before( function( done ) {
			messagesToSend = 3;
			harness = harnessFn( done, messagesToSend );

			harness.handle( "no.replyQueue", function( message ) {
				message.ack();
			} );

			for (var i = 0; i < messagesToSend; i++) {
				rabbit.publish( "noreply-ex.direct", {
					connectionName: "alternate",
					type: "no.replyQueue",
					body: "message " + i,
					routingKey: ""
				} );
			}
		} );

		it( "should receive all messages", function() {
			harness.received.length.should.equal( messagesToSend );
		} );
	} );

	after( function() {
		return rabbit.shutdown();
	} );
} );
