/** Cifera 代理全局配置（由 Cifera 注入到页面中的 __CIFERA__ 变量） */
export interface CiferaConfig {
    /** 源站主机名（如 www.example.com，可含端口如 example.com:443） */
    h: string;
    /** 源站协议（如 https），默认 http */
    s: string;
    /** 当前请求的 Referer（可选） */
    r?: string;
    /** Cookie 托管数据（可选，由 Cifera Cookie 托管系统注入） */
    c?: Record<string, any>;
}