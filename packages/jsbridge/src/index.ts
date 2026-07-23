import type { Callback, IJSBridge, InterceptorContext, InterceptorHandler, InterceptorOptions, InterceptorPoint } from "@study-wolf-cifera/shared-types";
import { interceptorProxyAdapter } from "./interceptors/proxy_adapter.js";
import { JSBridge } from "./jsbridge.js";
import { interceptorKeyboard, interceptorSwitch } from "./interceptors/derestrict.js";

const jsBridge = new JSBridge();

window.jsBridge = jsBridge;

export type { IJSBridge, Callback, InterceptorContext, InterceptorHandler, InterceptorOptions, InterceptorPoint };
export { jsBridge };

// 注册拦截器
jsBridge.use('prePostNotification', interceptorProxyAdapter);
jsBridge.use('prePostNotification', interceptorKeyboard);
jsBridge.use('preTrigger', interceptorSwitch);