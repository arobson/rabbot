require('../../setup.js');
var rewire = require('rewire');
var connection = rewire('../../../src/amqp/connection.js');

var pctEncodeForwardSlash = connection.__get__('pctEncodeForwardSlash');
var Adapter = connection.__get__('Adapter');

describe('pctEncodeForwardSlash', function () {
  it('should encode / to %2F', function (done) {
    pctEncodeForwardSlash('/').should.equal('%2F');
    done();
  });

  it('should encode multiple occurrences of  / to %2F', function (done) {
    pctEncodeForwardSlash('/test/').should.equal('%2Ftest%2F');
    done();
  });

  it(`should not encode !#$&'()*+,:;=?@[]`, function (done) {
    pctEncodeForwardSlash(`!#$&'()*+,:;=?@[]`).should.equal(`!#$&'()*+,:;=?@[]`);
    done();
  });
});

describe('getUri', function () {
  var revert;
  var pctEncodeForwardSlashMock;
  beforeEach(function (done) {
    pctEncodeForwardSlashMock = sinon.mock();
    revert = connection.__set__('pctEncodeForwardSlash', pctEncodeForwardSlashMock);
    done();
  });
  afterEach(function (done) {
    revert();
    done();
  });

  it('should call pctEncodeForwardSlash', function (done) {
    var adapter = new Adapter({pass: '/password'});
    adapter.getNextUri();
    sinon.assert.calledOnce(pctEncodeForwardSlashMock);
    sinon.assert.calledWith(pctEncodeForwardSlashMock, '/password');
    done();
  });
});
