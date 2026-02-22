export declare function createConsumerTag(queueName: string): string;
export declare function createConsumerHash(): number;
export declare function createConsistentHash(): number;
export declare function getHostInfo(): string;
export declare function getProcessInfo(): string;
export declare function getLibInfo(): string;
export declare const id: string;
export declare const hostInfo: typeof getHostInfo;
export declare const libInfo: typeof getLibInfo;
export declare const processInfo: typeof getProcessInfo;
export declare const createTag: typeof createConsumerTag;
export declare const createHash: typeof createConsumerHash;
declare const _default: {
    id: string;
    host: typeof getHostInfo;
    lib: typeof getLibInfo;
    process: typeof getProcessInfo;
    createTag: typeof createConsumerTag;
    createHash: typeof createConsumerHash;
    createConsistentHash: typeof createConsistentHash;
};
export default _default;
//# sourceMappingURL=info.d.ts.map