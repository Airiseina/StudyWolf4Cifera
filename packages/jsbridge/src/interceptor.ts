import { Callback, IJSBridge, InterceptorContext, InterceptorHandler, InterceptorOptions } from "@study-wolf-cifera/shared-types";

/** 内部拦截器节点 */
interface InterceptorNode<T = any> {
    handler: InterceptorHandler<T>;
    options: Required<InterceptorOptions>;
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

// ==================== Interceptor 管理器 ====================

export class InterceptorManager {
    private interceptors: Map<InterceptorPoint, InterceptorNode[]> = new Map();

    /**
     * 注册拦截器
     * @returns 卸载函数
     */
    public use<T = any>(
        point: InterceptorPoint,
        handler: InterceptorHandler<T>,
        options: InterceptorOptions = {}
    ): () => void {
        const node: InterceptorNode<T> = {
            handler,
            options: {
                condition: options.condition ?? (() => true),
                once: options.once ?? false,
                priority: options.priority ?? 0,
                name: options.name ?? `interceptor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            }
        };

        if (!this.interceptors.has(point)) {
            this.interceptors.set(point, []);
        }

        const list = this.interceptors.get(point)!;
        list.push(node);
        // 按优先级排序（高优先级在前）
        list.sort((a, b) => b.options.priority - a.options.priority);

        // 返回卸载函数
        return () => {
            const idx = list.indexOf(node);
            if (idx !== -1) {
                list.splice(idx, 1);
            }
        };
    }

    /**
     * 劫持某个拦截点（阻止原始方法执行，完全由拦截器接管）
     */
    public hijack<T = any>(
        point: InterceptorPoint,
        handler: (ctx: InterceptorContext<T>) => void | Promise<void>,
        options: Omit<InterceptorOptions, 'once'> = {}
    ): () => void {
        return this.use<T>(point, async (ctx, next) => {
            await handler(ctx);
            // 劫持模式下不调用 next，原始方法不会执行
            ctx.cancel = true;
        }, { ...options, once: false });
    }

    /**
     * 执行拦截器链
     */
    public async execute<T = any>(
        point: InterceptorPoint,
        args: T,
        method: string,
        originalFn: () => any
    ): Promise<any> {
        const list = this.interceptors.get(point) ?? [];
        const ctx: InterceptorContext<T> = {
            method,
            args,
            cancel: false
        };

        // 过滤出符合条件的拦截器
        const activeInterceptors = list.filter(node => node.options.condition!(ctx));

        // 构建链式调用
        let index = 0;
        const next = async (): Promise<void> => {
            if (ctx.cancel) return;

            if (index < activeInterceptors.length) {
                const node = activeInterceptors[index++];
                try {
                    await node.handler(ctx, next);
                    // 如果是 once 拦截器，执行后移除
                    if (node.options.once) {
                        const list = this.interceptors.get(point)!;
                        const idx = list.indexOf(node);
                        if (idx !== -1) list.splice(idx, 1);
                    }
                } catch (e) {
                    console.error(`[JSBridge Interceptor] Error in "${node.options.name}" at "${point}":`, e);
                    // 出错不中断链，继续执行下一个
                    await next();
                }
            }
        };

        await next();

        if (ctx.cancel) {
            return undefined;
        }

        // 执行原始方法
        try {
            const result = await originalFn();
            ctx.result = result;
            return result;
        } catch (e) {
            ctx.error = e;
            throw e;
        }
    }

    /**
     * 同步执行拦截器链（用于不需要等待的场景）
     */
    public executeSync<T = any>(
        point: InterceptorPoint,
        args: T,
        method: string,
        originalFn: () => any
    ): any {
        const list = this.interceptors.get(point) ?? [];
        const ctx: InterceptorContext<T> = {
            method,
            args,
            cancel: false
        };

        const activeInterceptors = list.filter(node => node.options.condition!(ctx));

        let index = 0;
        const next = (): void => {
            if (ctx.cancel) return;

            if (index < activeInterceptors.length) {
                const node = activeInterceptors[index++];
                try {
                    const maybePromise = node.handler(ctx, next);
                    // 如果是 Promise，给出警告但继续
                    if (maybePromise && typeof (maybePromise as any).then === 'function') {
                        console.warn(`[JSBridge Interceptor] Async interceptor "${node.options.name}" used in sync context at "${point}"`);
                    }
                    if (node.options.once) {
                        const list = this.interceptors.get(point)!;
                        const idx = list.indexOf(node);
                        if (idx !== -1) list.splice(idx, 1);
                    }
                } catch (e) {
                    console.error(`[JSBridge Interceptor] Error in "${node.options.name}" at "${point}":`, e);
                    next();
                }
            }
        };

        next();

        if (ctx.cancel) {
            return undefined;
        }

        try {
            const result = originalFn();
            ctx.result = result;
            return result;
        } catch (e) {
            ctx.error = e;
            throw e;
        }
    }

    /**
     * 移除所有拦截器
     */
    public clear(point?: InterceptorPoint): void {
        if (point) {
            this.interceptors.delete(point);
        } else {
            this.interceptors.clear();
        }
    }

    /**
     * 获取已注册的拦截器列表（调试用）
     */
    public getInterceptors(point?: InterceptorPoint): { point: InterceptorPoint; name: string; priority: number }[] {
        if (point) {
            return (this.interceptors.get(point) ?? []).map(n => ({
                point,
                name: n.options.name,
                priority: n.options.priority
            }));
        }
        const result: { point: InterceptorPoint; name: string; priority: number }[] = [];
        this.interceptors.forEach((list, p) => {
            list.forEach(n => result.push({ point: p, name: n.options.name, priority: n.options.priority }));
        });
        return result;
    }
}
