import {
    drawBackGlyph,
    drawCircleGlyph,
    drawRecentsGlyph,
    drawRoundedRect
} from '../draw/primitives';
import type { FormFactor, OS } from '../types/device';
import type { NavBarOptions, Rect } from '../types/frame';

/**
 * 绘制系统导航栏。
 *
 * 三键左右对称、间距可调（默认中心在 24% / 50% / 76% 宽度处，比"等分三栏"的 1/6、1/2、5/6 靠得近，
 * 这是按真机观感调的；`gapRatio` 可覆盖）。早期版本按 28.6% / 49.6% / 71.4% 摆放，视觉上明显错位——那是从
 * 某台设备截图上量到的像素，并不是三键布局的通用规则。`gesture` 改为画平台手势条，`none` 只留底色。
 */
export function drawNavBar(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    context: { os: OS; formFactor: FormFactor; scale: number },
    options: NavBarOptions = {}
): void {
    const isIOS = context.os === 'ios';
    const defaultMode = isIOS
        ? context.formFactor === 'iphone-classic' || context.formFactor === 'ipad-classic'
            ? 'none'
            : 'gesture'
        : 'buttons';
    const {
        mode = defaultMode,
        background = isIOS ? '#ffffff' : '#fcfcfc',
        foreground = isIOS ? '#000000' : '#8c8c8c'
    } = options;

    ctx.save();
    ctx.fillStyle = background;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    if (mode === 'none') return;

    if (mode === 'gesture') {
        const width = rect.width * (isIOS ? 0.35 : 0.28);
        const height = Math.max(3, 4 * context.scale);
        const y = isIOS
            ? rect.y + rect.height - height - 8 * context.scale
            : rect.y + rect.height - height - rect.height * 0.32;
        drawRoundedRect(
            ctx,
            rect.x + (rect.width - width) / 2,
            y,
            width,
            height,
            height / 2,
            isIOS ? 'rgba(0,0,0,0.85)' : '#000000'
        );
        return;
    }

    const glyph = Math.min(rect.height * 0.3, 14 * context.scale);
    // 三键中心相对屏幕中线的偏移比例：默认 0.26，比等分三栏的 1/3 明显靠得近。
    const gapRatio = options.gapRatio ?? 0.26;
    const centerY = rect.y + rect.height / 2;
    const middle = rect.x + rect.width / 2;
    drawBackGlyph(ctx, middle - rect.width * gapRatio, centerY, glyph, foreground);
    drawCircleGlyph(ctx, middle, centerY, glyph * 0.92, foreground);
    drawRecentsGlyph(ctx, middle + rect.width * gapRatio, centerY, glyph * 0.82, foreground);
}
