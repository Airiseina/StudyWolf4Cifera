import type { BarHeights, BarProfileName, DeviceInfo, DeviceInput, FormFactor } from './device';

/** 截取画面放进内容区的方式。 */
export type FitMode = 'exact' | 'contain' | 'cover' | 'stretch' | 'none';

/**
 * 档位之和与设备上报的外壳高度不一致时，由哪一栏吸收差额。`none` 表示原样使用档位——档位与
 * 设备相符时这才是对的；无论哪种取值，整帧总高都精确。
 */
export type ReconcileTarget = 'appBar' | 'none';

/** 状态栏外观。默认值对照参考机实测（白底、深色图标）。 */
export interface StatusBarOptions {
    /** 背景色，例如 `#ffffff`。 */
    background?: string;
    /** 图标与文字颜色。 */
    foreground?: string;
    /** 时间文本覆盖值；默认当前本地时间（`HH:MM`，实时）。 */
    time?: string;
    /**
     * 电池图标旁的电量百分比；`null` 表示不画。
     *
     * 缺省时读真实电量（Battery Status API），取不到则用 76。
     */
    batteryPercent?: number | null;
    /** 是否画信号、Wi-Fi 与网络制式徽标。 */
    showNetwork?: boolean;
    /** 是否在前缘画通知点（Android）。 */
    showNotifications?: boolean;
    /** 状态栏内容的左右内缩，CSS px。 */
    inset?: number;
}

/** 客户端工具栏（原生 WebView 外壳）外观。 */
export interface AppBarOptions {
    /** 标题；有 `CLIENT_TOOLBAR_TITLE` 上报值时应使用它。 */
    title?: string;
    /** 标题字号，CSS px。 */
    titleSize?: number;
    /** 背景色。 */
    background?: string;
    /** 文字与图标颜色。 */
    foreground?: string;
    /** 自定义返回键图标（例如 `CLIENT_CUSTOM_LEFTBTN` 给的图）。 */
    backIcon?: CanvasImageSource | null;
    /** 是否画返回键。 */
    showBack?: boolean;
    /** 右侧文字按钮，默认「反馈」（真机考试页右侧就是它）。 */
    rightLabel?: string;
    /** 右侧文字颜色；真机上是主题蓝。 */
    rightLabelColor?: string;
    /** 右侧文字字号，默认比标题小 3 dp。 */
    rightLabelSize?: number;
}

/** 导航栏外观。 */
export interface NavBarOptions {
    /** `buttons` 画三键，`gesture` 画手势条，`none` 留空。 */
    mode?: 'buttons' | 'gesture' | 'none';
    /** 左右两个图标距屏幕中线的比例，默认 0.26（等分三栏是 1/3）。 */
    gapRatio?: number;
    background?: string;
    foreground?: string;
}

/** 摄像头悬浮窗停靠的角。 */
export type FaceWindowCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** 摄像头悬浮窗的画面来源。 */
export type FaceFrameSource =
    | HTMLVideoElement
    | HTMLCanvasElement
    | HTMLImageElement
    | ImageBitmap
    | null;

/**
 * 摄像头悬浮窗（客户端监考时显示的原生浮层）。
 *
 * 默认值全部来自真机实测（截屏 1260x2800，按 3.5 倍密度折算）：窗口 350x420 px = **100x120 dp**，
 * 停在**右上角**，距右边缘 35 px = **10 dp**、距屏幕顶部 297 px ≈ **85 dp**；窗口内部底边压着一条
 * 350x63 px = **18 dp** 的黑色约 20% 透明状态条，居中写着「图像采集中」。
 *
 * 这是系统浮层，因此坐标以**屏幕**为基准（含状态栏），而不是页面内容区。
 */
