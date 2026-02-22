export interface Deferred<T = unknown> {
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
    promise: Promise<T>;
}
export default function defer<T = unknown>(): Deferred<T>;
//# sourceMappingURL=defer.d.ts.map