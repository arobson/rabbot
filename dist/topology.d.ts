import { EventEmitter } from 'events';
import ExchangeFsm from './exchangeFsm.js';
import QueueFsm from './queueFsm.js';
type ChannelLike = Record<string, unknown> & {
    once: (event: string, fn: (data?: unknown) => void) => void;
    on: (event: string, fn: (data?: unknown) => void) => {
        off: () => void;
    };
};
interface BindingDef {
    exchange?: string;
    source?: string;
    target: string;
    queueAlias?: string;
    keys?: string | string[];
    queue?: boolean;
    uniqueName?: string;
}
interface QueueDef {
    name: string;
    unique?: string;
    uniqueName?: string;
    [key: string]: unknown;
}
interface ExchangeDef {
    name: string;
    [key: string]: unknown;
}
interface TopologyOptions {
    name?: string;
    replyQueue?: string | {
        name: string | false;
        autoDelete?: boolean;
        subscribe?: boolean;
        noAck?: boolean;
    } | false;
    publishTimeout?: number;
    [key: string]: unknown;
}
interface Serializer {
    serialize: (body: unknown) => Buffer;
    deserialize: (bytes: Buffer, encoding?: string) => unknown;
}
interface UnhandledStrategies {
    onUnhandled: (message: unknown) => void;
}
interface ReturnedStrategies {
    onReturned: (message: unknown) => void;
}
interface Connection {
    name: string;
    state?: string;
    currentState?: string;
    getChannel: (name: string, confirm: boolean, context: string) => Promise<{
        bindQueue: (target: string, source: string, key: string) => Promise<unknown>;
        unbindQueue: (target: string, source: string, key: string) => Promise<unknown>;
        bindExchange: (target: string, source: string, key: string) => Promise<unknown>;
        unbindExchange: (target: string, source: string, key: string) => Promise<unknown>;
        deleteExchange: (name: string) => Promise<unknown>;
        deleteQueue: (name: string) => Promise<unknown>;
    }>;
    on: (event: string, fn: (data?: unknown) => void) => {
        off: () => void;
    };
    lastError?: () => unknown;
    addExchange: (exchange: unknown) => void;
    addQueue: (queue: unknown) => void;
    connect: () => Promise<void>;
    close: (reset?: boolean) => Promise<void>;
}
declare class Topology extends EventEmitter {
    private readonly Exchange;
    private readonly Queue;
    private readonly replyId;
    name: string;
    connection: Connection;
    channels: Record<string, ChannelLike>;
    promises: Record<string, Promise<unknown> | undefined>;
    definitions: {
        bindings: Record<string, BindingDef>;
        exchanges: Record<string, ExchangeDef>;
        queues: Record<string, QueueDef>;
    };
    options: TopologyOptions;
    replyQueue: {
        name: string | false;
        autoDelete?: boolean;
        subscribe?: boolean;
        noAck?: boolean;
    };
    serializers: Record<string, Serializer>;
    onUnhandled: (message: unknown) => void;
    onReturned: (message: unknown) => void;
    constructor(connection: Connection, options: TopologyOptions, serializers: Record<string, Serializer>, unhandledStrategies: UnhandledStrategies, returnedStrategies: ReturnedStrategies, Exchange: typeof ExchangeFsm, Queue: typeof QueueFsm, replyId: string);
    completeRebuild(): Promise<void>;
    configureBindings(bindingDef: unknown, list?: boolean): Promise<unknown>;
    configureQueues(queueDef: unknown, list?: boolean): Promise<unknown>;
    configureExchanges(exchangeDef: unknown, list?: boolean): Promise<unknown>;
    createBinding(options: BindingDef & {
        source: string;
    }): Promise<unknown>;
    createPrimitive(Primitive: typeof ExchangeFsm | typeof QueueFsm, primitiveType: string, options: ExchangeDef | QueueDef): Promise<ChannelLike>;
    createDefaultExchange(): Promise<ChannelLike>;
    createExchange(options: ExchangeDef): Promise<ChannelLike>;
    createQueue(options: QueueDef): Promise<ChannelLike>;
    createReplyQueue(): Promise<unknown>;
    deleteExchange(name: string): Promise<unknown>;
    deleteQueue(name: string): Promise<unknown>;
    getUniqueName(options: QueueDef): string;
    handleReturned(raw: unknown): void;
    onReconnect(): void;
    onReplyQueueFailed(err: unknown): void;
    reconnectChannels(): Promise<unknown>[];
    reset(): void;
    renameQueue(newQueueName: string): void;
    removeBinding(options: BindingDef & {
        source: string;
    }): Promise<unknown>;
}
export default function createTopology(connection: Connection, options: TopologyOptions, serializers: Record<string, Serializer>, unhandledStrategies: UnhandledStrategies, returnedStrategies: ReturnedStrategies, exchangeFsm?: typeof ExchangeFsm, queueFsm?: typeof QueueFsm, defaultId?: string): Topology;
export type { Topology };
//# sourceMappingURL=topology.d.ts.map