import createChannel from './amqp/channel.js';
import type { IOMonad } from './amqp/iomonad.js';
interface ConnectionOptions {
    name?: string;
    retryLimit?: number;
    failAfter?: number;
    [key: string]: unknown;
}
type ConnectionFn = (options: ConnectionOptions) => IOMonad;
type ChannelFn = typeof createChannel;
export default function Connection(options: ConnectionOptions, connectionFn?: ConnectionFn, channelFn?: ChannelFn): Record<string, unknown>;
export {};
//# sourceMappingURL=connectionFsm.d.ts.map