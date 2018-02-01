'use strict';

const _ = require( "lodash" );
const Monologue = require( "monologue.js" );
const connectionFn = require( "./connectionFsm.js" );
const topologyFn = require( "./topology.js" );
const postal = require( "postal" );
const uuid = require( "uuid" );
const dispatch = postal.channel( "rabbit.dispatch" );
const responses = postal.channel( "rabbit.responses" );
const signal = postal.channel( "rabbit.ack" );
const format = require( "util" ).format;
const log = require( "./log" );

const DEFAULT = "default";

const unhandledStrategies = {
  nackOnUnhandled: function( message ) {
    message.nack();
  },
  rejectOnUnhandled: function( message ) {
    message.reject();
  },
  customOnUnhandled: function() {}
};

const returnedStrategies = {
  customOnReturned: function() {}
};

unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;
returnedStrategies.onReturned = returnedStrategies.customOnReturned;

const serializers = {
  "application/json": {
    deserialize: ( bytes, encoding ) => {
      return JSON.parse( bytes.toString( encoding || "utf8" ) );
    },
    serialize: ( object ) => {
      return new Buffer( JSON.stringify( object ), "utf8" );
    }
  },
  "application/octet-stream": {
    deserialize: ( bytes ) => {
      return bytes;
    },
    serialize: ( bytes ) => {
      if( Buffer.isBuffer( bytes ) ) {
        return bytes;
      } else if( Array.isArray( bytes ) ) {
        return Buffer.from( bytes );
      } else {
        throw new Error( "Cannot serialize unknown data type" );
      }
    }
  },
  "text/plain": {
    deserialize: ( bytes, encoding ) => {
      return bytes.toString( encoding || "utf8" );
    },
    serialize: ( string ) => {
      return new Buffer( string, "utf8" );
    }
  }
};

var Broker = function() {
  this.connections = {};
  this.hasHandles = false;
  this.autoNack = false;
  this.serializers = serializers;
  this.configurations = {};
  this.log = log;
  _.bindAll( this );
};

Broker.prototype.addConnection = function( opts ) {
  const self = this

  const options = Object.assign( {}, {
    name: DEFAULT,
    retryLimit: 3,
    failAfter: 60
  }, opts );
  const name = options.name;
  let connection;

  const connectionPromise = new Promise( ( resolve, reject ) => {
    if ( !self.connections[ name ] ) {

      connection = connectionFn( options );
      const topology = topologyFn( connection, options, serializers, unhandledStrategies, returnedStrategies );

      connection.on( "connected", () => {
        self.emit( "connected", connection );
        self.emit( connection.name + ".connection.opened", connection );
        self.setAckInterval( 500 );
        resolve( topology )
      } );

      connection.on( "closed", () => {
        self.emit( "closed", connection );
        self.emit( connection.name + ".connection.closed", connection );
        reject( new Error( "connection closed" ) )
      } );

      connection.on( "failed", ( err ) => {
        self.emit( "failed", connection );
        self.emit( name + ".connection.failed", err );
        reject( err )
      } );

      connection.on( "unreachable", () => {
        self.emit( "unreachable", connection );
        self.emit( name + ".connection.unreachable" );
        self.clearAckInterval();
        reject( new Error( "connection unreachable" ) )
      } );

      connection.on( "return", ( raw ) => {
        self.emit( "return", raw );
      } );
      self.connections[ name ] = topology;
    } else {
      connection = self.connections[ name ];
      connection.connection.connect();
      resolve( connection );
    }
  } );

  if( !this.connections[ name ].promise ) {
    this.connections[ name ].promise = connectionPromise;
  }
  return connectionPromise;
};

Broker.prototype.addExchange = function( name, type, options, connectionName ) {

  options = options === undefined ?  {} : options;
  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  if ( _.isObject( name ) ) {
    options = name;
    options.connectionName = options.connectionName || type || connectionName;
  } else {
    options.name = name;
    options.type = type;
    options.connectionName = options.connectionName || connectionName;
  }
  return this.connections[ options.connectionName ].createExchange( options );
};

