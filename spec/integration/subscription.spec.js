'use strict'

require( "../setup" );
const rabbit = require( "../../src/index.js" );
const config = require( "./configuration" );

/*
A promise, twice made, is not a promise for more,
it's simply reassurance for the insecure.
*/
describe( "Duplicate Subscription", function() {
  var harness;

  before( function( done ) {
    rabbit.configure( {
      connection: config.connection,
      exchanges: [
        {
          name: "rabbot-ex.subscription",
          type: "topic",
          alternate: "rabbot-ex.alternate",
          autoDelete: true
        }
      ],
      queues: [
        {
          name: "rabbot-q.subscription",
          autoDelete: true,
          subscribe: true,
          deadletter: "rabbot-ex.deadletter"
        }
      ],
      bindings: [
        {
          exchange: "rabbot-ex.subscription",
          target: "rabbot-q.subscription",
          keys: "this.is.#"
        }
      ]
    } ).then( () => {
      harness.handle( "topic" );
      rabbit.startSubscription( "rabbot-q.subscription" , false, config.connection.name);
      rabbit.publish( "rabbot-ex.subscription", { type: "topic", routingKey: "this.is.an.array", body: [ 1, 2, 3 ] }, config.connection.name );
      rabbit.publish( "rabbot-ex.subscription", { type: "topic", routingKey: "this.is.an.object", body: { foo: 'bar' } }, config.connection.name );
      rabbit.publish( "rabbot-ex.subscription", { type: "topic", routingKey: "this.is.a.test", body: "broadcast" }, config.connection.name );
      rabbit.publish( "rabbot-ex.subscription", { type: "topic", routingKey: "this.is.sparta", body: "leonidas" }, config.connection.name );
      rabbit.publish( "rabbot-ex.subscription", { type: "topic", routingKey: "this.is.not.wine.wtf", body: "socrates" }, config.connection.name );
    } );
    harness = harnessFactory( rabbit, done, 3 );
  } );

  it( "should handle all messages once", function() {
    const results = harness.received.map( ( m ) =>
      ( {
        body: m.body,
        key: m.fields.routingKey
      } )
    );
    sortBy( results, "body" ).should.eql(
      [
        { body: [ 1, 2, 3 ], key: "this.is.an.array" },
        { body: { foo: "bar" }, key: "this.is.an.object" },
        { body: "broadcast", key: "this.is.a.test" },
        { body: "leonidas", key: "this.is.sparta" },
        { body: "socrates", key: "this.is.not.wine.wtf" }
      ] );
  } );

  after( function() {
    return harness.clean( config.connection.name );
  } );
} );
