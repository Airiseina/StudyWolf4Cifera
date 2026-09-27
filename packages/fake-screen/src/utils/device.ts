import type {
    BarHeights,
    BarProfileName,
    DeviceInfo,
    DeviceInput,
    FormFactor,
    OS
} from '../types/device';

/** 读取 {@link detectDevice} 所需原始指标。 */
export function readDeviceInput(win: Window = window): DeviceInput {
    const nav = win.navigator;
    return {
        userAgent: nav?.userAgent ?? '',
        platform: (nav as Navigator & { platform?: string })?.platform ?? '',
        maxTouchPoints: nav?.maxTouchPoints ?? 0,
        devicePixelRatio: win.devicePixelRatio || 1,
        screenWidthCss: Math.round(win.screen?.width ?? win.innerWidth ?? 0),
        screenHeightCss: Math.round(win.screen?.height ?? win.innerHeight ?? 0),
        viewportHeightCss: Math.round(win.innerHeight ?? 0),
        viewportWidthCss: Math.round(win.innerWidth ?? 0)
    };
}

/**
 * 识别设备并推导外壳高度。
 *
 * 外壳高度取自 `screenHeight - viewportHeight`：在客户端 WebView 里这是精确的（客户端把内容按
 * 状态栏、工具栏、导航栏内缩）。桌面浏览器的 `screen` 报的是显示器，因此只有当 UA 看起来像
 * 移动客户端时才采用该值。
 */
export function detectDevice(input: DeviceInput): DeviceInfo {
    const ua = input.userAgent;
    const platform = input.platform;

    // iPadOS 13+ 上报桌面 UA，多点触控是唯一可靠线索。
    const isIPad = /iPad/.test(ua) || (platform === 'MacIntel' && input.maxTouchPoints > 1);
    const isIPhone = /iPhone|iPod/.test(ua);
    const isIOS = isIPad || isIPhone;
    const isAndroid = /Android|harmony_phone/i.test(ua);

    const os: OS = isIOS ? 'ios' : isAndroid ? 'android' : 'unknown';

    const shortSide = Math.min(input.screenWidthCss, input.screenHeightCss);
    const longSide = Math.max(input.screenWidthCss, input.screenHeightCss);

    let formFactor: FormFactor = 'unknown';
    if (isIPad) {
        // 全面屏 iPad（2018 起）长边不小于 1130 pt。
        formFactor = longSide >= 1130 ? 'ipad-modern' : 'ipad-classic';
    } else if (isIPhone) {
        // iPhone 8 Plus 高 736 pt，iPhone X 及之后不小于 812 pt。
        formFactor = longSide >= 812 ? 'iphone-notch' : 'iphone-classic';
    } else if (isAndroid) {
        formFactor = 'android';
    }

    const chrome = input.screenHeightCss - input.viewportHeightCss;
    const chromeHeightCss =
        os !== 'unknown' && chrome > 0 && chrome < input.screenHeightCss * 0.4 ? chrome : null;

    return {
        os,
        formFactor,
        dpr: input.devicePixelRatio,
        screenWidthCss: input.screenWidthCss,
        screenHeightCss: input.screenHeightCss,
        viewportWidthCss: input.viewportWidthCss,
        viewportHeightCss: input.viewportHeightCss,
        chromeHeightCss
    };
}

/**
 * 外壳高度档位，CSS px。`huawei-teardrop-1080x2400` 来自参考机实测（HUAWEI PPA-AL20，
 * 1080x2400 @3x，状态栏 35 dp、工具栏 48 dp、三键导航 116 px），用注入的整屏彩色标尺加
 * `dumpsys window` insets 量得；其余为平台标准值。
 */
export const BAR_PROFILES: Readonly<Record<BarProfileName, BarHeights>> = Object.freeze({
    'huawei-teardrop-1080x2400': { statusBar: 35, appBar: 48, navBar: 116 / 3 },
    'android-3button': { statusBar: 24, appBar: 48, navBar: 48 },
    'android-gesture': { statusBar: 24, appBar: 48, navBar: 24 },
    'iphone-notch': { statusBar: 44, appBar: 44, navBar: 34 },
    'iphone-classic': { statusBar: 20, appBar: 44, navBar: 0 },
    'ipad-modern': { statusBar: 24, appBar: 44, navBar: 20 },
    'ipad-classic': { statusBar: 20, appBar: 44, navBar: 0 }
});

/** 调用方未指定档位时使用的那一档。 */
export function defaultProfileFor(device: DeviceInfo): BarProfileName {
    switch (device.formFactor) {
        case 'iphone-notch':
            return 'iphone-notch';
        case 'iphone-classic':
            return 'iphone-classic';
        case 'ipad-modern':
            return 'ipad-modern';
        case 'ipad-classic':
            return 'ipad-classic';
        default:
            return 'android-3button';
    }
}

/** 保留两位小数，既留住 116/3 这类分数 dp，又不引入浮点噪声。 */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * 计算设备的外壳高度。
 *
 * 档位原样使用：{@link computeFrameLayout} 把内容区当作余量，所以帧的总高度始终等于真实屏幕，
 * 档位之和与上报的外壳高度略有出入也不影响结果（参考机真实外壳是 121.67 dp，取整后的视口
 * 指标只报 121）。若想让分栏之和强行对上上报值，可传 `reconcile: 'appBar'`，仅在确认档位与
 * 设备不符时才有意义。
 */
export function resolveBarHeights(
    device: DeviceInfo,
    options: {
        profile?: BarProfileName;
        override?: Partial<BarHeights>;
        reconcile?: 'appBar' | 'none';
    } = {}
): BarHeights {
    const { profile, override, reconcile = 'none' } = options;
    const base = BAR_PROFILES[profile ?? defaultProfileFor(device)];
    const heights: BarHeights = {
        statusBar: override?.statusBar ?? base.statusBar,
        appBar: override?.appBar ?? base.appBar,
        navBar: override?.navBar ?? base.navBar
    };

    if (reconcile !== 'none' && device.chromeHeightCss !== null && override?.appBar === undefined) {
        const total = heights.statusBar + heights.appBar + heights.navBar;
        const diff = round2(device.chromeHeightCss - total);
        if (diff !== 0) {
            // 夹紧范围，避免异常测量值算出离谱的工具栏。
            heights.appBar = round2(Math.min(120, Math.max(24, heights.appBar + diff)));
        }
    }

    return {
        statusBar: round2(heights.statusBar),
        appBar: round2(heights.appBar),
        navBar: round2(heights.navBar)
    };
}