Broker.prototype.addQueue = function( name, options, connectionName ) {

  options = options === undefined ?  {} : options;
  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  options.name = name;
  if ( options.subscribe && !this.hasHandles ) {
    console.warn( "Subscription to '" + name + "' was started without any handlers. This will result in lost messages!" );
  }
  return this.connections[ connectionName ].createQueue( options, connectionName );
};

Broker.prototype.addSerializer = function( contentType, serializer ) {
  serializers[ contentType ] = serializer;
};

Broker.prototype.batchAck = function() {
  signal.publish( "ack", {} );
};

Broker.prototype.bindExchange = function( source, target, keys, connectionName ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  return this.connections[ connectionName ].createBinding( { source: source, target: target, keys: keys } );
};

Broker.prototype.bindQueue = function( source, target, keys, connectionName ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  return this.connections[ connectionName ].createBinding(
    { source: source, target: target, keys: keys, queue: true },
    connectionName
  );
};

Broker.prototype.clearAckInterval = function() {
  clearInterval( this.ackIntervalId );
};

Broker.prototype.closeAll = function( reset ) {
  // COFFEE IS FOR CLOSERS
  const connectionNames = Object.keys( this.connections );
  const closers = connectionNames.map( ( connection ) =>
    this.close( connection, reset )
  );
  return Promise.all( closers );
};

Broker.prototype.close = function( connectionName, reset ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;
  reset = reset === undefined ? false : reset;

  const connection = this.connections[ connectionName ].connection;
  if ( connection !== undefined && connection !== null ) {
    if( reset ) {
      this.connections[ connectionName ].reset();
    }
    return connection.close( reset );
  } else {
    return Promise.resolve( true );
  }
};

Broker.prototype.deleteExchange = function( name, connectionName ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  return this.connections[ connectionName ].deleteExchange( name );
};

Broker.prototype.deleteQueue = function( name, connectionName ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  return this.connections[ connectionName ].deleteQueue( name );
};

Broker.prototype.getExchange = function( name, connectionName ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  return this.connections[ connectionName ].channels[ "exchange:" + name ];
};

Broker.prototype.getQueue = function( name, connectionName ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  return this.connections[ connectionName ].channels[ "queue:" + name ];
};

Broker.prototype.handle = function( messageType, handler, queueName, context ) {
  this.hasHandles = true;
  var options;
  if( _.isString( messageType ) ) {
    options = {
      type: messageType,
      queue: queueName || "*",
      context: context,
      autoNack: this.autoNack,
      handler: handler
    }
  } else {
    options = messageType;
    options.autoNack = options.autoNack === false ? false : true;
    options.queue = options.queue || (options.type ? '*' : '#');
    options.handler = options.handler || handler;
  }
  const parts = [];
  if( options.queue === "#" ) {
    parts.push( "#" );
  } else {
    parts.push( options.queue.replace( /[.]/g, "-" ) );
    if( options.type !== "" ) {
      parts.push( options.type || "#" );
    }
  }

  const target = parts.join( "." );
  const subscription = dispatch.subscribe( target, options.handler.bind( options.context ) );
  if ( options.autoNack ) {
    subscription.catch( function( err, msg ) {
      console.log( "Handler for '" + target + "' failed with:", err.stack );
      msg.nack();
    } );
  }
  subscription.remove = subscription.unsubscribe;
  return subscription;
};

Broker.prototype.ignoreHandlerErrors = function() {
  this.autoNack = false;
};

Broker.prototype.nackOnError = function() {
  this.autoNack = true;
};

Broker.prototype.nackUnhandled = function() {
  unhandledStrategies.onUnhandled = unhandledStrategies.nackOnUnhandled;
};

Broker.prototype.onUnhandled = function( handler ) {
  unhandledStrategies.onUnhandled = unhandledStrategies.customOnUnhandled = handler;
};

Broker.prototype.rejectUnhandled = function() {
  unhandledStrategies.onUnhandled = unhandledStrategies.rejectOnUnhandled;
};

Broker.prototype.onReturned = function( handler ) {
  returnedStrategies.onReturned = returnedStrategies.customOnReturned = handler;
};

