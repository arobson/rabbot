export default (name) => {
  let handlers = {};

  function raise (ev) {
    if (handlers[ev]) {
      const args = Array.prototype.slice.call(arguments, 1);
      handlers[ev].slice().forEach(function (handler) {
        if (handler) {
          handler.apply(undefined, args);
        }
      });
    }
  }

  function remove (ev, handle) {
    if (handlers[ev]) {
      const index = handlers[ev].indexOf(handle);
      if (index >= 0) {
        handlers[ev].splice(index, 1);
      }
    }
  }

  function on (ev, handle) {
    if (handlers[ev]) {
      handlers[ev].push(handle);
    } else {
      handlers[ev] = [handle];
    }
    return {
      off: function () { remove(ev, handle); },
      remove: function () { remove(ev, handle); }
    };
  }

  function once (ev, handle) {
    const wrapped = function () {
      remove(ev, wrapped);
      return handle.apply(undefined, arguments);
    };
    return on(ev, wrapped);
  }

  function reset () {
    handlers = {};
  }

  return {
    name: name || 'default',
    handlers,
    on,
    once,
    raise,
    reset
  };
};
