import { CiferaConfig } from "./cifera.js";
import { IJSBridge, Callback, InterceptorContext, InterceptorHandler, InterceptorOptions, InterceptorPoint } from "./jsbridge.js";
import { ClientLeftButton, StudyWolfEnv } from "./studywolf.js";

declare global {
    interface Window {
        /** JSBridge 实例（与客户端通信）。 */
        jsBridge: IJSBridge;
        /** 旧版就绪回调，由 `jsBridge.setDevice` 触发。 */
        _jsBridgeReady?: () => void;
        /** Cifera 代理注入的配置。 */
        __CIFERA__?: CiferaConfig;
        /** Study Wolf 状态；由 bridge 首次使用时创建。 */
        __STUDY_WOLF_ENV__?: StudyWolfEnv;
    }
}

export type {
    CiferaConfig,
    ClientLeftButton,
    StudyWolfEnv,
    IJSBridge,
    Callback,
    InterceptorContext,
    InterceptorHandler,
    InterceptorOptions,
    InterceptorPoint
};
