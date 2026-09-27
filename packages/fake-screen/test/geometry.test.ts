import { describe, expect, test } from 'bun:test';

import { computeFrameLayout, placeContent } from '../src/layout';
import { computeFaceWindowBox } from '../src/compose/face-window';
import { BAR_PROFILES, detectDevice, resolveBarHeights } from '../src/utils/device';
import type { DeviceInput } from '../src/types/device';

/**
 * 参考机（HUAWEI PPA-AL20）的实测指标，取自真实 WebView：1080x2400 屏幕、3 倍密度、
 * 800x679 CSS px 窗口；外壳高度用注入的彩色标尺加 `dumpsys window` insets 量得
 * 105/144/116 px。
 */
const REFERENCE_DEVICE: DeviceInput = {
    userAgent:
        'Mozilla/5.0 (Linux; Android 10; PPA-AL20 Build/HUAWEIPPA-AL40; wv) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36 ' +
        'com.chaoxing.mobile/ChaoXingStudy_3_6.7.2_android_phone_10936_311',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    devicePixelRatio: 3,
    screenWidthCss: 360,
    screenHeightCss: 800,
    viewportWidthCss: 360,
    viewportHeightCss: 679
};

describe('detectDevice', () => {
    test('classifies the reference device and derives its chrome height', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        expect(device.os).toBe('android');
        expect(device.formFactor).toBe('android');
        expect(device.chromeHeightCss).toBe(121);
    });

    test('ignores screen metrics on desktop, where they describe the monitor', () => {
        const device = detectDevice({
            ...REFERENCE_DEVICE,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
            platform: 'Win32',
            maxTouchPoints: 0,
            screenWidthCss: 1920,
            screenHeightCss: 1080,
            viewportHeightCss: 900
        });
        expect(device.os).toBe('unknown');
        expect(device.chromeHeightCss).toBeNull();
    });

    test('treats a multi-touch MacIntel platform as an iPad', () => {
        const device = detectDevice({
            ...REFERENCE_DEVICE,
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
            platform: 'MacIntel',
            maxTouchPoints: 5,
            devicePixelRatio: 2,
            screenWidthCss: 834,
            screenHeightCss: 1194
        });
        expect(device.os).toBe('ios');
        expect(device.formFactor).toBe('ipad-modern');
    });
});

describe('resolveBarHeights', () => {
    test('uses the named profile verbatim', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        const bars = resolveBarHeights(device, { profile: 'huawei-teardrop-1080x2400' });
        expect(bars.statusBar).toBe(35);
        expect(bars.appBar).toBe(48);
        expect(bars.navBar).toBeCloseTo(38.67, 2);
    });

    test('picks a profile from the form factor when none is named', () => {
        const device = detectDevice({
            ...REFERENCE_DEVICE,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
            platform: 'iPhone',
            screenWidthCss: 390,
            screenHeightCss: 844,
            viewportHeightCss: 766
        });
        expect(device.formFactor).toBe('iphone-notch');
        expect(resolveBarHeights(device)).toEqual({ statusBar: 44, appBar: 44, navBar: 34 });
    });

    test('honours explicit overrides over the profile', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        const bars = resolveBarHeights(device, {
            profile: 'huawei-teardrop-1080x2400',
            override: { navBar: 0, statusBar: 24 }
        });
        expect(bars).toEqual({ statusBar: 24, appBar: 48, navBar: 0 });
    });

    test('absorbs a mismatch in the app bar only when asked', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        const kept = resolveBarHeights(device, { profile: 'android-3button' });
        expect(kept.appBar).toBe(48);

        const reconciled = resolveBarHeights(device, {
            profile: 'android-3button',
            reconcile: 'appBar'
        });
        expect(reconciled.appBar).toBeCloseTo(49, 2);
    });
});

