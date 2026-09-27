import type { InterceptorHandler } from '@study-wolf-cifera/shared-types';

import { rewriteUrl } from '../utils/proxy_url.js';

/**
 * 让 `CLIENT_OPEN_URL` 留在代理里。
 *
 * 页面会要求客户端用它自己的 web 容器打开链接，那些链接一旦离开代理就等于离开了插件，因此
 * 先把载荷里的 `webUrl` 改写成代理地址。通知本身原样转发。
 */
export const interceptorProxyAdapter: InterceptorHandler<any> = (ctx, next) => {
    const args = ctx.args as { name?: string; payload?: Record<string, any> };
    if (args?.name === 'CLIENT_OPEN_URL' && typeof args.payload?.['webUrl'] === 'string') {
        const originalUrl = args.payload['webUrl'];
        const proxyUrl = rewriteUrl(originalUrl);
        if (proxyUrl !== originalUrl) {
            args.payload['webUrl'] = proxyUrl;
        }
    }
    next();
};
