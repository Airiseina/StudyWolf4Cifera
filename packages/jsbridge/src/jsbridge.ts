import type {
    Callback,
    IJSBridge,
    InterceptorContext,
    InterceptorHandler,
    InterceptorOptions,
    InterceptorPoint
} from '@study-wolf-cifera/shared-types';

import { InterceptorManager } from './interceptor.js';

export { InterceptorManager };

/**
 * 客户端 `CXJSBridge.js` 的直接替代品。
 *
 * 协议与原实现一致：页面通过 iOS 的隐藏 `jsbridge://` iframe 或 Android 的注入对象
 * `androidjsbridge` 发通知，回复则以 `trigger` 形式由客户端在页面里求值送达。本实现额外加了
 * 一条拦截器链，使插件可以在不碰页面代码的前提下观察、改写或丢弃这些消息。
 */
export class JSBridge implements IJSBridge {
    public device: string = 'ios';
    public isReady: boolean = false;

    private callbackDict: Map<string, Callback[]> = new Map();
    private notificationDict: Map<number, { name: string; userInfo: any }> = new Map();
    private notificationIdCount: number = 0;

    public readonly interceptors: InterceptorManager = new InterceptorManager();

    constructor() {
        // DOM 一解析完就向客户端报到；页面的 `_jsBridgeReady()` 由客户端随后的 setDevice 触发。
        const announce = (): void => {
            this.bridgeCall('jsbridge://NotificationReady', () => {
                this.trigger('jsBridgeReady', {});
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', announce, { once: true });
        } else {
            queueMicrotask(announce);
        }
    }

    /**
     * 用隐藏 iframe 加载一个 `jsbridge://` URL 来发送消息。
     *
     * 这是 iOS 的原生通道：客户端拦截这次导航、识别 URL scheme，实际什么都不会加载，并自行
     * 移除该 iframe。Android 走注入对象，见 {@link postNotification}。
     */
    private bridgeCall(src: string, callback?: () => void): void {
        this.interceptors.executeSync('preBridgeCall', { src, callback }, 'bridgeCall', () => {
            if (!this.loadJsbridge()) return;

            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            // 标记成插件节点，截屏时会被排除。
            iframe.setAttribute('data-sw4c', 'bridge-iframe');
            iframe.src = src;

            iframe.onload = () => {
                try {
                    iframe.remove();
                } catch {
                    // iframe 已被移除也无妨，导航早就被拦截了。
                }
                callback?.();
            };

            document.documentElement.appendChild(iframe);
        });

        this.interceptors.executeSync('postBridgeCall', { src, callback }, 'bridgeCall');
    }

    /**
     * 判断当前页面是否应该与客户端通信。
     *
     * PC 课堂版内嵌考试页时不带 bridge，原库用同一个 UA 标记判断，避免发出成千上万次无效的
     * `jsbridge://` 导航。
     */
    private loadJsbridge(): boolean {
        try {
            return !navigator.userAgent.includes('ChaoxingClassroomPc');
        } catch {
            return true;
        }
    }

    /**
     * 向客户端发送协议消息。
     *
     * @param name - 协议名，例如 `CLIENT_SCREEN_MONITOR`。
     * @param payload - 协议载荷；两个平台都用 `JSON.stringify` 序列化。
     */
    public postNotification(name: string, payload: any): void {
        const args = { name, payload };

        this.interceptors.executeSync('prePostNotification', args, 'postNotification', () => {
            if (this.device === 'android') {
                (window as any).androidjsbridge?.postNotification(name, JSON.stringify(payload));
            } else {
                // iOS 把载荷留在本地，由客户端按 id 取回，即 `popNotificationObject` 提供的接口。
                this.notificationIdCount++;
                const id = this.notificationIdCount;
                this.notificationDict.set(id, { name, userInfo: payload });
                this.bridgeCall(`jsbridge://PostNotificationWithId-${id}`);
            }
        });

        this.interceptors.executeSync('postPostNotification', args, 'postNotification');
    }

    /**
     * 以 JSON 字符串返回缓存的通知载荷，并删除该缓存。
     *
     * iOS 端在 `jsbridge://PostNotificationWithId-<id>` 之后由客户端调用。
     *
     * @param notificationId - 通知 URL 里的编号。
     * @returns `{"name":…,"userInfo":…}`；id 不存在时返回 `undefined`。
     */
    public popNotificationObject(notificationId: number): string | undefined {
        const args = { notificationId };

        const result: string | undefined = this.interceptors.executeSync(
            'prePopNotificationObject',
            args,
            'popNotificationObject',
            () => {
                const notification = this.notificationDict.get(notificationId);
                if (!notification) return undefined;

                const json = JSON.stringify(notification);
                this.notificationDict.delete(notificationId);
                return json;
            }
        );

        this.interceptors.executeSync(
            'postPopNotificationObject',
            { ...args, result },
            'popNotificationObject'
        );

        return result;
    }

    /**
     * 把客户端消息分发给页面监听者。
     *
     * 客户端是在页面里执行 `jsBridge.trigger('<name>', <json>)` 调用它的，因此挂在 `preTrigger`
     * 上的拦截器从 `ctx.args.userInfo` 取到已解析的载荷。
     *
     * @param name - 页面订阅的协议名。
     * @param userInfo - 已解析的载荷。某个监听者抛异常不会影响其他监听者。
     */
    public trigger(name: string, userInfo: any): void {
        const args = { name, userInfo };

        this.interceptors.executeSync('preTrigger', args, 'trigger', () => {
            const callbacks = this.callbackDict.get(name);
            if (!callbacks) return;

            // 先复制再遍历：监听者可能在回调里解绑自己。
            [...callbacks].forEach((cb) => {
                try {
                    cb(userInfo);
                } catch (e) {
                    console.error(`JSBridge trigger error for "${name}":`, e);
                }
            });
        });

        this.interceptors.executeSync('postTrigger', args, 'trigger');
    }

    /**
     * 记录客户端上报的平台，并调用页面的 `_jsBridgeReady()`。
     *
     * 客户端会在页面内联脚本定义好 `_jsBridgeReady` 之后调用它，考试页的监控引导正是从这里开始。
     *
     * @param device - `'android'` 或 `'ios'`。
     */
    public setDevice(device: string): void {
        const args = { device };

        this.interceptors.executeSync('preSetDevice', args, 'setDevice', () => {
            this.device = device;
            this.isReady = true;

            try {
                (window as any)._jsBridgeReady?.();
            } catch {
                // 页面自己的就绪钩子出错不应影响 bridge。
            }
        });

        this.interceptors.executeSync('postSetDevice', args, 'setDevice');
    }

    /**
     * 订阅一个客户端协议。
     *
     * @param name - 要监听的协议名。
     * @param callback - 每次匹配到 `trigger` 时以解析后的载荷调用。
     */
    public bind(name: string, callback: Callback): void {
        const args = { name, callback };

        this.interceptors.executeSync('preBind', args, 'bind', () => {
            if (!this.callbackDict.has(name)) {
                this.callbackDict.set(name, []);
            }
            this.callbackDict.get(name)!.push(callback);
        });

        this.interceptors.executeSync('postBind', args, 'bind');
    }

    /**
     * 取消订阅。
     *
     * @param name - 协议名。
     * @param callback - 要移除的监听者；不传则移除该协议的全部监听者。
     */
    public unbind(name: string, callback?: Callback): void {
        const args = { name, callback };

        this.interceptors.executeSync('preUnbind', args, 'unbind', () => {
            if (!callback) {
                this.callbackDict.delete(name);
                return;
            }

            const callbacks = this.callbackDict.get(name);
            if (!callbacks) return;

            const index = callbacks.indexOf(callback);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }

            if (callbacks.length === 0) {
                this.callbackDict.delete(name);
            }
        });

        this.interceptors.executeSync('postUnbind', args, 'unbind');
    }

    /** 注册拦截器，见 {@link InterceptorManager.use}。 */
    public use<T = any>(
        point: InterceptorPoint,
        handler: InterceptorHandler<T>,
        options?: InterceptorOptions
    ): () => void {
        return this.interceptors.use(point, handler, options);
    }

    /** 注册接管式拦截器，见 {@link InterceptorManager.hijack}。 */
    public hijack<T = any>(
        point: InterceptorPoint,
        handler: (ctx: InterceptorContext<T>) => void | Promise<void>,
        options?: Omit<InterceptorOptions, 'once'>
    ): () => void {
        return this.interceptors.hijack(point, handler, options);
    }
}
