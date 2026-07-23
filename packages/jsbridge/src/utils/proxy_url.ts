import type { CiferaConfig } from "@study-wolf-cifera/shared-types";

/** 允许代理改写的协议白名单 */
const ALLOWED_SCHEMES = new Set([
    'http', 'https', 'ftp', 'ftps', 'ws', 'wss',
]);

/**
 * 读取 Cifera 注入的全局配置
 * 本项目作为 Cifera 的 addon，__CIFERA__ 由 Cifera 在 HTML 注入时自动设置
 */
function getConfig(): CiferaConfig | undefined {
    return window.__CIFERA__;
}

/**
 * 判断 URL 是否应跳过改写
 * 白名单模式：仅改写已知协议的绝对 URL，未知协议（如 jsBridge://、weixin://）不拦截
 */
function shouldSkip(url: string): boolean {
    if (!url || url.trim() === '') return true;
    if (url[0] === '#') return true;
    // 已包含 _cifera_ 前缀参数，跳过
    if (url.includes('_cifera_')) return true;
    // 检查是否包含协议前缀（形如 "xxx:"）
    const colonIdx = url.indexOf(':');
    if (colonIdx > 0) {
        const scheme = url.substring(0, colonIdx).toLowerCase();
        // 只有白名单中的协议才改写，未知协议跳过
        if (!ALLOWED_SCHEMES.has(scheme)) return true;
    }
    return false;
}

/**
 * 代理 host 归一化
 * 检测 URL host 是否存在以下问题并修复：
 *  1. host 为代理 host 或其子域拼接（如业务代码 'api.' + window.location.host）
 *     → 将代理 host 部分替换为源站 host，保留子域前缀
 *  2. host 为源站 host 或其子域，但被错误拼接了代理端口（如 'cn.bing.com:' + window.location.port）
 *     → 剥离错误的代理端口
 *
 * 示例（代理 host=127.0.0.1:8080, 源站 host=example.com）：
 *   127.0.0.1:8080         → example.com            （代理 host 本身）
 *   127.0.0.1              → example.com            （代理 hostname）
 *   api.127.0.0.1:8080     → api.example.com        （代理 host 子域）
 *   api.127.0.0.1          → api.example.com        （代理 hostname 子域）
 *   example.com:8080       → example.com            （源站 host + 代理端口）
 *   sub.example.com:8080   → sub.example.com        （源站子域 + 代理端口）
 *   other.com:8080         → other.com              （其他 host + 代理端口，剥离）
 *   other.com              → other.com              （不匹配，原样返回）
 */
function normalizeProxyHost(host: string, proxyHost: string): string {
    if (!host || !proxyHost) return host;

    const currentProxyHost = window.location.host;       // 如 "127.0.0.1:8080"
    const currentProxyHostname = window.location.hostname; // 如 "127.0.0.1"
    const currentProxyPort = window.location.port;        // 如 "8080"

    // 提取源站 hostname（proxyHost 可能含端口，如 "example.com:443"）
    let originHostname = proxyHost;
    try {
        originHostname = new URL('http://' + proxyHost).hostname;
    } catch {
        // 解析失败，保持原值
    }

    // 步骤 1：检测并剥离错误拼接的 proxy port
    // 页面 JS 可能将 window.location.port 拼接到任意 host 上（包括当前源站、其他源站、代理 host）
    if (currentProxyPort && host.endsWith(':' + currentProxyPort)) {
        const hostname = host.slice(0, host.length - currentProxyPort.length - 1);
        // hostname 是源站 hostname 本身 → 返回 proxyHost（保留源站端口）
        if (hostname === originHostname) {
            return proxyHost;
        }
        // hostname 是源站 hostname 的子域 → 返回 hostname（去掉错误端口）
        if (originHostname && hostname.endsWith('.' + originHostname)) {
            return hostname;
        }
        // hostname 是代理 host 相关 → 去掉端口，继续后续代理 host 检测
        if (hostname === currentProxyHost || hostname === currentProxyHostname ||
            hostname.endsWith('.' + currentProxyHost) || hostname.endsWith('.' + currentProxyHostname)) {
            host = hostname;
        } else {
            // 其他任意 hostname 携带代理端口：
            // 极大概率是页面 JS 将 window.location.port 拼接到外部 host 上
            // （如 kb.chaoxing.com + ':' + window.location.port → kb.chaoxing.com:8080）
            // 剥离端口，与后端 stripProxyPort 逻辑一致
            host = hostname;
        }
    }

    // 步骤 2：代理 host 检测（原有逻辑）
    // 完全匹配代理 host（含端口）或代理 hostname（不含端口）
    if (host === currentProxyHost || host === currentProxyHostname) {
        return proxyHost;
    }
    // 子域拼接：以 ".<currentProxyHost>" 结尾（如 "api.127.0.0.1:8080"）
    const dotProxyHost = '.' + currentProxyHost;
    if (host.endsWith(dotProxyHost)) {
        const prefix = host.slice(0, host.length - dotProxyHost.length);
        return prefix + '.' + proxyHost;
    }
    // 子域拼接：以 ".<currentProxyHostname>" 结尾（如 "api.127.0.0.1"）
    const dotProxyHostname = '.' + currentProxyHostname;
    if (host.endsWith(dotProxyHostname)) {
        const prefix = host.slice(0, host.length - dotProxyHostname.length);
        return prefix + '.' + proxyHost;
    }

    return host;
}

