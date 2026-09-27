import { drawImageCover, drawSilhouette, drawText } from '../draw/primitives';
import { naturalSize } from './app-bar';
import type { FaceWindowCorner, FaceWindowOptions, FrameLayout } from '../types/frame';

/** 摄像头悬浮窗的最终几何，单位画布像素。 */
export interface FaceWindowBox {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    corner: FaceWindowCorner;
    /** 底部状态条区域；`label` 为 `null` 时是 `null`。 */
    label: { x: number; y: number; width: number; height: number } | null;
}

/**
 * 计算摄像头悬浮窗的位置。
 *
 * 这个窗由客户端以系统浮层绘制，永远不会出现在页面 DOM 里，也无法随页面一起截取，只能用另外
 * 取到的画面另行合成（见 bridge 包的 `requestFaceFrame`）。定位同样按系统浮层的习惯以整屏为基准，
 * 所以窗口与页面内容区没有关系。
 */
export function computeFaceWindowBox(
    layout: FrameLayout,
    options: FaceWindowOptions = {}
): FaceWindowBox {
    const {
        // 真机实测：客户端默认把悬浮窗放在右上角。
        corner = 'top-right',
        width = 100,
        height = 120,
        offsetX = 10,
        offsetY = 85,
        margin,
        // 真机实测：悬浮窗是直角、无边框。
        radius = 0,
        label = '图像采集中',
        labelHeight = 18
    } = options;

    const scale = layout.scale;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    // 系统浮层以屏幕为基准定位，因此这里用 screen 而不是 content。
    const dx = Math.round((margin ?? offsetX) * scale);
    const dy = Math.round((margin ?? offsetY) * scale);
    const screen = layout.screen;

    const x = corner === 'bottom-right' || corner === 'top-right' ? screen.width - w - dx : dx;
    const y = corner === 'bottom-right' || corner === 'bottom-left' ? screen.height - h - dy : dy;
    const labelBox = label === null
        ? null
        : {
              x,
              y: y + h - Math.round(labelHeight * scale),
              width: w,
              height: Math.round(labelHeight * scale)
          };

    return { x, y, width: w, height: h, radius: radius * scale, corner, label: labelBox };
}

/**
 * 绘制摄像头悬浮窗：直角无边框的窗口、按前置预览习惯水平镜像的画面，以及底边那条半透明状态条。没有
 * 画面时退化为中性剪影，使合成出的屏幕仍然像一台被监考的客户端。
 */
export function drawFaceWindow(
    ctx: CanvasRenderingContext2D,
    layout: FrameLayout,
    options: FaceWindowOptions = {}
): FaceWindowBox | null {
    if (options.enabled === false) return null;

    const {
        source = null,
        // 真机没有描边。
        borderWidth = 0,
        borderColor = 'rgba(255,255,255,0.9)',
        background = '#1c1c1e',
        mirror = true,
        label = '图像采集中',
        labelSize = 9,
        labelColor = '#ffffff',
        labelBackground = 'rgba(0,0,0,0.2)'
    } = options;

    const box = computeFaceWindowBox(layout, options);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, box.radius);
    ctx.fillStyle = background;
    ctx.fill();
    ctx.clip();

    const natural = source ? naturalSize(source) : null;
    if (source && natural) {
        drawImageCover(ctx, source, box, natural, mirror);
    } else {
        drawSilhouette(ctx, box);
    }
    ctx.restore();

    if (box.label && label !== null) {
        // 状态条压在画面底边上，跟着窗口的圆角一起裁。
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.width, box.height, box.radius);
        ctx.clip();
        ctx.fillStyle = labelBackground;
        ctx.fillRect(box.label.x, box.label.y, box.label.width, box.label.height);
        drawText(ctx, label, box.x + box.width / 2, box.label.y + box.label.height / 2, {
            size: Math.max(6, Math.round(labelSize * layout.scale)),
            color: labelColor,
            align: 'center'
        });
        ctx.restore();
    }

    if (borderWidth > 0) {
        ctx.save();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth * layout.scale * 0.5;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.width, box.height, box.radius);
        ctx.stroke();
        ctx.restore();
    }

    return box;
}
