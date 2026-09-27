/**
 * 用真机抓到的回复做回归：把人脸探针在 V2507A（客户端 3.6.7.7_10945_315）上收到的原始回包固化下来，
 * 保证字段解析与 objectId 地址模板不会悄悄退化。
 */
import { describe, expect, test } from 'bun:test';

import { DEFAULT_OBJECT_ID_URL, findFrameCandidate } from '../src/face/frame.js';

/** 2026-09-24 真机回复原文（docs/chaoxing.txt 中的第一条）。 */
const REAL_REPLY = {
    data: {
        picCollectTime: 1790256242813,
        frontStatus: 1,
        frontObjectId: 'eb22bddf7ffee338164f3ca4e8df5702',
        completeTime: 1790256248390,
        backStatus: 1,
        backObjectId: '06c639617c223448960c0a9d04cff465',
        funconfig: '{}'
    },
    captureMode: 0,
    signToken: 'a38b3dcbbb19f4bd926ec4e10429ca09',
    cxcid: '3e57ec8c74669bf1ad3d28be5badd309410191884',
    cxtime: '1790256248390'
};

describe('findFrameCandidate', () => {
    test('真人脸回复里取前置摄像头那一路', () => {
        expect(findFrameCandidate(REAL_REPLY)).toEqual({
            kind: 'objectId',
            value: 'eb22bddf7ffee338164f3ca4e8df5702'
        });
    });

    test('objectId 地址模板与实测可用的一致', () => {
        expect(DEFAULT_OBJECT_ID_URL('eb22bddf7ffee338164f3ca4e8df5702')).toBe(
            'https://p.ananas.chaoxing.com/star3/origin/eb22bddf7ffee338164f3ca4e8df5702'
        );
    });

    test('内嵌图片优先于 objectId', () => {
        expect(
            findFrameCandidate({
                data: { frontObjectId: 'eb22bddf7ffee338164f3ca4e8df5702' },
                preview: 'data:image/jpeg;base64,AAAA'
            })
        ).toEqual({ kind: 'data', value: 'data:image/jpeg;base64,AAAA' });
    });

    test('只有状态没有画面时返回 null', () => {
        expect(findFrameCandidate({ recognizeStatus: 1, funconfig: '' })).toBeNull();
        expect(findFrameCandidate(null)).toBeNull();
        expect(findFrameCandidate('done')).toBeNull();
    });
});
