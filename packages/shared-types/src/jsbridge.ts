/**
 * 协议回调收到的载荷。
 *
 * 客户端是在页面里执行 `jsBridge.trigger(name, <payload>)`，所以多数协议拿到的是解析好的
 * 对象；个别客户端版本会把 JSON 当字符串传，因此消费方两种都要能接受。
 */
export type Callback = (userInfo?: any) => void;

/** 传给拦截器、并由调用方读回的上下文。 */
export interface InterceptorContext<T = any> {
    /** 被拦截的 bridge 方法名，例如 `postNotification`。 */
    method: string;
    /** 协议名与载荷；改这里即可改写本次调用。 */
    args: T;
    /** 置为 `true` 表示丢弃本次调用，被拦截的操作不会执行。 */
    cancel: boolean;
    /** 拦截器之间传递数据的自由字段。 */
    metadata?: Record<string, any>;
    /** 被拦截操作的返回值，执行后写入。 */
    result?: any;
    /** 被拦截操作抛出的异常。 */
    error?: any;
}

/**
 * 拦截器实现。
 *
 * 调用 `next()` 继续责任链；不调表示终止链但保留原操作，`ctx.cancel = true` 才是彻底丢弃。
 */
export type InterceptorHandler<T = any> = (
    ctx: InterceptorContext<T>,
    next: () => void | Promise<void>
) => void | Promise<void>;

/** 拦截器注册选项。 */
export interface InterceptorOptions {
    /** 返回 true 才执行，每次调用只判断一次。 */
    condition?: (ctx: InterceptorContext) => boolean;
    /** 执行一次后自动移除。 */
    once?: boolean;
    /** 数值越大越先执行。 */
    priority?: number;
    /** 出现在告警里、也用于移除；缺省自动生成。 */
    name?: string;
}

/** 可拦截的时机。 */
export type InterceptorPoint =
    | 'prePostNotification'
    | 'postPostNotification'
    | 'preTrigger'
    | 'postTrigger'
    | 'preBridgeCall'
    | 'postBridgeCall'
    | 'preSetDevice'
    | 'postSetDevice'
    | 'preBind'
    | 'postBind'
    | 'preUnbind'
    | 'postUnbind'
    | 'prePopNotificationObject'
    | 'postPopNotificationObject';

/**
 * 页面看到的客户端 bridge（`window.jsBridge`）。
 *
 * 与客户端自带 `CXJSBridge.js` 的 API 一致：页面用 `postNotification` 通知客户端，
 * 用 `bind`/`unbind` 订阅；客户端反向调用 `trigger`、`popNotificationObject` 和 `setDevice`。
 */
export interface IJSBridge {
    /** 客户端上报的平台；在 `setDevice` 之前是 `'ios'`。 */
    device: string;
    /** 客户端调用过 `setDevice` 后为 true。 */
    isReady: boolean;
    /** 向客户端发送协议消息。 */
    postNotification(name: string, payload: any): void;
    /** 按通知 id 取回缓存的载荷 JSON（iOS 通道）。 */
    popNotificationObject(notificationId: number): string | undefined;
    /** 把客户端消息分发给页面监听者。 */
    trigger(name: string, userInfo: any): void;
    /** 记录客户端平台，并调用页面的 `_jsBridgeReady()`。 */
    setDevice(device: string): void;
    /** 订阅协议。 */
    bind(name: string, callback: Callback): void;
    /** 移除一个监听者；不传 callback 时移除该协议的全部监听者。 */
    unbind(name: string, callback?: Callback): void;
}
