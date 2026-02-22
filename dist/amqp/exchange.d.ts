import type { IOMonad } from './iomonad.js';
interface ExchangeOptions {
    name: string;
    type: string;
    alternate?: string;
    limit?: number;
    persistent?: boolean;
    publishTimeout?: number;
    noConfirm?: boolean;
    passive?: boolean;
    [key: string]: unknown;
}
interface Message {
    correlationId?: string;
    headers?: Record<string, unknown>;
    contentType?: string;
    body: unknown;
    type?: string;
    replyTo?: string;
    messageId?: string;
    id?: string;
    timestamp?: number;
    appId?: string;
    expiresAfter?: string;
    mandatory?: boolean;
    sequenceNo?: string | number;
    routingKey?: string;
    persistent?: boolean;
    timeout?: number;
    connectionPublishTimeout?: number;
}
interface Topology {
    replyQueue: {
        name: string | false;
    };
    connection: {
        name: string;
    };
}
interface Serializer {
    serialize: (body: unknown) => Buffer;
    deserialize: (bytes: Buffer, encoding?: string) => unknown;
}
interface PublishLog {
    add: (message: Message) => void;
    remove: (message: Message) => void;
}
interface ExchangeAdapter {
    channel: IOMonad;
    define: () => Promise<unknown>;
    release: () => Promise<boolean>;
    publish: (message: Message) => Promise<unknown>;
}
export default function createExchange(options: ExchangeOptions, topology: Topology, publishLog: PublishLog, serializers: Record<string, Serializer>): Promise<ExchangeAdapter>;
export {};
//# sourceMappingURL=exchange.d.ts.map