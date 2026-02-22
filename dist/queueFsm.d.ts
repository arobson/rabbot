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
interface QueueOptions {
    name: string;
    uniqueName?: string;
    subscribe?: boolean;
    exclusive?: boolean;
    noAck?: boolean;
    [key: string]: unknown;
}
interface Subscription {
    off: () => void;
}
interface QueueAmqp {
    channel: {
        on: (event: string, fn: (data?: unknown) => void) => Subscription;
        once: (event: string, fn: (data?: unknown) => void) => Subscription;
        tag?: string;
    };
    messages: {
        changeName: (name: string) => void;
    };
    define: () => Promise<{
        queue?: string;
    }>;
    subscribe: (exclusive: boolean) => Promise<unknown>;
    unsubscribe: () => Promise<unknown>;
    purge: () => Promise<number>;
    release: () => Promise<unknown>;
    getMessageCount: () => number;
}
type QueueFn = (options: QueueOptions, topology: unknown, serializers: unknown) => Promise<QueueAmqp>;
export default function Factory(options: QueueOptions, connection: Machine, topology: {
    renameQueue: (name: string) => void;
}, serializers: unknown, queueFn?: QueueFn): Record<string, unknown>;
export {};
//# sourceMappingURL=queueFsm.d.ts.map