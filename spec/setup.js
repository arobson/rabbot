var chai = require( 'chai' );
chai.use( require( 'chai-as-promised' ) );
global.should = chai.should();
global.expect = chai.expect;
global.sinon = require( 'sinon' );
require( 'sinon-as-promised' );
