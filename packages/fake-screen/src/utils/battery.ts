/**
 * 读取真实电量。
 *
 * 状态栏画的是系统栏，电量必须与真实一致——写死一个数字，旁边还标着百分比，一看就假。浏览器侧只有
 * Battery Status API 能拿到电量：桌面 Chrome/Edge 支持，Android WebView 上通常没有该 API，因此取不到
 * 时退回调用方给的默认值（默认 76%）。
 */

/** 最近一次读到的电量，避免频繁查询。 */
let cachedPercent: number | null = null;

/** 是否已经尝试过（避免每次都等超时）。 */
let probed = false;

/** 清空缓存，供测试使用。 */
export function resetBatteryCache(): void {
    cachedPercent = null;
    probed = false;
}

/**
 * 取当前电量百分比。
 *
 * @param options.defaultPercent - 取不到时使用的默认值。
 * @param options.timeoutMs - 等待 API 的上限，默认 1200ms；超时即退回默认值。
 */
export async function readBatteryPercent(
    options: { defaultPercent?: number; timeoutMs?: number } = {}
): Promise<number> {
    const fallback = options.defaultPercent ?? 76;
    if (cachedPercent !== null) return cachedPercent;
    if (probed) return fallback;

    const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & {
        getBattery?: () => Promise<{ level: number }>;
    });
    if (!nav?.getBattery) {
        probed = true;
        return fallback;
    }

    probed = true;
    const timeoutMs = options.timeoutMs ?? 1200;
    try {
        const battery = await Promise.race([
            nav.getBattery(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
        ]);
        if (!battery || typeof battery.level !== 'number' || !Number.isFinite(battery.level)) {
            return fallback;
        }
        cachedPercent = Math.round(Math.min(1, Math.max(0, battery.level)) * 100);
        return cachedPercent;
    } catch {
        return fallback;
    }
}
