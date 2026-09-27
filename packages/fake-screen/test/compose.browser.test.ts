/**
 * 在真实浏览器里运行的合成测试。
 *
 * fixture 复刻了考试页上会让粗糙截取失效的几类内容：同源 iframe、只有走代理改写器才读得到的
 * 跨域图片、跨域 CSS 背景、来自另一个源的 `@font-face`，以及一张取不到的图片。浏览器通过
 * playwright-core 驱动本机已装的 Edge，因此不需要下载。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, type Browser, type Page } from 'playwright-core';

import { withInlinedResources } from '../src/capture/inliner';
import type { DeviceInput } from '../src/types/device';

const EDGE_PATHS = [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome'
].filter((entry): entry is string => !!entry);

/** 参考机指标；固定它们可以让几何断言与运行环境无关。 */
const REFERENCE_DEVICE: Partial<DeviceInput> = {
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

const ARTIFACT_DIR = join(import.meta.dir, 'artifacts');

/**
 * 手工编码的单色 PNG，使 fixture 不依赖磁盘上的二进制素材。
 *
 * 必须用 `node:zlib`：`Bun.deflateSync` 输出的是裸 deflate 流，而 PNG 的 IDAT 块要求
 * zlib 流（RFC 1950），否则浏览器会拒绝解码。
 */
function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
    }
    const crc32 = (bytes: Uint8Array): number => {
        let c = 0xffffffff;
        for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Uint8Array): Uint8Array => {
        const out = new Uint8Array(12 + data.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, data.length);
        out.set(new TextEncoder().encode(type), 4);
        out.set(data, 8);
        view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
        return out;
    };
    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, width);
    ihdrView.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolour
    const raw = new Uint8Array(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 3);
        raw[rowStart] = 0; // filter: none
        for (let x = 0; x < width; x++) {
            const pixel = rowStart + 1 + x * 3;
            raw[pixel] = rgb[0];
            raw[pixel + 1] = rgb[1];
            raw[pixel + 2] = rgb[2];
        }
    }
    const png = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', new Uint8Array(0))
    ];
    const total = png.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of png) {
        merged.set(part, offset);
        offset += part.length;
    }
    return merged;
}

const PHOTO = solidPng(120, 80, [0x12, 0x34, 0x56]);

let browser: Browser;
let page: Page;
let mainServer: ReturnType<typeof Bun.serve>;
let assetServer: ReturnType<typeof Bun.serve>;
let librarySource = '';

const MAIN_ORIGIN = () => `http://127.0.0.1:${mainServer.port}`;
const ASSET_ORIGIN = () => `http://127.0.0.1:${assetServer.port}`;

beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [join(import.meta.dir, '..', 'src', 'index.ts')],
        target: 'browser',
        format: 'esm',
        minify: false
    });
    if (!build.success) throw new Error('fixture bundle failed: ' + build.logs.map(String).join('\n'));
    librarySource = await build.outputs[0].text();

    await mkdir(ARTIFACT_DIR, { recursive: true });

    // 跨域素材所在的第二个源。它故意不发 CORS 头，因此页面只能通过同源代理端点读取这些资源。
    assetServer = Bun.serve({
        port: 0,
        fetch(request) {
            const { pathname } = new URL(request.url);
            if (pathname === '/photo.png') {
                return new Response(PHOTO, { headers: { 'content-type': 'image/png' } });
            }
            if (pathname === '/font.woff2') {
                // 不是真字体：测试只断言地址被改写成 data URL，而真字体只会让 fixture 白白
                // 多出一兆的噪声。
                return new Response(new Uint8Array(64).fill(7), {
                    headers: { 'content-type': 'font/woff2' }
                });
            }
            return new Response('not found', { status: 404 });
        }
    });

    mainServer = Bun.serve({
        port: 0,
        async fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/lib.js') {
                return new Response(librarySource, {
                    headers: { 'content-type': 'application/javascript' }
                });
            }
            if (url.pathname === '/proxy') {
                const target = url.searchParams.get('url') ?? '';
                if (!target.startsWith(ASSET_ORIGIN())) {
                    return new Response('proxy only serves the asset origin', { status: 400 });
                }
                const upstream = await fetch(target);
                return new Response(upstream.body, {
                    status: upstream.status,
                    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' }
                });
            }
            if (url.pathname === '/fixture.css') {
                return new Response(
                    `@font-face {
                        font-family: 'FixtureFont';
                        src: url('${ASSET_ORIGIN()}/font.woff2') format('woff2');
                    }
                    .cross-bg {
                        background-color: #ffffff;
                        background-image: url('${ASSET_ORIGIN()}/photo.png');
                        background-size: cover;
                    }`,
                    { headers: { 'content-type': 'text/css' } }
                );
            }
            if (url.pathname === '/iframe.html') {
                return new Response(
                    `<!doctype html><html><body style="margin:0;background:#00ff00">
                       <div id="inner" style="height:120px;background:#00ff00"></div>
                     </body></html>`,
                    { headers: { 'content-type': 'text/html' } }
                );
            }
            return new Response(fixtureHtml(), { headers: { 'content-type': 'text/html' } });
        }
    });

    const executablePath = EDGE_PATHS.find((candidate) => Bun.file(candidate).size > 0);
    if (!executablePath) throw new Error('no Edge/Chrome binary found for browser tests');
    browser = await chromium.launch({ executablePath, headless: true });
    page = await browser.newPage({ viewport: { width: 360, height: 679 }, deviceScaleFactor: 1 });

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${MAIN_ORIGIN()}/`);
    await page.waitForFunction(() => (window as any).FakeScreen !== undefined);
    if (errors.length) throw new Error('fixture page errors: ' + errors.join('; '));
}, 60_000);

afterAll(async () => {
    await browser?.close();
    mainServer?.stop(true);
    assetServer?.stop(true);
}, 30_000);

const fixtureHtml = () => `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/fixture.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #ffffff; }
    #banner { height: 200px; background: #ff0000; }
    #cross  { position: absolute; top: 220px; left: 10px; width: 120px; height: 80px; }
    .cross-bg { position: absolute; top: 320px; left: 10px; width: 120px; height: 80px; }
    #frame  { position: absolute; top: 420px; left: 10px; width: 200px; height: 120px; border: 0; }
    #broken { position: absolute; top: 560px; left: 10px; width: 40px; height: 40px; }
    #sample { position: absolute; top: 610px; left: 10px; font-family: 'FixtureFont', sans-serif; font-size: 20px; }
    #face   { position: absolute; top: 640px; left: 300px; width: 40px; height: 30px; }
  </style>
</head><body>
  <div id="banner"></div>
  <img id="cross" src="${ASSET_ORIGIN()}/photo.png" alt="">
  <div class="cross-bg" id="crossBg"></div>
  <iframe id="frame" src="/iframe.html"></iframe>
  <img id="broken" src="${ASSET_ORIGIN()}/missing.png" alt="">
  <div id="sample">Font sample</div>
  <canvas id="face" width="120" height="160"></canvas>
  <script type="module">
    import * as FakeScreen from '/lib.js';
    window.FakeScreen = FakeScreen;
  </script>
  <script>
    // 纯品红色的「摄像头」画面，便于按颜色识别合成出的人脸窗。
    const face = document.getElementById('face');
    const ctx = face.getContext('2d');
    ctx.fillStyle = '#ff00aa';
    ctx.fillRect(0, 0, face.width, face.height);
  </script>
