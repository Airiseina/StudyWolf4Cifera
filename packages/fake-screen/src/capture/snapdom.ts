import { snapdom } from '@zumer/snapdom';

import type { CaptureOptions } from '../types/frame';
import { withInlinedResources } from './inliner';

/**
 * 插件自己插入的 DOM 都带这个属性，截屏时一律排除，避免把调试面板之类的东西截进伪造画面里。
 *
 * 与 bridge 包写入的属性必须一致。
 */
export const SW4C_MARK_ATTRIBUTE = 'data-sw4c';
/** {@link SW4C_MARK_ATTRIBUTE} 对应的排除选择器。 */
export const SW4C_MARK_SELECTOR = `[${SW4C_MARK_ATTRIBUTE}]`;

/** 页面视口截取结果。 */
export interface CaptureResult {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    /** SnapDOM 的告警，例如它自己无法内联某资源时的 `image-fallback`。 */
    warnings: string[];
    /** 截取前被替换成 data URL 的资源位点数量。 */
    inlined: number;
    /** 未能内联的资源；它们会以占位形态出现。 */
    failed: { url: string; reason: string }[];
}

/**
 * 截取 `root` 的可见视口。
 *
 * 必须带 `clip: 'viewport'`：客户端录屏抓的只是屏幕上的内容，整页截取会得到错误的画面比例。
 * `dpr` 固定为 1，因为输出倍率由调用方给出，再乘一次设备像素比会让帧尺寸翻倍。
 */
export async function captureViewport(
    root: HTMLElement,
    options: CaptureOptions & { scale: number }
): Promise<CaptureResult> {
    const scale = options.scale;
    const runCapture = async (): Promise<CaptureResult> => {
        const result = await snapdom(root, {
            scale,
            dpr: 1,
            clip: 'viewport',
            embedFonts: true,
            placeholders: false,
            cache: 'disabled',
            fontStylesheetDomains: options.fontStylesheetDomains ?? [],
            exclude: [SW4C_MARK_SELECTOR, ...(options.exclude ?? [])]
        });
        const canvas = await result.toCanvas();
        return {
            canvas,
            width: canvas.width,
            height: canvas.height,
            warnings: (result.warnings ?? []).map((warning) => warning.code),
            inlined: 0,
            failed: []
        };
    };

    if (options.inlineResources === false) {
        return runCapture();
    }

    return withInlinedResources(
        root,
        {
            rewriteUrl: options.rewriteUrl,
            fetchImpl: options.fetchImpl,
            timeoutMs: options.resourceTimeoutMs
        },
        async (inline) => {
            const capture = await runCapture();
            return { ...capture, inlined: inline.inlined, failed: inline.failed };
        }
    );
}
