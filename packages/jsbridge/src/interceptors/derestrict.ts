import { InterceptorHandler } from "@study-wolf-cifera/shared-types";

/**
 * Native切屏检测拦截器
 * 拦截 CLIENT_WEB_LIFECYCLE 协议
 */
export const interceptorSwitch: InterceptorHandler<any> = (ctx, next) => {
    if (ctx.args.name === "CLIENT_WEB_LIFECYCLE" && ctx.args.payload?.["status"] != 1) {
        ctx.cancel = true;
    }
    next();
}

/**
 * 键盘限制拦截器
 * 拦截 CLIENT_LIMIT_KEYBOARD 协议
 */
export const interceptorKeyboard: InterceptorHandler<any> = (ctx, next) => {
    if (ctx.args.name === "CLIENT_LIMIT_KEYBOARD") {
        ctx.cancel = true;
    }
    next();
}
