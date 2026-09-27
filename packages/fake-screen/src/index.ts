/**
 * 为监控协议合成伪造的整屏画面。
 *
 * 客户端录屏抓的是整屏，所以伪造帧必须包含真实截屏会有的一切：系统状态栏、客户端工具栏、页面
 * 视口、导航栏，以及叠在最上层的摄像头浮层。本包负责把这张图拼出来，何时生成由 bridge 包决定。
 *
 * 页面里的典型用法：
 *
 * ```ts
 * const frame = await composeMonitorFrame(document.documentElement, {
 *   chrome: { appBar: { title: '张三 (20230001)' } },
 *   face: { source: cameraFrame },
 *   capture: { rewriteUrl },
 * });
 * const jpeg = await frameToJpegBlob(frame.canvas);
 * ```
 */
export {
    captureViewport,
    SW4C_MARK_ATTRIBUTE,
    SW4C_MARK_SELECTOR,
    type CaptureResult
} from './capture/snapdom';
export {
    clearResourceCache,
    withInlinedResources,
    type InlineResult,
    type InlinerOptions
} from './capture/inliner';
export { computeFrameLayout, placeContent, type ContentPlacement } from './layout';
export { composeFrame, composeMonitorFrame, type ComposedFrame } from './compose/frame';
export { drawStatusBar, formatStatusTime, type StatusBarContext } from './compose/status-bar';
export { drawAppBar } from './compose/app-bar';
export { drawChevron, drawMobileData } from './draw/primitives';
export { drawNavBar } from './compose/nav-bar';
export { computeFaceWindowBox, drawFaceWindow, type FaceWindowBox } from './compose/face-window';
export {
    downloadFrame,
    frameToDataUrl,
    frameToJpegBlob,
    frameToPngBlob
} from './output';
export {
    BAR_PROFILES,
    defaultProfileFor,
    detectDevice,
    readDeviceInput,
    resolveBarHeights
} from './utils/device';
export { readBatteryPercent, resetBatteryCache } from './utils/battery';
export type {
    BarHeights,
    BarProfileName,
    DeviceInfo,
    DeviceInput,
    FormFactor,
    OS
} from './types/device';
export type {
    AppBarOptions,
    CaptureOptions,
    ChromeOptions,
    ComposeFrameOptions,
    FaceFrameSource,
    FaceWindowCorner,
    FaceWindowOptions,
    FitMode,
    FrameLayout,
    NavBarOptions,
    Rect,
    ReconcileTarget,
    StatusBarOptions
} from './types/frame';
