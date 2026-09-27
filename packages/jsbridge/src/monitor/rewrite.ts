import { OBJECT_ID_KEYS } from '../face/frame.js';

/**
 * 上报改写用的纯函数。
 *
 * 与 DOM、bridge 都无关，因此可以在没有浏览器的环境里单独测试：替换 objectId 的规则、以及从客户端
 * 回复里找账号 id 的规则都不该藏在带副作用的模块里。
 */

/** 回包里可能承载 `puid` 的字段名，按优先级排列。 */
const PUID_FIELDS = ['puid', 'uid', 'userId', 'userid', 'personId', 'personid', 'id'];

/** 一个像账号 id 的值：数字串，长度至少 6。 */
function looksLikePuid(value: unknown): value is string | number {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 100000;
    return typeof value === 'string' && /^\d{6,}$/.test(value.trim());
}

/**
 * 从客户端回包里找出账号 id。
 *
 * 广度优先：浅层字段优先，同层按 {@link PUID_FIELDS} 的顺序，因此 `{puid: 123}` 会赢过
 * `{data: {userId: 456}}`。
 */
export function findPuidInReply(reply: unknown): { value: string | null; field: string | null } {
    const queue: unknown[] = [reply];
    const seen = new Set<unknown>();

    while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);

        const record = current as Record<string, unknown>;
        for (const field of PUID_FIELDS) {
            const raw = record[field];
            if (looksLikePuid(raw)) return { value: String(raw), field };
        }
        for (const value of Object.values(record)) {
            if (value && typeof value === 'object') queue.push(value);
        }
    }

    return { value: null, field: null };
}

/**
 * 就地改写载荷里的 objectId 字段。
 *
 * 字段名单与"从回复里找画面"共用（{@link OBJECT_ID_KEYS}），因此前后置、抓拍、录屏几种回复都能一次
 * 换掉。
 *
 * @returns 改写成功的字段数；为 0 说明这份回复没有可换的画面引用。
 */
export function rewriteObjectIds(payload: unknown, objectId: string): number {
    let replaced = 0;
    const queue: unknown[] = [payload];
    const seen = new Set<unknown>();

    while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);

        const record = current as Record<string, unknown>;
        for (const [key, value] of Object.entries(record)) {
            if (typeof value === 'string' && OBJECT_ID_KEYS.includes(key)) {
                record[key] = objectId;
                replaced++;
            } else if (value && typeof value === 'object') {
                queue.push(value);
            }
        }
    }

    return replaced;
}
