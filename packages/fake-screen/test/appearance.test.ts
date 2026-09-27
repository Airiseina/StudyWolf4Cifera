/**
 * 外观相关的纯函数测试（不需要 canvas）。
 *
 * 像素级的外观断言（箭头角度、导航栏等分、蓝色文字、电池填充、悬浮窗直角）在
 * `compose.browser.test.ts` 里跑，因为要真的画出来才能统计。
 */
import { describe, expect, test } from 'bun:test';

import { computeFaceWindowBox } from '../src/compose/face-window';
import { computeFrameLayout } from '../src/layout';
import { resetBatteryCache, readBatteryPercent } from '../src/utils/battery';
import { detectDevice, resolveBarHeights } from '../src/utils/device';
import type { DeviceInput } from '../src/types/device';

/** 设备 B（vivo V2507A）实测：360x800 CSS @3.5，视口 679。 */
const DEVICE_B: DeviceInput = {
    userAgent:
        'Mozilla/5.0 (Linux; Android 16; V2507A Build/BP2A.250605.031.A3_V000L1; wv) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Version/4.0 Chrome/154.0.8037.22 Mobile Safari/537.36 ' +
        'com.chaoxing.mobile/ChaoXingStudy_3_6.7.7_android_phone_10945_315',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    devicePixelRatio: 3.5,
    screenWidthCss: 360,
    screenHeightCss: 800,
    viewportWidthCss: 360,
    viewportHeightCss: 679
};

function deviceBLayout() {
    const device = detectDevice(DEVICE_B);
    const bars = resolveBarHeights(device, { profile: 'huawei-teardrop-1080x2400' });
    return computeFrameLayout(device, bars, 3.5);
}

describe('悬浮窗外观', () => {
    test('默认直角、无边框', () => {
        const box = computeFaceWindowBox(deviceBLayout(), {});
        expect(box.radius).toBe(0);
        expect(box.width / box.height).toBeCloseTo(350 / 420, 3);
    });
});

describe('电量读取', () => {
    test('没有 Battery API 时退回默认值 76', async () => {
        resetBatteryCache();
        // Bun 环境没有 navigator.getBattery。
        expect(await readBatteryPercent()).toBe(76);
    });

    test('默认值可覆盖', async () => {
        resetBatteryCache();
        expect(await readBatteryPercent({ defaultPercent: 42 })).toBe(42);
    });
});
