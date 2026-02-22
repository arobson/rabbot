export interface Logger {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
export default function log(namespace: string): Logger;
//# sourceMappingURL=log.d.ts.map