/** Cifera 代理注入到每个改写文档里的配置。 */
export interface CiferaConfig {
    /** 源站主机，例如 `www.example.com`；可能带端口，如 `example.com:443`。 */
    h: string;
    /** 源站协议，例如 `https`；缺省按 `http` 处理。 */
    s: string;
    /** 产生该文档的请求的 Referer，若有。 */
    r?: string;
    /** Cifera Cookie 托管的数据，启用时存在。 */
    c?: Record<string, any>;
}
