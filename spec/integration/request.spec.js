'use strict'

require( "../setup" );
const rabbit = require( "../../src/index.js" );
const config = require( "./configuration" );

describe( "Request & Response", function() {
  var harness;
  before( function() {
    return rabbit.configure( {
      connection: config.connection,
      exchanges: [
        {
          name: "rabbot-ex.request",
          type: "fanout",
          autoDelete: true
        }
      ],
      queues: [
        {
          name: "rabbot-q.request",
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: "rabbot-ex.request",
          target: "rabbot-q.request",
          keys: []
        }
      ]
    } )
  } );

  describe( "when getting a response within the timeout", function() {
    var response1;
    var response2;
    var response3;

    before( function( done ) {
      this.timeout( 3000 );
      harness = harnessFactory( rabbit, done, 9 );

      harness.handle( "polite", ( q ) => {
        q.reply( ":D" );
      } );

      harness.handle( "rude", ( q ) => {
        q.reply( ">:@" );
      } );

      harness.handle( "silly", ( q ) => {
        q.reply( '...', { more: true } );
        q.reply( '...', { more: true } );
        q.reply( '...', { more: true } );
        setTimeout( () => q.reply( '...' ), 10 );
      } );

      rabbit.request( "rabbot-ex.request", { type: "polite", body: "how are you?" } )
        .then( ( response ) => {
          response1 = response.body;
          harness.add( response );
          response.ack();
        } );

      rabbit.request( "rabbot-ex.request", { type: "rude", body: "why so dumb?" } )
        .then( ( response ) => {
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
        { type: "silly", body: "do you like my yak-hair-shirt?" },
        onPart
      ).then( onPart );
    } );

    it( "should receive multiple responses", function() {
      var results = harness.received.map( ( m ) => ( {
          body: m.body
        } ) );
      sortBy( results, "body" ).should.eql(
        [
          { body: "..." },
          { body: "..." },
          { body: "..." },
          { body: "..." },
          { body: ":D" },
          { body: ">:@" },
          { body: "do you like my yak-hair-shirt?" },
          { body: "how are you?" },
          { body: "why so dumb?" }
        ] );
    } );

    it( "should capture responses corresponding to the originating request", function() {
      response1.should.equal( ":D" );
      response2.should.equal( ">:@" );
      response3.should.equal( "............" );
    } );

    after( function() {
      harness.clean();
    } );
  } );

  describe( "when the request times out", function() {
    var timeoutError;
    const timeout = 100;
    before( function() {
      return rabbit.request( "rabbot-ex.request", { type: "polite", body: "how are you?", replyTimeout: timeout } )
        .then( null, ( err ) => {
          timeoutError = err;
        } )
    } );

    it( "should receive rejection with timeout error", function() {
      timeoutError.message.should.eql( `No reply received within the configured timeout of ${timeout} ms` );
    } );
  } );

  after( function() {
    return harness.clean( "default" )
  } );
} );