Broker.prototype.publish = function( exchangeName, type, message, routingKey, correlationId, connectionName, sequenceNo ) {
  const timestamp = Date.now();
  let options;
  if ( _.isObject( type ) ) {
    options = type;
    connectionName = message || options.connectionName || DEFAULT;
  } else {
    connectionName = connectionName || message.connectionName || DEFAULT;
    options = {
      appId: this.appId,
      type: type,
      body: message,
      routingKey: routingKey,
      correlationId: correlationId,
      sequenceNo: sequenceNo,
      timestamp: timestamp,
      headers: {},
      connectionName: connectionName
    };
  }
  if( !this.connections[ connectionName ] ) {
    return Promise.reject( new Error( `Publish failed - no connection ${connectionName} has been configured` ) );
  }
  if( this.connections[ connectionName ] && this.connections[ connectionName ].options.publishTimeout ) {
    options.connectionPublishTimeout = this.connections[ connectionName ].options.publishTimeout;
  }
  if( _.isNumber( options.body ) ) {
    options.body = options.body.toString();
  }

  return this.connections[ connectionName ].promise
    .then( () => {
      const exchange = this.getExchange( exchangeName, connectionName );
      if( exchange ) {
        return exchange.publish( options );
      } else {
        return Promise.reject( new Error( `Publish failed - no exchange ${exchangeName} on connection ${connectionName} is defined` ) );
      }
    } );
};

Broker.prototype.request = function( exchangeName, options, notify, connectionName ) {

  options = options === undefined ? {} : options;
  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  const requestId = uuid.v1();
  options.messageId = requestId;
  options.connectionName = options.connectionName || connectionName;
  const connection = this.connections[ options.connectionName ].options;
  const exchange = this.getExchange( exchangeName, options.connectionName );
  const publishTimeout = options.timeout || exchange.publishTimeout || connection.publishTimeout || 500;
  const replyTimeout = options.replyTimeout || exchange.replyTimeout || connection.replyTimeout || ( publishTimeout * 2 );

  return new Promise( ( resolve, reject ) => {
    const timeout = setTimeout( function() {
      subscription.unsubscribe();
      reject( new Error( "No reply received within the configured timeout of " + replyTimeout + " ms" ) );
    }, replyTimeout );
    const subscription = responses.subscribe( requestId, function( message ) {
      if ( message.properties.headers[ "sequence_end" ] ) { // jshint ignore:line
        clearTimeout( timeout );
        resolve( message );
        subscription.unsubscribe();
      } else if( notify ) {
        notify( message );
      }
    } );
    this.publish( exchangeName, options );
  } );
};

Broker.prototype.reset = function() {
  this.connections = {};
  this.configurations = {};
};

Broker.prototype.retry = function( connectionName ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  var config = this.configurations[ connectionName ];
  return this.configure( config );
};

Broker.prototype.setAckInterval = function( interval ) {
  if ( this.ackIntervalId ) {
    this.clearAckInterval();
  }
  this.ackIntervalId = setInterval( this.batchAck, interval );
};

Broker.prototype.shutdown = function() {
  return this.closeAll( true )
    .then( () => {
      this.clearAckInterval();
    } );
};

Broker.prototype.startSubscription = function( queueName, exclusive, connectionName ) {

  exclusive = exclusive === undefined ? false : exclusive;
  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  if ( !this.hasHandles ) {
    console.warn( "Subscription to '" + queueName + "' was started without any handlers. This will result in lost messages!" );
  }
  if( _.isString( exclusive ) ) {
    connectionName = exclusive;
    exclusive = false;
  }
  var queue = this.getQueue( queueName, connectionName );
  if ( queue ) {
    return queue.subscribe( exclusive );
  } else {
    throw new Error( "No queue named '" + queueName + "' for connection '" + connectionName + "'. Subscription failed." );
  }
};

Broker.prototype.stopSubscription = function( queueName, connectionName ) {

  connectionName = connectionName === undefined ? DEFAULT : connectionName;

  var queue = this.getQueue( queueName, connectionName );
  if( queue ) {
    queue.unsubscribe();
    return queue;
  } else {
    throw new Error( "No queue named '" + queueName + "' for connection '" + connectionName + "'. Unsubscribe failed." );
  }
}

require( "./config.js" )( Broker );

Monologue.mixInto( Broker );

var broker = new Broker();

module.exports = broker;
