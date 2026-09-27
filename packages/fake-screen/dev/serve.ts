/**
 * 本地预览用的开发服务器。
 *
 * 起两个源（主源 + 素材源）模拟跨域资源，把 fake-screen 打成 ESM 供页面加载，并用本机 Edge 打开预览页。
 * 预览页里可以调设备档位、工具栏、人脸窗参数，实时看合成结果，还能叠上真机截图对齐。
 *
 * 用法：`bun run preview`（在 packages/fake-screen 下）。
 */
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { chromium } from 'playwright-core';

const EDGE_PATHS = [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome'
].filter((entry): entry is string => !!entry);

const devDir = import.meta.dir;

/** 打一次库的 ESM 产物，供预览页 import。 */
async function buildLibrary(): Promise<string> {
    const result = await Bun.build({
        entrypoints: [join(devDir, '..', 'src', 'index.ts')],
        target: 'browser',
        format: 'esm',
        minify: false
    });
    if (!result.success) {
        throw new Error('构建失败：' + result.logs.map(String).join('\n'));
    }
    return result.outputs[0].text();
}

const library = await buildLibrary();

/** 素材源：故意不发 CORS 头，只有走代理才读得到，用来验证内联器。 */
const assetServer = Bun.serve({
    port: 0,
    fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname === '/photo.png') {
            return new Response(photoPng(240, 160), { headers: { 'content-type': 'image/png' } });
        }
        return new Response('not found', { status: 404 });
    }
});

const assetOrigin = () => `http://127.0.0.1:${assetServer.port}`;

const mainServer = Bun.serve({
    port: 0,
    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === '/lib.js') {
            return new Response(library, { headers: { 'content-type': 'application/javascript' } });
        }
        if (url.pathname === '/proxy') {
            const target = url.searchParams.get('url') ?? '';
            if (!target.startsWith(assetOrigin())) {
                return new Response('proxy 只服务素材源', { status: 400 });
            }
            const upstream = await fetch(target);
            return new Response(upstream.body, {
                status: upstream.status,
                headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' }
            });
        }
        if (url.pathname === '/fixture.css') {
            return new Response(
                `@font-face { font-family: 'PreviewFont'; src: url('${assetOrigin()}/missing.woff2') format('woff2'); }
                 .cross-bg { background-color: #eef3ff; background-image: url('${assetOrigin()}/photo.png'); background-size: cover; }`,
                { headers: { 'content-type': 'text/css' } }
            );
        }
        if (url.pathname === '/mock-iframe.html') {
            return new Response(
                `<!doctype html><html><body style="margin:0;font:14px sans-serif;background:#ffffff">
                   <div style="height:80px;background:#dff0ff;padding:8px">同源 iframe：这段内容来自另一个文档</div>
                 </body></html>`,
                { headers: { 'content-type': 'text/html' } }
            );
        }

        // mock 页里的跨域图片要指向素材源的真实端口，因此动态渲染。
        if (url.pathname === '/mock.html') {
            const html = await Bun.file(join(devDir, 'mock.html')).text();
            return new Response(html.replaceAll('__ASSET_ORIGIN__', assetOrigin()), {
                headers: { 'content-type': 'text/html' }
            });
        }

        const file = url.pathname === '/' ? '/preview.html' : url.pathname;
        const bunFile = Bun.file(join(devDir, file));
        if (await bunFile.exists()) {
            const type = file.endsWith('.css') ? 'text/css'
                : file.endsWith('.js') || file.endsWith('.mjs') ? 'application/javascript'
                : 'text/html';
            return new Response(bunFile, { headers: { 'content-type': type } });
        }
        return new Response('not found: ' + file, { status: 404 });
    }
});

const previewUrl = `http://127.0.0.1:${mainServer.port}/preview.html`;

/** 单色 PNG，避免预览依赖磁盘素材。 */
function photoPng(width: number, height: number): Uint8Array {
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
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const raw = new Uint8Array(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 3);
        for (let x = 0; x < width; x++) {
            const pixel = rowStart + 1 + x * 3;
            raw[pixel] = 0x22;
            raw[pixel + 1] = 0x66 + (x % 32);
            raw[pixel + 2] = 0xaa - (y % 32);
        }
    }
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        // PNG 的 IDAT 必须是 zlib 流：Bun.deflateSync 出的是裸 deflate，浏览器会拒绝解码。
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', new Uint8Array(0))
    ];
    const merged = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
    }
    return merged;
}

const executablePath = EDGE_PATHS.find((candidate) => Bun.file(candidate).size > 0);
console.log(`预览地址：${previewUrl}`);
console.log(`素材源：${assetOrigin()}`);

if (executablePath) {
    const browser = await chromium.launch({ executablePath, headless: false });
    await browser.newPage({ viewport: { width: 1500, height: 1000 } }).then((page) => page.goto(previewUrl));
    console.log('已用本机 Edge 打开，关掉浏览器即退出。');
} else {
    console.log('未找到 Edge/Chrome，请手动打开上面的地址。');
}
