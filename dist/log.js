import createDebug from 'debug';
export default function log(namespace) {
    return {
        debug: createDebug(`${namespace}:debug`),
        info: createDebug(`${namespace}:info`),
        warn: createDebug(`${namespace}:warn`),
        error: createDebug(`${namespace}:error`),
    };
}
//# sourceMappingURL=log.js.map