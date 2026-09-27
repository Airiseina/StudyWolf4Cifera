/**
 * 页面截取时的跨域资源内联。
 *
 * SnapDOM 会自己抓取图片、CSS 背景与字体，但直接 `fetch` 跨域地址只有在响应带 CORS 头时才
 * 成功。在 Cifera 下绕过这一点靠代理：{@link InlinerOptions.rewriteUrl} 把第三方地址改写成
 * 同源的代理地址，其响应可读，也就能内联成 data URL。没有改写器时只有带 CORS 的资源能活下来，
 * 其余都会变成占位。
 */

/** 一个可替换的资源位点：涉及哪些地址、如何写入以及如何还原。 */
interface ResourceTask {
    /** 该位点必须内联的绝对地址。 */
    urls: string[];
    /** 写入解析好的 data URL（以绝对地址为键）。 */
    apply: (resolved: Map<string, string>) => void;
    /** 还原原始标记或 CSS。 */
    restore: () => void;
}

/** 一次内联的结果。 */
export interface InlineResult {
    /** 被改写成 data URL 的资源位点数量。 */
    inlined: number;
    /** 读取失败的原因，按地址列出。 */
    failed: { url: string; reason: string }[];
}

/** {@link withInlinedResources} 的参数。 */
export interface InlinerOptions {
    /** 把资源地址改写成可读（代理）地址，例如 Cifera 的 `rewriteUrl`。 */
    rewriteUrl?: (url: string) => string;
    /** fetch 实现，默认用全局 `fetch`。 */
    fetchImpl?: typeof fetch;
    /** 单个资源的超时，毫秒，默认 8000。 */
    timeoutMs?: number;
    /** 超过该字节数的资源不内联，默认 8 MiB。 */
    maxBytes?: number;
}