describe('computeFrameLayout', () => {
    test('reproduces the reference device geometry pixel for pixel', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        const bars = resolveBarHeights(device, { profile: 'huawei-teardrop-1080x2400' });
        const layout = computeFrameLayout(device, bars, 3);

        // 真机实测：状态栏 0-104，工具栏 105-248，页面 249-2283，导航栏 2284-2399。
        expect(layout.screen).toEqual({ width: 1080, height: 2400 });
        expect(layout.statusBar).toEqual({ x: 0, y: 0, width: 1080, height: 105 });
        expect(layout.appBar).toEqual({ x: 0, y: 105, width: 1080, height: 144 });
        expect(layout.content).toEqual({ x: 0, y: 249, width: 1080, height: 2035 });
        expect(layout.navBar).toEqual({ x: 0, y: 2284, width: 1080, height: 116 });
    });

    test('keeps the display height exact when the profile does not fit the device', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        const layout = computeFrameLayout(device, BAR_PROFILES['android-gesture'], 3);
        expect(layout.screen.height).toBe(2400);
        expect(layout.navBar.y + layout.navBar.height).toBe(2400);
    });

    test('falls back to the chrome sum when the host hides the display size', () => {
        const device = detectDevice({ ...REFERENCE_DEVICE, screenHeightCss: 0 });
        const layout = computeFrameLayout(device, BAR_PROFILES['android-3button'], 2, { height: 700 });
        expect(layout.screen.height).toBe((700 + 24 + 48 + 48) * 2);
    });
});

describe('computeFaceWindowBox', () => {
    test('默认值复现真机实测的右上角悬浮窗', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        const bars = resolveBarHeights(device, { profile: 'huawei-teardrop-1080x2400' });
        const layout = computeFrameLayout(device, bars, 3);
        const box = computeFaceWindowBox(layout, {});

        // 实测 350x420 px @3.5x = 100x120 dp；距右 35 px = 10 dp，距顶 297 px ≈ 85 dp。
        expect(box).toMatchObject({ x: 1080 - 300 - 30, y: 255, width: 300, height: 360 });
        expect(box.corner).toBe('top-right');
        expect(box.width / box.height).toBeCloseTo(350 / 420, 3);
        // 底部 63 px @3.5x = 18 dp 的状态条。
        expect(box.label).toEqual({ x: 1080 - 330, y: 255 + 360 - 54, width: 300, height: 54 });
    });

    test('按整屏定位，与页面内容区无关', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        const bars = resolveBarHeights(device, { profile: 'huawei-teardrop-1080x2400' });
        const layout = computeFrameLayout(device, bars, 3);
        // 内容区左上角在 y=249，但窗口的 y 只由屏幕顶部决定。
        expect(computeFaceWindowBox(layout, { offsetY: 100 }).y).toBe(300);
        expect(computeFaceWindowBox(layout, { margin: 20 })).toMatchObject({ x: 1080 - 300 - 60, y: 60 });
    });

    test('label 传 null 时不画状态条', () => {
        const device = detectDevice(REFERENCE_DEVICE);
        const bars = resolveBarHeights(device, { profile: 'huawei-teardrop-1080x2400' });
        const layout = computeFrameLayout(device, bars, 3);
        expect(computeFaceWindowBox(layout, { label: null }).label).toBeNull();
    });
});

describe('placeContent', () => {
    const target = { x: 0, y: 100, width: 1000, height: 500 };

    test('draws an exact-size capture from the top-left without resampling', () => {
        expect(placeContent({ width: 1080, height: 520 }, target, 'exact')).toEqual({
            x: 0,
            y: 100,
            width: 1080,
            height: 520,
            clipped: true
        });
    });

    test('letterboxes with contain', () => {
        const placement = placeContent({ width: 1000, height: 1000 }, target, 'contain');
        expect(placement.height).toBe(500);
        expect(placement.width).toBe(500);
        expect(placement.x).toBe(250);
        expect(placement.y).toBe(100);
        expect(placement.clipped).toBe(false);
    });

    test('crops with cover', () => {
        const placement = placeContent({ width: 1000, height: 1000 }, target, 'cover');
        expect(placement.width).toBe(1000);
        expect(placement.height).toBe(1000);
        expect(placement.clipped).toBe(false);
    });

    test('stretches to the box and centres natural size for none', () => {
        expect(placeContent({ width: 10, height: 10 }, target, 'stretch')).toEqual({
            x: 0,
            y: 100,
            width: 1000,
            height: 500,
            clipped: false
        });
        const centred = placeContent({ width: 100, height: 100 }, target, 'none');
        expect(centred.x).toBe(450);
        expect(centred.y).toBe(300);
    });
});
