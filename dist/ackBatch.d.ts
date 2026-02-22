import { EventEmitter } from 'events';
declare const signal: import("topic-dispatch").Dispatcher;
export type AckOperation = 'ack' | 'nack' | 'reject' | 'waiting';
export type Resolver = (op: AckOperation, data?: {
    tag: number;
    inclusive: boolean;
}) => Promise<unknown> | void;
export declare class TrackedMessage {
    tag: number;
    status: 'pending' | 'ack' | 'nack' | 'reject';
    private batch;
    constructor(tag: number, batch: AckBatch);
    ack(): void;
    nack(): void;
    reject(): void;
}
export declare class AckBatch extends EventEmitter {
    name: string;
    connectionName: string;
    resolver: Resolver;
    lastAck: number;
    lastNack: number;
    lastReject: number;
    firstAck: number | undefined;
    firstNack: number | undefined;
    firstReject: number | undefined;
    messages: TrackedMessage[];
    receivedCount: number;
    private signalSubscription?;
    private acking;
    constructor(name: string, connectionName: string, resolver: Resolver);
    _ack(tag: number, inclusive: boolean): void;
    _nack(tag: number, inclusive: boolean): void;
    _reject(tag: number, inclusive: boolean): void;
    _ackOrNackSequence(): void;
    _firstByStatus(status: string): TrackedMessage | undefined;
    _findIndex(status: string): number;
    _lastByStatus(status: string): TrackedMessage | undefined;
    _processBatch(): void;
    _resolveAll(status: AckOperation, first: 'firstAck' | 'firstNack' | 'firstReject', last: 'lastAck' | 'lastNack' | 'lastReject'): void;
    _resolveTag(tag: number, operation: AckOperation, inclusive: boolean): void;
    _removeByStatus(status: string): void;
    _removeUpToTag(tag: number): number;
    addMessage(message: TrackedMessage): void;
    changeName(name: string): void;
    getMessageOps(tag: number): TrackedMessage;
    ignoreSignal(): void;
    listenForSignal(): void;
    reset(): void;
    static triggerSignal(): void;
}
export { signal as ackSignal };
export default AckBatch;
//# sourceMappingURL=ackBatch.d.ts.map