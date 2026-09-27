import {
    composeMonitorFrame,
    type ComposeFrameOptions,
    type ComposedFrame
} from '@study-wolf-cifera/fake-screen';

import { jsBridge } from '../bridge.js';
import { requestFaceFrame } from '../face/request.js';
import { jsBridgeEnv, leftButtonIconUrl } from '../utils/env.js';
import { rewriteUrl } from '../utils/proxy_url.js';

/** {@link captureMonitorFrame} 的参数。 */
export interface MonitorFrameRequest {
    /** 要截取的页面元素，默认整个文档。 */
    root?: HTMLElement;
    /** 工具栏标题，默认用 `CLIENT_TOOLBAR_TITLE` 上报的值。 */
    title?: string;
    /**
     * 是否先向客户端要一帧实时摄像头画面，让伪造帧带上真实人脸画面而不是剪影。默认 true。
     */
    withFace?: boolean;
    /** 等待摄像头画面的上限，毫秒。 */
    faceTimeoutMs?: number;
    /** 其余参数透传给构图模块。 */
    compose?: ComposeFrameOptions;
}

/**
 * 为当前页面合成一帧伪造的监控画面。
 *
 * 客户端的录屏抓的是整屏，因此这一帧要按真实截屏的内容拼出来：SnapDOM 截取的可见页面、
 * 客户端工具栏（标题与返回图标取自 bridge）、系统栏，以及向客户端要来的实时摄像头画面。
 * 跨域图片与字体会在途中走代理内联。
 *
 * 取摄像头画面会真的请求客户端，所以调用方应把首帧视为较贵的一次；客户端不给画面时构图模块
 * 会退化为剪影。
 */
export async function captureMonitorFrame(request: MonitorFrameRequest = {}): Promise<ComposedFrame> {
    const env = jsBridgeEnv();
    const face = request.withFace === false
        ? null
        : await requestFaceFrame({ timeoutMs: request.faceTimeoutMs, rewrite: rewriteUrl });

    const backIcon = env.left_btn ? await loadBackIcon() : null;

    return composeMonitorFrame(request.root ?? document.documentElement, {
        ...request.compose,
        capture: { rewriteUrl, ...request.compose?.capture },
        chrome: {
            ...request.compose?.chrome,
            appBar: {
                title: request.title ?? env.title,
                backIcon,
                ...request.compose?.chrome?.appBar
            }
        },
        face: { enabled: true, source: face?.image ?? null, ...request.compose?.face }
    });
}

/** 载入客户端的自定义返回键图标；失败则退回默认箭头。 */
async function loadBackIcon(): Promise<HTMLImageElement | null> {
    const url = leftButtonIconUrl(jsBridge.device);
    if (!url) return null;
    try {
        const image = new Image();
        image.decoding = 'async';
        image.src = rewriteUrl(url);
        await image.decode();
        return image;
    } catch {
        return null;
    }
}
