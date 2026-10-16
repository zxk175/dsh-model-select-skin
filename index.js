/**
 * 模型选择皮肤的 Host 端。
 *
 * 功能全部在浏览器侧：Client 模块（`./client`）以较低优先级为 composer 的
 * `conversation.input.model` 席位注册占用者，用胶囊芯片皮肤遮蔽官方选择器。
 * Host 端的存在只是为了让 bundle 有一行可加载的插件记录；它不注册任何
 * 服务、工具或事件。
 */

/** 空操作的 Host 插件主体。 */
export function apply() {}
