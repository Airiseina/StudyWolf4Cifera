/** `CLIENT_CUSTOM_LEFTBTN` 下发的自定义返回键。 */
export interface ClientLeftButton {
    /** 值为 `'1'` 时客户端应替换掉自带返回键。 */
    show?: string;
    /** 各平台的图标地址；客户端按屏幕密度挑选。 */
    icon?: Record<string, { icon?: string; iconHd?: string }>;
    /** 按下时执行的 JavaScript，例如 `customLeftBinAction()`。 */
    option?: string;
}

/** 注入的 bridge 所记录的页面环境状态。 */
export interface StudyWolfEnv {
    /** 客户端上报的标题（`CLIENT_TOOLBAR_TITLE`），例如 `张三 (20230001)`。 */
    title: string;
    /** 客户端上报的自定义返回键，若有。 */
    left_btn: ClientLeftButton | null;
}
