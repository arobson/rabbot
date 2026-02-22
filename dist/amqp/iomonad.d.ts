export interface IOMonadOptions {
    name: string;
    waitMin?: number;
    waitMax?: number;
    waitIncrement?: number;
}
export interface Subscription {
    off: () => void;
    remove: () => void;
}
export interface IOMonad {
    state: string;
    name: string;
    waitInterval: number;
    waitMin: number;
    waitMax: number;
    waitIncrement: number;
    item: unknown;
    on: (event: string, handler: (data?: unknown) => void) => Subscription;
    once: (event: string, handler: (data?: unknown) => void) => Subscription;
    emit: (event: string, data?: unknown) => void;
    acquire: () => Promise<IOMonad>;
    release: () => Promise<void>;
    operate: (call: string, args: unknown[]) => Promise<unknown>;
    [key: string]: unknown;
}
export default function createIOMonad(options: IOMonadOptions, type: string, factory: () => Promise<unknown>, target: {
    prototype: Record<string, unknown>;
}, close?: (item: unknown) => void): IOMonad;
//# sourceMappingURL=iomonad.d.ts.map