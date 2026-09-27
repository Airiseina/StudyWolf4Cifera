import { captureViewport, type CaptureResult } from '../capture/snapdom';
import { computeFrameLayout, placeContent } from '../layout';
import { readBatteryPercent } from '../utils/battery';
import { detectDevice, readDeviceInput, resolveBarHeights } from '../utils/device';
import { drawAppBar } from './app-bar';
import { drawFaceWindow } from './face-window';
import { drawNavBar } from './nav-bar';
import { drawStatusBar } from './status-bar';
import type { ComposeFrameOptions, FrameLayout } from '../types/frame';

/** 合成结果，以及它所依据的几何。 */
export interface ComposedFrame {
    canvas: HTMLCanvasElement;
    layout: FrameLayout;
    /** 帧由页面截取而来（而非外部传入）时存在。 */
    capture?: CaptureResult;
}

/**
 * 绘制一帧监控画面：系统状态栏、客户端工具栏、页面内容、导航栏与摄像头悬浮窗。
 *
 * 同步执行且不读 DOM，因此可以用构造出来的画面做单测，也可以在画面不是由 SnapDOM 产生时复用。
 */
export function composeFrame(
    layout: FrameLayout,
    capture: CanvasImageSource | null,
    options: ComposeFrameOptions = {}
): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = layout.screen.width;
    canvas.height = layout.screen.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('fake-screen: 2D canvas context unavailable');

    ctx.fillStyle = options.letterbox ?? '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (capture) {
        const placement = placeContent(sourceSize(capture), layout.content, options.fit ?? 'exact');
        if (placement.clipped) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(layout.content.x, layout.content.y, layout.content.width, layout.content.height);
            ctx.clip();
        }
        ctx.drawImage(capture, placement.x, placement.y, placement.width, placement.height);
        if (placement.clipped) ctx.restore();
    }

    const chrome = options.chrome ?? {};
    const context = {
        os: layout.device.os,
        formFactor: layout.device.formFactor,
        scale: layout.scale
    };
    drawStatusBar(ctx, layout.statusBar, context, chrome.statusBar);
    drawAppBar(ctx, layout.appBar, context, chrome.appBar);
    drawNavBar(ctx, layout.navBar, context, chrome.navBar);
    drawFaceWindow(ctx, layout, options.face);

    return canvas;
}

/**
 * 截取当前页面，并在其外围合成一整屏监控画面。
 *
 * 结果是整屏，也就是客户端录屏会上传的内容：中间是页面视口，上下是客户端外壳，摄像头浮层叠
 * 在页面之上。
 */
export async function composeMonitorFrame(
    page: HTMLElement = document.documentElement,
    options: ComposeFrameOptions = {}
): Promise<ComposedFrame> {
    const device = detectDevice({ ...readDeviceInput(), ...options.device });
    const bars = resolveBarHeights(device, {
        profile: options.chrome?.profile,
        override: options.chrome?.override,
        reconcile: options.chrome?.reconcile
    });
    const scale = options.scale ?? device.dpr;
    const layout = computeFrameLayout(device, bars, scale);

    // 状态栏要画真实电量：调用方没指定时读一次，读不到就用 76。
    const statusBar = options.chrome?.statusBar;
    const resolvedOptions =
        statusBar?.batteryPercent === undefined
            ? {
                  ...options,
                  chrome: {
                      ...options.chrome,
                      statusBar: {
                          ...statusBar,
                          batteryPercent: await readBatteryPercent({ defaultPercent: 76 })
                      }
                  }
              }
            : options;

    const capture = await captureViewport(page, { ...options.capture, scale });
    const canvas = composeFrame(layout, capture.canvas, resolvedOptions);

    return { canvas, layout, capture };
}

/** 画面源的原始像素尺寸。 */
function sourceSize(source: CanvasImageSource): { width: number; height: number } {
    const sized = source as {
        width: number;
        height: number;
        videoWidth?: number;
        videoHeight?: number;
    };
    return { width: sized.videoWidth ?? sized.width ?? 1, height: sized.videoHeight ?? sized.height ?? 1 };
}
