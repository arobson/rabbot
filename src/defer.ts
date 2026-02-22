export interface Deferred<T = unknown> {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  promise: Promise<T>;
}

export default function defer<T = unknown>(): Deferred<T> {
  const deferred = {
    resolve: null as unknown as (value: T | PromiseLike<T>) => void,
    reject: null as unknown as (reason?: unknown) => void,
    promise: null as unknown as Promise<T>,
  };
  deferred.promise = new Promise<T>((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}