export interface FaceWindowOptions {
    /** 是否绘制该窗。 */
    enabled?: boolean;
    /** 画面内容；`null` 时画中性剪影。 */
    source?: FaceFrameSource;
    /** 停靠的角，默认右上。 */
    corner?: FaceWindowCorner;
    /** 宽高，CSS px；默认 100x120。 */
    width?: number;
    height?: number;
    /** 距屏幕左右边缘的距离，CSS px；默认 10。 */
    offsetX?: number;
    /** 距屏幕上下边缘的距离，CSS px；默认 85。 */
    offsetY?: number;
    /** 同时覆盖 offsetX / offsetY 的便捷项。 */
    margin?: number;
    /** 圆角半径，CSS px；真机是直角，默认 0。 */
    radius?: number;
    /** 边框宽度，CSS px；真机没有边框，默认 0。 */
    borderWidth?: number;
    borderColor?: string;
    /** 水平镜像，与前置摄像头预览一致。 */
    mirror?: boolean;
    /** 画面底色。 */
    background?: string;
    /** 底部状态条文案；默认「图像采集中」，传 `null` 不画。 */
    label?: string | null;
    /** 状态条高度，CSS px；默认 18。 */
    labelHeight?: number;
    /** 状态条字号，CSS px；实测约 9。 */
    labelSize?: number;
    labelColor?: string;
    labelBackground?: string;
}

/** 页面截取设置。 */
export interface CaptureOptions {
    /** SnapDOM 输出相对 CSS px 的倍率，默认取设备 `dpr`。 */
    scale?: number;
    /**
     * 把跨域资源地址改写成同源地址（例如 Cifera 的 `rewriteUrl`）。不提供时跨域图片与字体会
     * 退化为占位。
     */
    rewriteUrl?: (url: string) => string;
    /** 覆盖资源内联所用的 fetch。 */
    fetchImpl?: typeof fetch;
    /** 完全跳过修改 DOM 的资源内联器。 */
    inlineResources?: boolean;
    /** 单个资源抓取的超时，毫秒。 */
    resourceTimeoutMs?: number;
    /** 额外允许读取 `@font-face` 的跨域样式表主机。 */
    fontStylesheetDomains?: string[];
    /**
     * 额外的排除选择器。插件自己插入的节点都带 {@link SW4C_MARK_ATTRIBUTE}，默认已排除，这里用于追加。
     */
    exclude?: string[];
}

/** 外壳高度与档位选择。 */
export interface ChromeOptions {
    /** 强制指定形态，跳过识别。 */
    formFactor?: FormFactor;
    /** 具名档位；覆盖形态默认的分栏。 */
    profile?: BarProfileName;
    /** 直接指定外壳高度，CSS px；优先级高于 `profile`。 */
    override?: Partial<BarHeights>;
    /** 档位与实测不匹配时由哪一栏吸收，默认 `appBar`。 */
    reconcile?: ReconcileTarget;
    statusBar?: StatusBarOptions;
    appBar?: AppBarOptions;
    navBar?: NavBarOptions;
}

/** {@link composeMonitorFrame} 的参数。 */
export interface ComposeFrameOptions {
    chrome?: ChromeOptions;
    face?: FaceWindowOptions;
    capture?: CaptureOptions;
    /**
     * 覆盖识别出的指标。测试用它固定数值；宿主 WebView 报的是显示器（桌面浏览器）时，也可以
     * 用它传入真实值。
     */
    device?: Partial<DeviceInput>;
    /** 整帧每个 CSS px 对应的画布像素数，默认取设备 `dpr`。 */
    scale?: number;
    /** `fit` 留白时内容区的底色。 */
    letterbox?: string;
    /** 截取画面填充内容区的方式，默认 `exact`。 */
    fit?: FitMode;
    /** 要截取的页面元素，默认 `document.documentElement`。 */
    root?: HTMLElement;
}

/** 合成结果中各区域的几何，单位画布像素。 */
export interface FrameLayout {
    scale: number;
    screen: { width: number; height: number };
    content: Rect;
    statusBar: Rect;
    appBar: Rect;
    navBar: Rect;
    /** 推导布局所用的 CSS px 输入，便于断言与排查。 */
    css: {
        screenWidth: number;
        screenHeight: number;
        viewportWidth: number;
        viewportHeight: number;
        bars: BarHeights;
    };
    device: DeviceInfo;
}

/** 轴对齐矩形，单位画布像素。 */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
