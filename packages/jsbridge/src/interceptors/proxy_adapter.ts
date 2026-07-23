import { InterceptorHandler } from "@study-wolf-cifera/shared-types";
import { rewriteUrl } from "../utils/proxy_url";

/**
 * 代理URL适配器
 * 拦截 CLIENT_OPEN_URL 通知，将其中的 webUrl 改写为代理 URL
 * 改写逻辑与 Cifera 运行时的 URL 改写一致，通过 __CIFERA__ 全局变量获取代理配置
 */
export const interceptorProxyAdapter: InterceptorHandler<any> = (ctx, next) => {
    if (ctx.args.name === "CLIENT_OPEN_URL" && ctx.args.payload?.["webUrl"]) {
        const originalUrl = ctx.args.payload["webUrl"];
        const proxyUrl = rewriteUrl(originalUrl);
        if (proxyUrl !== originalUrl) {
            ctx.args.payload["webUrl"] = proxyUrl;
        }
    }
    next();
}
