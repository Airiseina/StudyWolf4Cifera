import {
    drawBattery,
    drawMobileData,
    drawSignalBars,
    drawText,
    drawWifi,
    measureTextWidth
} from '../draw/primitives';
import type { FormFactor, OS } from '../types/device';
import type { Rect, StatusBarOptions } from '../types/frame';

/** 一帧里状态栏所需的上下文。 */
export interface StatusBarContext {
    os: OS;
    formFactor: FormFactor;
    scale: number;
}

/** 把状态栏时钟格式化为 `HH:MM`。 */
export function formatStatusTime(date: Date = new Date()): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * 绘制系统状态栏。
 *
 * 布局按真机：前缘是网络徽标（`HD`）、移动数据指示（`4G` 加下方右箭头）与信号格，后缘依次是电量
 * 百分比、电池、时钟。几处让它像系统而不像画出来的细节：图标高度取状态栏高的 38%、线宽由图标高度
 * 推导；**时钟与电量百分比同字号**（真机上两者一致），并且都取偏大的一档；电池填充按电量比例；所有
 * 文字按实测墨迹盒居中，与图标共用同一条水平中线。
 *
 * Android 侧不再画 Wi-Fi 图标——真机那个位置是移动数据指示。iOS 仍保留 Wi-Fi。
 */
export function drawStatusBar(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    context: StatusBarContext,
    options: StatusBarOptions = {}
): void {
    const {
        background = '#ffffff',
        foreground = '#666666',
        time = formatStatusTime(),
        batteryPercent = 76,
        showNetwork = true,
        showNotifications = false,
        inset = 16
    } = options;

    ctx.save();
    ctx.fillStyle = background;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    const centerY = rect.y + rect.height / 2;
    const iconHeight = rect.height * 0.38;
    // 时钟与电量百分比同字号，且取偏大的一档（真机上两者一样大）。
    const textSize = Math.round(rect.height * 0.46);
    const badgeSize = Math.round(iconHeight * 0.9);
    // 制式文字比 HD 徽标小一档。
    const mobileDataTextSize = Math.round(badgeSize * 0.78);
    const gap = iconHeight * 0.5;
    const pad = inset * context.scale;
    const batteryLevel =
        batteryPercent === null ? 0.75 : Math.min(1, Math.max(0, batteryPercent / 100));

    if (context.os === 'ios') {
        drawText(ctx, time, rect.x + pad + iconHeight * 0.5, centerY, {
            size: textSize,
            color: foreground,
            weight: '600'
        });
    } else if (showNetwork || showNotifications) {
        let x = rect.x + pad;
        if (showNotifications) {
            ctx.save();
            ctx.fillStyle = foreground;
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(x + i * iconHeight * 0.55, centerY, iconHeight * 0.075, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            x += iconHeight * 1.75;
        }
        if (showNetwork) {
            drawNetworkGroup(
                ctx,
                x,
                centerY,
                iconHeight,
                badgeSize,
                mobileDataTextSize,
                gap,
                foreground
            );
        }
    }

    // 后缘由右向左：时钟、电池、电量百分比。
    let right = rect.x + rect.width - pad;
    if (context.os === 'ios') {
        right -= drawBattery(
            ctx,
            right - iconHeight * 1.85,
            centerY,
            iconHeight,
            foreground,
            batteryLevel
        );
        right -= gap * 1.5;
        drawWifi(ctx, right - iconHeight * 0.5, centerY, iconHeight, foreground);
        right -= iconHeight + gap * 1.5;
        drawSignalBars(ctx, right - iconHeight * 1.4, centerY, iconHeight, foreground);
        return;
    }

    const clock = { size: textSize, color: foreground, align: 'right' as const };
    drawText(ctx, time, right, centerY, clock);
    right -= measureTextWidth(ctx, time, clock) + gap;
    right -= drawBattery(ctx, right - iconHeight * 1.85, centerY, iconHeight, foreground, batteryLevel);
    if (batteryPercent !== null) {
        right -= gap * 0.75;
        drawText(ctx, `${Math.round(batteryPercent)}%`, right, centerY, {
            size: textSize,
            color: foreground,
            align: 'right'
        });
    }
}

/** 画网络徽标、移动数据指示与信号格，返回其后的光标位置。 */
function drawNetworkGroup(
    ctx: CanvasRenderingContext2D,
    x: number,
    centerY: number,
    iconHeight: number,
    badgeSize: number,
    mobileDataTextSize: number,
    gap: number,
    color: string
): number {
    const badge = { size: badgeSize, color };
    drawText(ctx, 'HD', x, centerY, { ...badge, align: 'left' });
    x += measureTextWidth(ctx, 'HD', badge) + gap * 0.8;
    x +=
        drawMobileData(ctx, x, centerY, iconHeight, color, { textSize: mobileDataTextSize }) +
        gap * 0.8;
    drawSignalBars(ctx, x, centerY, iconHeight, color);
    return x + iconHeight + gap;
}
