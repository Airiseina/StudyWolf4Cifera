import type { Callback } from '@study-wolf-cifera/shared-types';

import { jsBridge } from '../bridge.js';
import { findPuidInReply } from './rewrite.js';
import { resolvePuid, type PuidResolution } from './upload.js';

/**
 * 向客户端索取账号信息。
 *
 * 上传云盘要用 `puid`（`UploadTask` 从账号管理器取），而页面在有些页面上根本看不到它。客户端自己当然
 * 知道，因此这一层负责问它：发 `CLIENT_GET_USERINFO`，再从回包里找账号字段。
 */

/** 可能带回账号信息的协议，按可能性排序。 */
const USER_INFO_PROTOCOLS = ['CLIENT_GET_USERINFO', 'CLIENT_LOGIN_STATUS', 'CLIENT_DEVICE_ID'];

/** 依次问客户端要账号信息，返回第一条回包。 */
export async function requestClientUserInfo(
    options: { timeoutMs?: number } = {}
): Promise<{ protocol: string; reply: unknown } | null> {
    const timeoutMs = options.timeoutMs ?? 5000;

    for (const protocol of USER_INFO_PROTOCOLS) {
        let resolveReply: ((reply: unknown) => void) | null = null;
        const received = new Promise<unknown>((resolve) => {
            resolveReply = resolve;
        });
        const listener: Callback = (payload) => resolveReply?.(payload);
        jsBridge.bind(protocol, listener);
        try {
            jsBridge.postNotification(protocol, {});
            const reply = await Promise.race([
                received,
                new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
            ]);
            if (reply) return { protocol, reply };
        } catch {
            // 客户端不接受这条协议就换下一条。
        } finally {
            jsBridge.unbind(protocol, listener);
        }
    }

    return null;
}

/**
 * 解析出上传要用的 `puid`：先看页面自己的线索，再问客户端。
 *
 * 两条路都失败时返回 `null` 并带上尝试记录，服务端会直接拒绝空 `puid`，所以调用方应据此跳过上传。
 */
export async function resolveUploadPuid(
    options: { timeoutMs?: number; root?: Document } = {}
): Promise<PuidResolution> {
    const fromPage = resolvePuid({ root: options.root });
    if (fromPage.value) return fromPage;

    const reply = await requestClientUserInfo({ timeoutMs: options.timeoutMs });
    const tried = [...fromPage.tried, ...(reply ? [`client:${reply.protocol}`] : ['client:无回复'])];
    if (reply) {
        const found = findPuidInReply(reply.reply);
        if (found.value) {
            return { value: found.value, source: `client:${reply.protocol}#${found.field}`, tried };
        }
    }

    return { value: null, source: null, tried };
}
