/** JSBridge 回调函数类型 */
export type Callback = (userInfo?: any) => void;

/** 拦截器上下文 */
export interface InterceptorContext<T = any> {
    /** 被拦截的方法名 */
    method: string;
    /** 原始参数（可被修改） */
    args: T;
    /** 是否取消本次调用 */
    cancel: boolean;
    /** 扩展元数据 */
    metadata?: Record<string, any>;
    /** 原始方法执行结果（仅 post 阶段可用） */
    result?: any;
    /** 原始方法执行是否出错（仅 post 阶段可用） */
    error?: any;
}

/** 拦截器处理器 */
export type InterceptorHandler<T = any> = (
    ctx: InterceptorContext<T>,
    next: () => void | Promise<void>
) => void | Promise<void>;

/** 拦截器注册选项 */
export interface InterceptorOptions {
    /** 条件拦截：返回 true 才执行 */
    condition?: (ctx: InterceptorContext) => boolean;
    /** 是否只执行一次 */
    once?: boolean;
    /** 拦截器优先级，数字越大越先执行 */
    priority?: number;
    /** 拦截器名称（用于调试和移除） */
    name?: string;
}

/** 支持的拦截点 */
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

/** JSBridge 全局类型声明 */
export interface IJSBridge {
    device: string;
    isReady: boolean;
    postNotification(name: string, payload: any): void;
    popNotificationObject(notificationId: number): string | undefined;
    trigger(name: string, userInfo: any): void;
    setDevice(device: string): void;
    bind(name: string, callback: Callback): void;
    unbind(name: string, callback?: Callback): void;
}