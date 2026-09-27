/** 操作系统族，决定页面外围系统栏的样式。 */
export type OS = 'ios' | 'android' | 'unknown';

/**
 * 设备形态，决定状态栏与导航栏的几何：
 * `<x>-notch` 是圆角全面屏（带 Home 指示条），`<x>-classic` 是实体 Home 键或三键导航。
 */
export type FormFactor =
    | 'iphone-notch'
    | 'iphone-classic'
    | 'ipad-modern'
    | 'ipad-classic'
    | 'android'
    | 'unknown';

/** 从宿主 window 读到的原始指标。与识别逻辑分离，识别部分保持纯函数、便于测试。 */
export interface DeviceInput {
    userAgent: string;
    platform: string;
    maxTouchPoints: number;
    devicePixelRatio: number;
    /** 屏幕（非视口）宽度，CSS px。 */
    screenWidthCss: number;
    /** 屏幕（非视口）高度，CSS px。 */
    screenHeightCss: number;
    /** WebView 视口高度，CSS px。 */
    viewportHeightCss: number;
    viewportWidthCss: number;
}

/** 设备归类与派生指标。 */
export interface DeviceInfo {
    os: OS;
    formFactor: FormFactor;
    dpr: number;
    screenWidthCss: number;
    screenHeightCss: number;
    viewportWidthCss: number;
    viewportHeightCss: number;
    /**
     * 客户端外壳（状态栏 + 工具栏 + 导航栏）的高度，CSS px，取自
     * `screenHeightCss - viewportHeightCss`。宿主不上报整屏高度（桌面浏览器报的是显示器）时为
     * `null`。
     */
    chromeHeightCss: number | null;
}

/** 外壳各栏高度，CSS px（移动端等价于 dp/pt）。 */
export interface BarHeights {
    statusBar: number;
    appBar: number;
    navBar: number;
}

/** 具名的外壳高度档位（实测值或平台标准值），单位 CSS px。 */
export type BarProfileName =
    | 'huawei-teardrop-1080x2400'
    | 'android-3button'
    | 'android-gesture'
    | 'iphone-notch'
    | 'iphone-classic'
    | 'ipad-modern'
    | 'ipad-classic';
