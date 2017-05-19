require( "../setup" );
const rabbit = require( "../../src/index.js" );
const config = require( "./configuration" );

describe( "Request & Response", () => {
  var harness;
  before( () =>
    rabbit.configure( {
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
  );

  describe( "when getting a response within the timeout", () => {
    var response1;
    var response2;
    var response3;

    before( ( done ) => {
      harness = harnessFactory( rabbit, done, 8 );
      harness.handle( "polite", ( q ) => {
        q.reply( ":D" );
      } );
      harness.handle( "rude", ( q ) => {
        q.reply( ">:@" );
      } );
      harness.handle( "crazy", ( q ) => {
        q.reply( '...', { more: true } );
        q.reply( '...', { more: true } );
        q.reply( '...' );
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
        { type: "crazy", body: "do you like my yak-hair-shirt?" },
        onPart
      )
      .then( ( response ) => {
        onPart( response );
      } );
    } );

    it( "should receive multiple responses", () => {
      var results = harness.received.map( ( m ) => ( {
          body: m.body
        } ) );
      sortBy( results, "body" ).should.eql(
        [
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

    it( "should capture responses corresponding to the originating request", () => {
      response1.should.equal( ":D" );
      response2.should.equal( ">:@" );
      response3.should.equal( "........." );
    } );

    after( () => {
      harness.clean();
    } );
  } );

  describe( "when the request times out", () => {
    var timeoutError;
    const timeout = 100;
    before( () =>
      rabbit.request( "rabbot-ex.request", { type: "polite", body: "how are you?", replyTimeout: timeout } )
        .then( null, ( err ) => {
          timeoutError = err;
        } )
    );

    it( "should receive rejection with timeout error", () => {
      timeoutError.message.should.eql( `No reply received within the configured timeout of ${timeout} ms` );
    } );
  } );

  after( () => harness.clean( "default" ) );
} );
