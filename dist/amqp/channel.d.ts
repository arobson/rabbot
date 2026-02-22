declare const _default: {
    create(connection: {
        createChannel: () => Promise<unknown>;
        createConfirmChannel: () => Promise<unknown>;
    }, name: string, confirm: boolean): import("./iomonad.js").IOMonad;
};
export default _default;
//# sourceMappingURL=channel.d.ts.map