import { CiferaConfig } from "./cifera.js";
import { IJSBridge, Callback, InterceptorContext, InterceptorHandler, InterceptorOptions, InterceptorPoint } from "./jsbridge.js";

declare global {
    interface Window {
        /** JSBridge 实例（Native 通信） */
        jsBridge: IJSBridge;
        /** 旧版 JSBridge 就绪回调 */
        _jsBridgeReady?: () => void;
        /** Cifera 代理注入的全局配置 */
        __CIFERA__?: CiferaConfig;
    }
}

export type {
    CiferaConfig,
    IJSBridge,
    Callback,
    InterceptorContext,
    InterceptorHandler,
    InterceptorOptions,
    InterceptorPoint
};
