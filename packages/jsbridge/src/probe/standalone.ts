import { installFaceProbe } from './face-probe.js';

/**
 * 单独注入用的入口（构建为 `dist/face-probe.js`）。
 *
 * 与主 bundle 无关，直接用页面里已有的 bridge，因此既能配合 Cifera 规则注入，也能在
 * WebView 检查器里手动执行。注入即自动运行，结果见右上角面板与
 * `window.__SW4C_FACE_PROBE__`。
 */
installFaceProbe({ autoRun: true });
