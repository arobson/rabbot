import defer from './defer.js';
interface Message {
    sequenceNo?: number;
    [key: string]: unknown;
}
interface PublishState {
    count: number;
    messages: Record<number, Message>;
    sequenceNumber: number;
    waiting?: ReturnType<typeof defer<number>>;
}
export interface PublishLog {
    add: (m: Message) => void;
    count: () => number;
    onceEmptied: () => Promise<number>;
    reset: () => Message[];
    remove: (m: Message | number) => boolean;
    state: PublishState;
}
export default function publishLog(): PublishLog;
export {};
//# sourceMappingURL=publishLog.d.ts.map