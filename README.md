# dsh-model-select-skin

给 DeepSeek Harness Web UI 的模型选择器换皮肤：胶囊芯片触发器 + 重做的下拉菜单。

## 效果

- **触发器**：胶囊芯片，含提供商彩点、`提供商 · 模型名`、思考档位标签
- **下拉菜单**：与官方弹层一致的半透明毛玻璃表面；分组标题显示提供商名 + 数量徽章
- **打开时自动定位**到当前选中的模型

## 安装

```bash
# 在 profile 的 node_modules 下软链本目录
ln -s /path/to/dsh-model-select-skin ~/.dsh/profiles/web/node_modules/@local/dsh-model-select-skin
```

随后在 `cordis.patch.yml` 中插入插件行（本仓库已自带该补丁），重启 `dsh web` 即可。

## 结构

| 文件 | 作用 |
|---|---|
| `client.js` | 浏览器端：注册低优先级席位，遮蔽官方选择器 |
| `index.js` | Host 端：仅承载 bundle 身份，`apply` 为空 |
| `cordis.patch.yml` | bundle 补丁，插入插件行 |
| `locale/` | 中英文案 |
| `icon.svg` | 插件图标 |

## 原理

`conversation.input.model` 是单槽席位，默认由官方 `client-ui-model-selection` 占据。
本插件以 **-1 优先级**注册同一个槽位，遮蔽官方入口（最低优先级先渲染）。

数据与提交**不重新实现**：组件通过 `modelDirectories` 服务读取按会话共享的目录
（与官方选择器、`/model` 弹窗同一份存储），选择走 `directory.select()`，即
官方的 `session/selectModel` 链路。因此在任何位置做的切换都处处可见。

禁用或卸载本插件即可恢复官方 UI。
