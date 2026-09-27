/** 合成帧的输出辅助函数。 */

/** 把合成帧编码为 JPEG Blob，即客户端上传使用的格式。 */
export function frameToJpegBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
    return canvasToBlob(canvas, 'image/jpeg', quality);
}

/** 把合成帧编码为 PNG Blob。 */
export function frameToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return canvasToBlob(canvas, 'image/png');
}

/** 把合成帧编码为 data URL。 */
export function frameToDataUrl(
    canvas: HTMLCanvasElement,
    type: 'image/jpeg' | 'image/png' = 'image/jpeg',
    quality = 0.92
): string {
    return canvas.toDataURL(type, quality);
}

/** 触发下载合成帧，便于人工查看。 */
export function downloadFrame(
    canvas: HTMLCanvasElement,
    filename = 'monitor-frame.jpg',
    quality = 0.92
): void {
    const link = document.createElement('a');
    link.download = filename;
    link.href = frameToDataUrl(canvas, filename.endsWith('.png') ? 'image/png' : 'image/jpeg', quality);
    link.click();
}

/** `HTMLCanvasElement.toBlob` 的 Promise 包装。 */
function canvasToBlob(
    canvas: HTMLCanvasElement,
    type: string,
    quality?: number
): Promise<Blob> {
    return new Promise((resolvePromise, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolvePromise(blob) : reject(new Error(`fake-screen: encoding ${type} failed`))),
            type,
            quality
        );
    });
}
