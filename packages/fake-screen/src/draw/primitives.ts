/**
 * 绘制外壳用的底层 canvas 辅助函数。所有函数都以画布像素为单位，并且不改动上下文状态，
 * 调用方可以随意组合。
 *
 * 尺寸约定：调用方给出"图标高度"或"字号"，线宽、圆角、间距都由这里按同一比例推导，避免出现
 * "粗黑图标"那种一眼假的观感。
 */

/** 外壳文字用的字体栈：平台 UI 字体加中文字体兜底。 */
export const UI_FONT_STACK =
    "Roboto, 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif";

/** 画文字的公共选项。 */
export interface TextOptions {
    size: number;
    color: string;
    align?: CanvasTextAlign;
    weight?: string;
}

/** 字形墨迹盒（相对基线）。 */
interface InkBox {
    ascent: number;
    descent: number;
}

/** 墨迹盒缓存：按"字重/字号/文本"缓存，一帧只测一次。 */
const inkBoxCache = new Map<string, InkBox>();
const INK_BOX_CACHE_LIMIT = 256;

/** 离屏量字用的画布。 */
let inkProbe: HTMLCanvasElement | null = null;

/** 装上字体与颜色；调用方负责 save/restore。 */
function applyFont(ctx: CanvasRenderingContext2D, options: TextOptions): void {
    ctx.font = `${options.weight ?? '400'} ${options.size}px ${UI_FONT_STACK}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
}

/**
 * 实测文本的墨迹盒（上高/下深，相对基线）。
 *
 * `TextMetrics.actualBoundingBox*` 在 Chrome 上并不总是紧贴字形——数字串会带上一段字体下深，按它居中
 * 的结果就是文字比图标高出一两个 dp（实测差 5~7 px @3.5x）。这里改为把字渲染到离屏画布上，扫描像素
 * 得到真实墨迹盒，并按字符串缓存，代价可以忽略。
 */
function measureInkBox(ctx: CanvasRenderingContext2D, text: string, options: TextOptions): InkBox {
    const key = `${options.weight ?? '400'}|${options.size}|${text}`;
    const cached = inkBoxCache.get(key);
    if (cached) return cached;

    const fallback: InkBox = { ascent: options.size * 0.74, descent: options.size * 0.22 };
    if (typeof document === 'undefined') return fallback;

    try {
        const width = Math.max(32, Math.ceil(options.size * (text.length + 2)));
        const height = Math.ceil(options.size * 3);
        inkProbe ??= document.createElement('canvas');
        inkProbe.width = width;
        inkProbe.height = height;
        const probeCtx = inkProbe.getContext('2d', { willReadFrequently: true });
        if (!probeCtx) return fallback;

        probeCtx.clearRect(0, 0, width, height);
        applyFont(probeCtx, options);
        probeCtx.fillStyle = '#fff';
        const baseline = Math.ceil(options.size * 2);
        probeCtx.fillText(text, 2, baseline);

        const data = probeCtx.getImageData(0, 0, width, height).data;
        let minY = Infinity;
        let maxY = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (data[(y * width + x) * 4 + 3] < 8) continue;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxY < 0) return fallback;

        const box: InkBox = { ascent: baseline - minY, descent: maxY - baseline };
        if (inkBoxCache.size >= INK_BOX_CACHE_LIMIT) inkBoxCache.clear();
        inkBoxCache.set(key, box);
        return box;
    } catch {
        return fallback;
    }
}

/**
 * 按字形墨迹盒居中画一段文字。
 *
 * 系统 UI 的文字是"看着居中"排的，而 canvas 的 `textBaseline: middle` 按 em 盒居中：中英混排或字体
 * 回退到别的字族时，em 盒与墨迹盒能差出好几像素，于是标题栏看起来就是没和图标对齐。这里用
 * `actualBoundingBox` 把墨迹盒中线对到 `centerY`。
 *
 * `align` 为 `right`/`center` 时同样按墨迹盒宽度对齐。
 */
export function drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: TextOptions
): void {
    ctx.save();
    applyFont(ctx, options);
    ctx.fillStyle = options.color;

    // 横向按排版宽度（含边距）对齐，纵向按实测墨迹盒居中：两者诉求不同，不能混用。
    const advance = ctx.measureText(text).width;
    const box = measureInkBox(ctx, text, options);
    const baselineY = y + (box.ascent - box.descent) / 2;

    if (options.align === 'right') {
        ctx.fillText(text, x - advance, baselineY);
    } else if (options.align === 'center') {
        ctx.fillText(text, x - advance / 2, baselineY);
    } else {
        ctx.fillText(text, x, baselineY);
    }
    ctx.restore();
}

/** 量出文字墨迹盒宽度，供连续右对齐排布使用。 */
export function measureTextWidth(
    ctx: CanvasRenderingContext2D,
    text: string,
    options: TextOptions
): number {
    ctx.save();
    applyFont(ctx, options);
    const width = ctx.measureText(text).width;
    ctx.restore();
    return width;
}

/** 绘制一条线段，端点圆头。 */
export function drawLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: string
): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
}

/**
 * 绘制返回箭头（chevron）。
 *
 * `openingRatio` 是"单臂水平投影 ÷ 半高"，越小张口越大。真机返回图标的张口较宽、线条较细，因此默认
 * 0.44（约 100°）与 9% 线宽；之前 0.62 / 14% 会画出又窄又粗的箭头。
 */
export function drawChevron(
    ctx: CanvasRenderingContext2D,
    x: number,
    centerY: number,
    height: number,
    color: string,
    direction: 'left' | 'right' = 'left',
    options: { openingRatio?: number; strokeRatio?: number } = {}
): void {
    const half = height / 2;
    const opening = (options.openingRatio ?? 0.44) * half;
    // `dir` 决定顶点朝哪边：`left` 时顶点在左侧（也就是"返回"）。
    const dir = direction === 'left' ? 1 : -1;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, height * (options.strokeRatio ?? 0.09));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + dir * opening, centerY - half);
    ctx.lineTo(x - dir * opening, centerY);
    ctx.lineTo(x + dir * opening, centerY + half);
    ctx.stroke();
    ctx.restore();
}

/** 绘制蜂窝信号的 4 格递增柱，返回其宽度。 */
export function drawSignalBars(
    ctx: CanvasRenderingContext2D,
    x: number,
    centerY: number,
    height: number,
    color: string
): number {
    const count = 4;
    const barWidth = Math.max(1.2, height * 0.17);
    const gap = Math.max(1, height * 0.1);
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
        const barHeight = height * (0.4 + (0.6 * i) / (count - 1));
        ctx.beginPath();
        ctx.roundRect(
            x + i * (barWidth + gap),
            centerY + height / 2 - barHeight,
            barWidth,
            barHeight,
            barWidth * 0.35
        );
        ctx.fill();
    }
    ctx.restore();
    return count * barWidth + (count - 1) * gap;
}

/** 绘制 Wi-Fi 图标：三条弧线加一个圆点。 */
export function drawWifi(
    ctx: CanvasRenderingContext2D,
    x: number,
    centerY: number,
    size: number,
    color: string
): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.1);
    ctx.lineCap = 'round';
    const bottom = centerY + size * 0.32;
    for (let i = 0; i < 3; i++) {
        const radius = size * (0.26 + i * 0.24);
        ctx.beginPath();
        ctx.arc(x, bottom, radius, Math.PI * 1.29, Math.PI * 1.71);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, bottom - size * 0.03, size * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

/** 绘制电池轮廓与电量，返回其总宽度。 */
export function drawBattery(
    ctx: CanvasRenderingContext2D,
    x: number,
    centerY: number,
    height: number,
    color: string,
    level = 0.7
): number {
    const width = height * 1.85;
    const bodyWidth = width - height * 0.16;
    const radius = height * 0.26;
    const stroke = Math.max(1, height * 0.08);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.roundRect(x + stroke / 2, centerY - height / 2 + stroke / 2, bodyWidth - stroke, height - stroke, radius);
    ctx.stroke();

    const padding = Math.max(1.5, height * 0.21);
    const fillWidth = (bodyWidth - padding * 2) * Math.min(1, Math.max(0, level));
    if (fillWidth > 0) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(
            x + padding,
            centerY - height / 2 + padding,
            fillWidth,
            height - padding * 2,
            radius * 0.45
        );
        ctx.fill();
    }

    // 正极小凸起
    ctx.beginPath();
    ctx.roundRect(x + bodyWidth + stroke * 0.3, centerY - height * 0.14, height * 0.13, height * 0.28, height * 0.05);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();

    return width;
}

/** 绘制实心圆角矩形。 */
export function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    color: string
): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, Math.min(radius, height / 2, width / 2));
    ctx.fill();
    ctx.restore();
}

/** 导航栏图标的统一线宽比例：真机是细线条，但比早期版本粗一档。 */
const NAV_GLYPH_STROKE = 0.13;

/** 绘制 Android「多任务」图标：圆角方框描边（镂空）。 */
export function drawRecentsGlyph(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    size: number,
    color: string
): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * NAV_GLYPH_STROKE);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.roundRect(centerX - size / 2, centerY - size / 2, size, size, size * 0.3);
    ctx.stroke();
    ctx.restore();
}

/** 绘制 Android「主页」图标：圆形描边（镂空）。 */
export function drawCircleGlyph(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    diameter: number,
    color: string,
    fill = false
): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, diameter / 2, 0, Math.PI * 2);
    if (fill) {
        ctx.fillStyle = color;
        ctx.fill();
    } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, diameter * NAV_GLYPH_STROKE);
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * 绘制 Android「返回」图标：镂空圆角三角，底边那根竖线与三角同一条描边。
 *
 * 早期版本画的是实心三角 + 一根分离的细竖线，看起来既"糊"又多出一笔；系统里的三键返回是描边图形，
 * 拐角与端点是圆的，竖线就是三角形底边本身。
 */
export function drawBackGlyph(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    size: number,
    color: string
): void {
    const half = size / 2;
    const tipX = centerX - half;
    const baseX = centerX + half * 0.55;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * NAV_GLYPH_STROKE);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // 三角轮廓（镂空）
    ctx.beginPath();
    ctx.moveTo(tipX, centerY);
    ctx.lineTo(baseX, centerY - half * 0.84);
    ctx.lineTo(baseX, centerY + half * 0.84);
    ctx.closePath();
    ctx.stroke();
    // 底边竖线：与三角底边重合的一段，一笔画顺
    ctx.beginPath();
    ctx.moveTo(baseX, centerY - half * 0.54);
    ctx.lineTo(baseX, centerY + half * 0.54);
    ctx.stroke();
    ctx.restore();
}

/**
 * 绘制移动数据指示：`5G` 字样，其下方**并排两个小箭头**——左为上行、右为下行（真机就是这个样子）。
 *
 * 制式文字比 `HD` 徽标小一档，与下方箭头之间留出明显间距；箭头相对更大，这样上下两块不会糊成一团。
 *
 * @param size - 参考高度（一般给状态栏图标高度）。字号用 `options.textSize` 显式传入。
 * @returns 指示块宽度，供调用方继续排布。
 */
export function drawMobileData(
    ctx: CanvasRenderingContext2D,
    x: number,
    centerY: number,
    size: number,
    color: string,
    options: { textSize?: number } = {}
): number {
    const textSize = options.textSize ?? size * 0.5;
    const arrowHeight = size * 0.3;
    const arrowWidth = size * 0.32;
    // 文字与箭头之间留白，避免挤在一起看不清是两行。
    const arrowGap = size * 0.2;
    const arrowGap2 = size * 0.1;

    const rowWidth = arrowWidth * 2 + arrowGap;
    // 文字墨迹高度按字号估算即可，这一块只关心整体居中。
    const textInk = textSize * 0.74;
    const blockHeight = textInk + arrowGap + arrowHeight;
    const textCenterY = centerY - blockHeight / 2 + textInk / 2;
    const arrowCenterY = textCenterY + textInk / 2 + arrowGap + arrowHeight / 2;

    ctx.save();
    ctx.fillStyle = color;
    drawText(ctx, '5G', x, textCenterY, { size: textSize, color, align: 'left' });
    const textWidth = measureTextWidth(ctx, '5G', { size: textSize, color });

    /** 画一个竖直方向的小三角。 */
    const triangle = (centerX: number, pointingUp: boolean): void => {
        ctx.beginPath();
        ctx.moveTo(centerX, arrowCenterY + (pointingUp ? -arrowHeight / 2 : arrowHeight / 2));
        ctx.lineTo(centerX + arrowWidth / 2, arrowCenterY + (pointingUp ? arrowHeight / 2 : -arrowHeight / 2));
        ctx.lineTo(centerX - arrowWidth / 2, arrowCenterY + (pointingUp ? arrowHeight / 2 : -arrowHeight / 2));
        ctx.closePath();
        ctx.fill();
    };

    // 并排：左上行、右下行，整排居中于文字下方。
    const rowLeft = x + (textWidth - rowWidth) / 2 + arrowGap2;
    triangle(rowLeft + arrowWidth / 2, true);
    triangle(rowLeft + arrowWidth + arrowGap2 + arrowWidth / 2, false);
    ctx.restore();

    return Math.max(textWidth, rowWidth);
}

/**
 * 把画面按「填满」方式绘制到指定区域（超出部分裁掉），也就是摄像头预览填满窗口的方式。
 */
export function drawImageCover(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    box: { x: number; y: number; width: number; height: number },
    natural: { width: number; height: number },
    mirror = false
): void {
    if (natural.width <= 0 || natural.height <= 0) return;
    const scale = Math.max(box.width / natural.width, box.height / natural.height);
    const width = natural.width * scale;
    const height = natural.height * scale;
    const dx = box.x + (box.width - width) / 2;
    const dy = box.y + (box.height - height) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    if (mirror) {
        // 翻转之后局部 x 从区域右缘向左递增，因此要按区域自身坐标（0..box.width）定位，
        // 而不是再叠加它在屏幕上的偏移。
        ctx.translate(box.x + box.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(image, (box.width - width) / 2, dy, width, height);
    } else {
        ctx.drawImage(image, dx, dy, width, height);
    }
    ctx.restore();
}

/** 绘制中性的人像剪影，用于没有摄像头画面的情况。 */
export function drawSilhouette(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; width: number; height: number },
    color = 'rgba(255,255,255,0.55)'
): void {
    const cx = box.x + box.width / 2;
    const headRadius = Math.min(box.width, box.height) * 0.19;
    const headCy = box.y + box.height * 0.36;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, headCy, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, box.y + box.height * 1.02, box.width * 0.34, box.height * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
