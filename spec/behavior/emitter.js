module.exports = (name) => {
  let handlers = {}

  function emit (ev) {
    if (handlers[ev]) {
      const args = Array.prototype.slice.call(arguments, 0)
      handlers[ev].forEach(function (handler) {
        if (handler) {
          handler.apply(undefined, args)
        }
      })
    }
  }

  function on (ev, handle) {
    if (handlers[ev]) {
      handlers[ev].push(handle)
    } else {
      handlers[ev] = [handle]
    }
    return {
      remove: function (h) {
        handlers[ev].splice(handlers[ev].indexOf(h || handle)) // jshint ignore:line
      }
    }
  }

  function reset () {
    handlers = {}
  }

  return {
    name: name || 'default',
    handlers: handlers,
    on: on,
    once: on,
    emit: emit,
    reset: reset
  }
}