const URL_PATTERN = /url\((['"]?)([^'")]+)\1\)/g;
const resourceCache = new Map<string, Promise<string>>();
const MAX_CACHE_ENTRIES = 64;

/** 清空跨调用共享的资源缓存，供测试使用。 */
export function clearResourceCache(): void {
    resourceCache.clear();
}

/** 读出 CSS 值里所有的 `url(...)`。 */
function extractUrls(value: string): string[] {
    const urls: string[] = [];
    URL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_PATTERN.exec(value)) !== null) {
        if (match[2]) urls.push(match[2]);
    }
    return urls;
}

/** 判断是否是不该或无法抓取的地址（内嵌数据、blob、锚点）。 */
function isEmbedded(url: string): boolean {
    return /^(data:|blob:|about:|javascript:|#)/i.test(url);
}

/** 把驼峰样式名转换成 CSS 里的写法。 */
function toCssProperty(property: string): string {
    return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * 把 `root` 内所有跨域图片、CSS 背景与网页字体改写为 data URL，执行 `run`，然后还原原始标记。
 *
 * 修改的是真实 DOM 而不是副本，这样 SnapDOM 量到的就是浏览器实际布局的结果。`run` 要尽量短：
 * 它执行期间页面处于被改动状态。
 */
export async function withInlinedResources<T>(
    root: HTMLElement,
    options: InlinerOptions,
    run: (result: InlineResult) => Promise<T> | T
): Promise<T> {
    const tasks = collect(root, options);
    const failed: { url: string; reason: string }[] = [];
    let inlined = 0;

    for (const task of tasks) {
        const resolved = new Map<string, string>();
        let complete = true;
        for (const url of task.urls) {
            try {
                resolved.set(url, await load(url, options));
            } catch (error) {
                complete = false;
                failed.push({ url, reason: error instanceof Error ? error.message : String(error) });
            }
        }
        // 有地址没取到就整处保持原样：只改写一半的 `srcset` 会出问题。
        if (!complete) continue;
        task.apply(resolved);
        inlined++;
    }

    try {
        return await run({ inlined, failed });
    } finally {
        for (const task of tasks) task.restore();
    }
}

/** 每个资源只抓一次，data URL 会被缓存。 */
function load(rawUrl: string, options: InlinerOptions): Promise<string> {
    const cached = resourceCache.get(rawUrl);
    if (cached) return cached;
    const pending = toDataUrl(rawUrl, options);
    if (resourceCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = resourceCache.keys().next();
        if (!oldest.done) resourceCache.delete(oldest.value);
    }
    resourceCache.set(rawUrl, pending);
    pending.catch(() => resourceCache.delete(rawUrl));
    return pending;
}

/** 收集 `root` 内所有跨域资源位点。 */
function collect(root: HTMLElement, options: InlinerOptions): ResourceTask[] {
    const tasks: ResourceTask[] = [];
    const doc = root.ownerDocument ?? document;
    const pageUrl = doc.baseURI || location.href;
    const rewrite = options.rewriteUrl ?? ((url: string) => url);

    /** 需要内联时返回绝对地址，否则返回 `null`。 */
    const needsProxy = (raw: string): string | null => {
        if (!raw || isEmbedded(raw)) return null;
        let absolute: string;
        let crossOrigin: boolean;
        try {
            const parsed = new URL(raw, pageUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
            absolute = parsed.href;
            crossOrigin = parsed.origin !== location.origin;
        } catch {
            return null;
        }
        const rewritten = rewrite(absolute);
        return crossOrigin || rewritten !== absolute ? absolute : null;
    };

    for (const img of Array.from(root.querySelectorAll('img'))) {
        const src = img.getAttribute('src') ?? '';
        const srcUrl = needsProxy(src);
        if (srcUrl) {
            tasks.push({
                urls: [srcUrl],
                apply: (resolved) => img.setAttribute('src', resolved.get(srcUrl)!),
                restore: () => img.setAttribute('src', src)
            });
        }

        const srcset = img.getAttribute('srcset');
        if (srcset) {
            const candidates = srcset
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
            const urls: string[] = [];
            for (const candidate of candidates) {
                const url = needsProxy(candidate.split(/\s+/)[0] ?? '');
                if (url && !urls.includes(url)) urls.push(url);
            }
            if (urls.length) {
                tasks.push({
                    urls,
                    apply: (resolved) =>
                        img.setAttribute(
                            'srcset',
                            candidates
                                .map((candidate) => {
                                    const [url, descriptor = ''] = candidate.split(/\s+/);
                                    const absolute = needsProxy(url ?? '');
                                    const dataUrl = absolute ? resolved.get(absolute) : undefined;
                                    return dataUrl ? `${dataUrl} ${descriptor}`.trim() : candidate;
                                })
                                .join(', ')
                        ),
                    restore: () => img.setAttribute('srcset', srcset)
                });
            }
        }
    }

    for (const video of Array.from(root.querySelectorAll('video[poster]'))) {
        const poster = video.getAttribute('poster') ?? '';
        const url = needsProxy(poster);
        if (url) {
            tasks.push({
                urls: [url],
                apply: (resolved) => video.setAttribute('poster', resolved.get(url)!),
                restore: () => video.setAttribute('poster', poster)
            });
        }
    }

    for (const sheet of Array.from(doc.styleSheets)) {
        let rules: CSSRuleList | null = null;
        try {
            rules = sheet.cssRules;
        } catch {
            // 跨域样式表在没有 CORS 时读不到规则；SnapDOM 自己的字体处理会通过
            // `fontStylesheetDomains` 覆盖这部分。
            continue;
        }
        if (!rules) continue;

        for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
                for (const property of ['backgroundImage', 'maskImage', 'borderImageSource'] as const) {
                    const cssName = toCssProperty(property);
                    const value = rule.style.getPropertyValue(cssName);
                    if (!value.includes('url(')) continue;
                    const urls: string[] = [];
                    for (const raw of extractUrls(value)) {
                        const url = needsProxy(raw);
                        if (url && !urls.includes(url)) urls.push(url);
                    }
                    if (!urls.length) continue;
                    tasks.push({
                        urls,
                        apply: (resolved) => {
                            let next = value;
                            for (const [url, dataUrl] of resolved) next = next.split(url).join(dataUrl);
                            rule.style.setProperty(cssName, next, rule.style.getPropertyPriority(cssName));
                        },
                        restore: () =>
                            rule.style.setProperty(cssName, value, rule.style.getPropertyPriority(cssName))
                    });
                }
            } else if (rule instanceof CSSFontFaceRule) {
                const src = rule.style.getPropertyValue('src');
                if (!src.includes('url(')) continue;
                const urls: string[] = [];
                for (const raw of extractUrls(src)) {
                    const url = needsProxy(raw);
                    if (url && !urls.includes(url)) urls.push(url);
                }
                if (!urls.length) continue;
                tasks.push({
                    urls,
                    apply: (resolved) => {
                        let next = src;
                        for (const [url, dataUrl] of resolved) next = next.split(url).join(dataUrl);
                        rule.style.setProperty('src', next);
                    },
                    restore: () => rule.style.setProperty('src', src)
                });
            }
        }
    }

    return tasks;
}

/** 抓取资源（配置了改写器就走改写器）并返回 data URL。 */
async function toDataUrl(rawUrl: string, options: InlinerOptions): Promise<string> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 8000;
    const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    const url = options.rewriteUrl ? options.rewriteUrl(rawUrl) : rawUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { credentials: 'include', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (blob.size > maxBytes) throw new Error(`resource too large (${blob.size} bytes)`);
        return await blobToDataUrl(blob);
    } finally {
        clearTimeout(timer);
    }
}

/** 把 blob 读成 data URL。 */
function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolvePromise, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolvePromise(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}
