import { InterceptorContext, InterceptorHandler, InterceptorOptions, InterceptorPoint } from "@study-wolf-cifera/shared-types";

/** 已注册的拦截器及其补全后的选项。 */
interface InterceptorNode<T = any> {
    handler: InterceptorHandler<T>;
    options: Required<InterceptorOptions>;
}

/** 拦截器的注册表与执行器。 */
export class InterceptorManager {
    private interceptors: Map<InterceptorPoint, InterceptorNode[]> = new Map();

    /**
     * 在 `point` 上注册拦截器。
     *
     * @param point - 挂载的拦截时机。
     * @param handler - 拦截器实现；调用 `next()` 继续责任链。
     * @param options - 条件、优先级、名称与一次性行为。
     * @returns 用于移除该拦截器的函数。
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
        // 优先级高的在前；优先级相同则保持注册顺序。
        list.sort((a, b) => b.options.priority - a.options.priority);

        return () => {
            const idx = list.indexOf(node);
            if (idx !== -1) {
                list.splice(idx, 1);
            }
        };
    }

    /**
     * 注册接管式拦截器：被拦截的操作完全不执行。
     *
     * 用于绝不能抵达客户端的协议；比在普通拦截器里写 `ctx.cancel` 更直白。
     */
    public hijack<T = any>(
        point: InterceptorPoint,
        handler: (ctx: InterceptorContext<T>) => void | Promise<void>,
        options: Omit<InterceptorOptions, 'once'> = {}
    ): () => void {
        return this.use<T>(point, async (ctx) => {
            await handler(ctx);
            // 故意不调用 `next()`：原操作不会执行。
            ctx.cancel = true;
        }, { ...options, once: false });
    }

    /**
     * 执行 `point` 上的拦截器链。
     *
     * @param point - 要执行的拦截时机。
     * @param args - 交给每个拦截器的可变参数对象，即 `ctx.args`。
     * @param method - 拦截器看到的 `ctx.method`，通常就是 bridge 方法名。
     * @param originalFn - 被拦截的操作；只有 post 类时机可以省略。
     * @returns 原操作的返回值；被取消时返回 `undefined`。
     */
    public async execute<T = any>(
        point: InterceptorPoint,
        args: T,
        method: string,
        originalFn?: () => any
    ): Promise<any> {
        const list = this.interceptors.get(point) ?? [];
        const ctx: InterceptorContext<T> = {
            method,
            args,
            cancel: false
        };

        // 事先过滤一次：某个拦截器在运行中注册的新拦截器不应被同一条链调用。
        const activeInterceptors = list.filter(node => node.options.condition!(ctx));

        // 组装责任链
        let index = 0;
        const next = async (): Promise<void> => {
            if (ctx.cancel) return;

            if (index < activeInterceptors.length) {
                const node = activeInterceptors[index++];
                try {
                    await node.handler(ctx, next);
                    // 一次性拦截器执行后即移除
                    if (node.options.once) {
                        const current = this.interceptors.get(point)!;
                        const idx = current.indexOf(node);
                        if (idx !== -1) current.splice(idx, 1);
                    }
                } catch (e) {
                    console.error(`[JSBridge Interceptor] Error in "${node.options.name}" at "${point}":`, e);
                    // 单个拦截器报错不应中断整条链。
                    await next();
                }
            }
        };

        await next();

        if (ctx.cancel || !originalFn) {
            return undefined;
        }

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
     * 同步执行拦截器链，供调用方无法 await 的 bridge 方法使用。
     *
     * 这里注册的拦截器不能是异步的：Promise 不会被等待，只会打一条告警。调用方能等待时优先用
     * {@link execute}。
     *
     * @param point - 要执行的拦截时机。
     * @param args - 交给每个拦截器的可变参数对象，即 `ctx.args`。
     * @param method - 拦截器看到的 `ctx.method`。
     * @param originalFn - 被拦截的操作；只有 post 类时机可以省略。
     * @returns 原操作的返回值；被取消时返回 `undefined`。
     */
    public executeSync<T = any>(
        point: InterceptorPoint,
        args: T,
        method: string,
        originalFn?: () => any
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
                    if (maybePromise && typeof (maybePromise as any).then === 'function') {
                        console.warn(`[JSBridge Interceptor] Async interceptor "${node.options.name}" used in sync context at "${point}"`);
                    }
                    if (node.options.once) {
                        const current = this.interceptors.get(point)!;
                        const idx = current.indexOf(node);
                        if (idx !== -1) current.splice(idx, 1);
                    }
                } catch (e) {
                    console.error(`[JSBridge Interceptor] Error in "${node.options.name}" at "${point}":`, e);
                    next();
                }
            }
        };

        next();

        if (ctx.cancel || !originalFn) {
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
     * 移除 `point` 上的全部拦截器；不传参数则清空所有时机。
     */
    public clear(point?: InterceptorPoint): void {
        if (point) {
            this.interceptors.delete(point);
        } else {
            this.interceptors.clear();
        }
    }

    /**
     * 列出已注册的拦截器，供调试使用。
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