</body></html>`;

/** 读取合成帧上的一个像素，允许抗锯齿/合成误差。 */
async function expectPixelClose(
    canvasId: string,
    x: number,
    y: number,
    expected: number[],
    tolerance = 6
): Promise<void> {
    const actual = await readPixel(canvasId, x, y);
    for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(tolerance);
    }
}

/** 读取合成帧上的一个像素。 */
async function readPixel(canvasId: string, x: number, y: number): Promise<number[]> {
    return page.evaluate(
        ({ canvasId, x, y }) => {
            const canvas = (window as any)[canvasId] as HTMLCanvasElement;
            const ctx = canvas.getContext('2d')!;
            const data = ctx.getImageData(x, y, 1, 1).data;
            return [data[0], data[1], data[2]];
        },
        { canvasId, x, y }
    );
}

/** 统计区域内较暗的像素数，用来判断是否真的画上了图标或文字。 */
async function countDark(
    canvasId: string,
    rect: { x: number; y: number; width: number; height: number },
    threshold = 140
): Promise<number> {
    return page.evaluate(
        ({ canvasId, rect, threshold }) => {
            const canvas = (window as any)[canvasId] as HTMLCanvasElement;
            const ctx = canvas.getContext('2d')!;
            const { data } = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
            let count = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < threshold) count++;
            }
            return count;
        },
        { canvasId, rect, threshold }
    );
}

describe('composeMonitorFrame', () => {
    test('composes a full-display frame with the reference device geometry', async () => {
        const result = await page.evaluate(
            async ({ device }) => {
                const frame = await (window as any).FakeScreen.composeMonitorFrame(document.documentElement, {
                    device,
                    scale: 3,
                    chrome: {
                        profile: 'huawei-teardrop-1080x2400',
                        appBar: { title: '张三 (20230001)', rightLabel: '高级' },
                        statusBar: { time: '19:29', batteryPercent: 29 }
                    },
                    face: { source: document.getElementById('face'), enabled: true },
                    capture: {
                        rewriteUrl: (url: string) => {
                            const parsed = new URL(url);
                            return parsed.origin === location.origin
                                ? url
                                : '/proxy?url=' + encodeURIComponent(url);
                        }
                    }
                });
                (window as any).__frame = frame.canvas;
                const jpeg = frame.canvas.toDataURL('image/jpeg', 0.9);
                return {
                    layout: frame.layout,
                    inlined: frame.capture.inlined,
                    failed: frame.capture.failed,
                    warnings: frame.capture.warnings,
                    jpegBytes: Math.round((jpeg.length - 'data:image/jpeg;base64,'.length) * 0.75),
                    hasContext: true
                };
            },
            { device: REFERENCE_DEVICE }
        );

        // 几何必须与真机实测一致：105 / 144 / 2035 / 116 px。
        expect(result.layout.screen).toEqual({ width: 1080, height: 2400 });
        expect(result.layout.statusBar.height).toBe(105);
        expect(result.layout.appBar.height).toBe(144);
        expect(result.layout.content).toEqual({ x: 0, y: 249, width: 1080, height: 2035 });
        expect(result.layout.navBar.height).toBe(116);

        // 跨域资源：照片、它的 CSS 背景副本与字体都经代理内联；取不到的图片要如实上报，
        // 而不是悄悄丢掉。
        expect(result.inlined).toBeGreaterThanOrEqual(3);
        expect(result.failed.map((entry: { url: string }) => entry.url)).toContain(
            `${ASSET_ORIGIN()}/missing.png`
        );
        expect(result.jpegBytes).toBeGreaterThan(20_000);
    }, 60_000);

    test('renders the expected pixels for every region', async () => {
        // 状态栏：白底，且确实画上了灰色的时钟与指示图标。
        expect(await readPixel('__frame', 10, 10)).toEqual([255, 255, 255]);
        expect(await countDark('__frame', { x: 0, y: 0, width: 1080, height: 105 })).toBeGreaterThan(200);

        // 工具栏：白底，标题与返回箭头以深灰画出。
        expect(await readPixel('__frame', 200, 130)).toEqual([255, 255, 255]);
        expect(await countDark('__frame', { x: 0, y: 105, width: 1080, height: 144 })).toBeGreaterThan(150);

        // 页面内容：顶部色块、跨域图片与同源 iframe。
        expect(await readPixel('__frame', 540, 549)).toEqual([255, 0, 0]);
        expect(await readPixel('__frame', 210, 1029)).toEqual([0x12, 0x34, 0x56]);
        expect(await readPixel('__frame', 210, 1329)).toEqual([0x12, 0x34, 0x56]);
        expect(await readPixel('__frame', 330, 1689)).toEqual([0, 255, 0]);

        // 摄像头悬浮窗：默认贴右上角（真机实测方位与尺寸），由传入的画面填充并做了镜像。
        expect(await readPixel('__frame', 900, 435)).toEqual([255, 0, 170]);
        // 底边 18 dp 的状态条：20% 黑压在画面上，避开文字取点。
        expectPixelClose('__frame', 760, 588, [204, 0, 136]);

        // 导航栏：近乎白色的底与灰色图标（#8c8c8c，比"深色"阈值浅，因此放宽到 210）。
        // 取点要避开图标：三键中心在 20% / 50% / 80% 宽度处，所以左侧空白区取 x=80。
        expect(await readPixel('__frame', 80, 2341)).toEqual([252, 252, 252]);
        expect(
            await countDark('__frame', { x: 0, y: 2284, width: 1080, height: 116 }, 210)
        ).toBeGreaterThan(500);
    });

    test('falls back to a silhouette face window and writes inspection artifacts', async () => {
        const artifacts = await page.evaluate(
            async ({ device }) => {
                const api = (window as any).FakeScreen;
                const quiet = await api.composeMonitorFrame(document.documentElement, {
                    device,
                    scale: 1,
                    chrome: { profile: 'android-3button', appBar: { title: '示例如题' } },
                    face: { enabled: true },
                    capture: { inlineResources: false }
                });
                const withFace = await api.composeMonitorFrame(document.documentElement, {
                    device,
                    scale: 1,
                    chrome: { profile: 'android-3button', appBar: { title: '示例如题' } },
                    face: { source: document.getElementById('face') },
                    capture: { inlineResources: false }
                });
                // 设备分辨率整帧，用于和真实截屏对照。
                const fullSize = await api.composeMonitorFrame(document.documentElement, {
                    device,
                    scale: 3,
                    chrome: {
                        profile: 'huawei-teardrop-1080x2400',
                        appBar: { title: '示例如题' },
                        statusBar: { time: '19:29', batteryPercent: 29 }
                    },
                    face: { source: document.getElementById('face') }
                });
                return {
                    quiet: quiet.canvas.toDataURL('image/png'),
                    withFace: withFace.canvas.toDataURL('image/png'),
                    fullSize: fullSize.canvas.toDataURL('image/jpeg', 0.9),
                    quietSize: [quiet.canvas.width, quiet.canvas.height],
                    fullSizePixels: [fullSize.canvas.width, fullSize.canvas.height]
                };
            },
            { device: REFERENCE_DEVICE }
        );

        await Bun.write(
            join(ARTIFACT_DIR, 'frame-silhouette.png'),
            Buffer.from(artifacts.quiet.split(',')[1], 'base64')
        );
        await Bun.write(
            join(ARTIFACT_DIR, 'frame-face.png'),
            Buffer.from(artifacts.withFace.split(',')[1], 'base64')
        );
        await Bun.write(
            join(ARTIFACT_DIR, 'frame-1080x2400.jpg'),
            Buffer.from(artifacts.fullSize.split(',')[1], 'base64')
        );
        expect(artifacts.quietSize).toEqual([360, 800]);
        expect(artifacts.fullSizePixels).toEqual([1080, 2400]);
    }, 60_000);
});

describe('外观细节（像素统计）', () => {
    /** 设备 B（vivo）实测指标；用 3.5 倍密度换算像素。 */
    const DEVICE_B = {
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

    /** 在画出的帧里统计某个区域的墨迹（返回数量、包围盒与列投影）。 */
    async function inkStats(
        chrome: Record<string, unknown>,
        area: { band: 'appBar' | 'navBar' | 'statusBar'; xRatio: number; widthRatio: number },
        kind: 'dark' | 'blue'
    ): Promise<{ count: number; width: number; height: number; columns: number[] }> {
        return page.evaluate(
            ({ device, chrome, area, kind }) => {
                const api = (window as any).FakeScreen;
                const dev = api.detectDevice({ ...device });
                const bars = api.resolveBarHeights(dev, { profile: 'huawei-teardrop-1080x2400' });
                const layout = api.computeFrameLayout(dev, bars, 3.5);
                // composeFrame 的第三个参数是 options，外壳参数在 options.chrome 里。
                const canvas = api.composeFrame(layout, null, { chrome });
                const band = layout[area.band];
                const x = Math.round(layout.screen.width * area.xRatio);
                const width = Math.round(layout.screen.width * area.widthRatio);
                const data = canvas.getContext('2d').getImageData(x, band.y, width, band.height).data;

                const match =
                    kind === 'dark'
                        ? (r: number, g: number, b: number) => r < 200 && g < 200 && b < 200
                        : (r: number, g: number, b: number) => b > 180 && b - r > 60 && g > r;

                let count = 0;
                let minX = 1e9;
                let maxX = -1;
                let minY = 1e9;
                let maxY = -1;
                const columns = new Array(width).fill(0);
                for (let yy = 0; yy < band.height; yy++) {
                    for (let xx = 0; xx < width; xx++) {
                        const i = (yy * width + xx) * 4;
                        if (!match(data[i], data[i + 1], data[i + 2])) continue;
                        count++;
                        columns[xx]++;
                        if (xx < minX) minX = xx;
                        if (xx > maxX) maxX = xx;
                        if (yy < minY) minY = yy;
                        if (yy > maxY) maxY = yy;
                    }
                }
                return { count, width: maxX - minX, height: maxY - minY, columns };
            },
            { device: DEVICE_B, chrome, area, kind }
        );
    }

    test('返回箭头细、张口大', async () => {
        const chevron = await inkStats(
            { appBar: { title: '', rightLabel: '' }, statusBar: { showNetwork: false } },
            { band: 'appBar', xRatio: 0, widthRatio: 0.12 },
            'dark'
        );

        expect(chevron.count).toBeGreaterThan(20);
        // 张口越大，V 形越"扁"：高度/宽度更大。旧实现（openingRatio 0.62）只有 1.6 左右，现在是 2.2+。
        expect(chevron.height / chevron.width).toBeGreaterThan(2);
    });

    test('导航栏三键对称摆放（默认 24% / 50% / 76%）', async () => {
        const nav = await inkStats(
            { navBar: { mode: 'buttons' }, appBar: { title: '', rightLabel: '' } },
            { band: 'navBar', xRatio: 0, widthRatio: 1 },
            'dark'
        );

        const centers: number[] = [];
        let start = -1;
        for (let x = 0; x < nav.columns.length; x++) {
            const on = nav.columns[x] > 0;
            if (on && start === -1) start = x;
            if ((!on || x === nav.columns.length - 1) && start !== -1) {
                centers.push((start + (on ? x : x - 1)) / 2);
                start = -1;
            }
        }

        const width = nav.columns.length;
        expect(centers).toHaveLength(3);
        // 默认 gapRatio 0.26：中心在 24% / 50% / 76%（等分三栏是 1/6、1/2、5/6，观感偏散）。
        expect(centers[0] / width).toBeCloseTo(0.24, 1);
        expect(centers[1] / width).toBeCloseTo(0.5, 1);
        expect(centers[2] / width).toBeCloseTo(0.76, 1);
    });

    test('工具栏右侧有蓝色小字，字号小于标题', async () => {
        const blue = await inkStats(
            { appBar: { title: '张三 (20230001)' } },
            { band: 'appBar', xRatio: 0.72, widthRatio: 0.28 },
            'blue'
        );
        const title = await inkStats(
            { appBar: { title: '张三 (20230001)' } },
            { band: 'appBar', xRatio: 0.25, widthRatio: 0.5 },
            'dark'
        );

        expect(blue.count).toBeGreaterThan(50);
        expect(title.height).toBeGreaterThan(blue.height);
    });

    test('电池填充随电量变化', async () => {
        // 整条状态栏：时钟与百分比两次相同，差异只来自电池填充。
        const area = { band: 'statusBar' as const, xRatio: 0, widthRatio: 1 };
        const low = await inkStats({ statusBar: { batteryPercent: 10, time: '19:29' } }, area, 'dark');
        const high = await inkStats({ statusBar: { batteryPercent: 100, time: '19:29' } }, area, 'dark');

        expect(high.count).toBeGreaterThan(low.count + 150);
    });

    test('返回箭头朝左：左端是尖点，右端才是两臂', async () => {
        const shape = await page.evaluate(({ device }) => {
            const api = (window as any).FakeScreen;
            const dev = api.detectDevice({ ...device });
            const bars = api.resolveBarHeights(dev, { profile: 'huawei-teardrop-1080x2400' });
            const layout = api.computeFrameLayout(dev, bars, 3.5);
            const canvas = api.composeFrame(layout, null, {
                chrome: { appBar: { title: '', rightLabel: '' }, statusBar: { showNetwork: false } }
            });
            const band = layout.appBar;
            const regionWidth = Math.round(layout.scale * 45);
            const data = canvas.getContext('2d').getImageData(0, band.y, regionWidth, band.height).data;

            const columnSpan = (fromX: number, toX: number) => {
                let minY = 1e9;
                let maxY = -1;
                for (let y = 0; y < band.height; y++) {
                    for (let x = fromX; x < toX; x++) {
                        const i = (y * regionWidth + x) * 4;
                        if (data[i] > 200) continue;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
                return maxY < 0 ? 0 : maxY - minY;
            };

            // 找出箭头的横向范围（墨迹=暗像素；白底要被跳过）
            let minX = 1e9;
            let maxX = -1;
            for (let x = 0; x < regionWidth; x++) {
                for (let y = 0; y < band.height; y++) {
                    if (data[(y * regionWidth + x) * 4] > 200) continue;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    break;
                }
            }
            const quarter = Math.round((maxX - minX) / 4);
            return {
                leftSpan: columnSpan(minX, minX + quarter),
                rightSpan: columnSpan(minX + 3 * quarter, maxX + 1)
            };
        }, { device: DEVICE_B });

        // 朝左的 V 形：左端是尖点（纵向跨度小），右端张开（跨度大）。
        expect(shape.rightSpan).toBeGreaterThan(shape.leftSpan * 1.8);
    });

    test('状态栏文字与图标共享同一条中线', async () => {
        const offsets = await page.evaluate(({ device }) => {
            const api = (window as any).FakeScreen;
            const dev = api.detectDevice({ ...device });
            const bars = api.resolveBarHeights(dev, { profile: 'huawei-teardrop-1080x2400' });
            const layout = api.computeFrameLayout(dev, bars, 3.5);
            const canvas = api.composeFrame(layout, null, {
                chrome: { statusBar: { time: '19:29', batteryPercent: 29 } }
            });
            const band = layout.statusBar;
            const width = layout.screen.width;
            const data = canvas.getContext('2d').getImageData(0, band.y, width, band.height).data;
            const middle = band.height / 2;

            const offsets: number[] = [];
            const segments = 8;
            for (let i = 0; i < segments; i++) {
                const fromX = Math.round((width / segments) * i);
                const toX = Math.round((width / segments) * (i + 1));
                let minY = 1e9;
                let maxY = -1;
                let count = 0;
                for (let y = 0; y < band.height; y++) {
                    for (let x = fromX; x < toX; x++) {
                        const i2 = (y * width + x) * 4;
                        const l = 0.299 * data[i2] + 0.587 * data[i2 + 1] + 0.114 * data[i2 + 2];
                        if (l > 200) continue;
                        count++;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
                if (count < 40) continue;
                offsets.push((minY + maxY) / 2 - middle);
            }
            return offsets;
        }, { device: DEVICE_B });

        expect(offsets.length).toBeGreaterThanOrEqual(4);
        // 每个元素的墨迹中心都应贴着状态栏中线（早期文字偏上 5~7 px）。
        for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(4);
    });

    test('导航栏返回键是镂空三角，中心没有大片实心', async () => {
        const back = await page.evaluate(({ device }) => {
            const api = (window as any).FakeScreen;
            const dev = api.detectDevice({ ...device });
            const bars = api.resolveBarHeights(dev, { profile: 'huawei-teardrop-1080x2400' });
            const layout = api.computeFrameLayout(dev, bars, 3.5);
            const canvas = api.composeFrame(layout, null, {
                chrome: { navBar: { mode: 'buttons' }, appBar: { title: '', rightLabel: '' } }
            });
            const band = layout.navBar;
            const width = layout.screen.width;
            const data = canvas.getContext('2d').getImageData(0, band.y, width, band.height).data;
            const count = (fromX: number, toX: number, fromY: number, toY: number) => {
                let ink = 0;
                for (let y = fromY; y < toY; y++) {
                    for (let x = fromX; x < toX; x++) {
                        const i = (y * width + x) * 4;
                        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 210) ink++;
                    }
                }
                return ink;
            };

            // 按列投影定位**第一个**图标（返回键），位置随 gapRatio 变化，不能写死。
            const inkedColumns: number[] = [];
            for (let x = 0; x < width; x++) {
                let hit = 0;
                for (let y = 0; y < band.height; y++) {
                    const i = (y * width + x) * 4;
                    if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 210) hit++;
                }
                if (hit > 0) inkedColumns.push(x);
            }
            let left = inkedColumns[0];
            let right = left;
            for (const x of inkedColumns) {
                if (x > right) right = x;
                if (x - right > 3) break;
            }

            const glyphWidth = right - left + 1;
            const middle = Math.round(band.height / 2);
            const inner = Math.round(layout.scale * 3);
            return {
                glyphWidth,
                border: count(left, right + 1, middle - inner, middle + inner),
                interior: count(
                    Math.round(left + glyphWidth * 0.34),
                    Math.round(left + glyphWidth * 0.6),
                    middle - inner,
                    middle + inner
                )
            };
        }, { device: DEVICE_B });

        // 镂空：内部墨迹远少于边框带。
        expect(back.glyphWidth).toBeGreaterThan(10);
        expect(back.border).toBeGreaterThan(20);
        expect(back.interior).toBeLessThan(back.border * 0.5);
    });

    test('移动数据指示：5G 下方并排两个箭头，左上行右下行', async () => {
        const shape = await page.evaluate(() => {
            const api = (window as any).FakeScreen;
            const size = 140;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            api.drawMobileData(ctx, 20, 70, 40, '#666666', { textSize: 34 });

            const data = ctx.getImageData(0, 0, size, size).data;
            const isInk = (x: number, y: number) => data[(y * size + x) * 4] < 200;

            // 逐行切成纵向条带
            const bands: number[][] = [];
            let start = -1;
            for (let y = 0; y <= size; y++) {
                let hit = 0;
                for (let x = 0; x < size && y < size; x++) if (isInk(x, y)) hit++;
                if (hit > 0 && start === -1) start = y;
                if ((hit === 0 || y === size) && start !== -1) {
                    bands.push([start, y - 1]);
                    start = -1;
                }
            }

            // 箭头那一行：逐列切成横向条带
            const [arrowTop, arrowBottom] = bands[bands.length - 1];
            const runs: number[][] = [];
            let runStart = -1;
            for (let x = 0; x <= size; x++) {
                let hit = 0;
                for (let y = arrowTop; y <= arrowBottom && x < size; y++) if (isInk(x, y)) hit++;
                if (hit > 0 && runStart === -1) runStart = x;
                if ((hit === 0 || x === size) && runStart !== -1) {
                    runs.push([runStart, x - 1]);
                    runStart = -1;
                }
            }

            /** 某个 x 区间里，上半与下半的墨迹量（上行箭头下半更宽、下行箭头上半更宽）。 */
            const halves = (from: number, to: number) => {
                const middle = Math.floor((arrowTop + arrowBottom) / 2);
                let top = 0;
                let bottom = 0;
                for (let y = arrowTop; y <= arrowBottom; y++) {
                    for (let x = from; x <= to; x++) {
                        if (!isInk(x, y)) continue;
                        if (y <= middle) top++;
                        else bottom++;
                    }
                }
                return { top, bottom };
            };

            return {
                bands: bands.length,
                runs,
                // 文字带与箭头带之间的空白高度
                textToArrowGap: bands.length >= 2 ? bands[1][0] - bands[0][1] - 1 : 0,
                arrowBandHeight: bands.length >= 2 ? bands[1][1] - bands[1][0] + 1 : 0,
                left: runs[0] && halves(runs[0][0], runs[0][1]),
                right: runs[1] && halves(runs[1][0], runs[1][1])
            };
        });

        // 两段：5G 文字 + 一行箭头。
        expect(shape.bands).toBe(2);
        // 箭头行里左右并排两个三角。
        expect(shape.runs).toHaveLength(2);
        // 文字与箭头之间要有明显留白（> 0.12 参考高度），且箭头行本身够高（0.25 参考高度以上）。
        expect(shape.textToArrowGap).toBeGreaterThan(4);
        expect(shape.arrowBandHeight).toBeGreaterThan(10);
        // 左：上行（底边在下）；右：下行（底边在上）。
        expect(shape.left!.bottom).toBeGreaterThan(shape.left!.top);
        expect(shape.right!.top).toBeGreaterThan(shape.right!.bottom);
    });

    test('电量读取：有 Battery API 时给出 0-100 的整数', async () => {
        const value = await page.evaluate(async () => {
            const api = (window as any).FakeScreen;
            api.resetBatteryCache?.();
            return api.readBatteryPercent({ defaultPercent: 76 });
        });

        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
    });

    test('悬浮窗左上角是画面本身（无描边、无圆角）', async () => {
        const corner = await page.evaluate(({ device }) => {
            const api = (window as any).FakeScreen;
            const dev = api.detectDevice({ ...device });
            const bars = api.resolveBarHeights(dev, { profile: 'huawei-teardrop-1080x2400' });
            const layout = api.computeFrameLayout(dev, bars, 3.5);
            const canvas = api.composeFrame(layout, null, { face: { enabled: true } });
            const box = api.computeFaceWindowBox(layout, {});
            const pixel = canvas.getContext('2d').getImageData(box.x, box.y, 1, 1).data;
            return { radius: box.radius, pixel: [pixel[0], pixel[1], pixel[2]] };
        }, { device: DEVICE_B });

        expect(corner.radius).toBe(0);
        expect(corner.pixel[0]).toBeLessThan(120);
    });
});

describe('drawFaceWindow', () => {
    test('paints the supplied camera frame inside the window box', async () => {
        const result = await page.evaluate(() => {
            const api = (window as any).FakeScreen;
            const face = document.getElementById('face') as HTMLCanvasElement;
            const probe = document.createElement('canvas');
            probe.width = 1;
            probe.height = 1;
            const probeCtx = probe.getContext('2d')!;
            probeCtx.drawImage(face, 0, 0, 1, 1);
            const sourceColour = [...probeCtx.getImageData(0, 0, 1, 1).data];

            const layout = {
                scale: 1,
                screen: { width: 400, height: 400 },
                content: { x: 0, y: 0, width: 400, height: 400 },
                statusBar: { x: 0, y: 0, width: 400, height: 0 },
                appBar: { x: 0, y: 0, width: 400, height: 0 },
                navBar: { x: 0, y: 0, width: 400, height: 0 },
                css: {
                    screenWidth: 400,
                    screenHeight: 400,
                    viewportWidth: 400,
                    viewportHeight: 400,
                    bars: { statusBar: 0, appBar: 0, navBar: 0 }
                },
                device: { os: 'android', formFactor: 'android', dpr: 1 }
            };
            const options = { corner: 'bottom-right' as const, margin: 0, width: 100, height: 100 };
            const out = api.composeFrame(layout, null, { face: { ...options, source: face } });
            const box = api.computeFaceWindowBox(layout, options);
            const pixel = [...out.getContext('2d')!.getImageData(350, 350, 1, 1).data];
            return { sourceColour, box, pixel, faceSize: [face.width, face.height] };
        });

        expect(result.faceSize).toEqual([120, 160]);
        expect(result.sourceColour.slice(0, 3)).toEqual([255, 0, 170]);
        expect(result.box).toMatchObject({ x: 300, y: 300, width: 100, height: 100 });
        expect(result.pixel.slice(0, 3)).toEqual([255, 0, 170]);
    });
});

describe('withInlinedResources', () => {
    test('rewrites CSS backgrounds and @font-face sources, then restores them', async () => {
        const observed = await page.evaluate(async () => {
            const api = (window as any).FakeScreen;
            const rewriteUrl = (url: string) => {
                const parsed = new URL(url);
                return parsed.origin === location.origin
                    ? url
                    : '/proxy?url=' + encodeURIComponent(url);
            };

            const readValues = () => {
                const sheet = Array.from(document.styleSheets).find((entry) =>
                    entry.href?.endsWith('/fixture.css')
                )!;
                const rules = Array.from(sheet.cssRules) as CSSStyleRule[];
                const fontRule = rules.find((rule) => rule instanceof CSSFontFaceRule) as CSSFontFaceRule;
                const backgroundRule = rules.find((rule) => rule.selectorText === '.cross-bg')!;
                return {
                    font: fontRule.style.getPropertyValue('src'),
                    background: backgroundRule.style.getPropertyValue('background-image')
                };
            };

            const before = readValues();
            const inside = await api.withInlinedResources(
                document.documentElement,
                { rewriteUrl },
                () => readValues()
            );
            return { before, inside, after: readValues() };
        });

        expect(observed.before.font).not.toContain('data:');
        expect(observed.inside.font).toContain('data:font/woff2;base64,');
        expect(observed.inside.background).toContain('data:image/png;base64,');
        expect(observed.after.font).toBe(observed.before.font);
        expect(observed.after.background).toBe(observed.before.background);
    }, 30_000);

    test('exposes the API surface the bridge package relies on', async () => {
        const surface = await page.evaluate(() =>
            Object.keys((window as any).FakeScreen).sort()
        );
        expect(surface).toContain('composeMonitorFrame');
        expect(surface).toContain('frameToJpegBlob');
        expect(surface).toContain('withInlinedResources');
    });
});