/**
 * 将 URL 改写为代理 URL
 * 与 Cifera 运行时（scripts/src/rewriter.ts）的 rewriteUrl 逻辑一致
 * 读取 __CIFERA__ 全局配置来确定代理参数
 *
 * 代理 URL 格式：http://<proxy_host>/<source_path>?_cifera_h=<source_host>&_cifera_s=<source_schema>&<source_query>
 *
 * @param url 原始 URL
 * @param baseUrl 可选的基础 URL，用于解析相对路径
 * @returns 改写后的代理 URL，或原始 URL（如果不需改写）
 */
export function rewriteUrl(url: string, baseUrl?: string): string {
    if (shouldSkip(url)) return url;

    const config = getConfig();
    if (!config) return url;

    const PROXY_HOST = config.h;
    const PROXY_SCHEMA = config.s || 'http';

    if (!PROXY_HOST) return url;

    try {
        let parsed: URL;
        try {
            parsed = new URL(url, baseUrl || window.location.href);
        } catch {
            return url;
        }

        // 修复代理 host 子域拼接
        // 业务代码可能执行 'api.' + window.location.host 得到 'api.127.0.0.1:8080'
        // 此处将其归一化为 'api.<源站host>'，避免错误代理
        const adjustedHost = normalizeProxyHost(parsed.host, PROXY_HOST);
        if (adjustedHost !== parsed.host) {
            parsed.host = adjustedHost;
        }

        // 判断是否为同源请求（目标 host 与当前页面 host 相同）
        const isSameOrigin = parsed.host === window.location.host &&
            parsed.protocol === window.location.protocol;

        if (isSameOrigin) {
            // 同源请求：只需追加代理参数
            parsed.searchParams.set('_cifera_h', PROXY_HOST);
            if (PROXY_SCHEMA && PROXY_SCHEMA !== 'http') {
                parsed.searchParams.set('_cifera_s', PROXY_SCHEMA);
            }
            return parsed.toString();
        }

        // 跨域请求：提取目标 host/scheme，重写为代理 URL
        const targetHost = parsed.host;
        const targetSchema = parsed.protocol.replace(':', '');

        // 构建代理 URL：使用当前页面 origin + 原始路径
        const proxyUrl = new URL(parsed.pathname + parsed.search, window.location.origin);
        proxyUrl.searchParams.set('_cifera_h', targetHost);
        if (targetSchema && targetSchema !== 'http') {
            proxyUrl.searchParams.set('_cifera_s', targetSchema);
        }
        proxyUrl.hash = parsed.hash;

        return proxyUrl.toString();
    } catch {
        return url;
    }
}
