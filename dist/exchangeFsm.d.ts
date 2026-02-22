type Machine = Record<string, unknown> & {
    currentState: string;
    emit: (event: string, data?: unknown) => unknown;
    handle: (event: string, data?: unknown) => void;
    next: (state: string) => Promise<void>;
    once: (event: string, fn: (data?: unknown) => void) => void;
    on: (event: string, fn: (data?: unknown) => void) => unknown;
    after: (state: string) => Promise<void>;
    name?: unknown;
};
import publishLog from './publishLog.js';
interface ExchangeOptions {
    name: string;
    type: string;
    publishTimeout?: number;
    replyTimeout?: number;
    limit?: number;
    [key: string]: unknown;
}
interface Subscription {
    off: () => void;
}
interface Exchange {
    channel: {
        once: (event: string, fn: (data?: unknown) => void) => Subscription;
        on: (event: string, fn: (data?: unknown) => void) => Subscription;
    };
    define: () => Promise<unknown>;
    publish: (message: unknown) => Promise<unknown>;
    release: () => Promise<unknown>;
}
type ExchangeFn = (options: ExchangeOptions, topology: unknown, log: ReturnType<typeof publishLog>, serializers: unknown) => Promise<Exchange>;
export default function Factory(options: ExchangeOptions, connection: Machine, topology: unknown, serializers: unknown, exchangeFn?: ExchangeFn): Record<string, unknown>;
export {};
//# sourceMappingURL=exchangeFsm.d.ts.map