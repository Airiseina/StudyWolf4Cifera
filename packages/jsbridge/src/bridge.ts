import { JSBridge } from './jsbridge.js';

/**
 * 注入到每个页面的唯一 bridge 实例。放在这里而不是 `index.ts`，是为了避免循环依赖：各功能模块
 * 需要这个实例，而 `index.ts` 又需要各功能模块来注册拦截器。
 */
export const jsBridge = new JSBridge();

window.jsBridge = jsBridge;
