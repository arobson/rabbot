interface Config {
    name?: string;
    connection?: unknown;
    exchanges?: unknown;
    queues?: unknown;
    bindings?: unknown;
}
interface BrokerLike {
    configurations: Record<string, Config>;
    configuring: Record<string, Promise<void>>;
    addConnection: (opts: unknown) => Promise<{
        name: string;
        configureExchanges: (def: unknown) => Promise<void>;
        configureQueues: (def: unknown) => Promise<void>;
        configureBindings: (def: unknown, name: string) => Promise<void>;
    }>;
    emit: (event: string, data: unknown) => void;
    configure: (config: Config) => Promise<void>;
}
export default function configMixin(Broker: {
    prototype: BrokerLike;
}): void;
export {};
//# sourceMappingURL=config.d.ts.map