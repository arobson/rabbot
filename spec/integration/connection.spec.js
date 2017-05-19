require( "../setup" );
const rabbit = require( "../../src/index.js" );
const config = require( "./configuration" );

describe( "Connection", () => {
  const noop = () => {};

  describe( "on connection", () => {
    var connected;
    before( () => {
      rabbit.once( "connected", ( c ) => connected = c );
      return rabbit.configure( { connection: config.connection } );
    } );

    it( "should assign uri to connection", () =>
      connected.uri.should.equal( "amqp://guest:guest@127.0.0.1:5672/%2f?heartbeat=30" )
    );

    after( () => rabbit.close( "default" ) );
  } );
} );
