import type { StudyWolfEnv } from '@study-wolf-cifera/shared-types';

/**
 * window 上可能还没有 Study Wolf 环境对象：由 bridge 首次使用时创建，其他代码不必关心初始化顺序。
 */
type WindowWithEnv = Window & { __STUDY_WOLF_ENV__?: StudyWolfEnv };

/** 取共享环境对象，不存在则创建。 */
export function jsBridgeEnv(): StudyWolfEnv {
    const target = window as WindowWithEnv;
    if (!target.__STUDY_WOLF_ENV__) {
        target.__STUDY_WOLF_ENV__ = { title: document.title || '', left_btn: null };
    }
    return target.__STUDY_WOLF_ENV__;
}

/**
 * 客户端自定义返回键的图标地址，按当前设备取。
 *
 * `CLIENT_CUSTOM_LEFTBTN` 给每个平台各带一份图标，并额外给一份高密度版本；客户端按屏幕密度
 * 选择，这里最接近的做法是有 `iconHd` 就用它。
 */
export function leftButtonIconUrl(device: string): string | null {
    const payload = jsBridgeEnv().left_btn as
        | { show?: string; icon?: Record<string, { icon?: string; iconHd?: string }> }
        | null
        | undefined;
    if (!payload?.icon) return null;
    const platform = device === 'ios' ? 'ios' : 'android';
    const icon = payload.icon[platform] ?? payload.icon.android ?? payload.icon.ios;
    return icon?.iconHd ?? icon?.icon ?? null;
}
