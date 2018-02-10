
var rabbit = require('../../src/index.js');

require('./topology')(rabbit)
  .then(function () {
    require('./subscriber-topic-left')(rabbit);
    require('./subscriber-topic-right')(rabbit);
  });
