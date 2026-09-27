import type { InterceptorPoint } from '@study-wolf-cifera/shared-types';

import { jsBridge } from '../bridge.js';

/**
 * 被动的 bridge 流量录制器。
 *
 * 录制的目的是协议调研：客户端的回复是描述它自身行为最可靠的依据，而不同版本的形态并不一致。
 * 正常操作客户端时打开录制，之后读 {@link dumpBridgeLog} 即可。它不改变任何行为，被包装的方法
 * 照常执行。
 */

/** 一条观察到的 bridge 调用。 */
export interface BridgeLogEntry {
    time: number;
    /** `postNotification` 记为 `toClient`，`trigger` 记为 `toPage`，其余是方法名。 */
    direction: 'toClient' | 'toPage' | 'bind' | 'unbind';
    protocol: string;
    /** 序列化后的参数；函数记作 `"[function]"`。 */
    args: unknown[];
}

interface TappedBridge {
    postNotification: (name: string, payload: unknown) => void;
    trigger: (name: string, userInfo: unknown) => void;
    bind: (name: string, callback: unknown) => void;
    unbind: (name: string, callback?: unknown) => void;
    __sw4cRecorder?: boolean;
}

const MAX_ENTRIES = 500;
const log: BridgeLogEntry[] = [];

/** 序列化，遇到循环引用不抛异常。 */
function serialise(value: unknown): unknown {
    if (typeof value === 'function') return '[function]';
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return String(value);
    }
}

/**
 * 开始录制 bridge 流量。
 *
 * 包装的是 bridge 实例上的方法，因此要早于其他代码注册监听器；注册顺序只影响日志覆盖范围，
 * 不影响语义。
 */
export function startBridgeRecorder(): void {
    const bridge = jsBridge as unknown as TappedBridge;
    if (bridge.__sw4cRecorder) return;

    const record = (direction: BridgeLogEntry['direction'], protocol: string, args: unknown[]): void => {
        log.push({ time: Date.now(), direction, protocol, args: args.map(serialise) });
        if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
    };

    const wrap = <K extends 'postNotification' | 'trigger' | 'bind' | 'unbind'>(
        method: K,
        direction: BridgeLogEntry['direction']
    ): void => {
        const original = bridge[method];
        bridge[method] = function (this: unknown, ...args: unknown[]) {
            record(direction, String(args[0]), args.slice(1));
            return (original as (...rest: unknown[]) => unknown).apply(this, args);
        } as TappedBridge[K];
    };

    wrap('postNotification', 'toClient');
    wrap('trigger', 'toPage');
    wrap('bind', 'bind');
    wrap('unbind', 'unbind');
    bridge.__sw4cRecorder = true;
}

/** 返回已录制流量的副本。 */
export function dumpBridgeLog(): BridgeLogEntry[] {
    return log.map((entry) => ({ ...entry }));
}

/** 清空已录制的流量。 */
export function clearBridgeLog(): void {
    log.length = 0;
}

/** bridge 暴露的拦截时机；决定某个协议挂在哪里时有用。 */
export const INTERCEPTOR_POINTS: InterceptorPoint[] = [
    'prePostNotification',
    'postPostNotification',
    'preTrigger',
    'postTrigger',
    'preBridgeCall',
    'postBridgeCall',
    'preSetDevice',
    'postSetDevice',
    'preBind',
    'postBind',
    'preUnbind',
    'postUnbind',
    'prePopNotificationObject',
    'postPopNotificationObject'
];
