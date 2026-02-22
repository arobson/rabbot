import { EventEmitter } from 'events';
import log from './log.js';
import type { Topology } from './topology.js';
type ChannelLike = Record<string, unknown>;
interface MessageLike {
    nack: () => void;
    reject: () => void;
    [key: string]: unknown;
}
interface Serializer {
    serialize: (body: unknown) => Buffer;
    deserialize: (bytes: Buffer, encoding?: string) => unknown;
}
interface ConnectionOptions {
    name?: string;
    retryLimit?: number;
    failAfter?: number;
    publishTimeout?: number;
    replyTimeout?: number;
    [key: string]: unknown;
}
interface PublishOptions {
    appId?: string;
    type?: string;
    body?: unknown;
    routingKey?: string;
    correlationId?: string;
    sequenceNo?: string | number;
    timestamp?: number;
    headers?: Record<string, unknown>;
    connectionName?: string;
    timeout?: number;
    connectionPublishTimeout?: number;
    messageId?: string;
    replyTimeout?: number;
    expect?: number;
    exchange?: string;
    [key: string]: unknown;
}
interface HandleOptions {
    type?: string;
    queue?: string;
    context?: unknown;
    autoNack?: boolean;
    handler?: (message: MessageLike) => void;
    [key: string]: unknown;
}
interface TopologyWithExtras extends Topology {
    promise?: Promise<Topology>;
    promises: Record<string, Promise<unknown> | undefined>;
    options: ConnectionOptions;
}
declare class Broker extends EventEmitter {
    connections: Record<string, TopologyWithExtras>;
    hasHandles: boolean;
    autoNack: boolean;
    serializers: Record<string, Serializer>;
    configurations: Record<string, unknown>;
    configuring: Record<string, Promise<void> | undefined>;
    log: typeof log;
    appId?: string;
    ackIntervalId?: ReturnType<typeof setInterval>;
    addConnection(opts?: ConnectionOptions): Promise<TopologyWithExtras>;
    addExchange(name: string | HandleOptions, type?: string, options?: HandleOptions, connectionName?: string): Promise<unknown>;
    addQueue(name: string, options?: HandleOptions, connectionName?: string): Promise<unknown>;
    addSerializer(contentType: string, serializer: Serializer): void;
    batchAck(): void;
    bindExchange(source: string, target: string, keys: string | string[], connectionName?: string): Promise<unknown>;
    bindQueue(source: string, target: string, keys: string | string[], connectionName?: string): Promise<unknown>;
    bulkPublish(set: PublishOptions[] | Record<string, PublishOptions[]>, connectionName?: string): Promise<unknown>;
    clearAckInterval(): void;
    closeAll(reset?: boolean): Promise<unknown>;
    close(connectionName?: string, reset?: boolean): Promise<unknown>;
    deleteExchange(name: string, connectionName?: string): Promise<unknown>;
    deleteQueue(name: string, connectionName?: string): Promise<unknown>;
    getExchange(name: string, connectionName?: string): ChannelLike | undefined;
    getQueue(name: string, connectionName?: string): ChannelLike | undefined;
    handle(messageType: string | HandleOptions, handler?: (message: MessageLike) => void, queueName?: string, context?: unknown): {
        off: () => void;
    };
    ignoreHandlerErrors(): void;
    nackOnError(): void;
    nackUnhandled(): void;
    onUnhandled(handler: (message: MessageLike) => void): void;
    rejectUnhandled(): void;
    onExchange(exchangeName: string, connectionName?: string): Promise<ChannelLike | undefined>;
    onExchanges(exchanges: string[], connectionName?: string): Promise<Record<string, ChannelLike>>;
    onReturned(handler: (message: unknown) => void): void;
    publish(exchangeName: string, type: string | PublishOptions, message?: unknown, routingKey?: string, correlationId?: string, connectionName?: string, sequenceNo?: string | number): Promise<unknown>;
    purgeQueue(queueName: string, connectionName?: string): Promise<unknown>;
    request(exchangeName: string, options?: PublishOptions, notify?: (message: unknown) => void, connectionName?: string): Promise<unknown>;
    reset(): void;
    retry(connectionName?: string): Promise<void>;
    setAckInterval(interval: number): void;
    shutdown(): Promise<void>;
    startSubscription(queueName: string, exclusive?: boolean | string, connectionName?: string): Promise<unknown>;
    stopSubscription(queueName: string, connectionName?: string): ChannelLike;
    unbindExchange(source: string, target: string, keys: string | string[], connectionName?: string): Promise<unknown>;
    unbindQueue(source: string, target: string, keys: string | string[], connectionName?: string): Promise<unknown>;
    configure: (config: unknown) => Promise<void>;
}
declare const broker: Broker;
export default broker;
export { Broker };
//# sourceMappingURL=index.d.ts.map