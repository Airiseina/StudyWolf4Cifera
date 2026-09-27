/**
 * 上传模块的单元测试：请求形状必须与客户端 `UploadTask.java` 一致（multipart 只带 `file` 与 `puid`，
 * 查询参数来自页面请求里的 uploadParams），响应里的 `data.objectId` 要能解出来。
 */
import { describe, expect, test } from 'bun:test';

import {
    DEFAULT_PAN_UPLOAD_URL,
    uploadMonitorFrame
} from '../src/monitor/upload.js';

/** 记录一次 fetch 调用的桩。 */
function stubFetch(
    response: { status?: number; body: string; ok?: boolean }
): { calls: { url: string; init: RequestInit }[]; fetchImpl: typeof fetch } {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        const status = response.status ?? 200;
        return new Response(response.body, {
            status,
            headers: { 'content-type': 'application/json' }
        });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
}

describe('uploadMonitorFrame', () => {
    test('按云盘中心的形状发 multipart，并解出 objectId', async () => {
        const { calls, fetchImpl } = stubFetch({
            body: JSON.stringify({ data: { objectId: 'eb22bddf7ffee338164f3ca4e8df5702' } })
        });

        const result = await uploadMonitorFrame(
            new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
            {
                params: { uploadtype: 'face_temp' },
                puid: '410191884'
            },
            { filename: 'monitor.jpg', fetchImpl }
        );

        expect(result.ok).toBe(true);
        expect(result.objectId).toBe('eb22bddf7ffee338164f3ca4e8df5702');
        expect(result.status).toBe(200);

        const url = new URL(calls[0].url);
        expect(url.origin + url.pathname).toBe(DEFAULT_PAN_UPLOAD_URL);
        expect(url.searchParams.get('uploadtype')).toBe('face_temp');

        const form = calls[0].init.body as FormData;
        expect(calls[0].init.method).toBe('POST');
        expect(form.get('puid')).toBe('410191884');
        expect(form.get('file')).toBeInstanceOf(Blob);
    });

    test('后端注入上传地址时优先用它', async () => {
        const { calls, fetchImpl } = stubFetch({ body: JSON.stringify({ data: { objectId: 'x'.repeat(32) } }) });

        await uploadMonitorFrame(new Blob(['x']), {
            uploadUrl: 'https://exam.example.com/upload?sign=abc',
            params: { uploadtype: 'examkeeper' },
            puid: '1'
        }, { fetchImpl });

        const url = new URL(calls[0].url);
        expect(url.origin).toBe('https://exam.example.com');
        expect(url.searchParams.get('sign')).toBe('abc');
        expect(url.searchParams.get('uploadtype')).toBe('examkeeper');
    });

    test('isYunPan 时用 fid 拼镜像域名', async () => {
        const { calls, fetchImpl } = stubFetch({ body: JSON.stringify({ data: { objectId: 'y'.repeat(32) } }) });

        await uploadMonitorFrame(new Blob(['x']), { isYunPan: true, fid: 'abc123', puid: '1' }, { fetchImpl });

        expect(new URL(calls[0].url).origin).toBe('https://abc123-pan.chaoxing.com');
    });

    test('服务端报错或没有 objectId 时判定为失败', async () => {
        const failing = stubFetch({ status: 500, body: 'boom' });
        const failed = await uploadMonitorFrame(new Blob(['x']), { puid: '1' }, { fetchImpl: failing.fetchImpl });
        expect(failed.ok).toBe(false);
        expect(failed.objectId).toBeNull();
        expect(failed.body).toContain('boom');

        const noId = stubFetch({ body: JSON.stringify({ data: {} }) });
        const missing = await uploadMonitorFrame(new Blob(['x']), { puid: '1' }, { fetchImpl: noId.fetchImpl });
        expect(missing.ok).toBe(false);
        expect(missing.status).toBe(200);
    });

    test('网络异常不抛错，转成失败结果', async () => {
        const throwing = (async () => {
            throw new Error('offline');
        }) as unknown as typeof fetch;
        const result = await uploadMonitorFrame(new Blob(['x']), { puid: '1' }, { fetchImpl: throwing });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(0);
        expect(result.body).toContain('offline');
    });
});
