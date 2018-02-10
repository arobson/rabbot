function defer () {
  const deferred = {
    resolve: null,
    reject: null,
    promise: null
  };
  deferred.promise = new Promise(function (resolve, reject) {
    deferred.reject = reject;
    deferred.resolve = resolve;
  });
  return deferred;
}

module.exports = defer;
