'use strict'

require( "../setup" );
const rabbit = require( "../../src/index.js" );
const config = require( "./configuration" );

/*
  This passes a queue name argument to rabbit's handle call
  so that it will register the harness's handler only for one
  of the bound fanout queue's.
*/
describe( "Queue Specific Handler", function() {
  var harness;

  before( function( done ) {
    rabbit.configure( {
      connection: config.connection,
      exchanges: [
        {
          name: "rabbot-ex.fanout",
          type: "fanout",
          autoDelete: true
        }
      ],
      queues: [
        {
          name: "rabbot-q.general1",
          autoDelete: true,
          subscribe: true
        },
        {
          name: "rabbot-q.general2",
          noAck: true,
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: "rabbot-ex.fanout",
          target: "rabbot-q.general1",
          keys: []
        },
        {
          exchange: "rabbot-ex.fanout",
          target: "rabbot-q.general2",
          keys: []
        }
      ]
    } ).then( () => {
      rabbit.publish( "rabbot-ex.fanout", { type: "", routingKey: "", body: "one" } );
      rabbit.publish( "rabbot-ex.fanout", { type: "", routingKey: "", body: "two" } );
      rabbit.publish( "rabbot-ex.fanout", { type: "", routingKey: "", body: "three" } );
    } );

    harness = harnessFactory( rabbit, done, 6 );
    harness.handle( "", undefined, "rabbot-q.general1" );
  } );

  it( "should only handle messages for the specified queue", function() {
    const results = harness.received.map( ( m ) => ( {
        body: m.body,
        queue: m.queue
      } ) );
    sortBy( results, "body" ).should.eql(
      [
        { body: "one", queue: "rabbot-q.general1" },
        { body: "three", queue: "rabbot-q.general1" },
        { body: "two", queue: "rabbot-q.general1" }
      ] );
  } );

  it( "should show the other messages as unhandled", function() {
    harness.unhandled.length.should.eql( 3 );
  } );

  after( function() {
    return harness.clean( "default" );
  } );
} );
