import { drawChevron, drawImageCover, drawText } from '../draw/primitives';
import type { OS } from '../types/device';
import type { AppBarOptions, Rect } from '../types/frame';

/**
 * 绘制客户端工具栏：返回按钮、居中标题、右侧蓝色文字按钮。
 *
 * 参考机（设备 A）实测这条栏是纯白、无分隔线、高 48 dp，返回箭头距前缘约 15 dp；真机考试页右侧还有
 * 一个字号小于标题的蓝色文字按钮（如「反馈」）。页面看不到这条栏，因此内容只能来自 bridge：标题取
 * `CLIENT_TOOLBAR_TITLE`，返回图标取 `CLIENT_CUSTOM_LEFTBTN`。
 */
export function drawAppBar(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    context: { os: OS; scale: number },
    options: AppBarOptions = {}
): void {
    const {
        title = '',
        titleSize = 16,
        background = '#ffffff',
        foreground = '#333333',
        backIcon = null,
        showBack = true,
        rightLabel = '反馈',
        rightLabelColor = '#0099ff',
        rightLabelSize = Math.max(10, titleSize - 3)
    } = options;

    ctx.save();
    ctx.fillStyle = background;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    const centerY = rect.y + rect.height / 2;
    const pad = 15 * context.scale;

    if (showBack) {
        // 真机图标偏细偏小，张口也更大（见 drawChevron 的默认值）。
        const iconSize = Math.min(rect.height * 0.3, 13 * context.scale);
        if (backIcon) {
            const natural = naturalSize(backIcon);
            if (natural) {
                drawImageCover(
                    ctx,
                    backIcon,
                    { x: rect.x + pad, y: centerY - iconSize / 2, width: iconSize, height: iconSize },
                    natural
                );
            }
        } else {
            drawChevron(ctx, rect.x + pad + iconSize * 0.45, centerY, iconSize, foreground, 'left');
        }
    }

    if (title) {
        drawText(ctx, title, rect.x + rect.width / 2, centerY, {
            size: Math.round(titleSize * context.scale),
            color: foreground,
            align: 'center',
            weight: '500'
        });
    }

    if (rightLabel) {
        drawText(ctx, rightLabel, rect.x + rect.width - pad, centerY, {
            size: Math.round(rightLabelSize * context.scale),
            color: rightLabelColor,
            align: 'right'
        });
    }
}

/** 画面源的原始像素尺寸；尚未解码完成时返回 `null`。 */
export function naturalSize(
    source: CanvasImageSource
): { width: number; height: number } | null {
    if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
        return source.videoWidth > 0
            ? { width: source.videoWidth, height: source.videoHeight }
            : null;
    }
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
        return source.naturalWidth > 0
            ? { width: source.naturalWidth, height: source.naturalHeight }
            : null;
    }
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
        return source.width > 0 ? { width: source.width, height: source.height } : null;
    }
    const bitmap = source as ImageBitmap;
    return bitmap.width > 0 ? { width: bitmap.width, height: bitmap.height } : null;
}
