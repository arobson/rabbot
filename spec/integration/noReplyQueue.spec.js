require( "../setup" );
const rabbit = require( "../../src/index.js" );
const config = require( "./configuration" );

describe( "No Reply Queue (replyQueue: false)", () => {
  var messagesToSend;
  var harness;

  before( ( done ) => {
    rabbit.configure( {
      connection: config.noReplyQueue,
      exchanges: [
        {
          name: "noreply-ex.direct",
          type: "direct",
          autoDelete: true
        }
      ],
      queues: [
        {
          name: "noreply-q.direct",
          autoDelete: true,
          subscribe: true
        }
      ],
      bindings: [
        {
          exchange: "noreply-ex.direct",
          target: "noreply-q.direct",
          keys: ""
        }
      ]
    } ).then( () => {
      messagesToSend = 3;
      harness.handle( "no.replyQueue" );
      for (var i = 0; i < messagesToSend; i++) {
        rabbit.publish( "noreply-ex.direct", {
          connectionName: "noReplyQueue",
          type: "no.replyQueue",
          body: "message " + i,
          routingKey: ""
        } );
      }
    } );
    harness = harnessFactory( rabbit, done, messagesToSend );
  } );

  it( "should receive all messages", () => {
    harness.received.length.should.equal( messagesToSend );
  } );

  after( () => harness.clean( "noReplyQueue" ) );
} );
