import { IJSBridge, Callback, InterceptorContext, InterceptorHandler, InterceptorOptions } from "@study-wolf-cifera/shared-types";

import {
    InterceptorManager,
    InterceptorPoint,
} from "./interceptor";

export { InterceptorManager };

export class JSBridge implements IJSBridge {
    public device: string = 'ios';
    public isReady: boolean = false;

    private callbackDict: Map<string, Callback[]> = new Map();
    private notificationDict: Map<number, { name: string; userInfo: any }> = new Map();
    private notificationIdCount: number = 0;

    /** 拦截器管理器 */
    public readonly interceptors: InterceptorManager = new InterceptorManager();

    constructor() {
        // DOM 就绪后触发 jsBridgeReady 事件
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.bridgeCall('jsbridge://NotificationReady', () => {
                    this.trigger('jsBridgeReady', {});
                });
            }, { once: true });
        } else {
            queueMicrotask(() => {
                this.bridgeCall('jsbridge://NotificationReady', () => {
                    this.trigger('jsBridgeReady', {});
                });
            });
        }
    }

    // ==================== 核心通信方法 ====================

    /**
     * 通过 iframe 发送 URL Scheme 请求
     * 这是 iOS 端 Native 通信的核心机制
     */
    private bridgeCall(src: string, callback?: () => void): void {
        this.interceptors.executeSync(
            'preBridgeCall',
            { src, callback },
            'bridgeCall',
            () => {
                if (!this.loadJsbridge()) return;

                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = src;

                const cleanFn = (): void => {
                    try {
                        iframe.remove();
                    } catch {
                        // 忽略移除失败
                    }
                    callback?.();
                };

                iframe.onload = cleanFn;
                document.documentElement.appendChild(iframe);
            }
        );

        // post 拦截
        this.interceptors.executeSync(
            'postBridgeCall',
            { src, callback },
            'bridgeCall',
            () => { /* 无返回值 */ }
        );
    }

    /**
     * 判断是否需要加载 JSBridge
     * 在超星课堂 PC 端禁用
     */
    private loadJsbridge(): boolean {
        try {
            return !navigator.userAgent.includes('ChaoxingClassroomPc');
        } catch {
            return true;
        }
    }

    // ==================== 公开 API（带拦截器）====================

    /**
     * 向 Native 发送通知
     * Android 直接调用注入对象，iOS 通过 URL Scheme
     */
    public postNotification(name: string, payload: any): void {
        const args = { name, payload };

        this.interceptors.executeSync(
            'prePostNotification',
            args,
            'postNotification',
            () => {
                if (this.device === 'android') {
                    (window as any).androidjsbridge?.postNotification(name, JSON.stringify(payload));
                } else {
                    this.notificationIdCount++;
                    const id = this.notificationIdCount;
                    this.notificationDict.set(id, { name, userInfo: payload });
                    this.bridgeCall(`jsbridge://PostNotificationWithId-${id}`);
                }
            }
        );

        this.interceptors.executeSync(
            'postPostNotification',
            args,
            'postNotification',
            () => { /* 无返回值 */ }
        );
    }

    /**
     * Native 调用：弹出缓存中的通知对象
     * 返回 JSON 字符串后清除缓存
     */
    public popNotificationObject(notificationId: number): string | undefined {
        const args = { notificationId };
        let result: string | undefined;

        result = this.interceptors.executeSync(
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
            'popNotificationObject',
            () => { /* 无返回值 */ }
        );

        return result;
    }

    /**
     * 触发 JS 事件，通知所有监听者
     */
    public trigger(name: string, userInfo: any): void {
        const args = { name, userInfo };

        this.interceptors.executeSync(
            'preTrigger',
            args,
            'trigger',
            () => {
                const callbacks = this.callbackDict.get(name);
                if (!callbacks) return;

                [...callbacks].forEach((cb) => {
                    try {
                        cb(userInfo);
                    } catch (e) {
                        console.error(`JSBridge trigger error for "${name}":`, e);
                    }
                });
            }
        );

        this.interceptors.executeSync(
            'postTrigger',
            args,
            'trigger',
            () => { /* 无返回值 */ }
        );
    }

    /**
     * 设置设备类型并标记就绪
     * 同时触发旧版兼容回调 _jsBridgeReady
     */
    public setDevice(device: string): void {
        const args = { device };

        this.interceptors.executeSync(
            'preSetDevice',
            args,
            'setDevice',
            () => {
                this.device = device;
                this.isReady = true;

                try {
                    (window as any)._jsBridgeReady?.();
                } catch {
                    // 兼容旧版回调，忽略异常
                }
            }
        );

        this.interceptors.executeSync(
            'postSetDevice',
            args,
            'setDevice',
            () => { /* 无返回值 */ }
        );
    }

    /**
     * 绑定事件监听
     */
    public bind(name: string, callback: Callback): void {
        const args = { name, callback };

        this.interceptors.executeSync(
            'preBind',
            args,
            'bind',
            () => {
                if (!this.callbackDict.has(name)) {
                    this.callbackDict.set(name, []);
                }
                this.callbackDict.get(name)!.push(callback);
            }
        );

        this.interceptors.executeSync(
            'postBind',
            args,
            'bind',
            () => { /* 无返回值 */ }
        );
    }

    /**
     * 解绑事件监听
     * 支持解绑单个回调或全部回调
     */
    public unbind(name: string, callback?: Callback): void {
        const args = { name, callback };

        this.interceptors.executeSync(
            'preUnbind',
            args,
            'unbind',
            () => {
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
            }
        );

        this.interceptors.executeSync(
            'postUnbind',
            args,
            'unbind',
            () => { /* 无返回值 */ }
        );
    }

    /**
     * 注册拦截器的便捷方法
     */
    public use<T = any>(
        point: InterceptorPoint,
        handler: InterceptorHandler<T>,
        options?: InterceptorOptions
    ): () => void {
        return this.interceptors.use(point, handler, options);
    }

    /**
     * 劫持的便捷方法
     */
    public hijack<T = any>(
        point: InterceptorPoint,
        handler: (ctx: InterceptorContext<T>) => void | Promise<void>,
        options?: Omit<InterceptorOptions, 'once'>
    ): () => void {
        return this.interceptors.hijack(point, handler, options);
    }
}
