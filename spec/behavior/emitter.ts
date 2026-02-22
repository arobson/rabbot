interface Subscription {
  off: () => void;
  remove: () => void;
}

export default function createEmitter(name?: string) {
  const handlers: Record<string, ((data?: unknown) => void)[]> = {};

  function raise(ev: string, ...args: unknown[]): void {
    if (handlers[ev]) {
      [...handlers[ev]].forEach((handler) => {
        if (handler) handler(args[0] as unknown);
      });
    }
  }

  function on(ev: string, handle: (data?: unknown) => void): Subscription {
    if (handlers[ev]) {
      handlers[ev].push(handle);
    } else {
      handlers[ev] = [handle];
    }
    const remove = () => {
      const list = handlers[ev];
      if (list) {
        const idx = list.indexOf(handle);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
    return { off: remove, remove };
  }

  function once(ev: string, handle: (data?: unknown) => void): Subscription {
    let sub: Subscription;
    const wrapper = (data?: unknown) => {
      sub?.off();
      handle(data);
    };
    sub = on(ev, wrapper);
    return sub;
  }

  function reset(): void {
    Object.keys(handlers).forEach(k => delete handlers[k]);
  }

  return {
    name: name || 'default',
    handlers,
    on,
    once,
    raise,
    reset,
  };
}
