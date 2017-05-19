require( "../setup" );
const rabbit = require( "../../src/index.js" );

describe( "Publishing Messages", () => {

  describe( "without a connection defined", () => {
    it( "should reject publish call with missing connection", () => {
      return rabbit.publish( "", { type: "nothing", routingKey: "", body: "", connectionName: "notthere" } )
        .should.be.rejectedWith( "Publish failed - no connection notthere has been configured" );
    } );
  } );

  describe( "with a connection and no exchange defined", () => {
    it( "should reject publish call with missing exchange", () => {
      rabbit.addConnection( {} );
      return rabbit.publish( "missing.ex", { type: "nothing", routingKey: "", body: "" } )
        .should.be.rejectedWith( "Publish failed - no exchange missing.ex on connection default is defined" );
    } );

    after( () => {
      rabbit.reset();
      return rabbit.shutdown();
    } );
  } );

  describe( "with a connection and exchange defined", () => {

    it( "should not error on publish calls", () => {
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

    after( () => {
      return rabbit.deleteExchange( "simple.ex", "temp" )
        .then( () => {
          rabbit.reset();
          return rabbit.shutdown();
        } );
    } );

  } );
} );
