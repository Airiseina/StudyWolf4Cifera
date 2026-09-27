/**
 * 上报改写的纯函数测试：替换规则与账号 id 解析都不该只能在浏览器里跑。
 */
import { describe, expect, test } from 'bun:test';

import { findPuidInReply, rewriteObjectIds } from '../src/monitor/rewrite.js';
import { resolvePuid } from '../src/monitor/upload.js';

/** 真机回包的形状（docs/chaoxing.txt）。 */
const REAL_REPLY = {
    data: {
        picCollectTime: 1790256242813,
        frontStatus: 1,
        frontObjectId: 'eb22bddf7ffee338164f3ca4e8df5702',
        backStatus: 1,
        backObjectId: '06c639617c223448960c0a9d04cff465',
        funconfig: '{}'
    },
    captureMode: 0,
    signToken: 'a38b3dcbbb19f4bd926ec4e10429ca09',
    cxcid: '3e57ec8c74669bf1ad3d28be5badd309410191884',
    cxtime: '1790256248390'
};

describe('rewriteObjectIds', () => {
    test('把人脸回复里的前后置 id 都换成自己的', () => {
        const payload = structuredClone(REAL_REPLY) as Record<string, unknown>;
        const replaced = rewriteObjectIds(payload, 'ffffffffffffffffffffffffffffffff');

        expect(replaced).toBe(2);
        const data = payload.data as Record<string, string>;
        expect(data.frontObjectId).toBe('ffffffffffffffffffffffffffffffff');
        expect(data.backObjectId).toBe('ffffffffffffffffffffffffffffffff');
        // 其他字段（尤其是签名）不该被动。
        expect((payload as Record<string, string>).signToken).toBe(REAL_REPLY.signToken);
        expect((payload as Record<string, string>).cxcid).toBe(REAL_REPLY.cxcid);
    });

    test('录屏回复里的 captureObjectId/objectId 同样能换', () => {
        const payload = {
            controlType: 0,
            data: { objectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', completeTime: 1 },
            captureObjectId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        };
        expect(rewriteObjectIds(payload, 'cccccccccccccccccccccccccccccccc')).toBe(2);
        expect(payload.data.objectId).toBe('cccccccccccccccccccccccccccccccc');
    });

    test('没有画面引用时返回 0', () => {
        expect(rewriteObjectIds({ recognizeStatus: 1, funconfig: '' }, 'd'.repeat(32))).toBe(0);
        expect(rewriteObjectIds(null, 'd'.repeat(32))).toBe(0);
    });
});

describe('findPuidInReply', () => {
    test('优先取浅层的 puid 字段', () => {
        expect(findPuidInReply({ puid: '410191884', data: { userId: 999 } })).toEqual({
            value: '410191884',
            field: 'puid'
        });
    });

    test('没有 puid 时退到 userId / personId', () => {
        expect(findPuidInReply({ data: { userId: '410191884' } })).toEqual({
            value: '410191884',
            field: 'userId'
        });
        expect(findPuidInReply({ info: { personId: 410191884 } })).toEqual({
            value: '410191884',
            field: 'personId'
        });
    });

    test('短数字与 uuid 不算账号 id', () => {
        expect(findPuidInReply({ uuid: 'db0126b6c7434a008c36321e220de522' }).value).toBeNull();
        expect(findPuidInReply({ id: 42 }).value).toBeNull();
        expect(findPuidInReply('done').value).toBeNull();
    });
});

describe('resolvePuid', () => {
    test('页面里找不到就返回空，并给出尝试记录（交由客户端回答）', () => {
        const resolved = resolvePuid({});
        expect(resolved.value).toBeNull();
        expect(resolved.source).toBeNull();
        // 尝试过隐藏输入与地址参数；cxcid 尾部不可靠，已刻意不做猜测。
        expect(resolved.tried).toContain('input:userId');
        expect(resolved.tried).not.toContain('cxcid');
    });
});
