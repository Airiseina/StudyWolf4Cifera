import type { CiferaConfig } from '@study-wolf-cifera/shared-types';

/** 允许被改写成代理 URL 的协议。 */
const ALLOWED_SCHEMES = new Set([
    'http', 'https', 'ftp', 'ftps', 'ws', 'wss',
]);

/** 读取 Cifera 代理注入到每个改写文档里的配置；没有 window 时（例如服务端或单测环境）返回空。 */
function getConfig(): CiferaConfig | undefined {
    return typeof window === 'undefined' ? undefined : window.__CIFERA__;
}

/**
 * 判断 URL 是否应当原样放过。
 *
 * 只改写带已知协议的绝对地址；页内锚点、已经改写过的地址，以及 `weixin://` 这类应用协议
 * 都不动。
 */
function shouldSkip(url: string): boolean {
    if (!url || url.trim() === '') return true;
    if (url[0] === '#') return true;
    // 已经带了代理参数。
    if (url.includes('_cifera_')) return true;
    const colonIdx = url.indexOf(':');
    if (colonIdx > 0) {
        const scheme = url.substring(0, colonIdx).toLowerCase();
        if (!ALLOWED_SCHEMES.has(scheme)) return true;
    }
    return false;
}

/**
 * 修复页面代码拼接 `window.location` 造成的畸形主机名。
 *
 * 在代理下 `window.location` 是*代理*主机，因此 `'api.' + window.location.host` 或
 * `host + ':' + window.location.port` 这类写法会拼出看着合理、实际指向代理的地址。修复两类
 * 情况：
 *
 *  1. 代理主机或其子域映射回源站主机，保留子域前缀。
 *  2. 任意主机尾部多出来的代理端口一律剥掉。
 *
 * 以 `proxyHost = example.com`、访问地址 `127.0.0.1:8080` 为例：
 *
 * | Input                  | Output              | Reason                        |
 * |------------------------|---------------------|-------------------------------|
 * | `127.0.0.1:8080`       | `example.com`       | the proxy host itself         |
 * | `127.0.0.1`            | `example.com`       | proxy hostname without port   |
 * | `api.127.0.0.1:8080`   | `api.example.com`   | subdomain of the proxy host   |
 * | `api.127.0.0.1`        | `api.example.com`   | subdomain, portless           |
 * | `example.com:8080`     | `example.com`       | origin host, proxy port       |
 * | `sub.example.com:8080` | `sub.example.com`   | origin subdomain, proxy port  |
 * | `other.com:8080`       | `other.com`         | unrelated host, proxy port    |
 * | `other.com`            | `other.com`         | nothing to repair             |
 */
function normalizeProxyHost(host: string, proxyHost: string): string {
    if (!host || !proxyHost) return host;

    const currentProxyHost = window.location.host;         // e.g. "127.0.0.1:8080"
    const currentProxyHostname = window.location.hostname; // e.g. "127.0.0.1"
    const currentProxyPort = window.location.port;         // e.g. "8080"

    // 配置里的主机可能带端口（"example.com:443"）；子域判断只用主机名。
    let originHostname = proxyHost;
    try {
        originHostname = new URL('http://' + proxyHost).hostname;
    } catch {
        // 解析失败就按原值用。
    }

    // 第 1 步：剥掉拼到任意主机上的代理端口。
    if (currentProxyPort && host.endsWith(':' + currentProxyPort)) {
        const hostname = host.slice(0, host.length - currentProxyPort.length - 1);
        // 就是源站主机名：还原成配置里的主机（含端口）。
        if (hostname === originHostname) {
            return proxyHost;
        }
        // 源站主机名的子域：保留子域，去掉端口。
        if (originHostname && hostname.endsWith('.' + originHostname)) {
            return hostname;
        }
        // 与代理相关、或无关主机误带代理端口：统一去掉端口。
        host = hostname;
    }

    // 第 2 步：把代理主机映射回源站主机，保留子域前缀。
    if (host === currentProxyHost || host === currentProxyHostname) {
        return proxyHost;
    }
    const dotProxyHost = '.' + currentProxyHost;
    if (host.endsWith(dotProxyHost)) {
        const prefix = host.slice(0, host.length - dotProxyHost.length);
        return prefix + '.' + proxyHost;
    }
    const dotProxyHostname = '.' + currentProxyHostname;
    if (host.endsWith(dotProxyHostname)) {
        const prefix = host.slice(0, host.length - dotProxyHostname.length);
        return prefix + '.' + proxyHost;
    }

    return host;
}

/**
 * 把 URL 改写成代理地址。
 *
 * 与 Cifera 对文档和资源的改写保持一致，使运行期拼出来的地址（上传、跳转、XHR 目标）在代理
 * 下依然可用：
 *
 * ```text
 * http://<proxy_host>/<source_path>?_cifera_h=<source_host>&_cifera_s=<source_scheme>&<source_query>
 * ```
 *
 * 同源地址只补代理参数；其余地址重建到当前页面 origin 上，目标主机与协议放进
 * `_cifera_h` / `_cifera_s`。
 *
 * @param url - 要改写的地址，可绝对可相对。
 * @param baseUrl - 解析相对地址的基准，默认当前页面。
 * @returns 改写后的地址；不该改写或改写失败时返回原值。
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

        const adjustedHost = normalizeProxyHost(parsed.host, PROXY_HOST);
        if (adjustedHost !== parsed.host) {
            parsed.host = adjustedHost;
        }

        const isSameOrigin = parsed.host === window.location.host &&
            parsed.protocol === window.location.protocol;

        if (isSameOrigin) {
            parsed.searchParams.set('_cifera_h', PROXY_HOST);
            if (PROXY_SCHEMA && PROXY_SCHEMA !== 'http') {
                parsed.searchParams.set('_cifera_s', PROXY_SCHEMA);
            }
            return parsed.toString();
        }

        const targetHost = parsed.host;
        const targetSchema = parsed.protocol.replace(':', '');

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
