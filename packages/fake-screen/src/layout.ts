import type { BarHeights, DeviceInfo } from './types/device';
import type { FitMode, FrameLayout, Rect } from './types/frame';

/**
 * 计算整帧几何。
 *
 * 以屏幕高度为准、内容区取余量，因为 `window.innerHeight` 会取整到整数 CSS px：参考机上报 679，
 * 而真实视口是 678.33，若由视口反推屏幕就会得到比真实屏幕高 2 px 的帧。各栏只取整一次、偏移
 * 逐段累加，因此总高精确等于 `screenHeight * scale`。
 *
 * @param device - 已识别的设备，其屏幕与视口尺寸决定布局。
 * @param bars - 外壳各栏高度，CSS px。
 * @param scale - 每个 CSS px 对应的画布像素数。
 * @param options - 可固定视口宽度；宿主不上报屏幕尺寸时改用它指定视口高度（桌面浏览器报的是
 * 显示器，此时帧就按窗口来）。
 */
export function computeFrameLayout(
    device: DeviceInfo,
    bars: BarHeights,
    scale: number,
    options: { width?: number; height?: number } = {}
): FrameLayout {
    const widthCss = options.width ?? device.viewportWidthCss ?? device.screenWidthCss;
    const statusBarPx = Math.round(bars.statusBar * scale);
    const appBarPx = Math.round(bars.appBar * scale);
    const navBarPx = Math.round(bars.navBar * scale);
    const widthPx = Math.round(widthCss * scale);

    const screenHeightCss = options.height
        ? options.height + bars.statusBar + bars.appBar + bars.navBar
        : device.screenHeightCss;
    const screenPx = screenHeightCss > 0
        ? Math.round(screenHeightCss * scale)
        : statusBarPx + appBarPx + navBarPx + Math.round(device.viewportHeightCss * scale);

    const contentHeightPx = Math.max(1, screenPx - statusBarPx - appBarPx - navBarPx);

    const statusBar: Rect = { x: 0, y: 0, width: widthPx, height: statusBarPx };
    const appBar: Rect = { x: 0, y: statusBarPx, width: widthPx, height: appBarPx };
    const contentRect: Rect = {
        x: 0,
        y: statusBarPx + appBarPx,
        width: widthPx,
        height: contentHeightPx
    };
    const navBar: Rect = {
        x: 0,
        y: contentRect.y + contentHeightPx,
        width: widthPx,
        height: navBarPx
    };

    return {
        scale,
        screen: { width: widthPx, height: navBar.y + navBarPx },
        content: contentRect,
        statusBar,
        appBar,
        navBar,
        css: {
            screenWidth: widthCss,
            screenHeight: screenHeightCss,
            viewportWidth: widthCss,
            viewportHeight: contentHeightPx / scale,
            bars
        },
        device
    };
}

/** 截取画面在内容区里的放置结果。 */
export interface ContentPlacement {
    x: number;
    y: number;
    width: number;
    height: number;
    /** 放置结果超出内容区、需要裁剪时为 true。 */
    clipped: boolean;
}

/**
 * 把截取画面放进内容区。
 *
 * `exact`（合成帧的默认值）从内容区左上角一比一绘制：截取结果本身就是 `viewport * scale`，
 * 任何重采样只会让它变糊，高度上的亚像素差异直接裁掉。
 */
export function placeContent(
    source: { width: number; height: number },
    target: Rect,
    fit: FitMode
): ContentPlacement {
    if (fit === 'exact') {
        return {
            x: target.x,
            y: target.y,
            width: source.width,
            height: source.height,
            clipped: source.width > target.width || source.height > target.height
        };
    }
    if (fit === 'stretch') {
        return { x: target.x, y: target.y, width: target.width, height: target.height, clipped: false };
    }
    if (fit === 'none') {
        return {
            x: target.x + Math.round((target.width - source.width) / 2),
            y: target.y + Math.round((target.height - source.height) / 2),
            width: source.width,
            height: source.height,
            clipped: source.width > target.width || source.height > target.height
        };
    }

    const k = fit === 'cover'
        ? Math.max(target.width / source.width, target.height / source.height)
        : Math.min(target.width / source.width, target.height / source.height);
    const width = Math.round(source.width * k);
    const height = Math.round(source.height * k);

    return {
        x: target.x + Math.round((target.width - width) / 2),
        y: target.y + Math.round((target.height - height) / 2),
        width,
        height,
        clipped: false
    };
}
