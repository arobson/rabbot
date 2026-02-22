import AckBatch from '../ackBatch.js';
declare const dispatch: import("topic-dispatch").Dispatcher;
declare const responses: import("topic-dispatch").Dispatcher;
export { dispatch, responses };
interface QueueOptions {
    name: string;
    uniqueName?: string;
    subscribe?: boolean;
    exclusive?: boolean;
    noAck?: boolean;
    noBatch?: boolean;
    noCacheKeys?: boolean;
    poison?: boolean;
    autoDelete?: boolean;
    contentType?: string;
    consumerTag?: string;
    limit?: number;
    queuelimit?: number;
    queueLimit?: number;
    deadletter?: string;
    deadLetter?: string;
    deadLetterRoutingKey?: string;
    [key: string]: unknown;
}
interface Serializer {
    serialize: (body: unknown) => Buffer;
    deserialize: (bytes: Buffer, encoding?: string) => unknown;
}
interface Serializers {
    [contentType: string]: Serializer;
}
interface Topology {
    connection: {
        name: string;
    };
    replyQueue: {
        name: string | false;
    };
    onUnhandled: (message: unknown) => void;
}
export default function createQueue(options: QueueOptions, topology: Topology, serializers: Serializers): Promise<{
    channel: unknown;
    messages: AckBatch;
    define: () => Promise<{
        queue?: string;
        messageCount?: number;
    }>;
    finalize: () => void;
    getMessageCount: () => number;
    purge: () => Promise<number>;
    release: (released?: boolean | undefined) => Promise<void>;
    subscribe: (exclusive?: boolean | undefined) => Promise<unknown>;
    unsubscribe: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map