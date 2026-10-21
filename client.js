/**
 * 模型选择皮肤的 Client 端。
 *
 * 输入框的 `conversation.input.model` 席位是一个单槽，默认被官方
 * `client-ui-model-selection` 选择器占据。本模块以 -1 优先级注册同一个槽位，
 * 遮蔽官方入口（最低优先级先渲染），用胶囊芯片皮肤替换触发器和下拉菜单。
 *
 * 数据与提交不重新实现：组件通过 `modelDirectories` 服务读取按会话共享的
 * 目录（正是官方选择器和 /model 弹窗用的那份存储），所以在任何位置做的切换
 * 都处处可见。选择走 `directory.select()`，与官方的 `session/selectModel` 同一条链路。
 *
 * 无需任何 Harness Client 包：React 来自浏览器模块表，样式表是本插件 effect
 * 自己持有的普通 <style> 元素（动态外观的 `styles` 内建不在 bundle factory 作用域里）。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-model-select-skin',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const {
      useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
    } = React

    /** 本插件自有的字典命名空间。 */
    const NS = 'model-select-skin'
    /** Host 目录不翻译其显示名的提供商 id。 */
    const ACCOUNT_PROVIDER = 'deepseek-account'

    /** 所有可见字符串的双语字典。 */
    const DICT = {
      zh: {
        triggerFallback: '选择模型',
        triggerLoading: '加载模型…',
        selectAria: '选择模型',
        menuAria: '模型选择',
        effortSection: '思考档位',
        providerDefault: '供应商默认',
        searchPlaceholder: '搜索模型',
        searchEmpty: '没有匹配的模型',
        emptyModels: '暂无可用模型',
        loading: '正在加载模型列表…',
        retry: '重试',
        groupLoadError: '{name} 加载失败：{message}',
        actionError: '操作未完成：{message}',
        sessionInUse: '该会话正被另一个写入方占用，请稍后重试',
        providerAccount: 'DeepSeek 账号',
        collapseGroup: '收起分组',
        expandGroup: '展开分组',
        collapseAll: '全部收起',
        expandAll: '全部展开',
      },
      en: {
        triggerFallback: 'Select model',
        triggerLoading: 'Loading models…',
        selectAria: 'Select model',
        menuAria: 'Model selection',
        effortSection: 'Thinking effort',
        providerDefault: 'Provider default',
        searchPlaceholder: 'Search models',
        searchEmpty: 'No matching model',
        emptyModels: 'No model available',
        loading: 'Loading model catalog…',
        retry: 'Retry',
        groupLoadError: '{name} failed to load: {message}',
        actionError: 'Action did not complete: {message}',
        sessionInUse: 'This session is held by another writer; try again shortly',
        providerAccount: 'DeepSeek account',
        collapseGroup: 'Collapse group',
        expandGroup: 'Expand group',
        collapseAll: 'Collapse all',
        expandAll: 'Expand all',
      },
    }

    /** 提供商强调色；未知提供商用稳定的哈希色。 */
    const PROVIDER_COLORS = {
      'deepseek-account': '#4d6bfe',
      deepseek: '#4d6bfe',
      workbuddy: '#12b981',
      'sense-nova': '#f59e0b',
      openai: '#10a37f',
      anthropic: '#d97757',
      google: '#4285f4',
      openrouter: '#8b5cf6',
    }
    const FALLBACK_COLORS = ['#4d6bfe', '#12b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444', '#84cc16']

    /**
     * 某个提供商 id 的稳定强调色。
     * @param id - 目录里的提供商 id。
     * @returns CSS 颜色字面量（美术资源，刻意不依赖主题 token）。
     */
    function providerColor(id) {
      // 目录快照可能出现 provider id 缺失的条目
      // （例如待处理或部分加载的选择）。把它当作中性
      // 强调色，而不是让整个席位崩溃。
      if (id === undefined || id === null) return '#9ca3af'
      const known = PROVIDER_COLORS[id]
      if (known !== undefined) return known
      let hash = 0
      const str = String(id)
      for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0
      return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
    }

    /**
     * 按查询对模型名打分：子串命中优先（越靠前越好），然后是有序子序列命中，最后是无匹配。
     * @param name - 目录里的模型名。
     * @param q - 已小写化、去空格的查询；空串匹配全部。
     * @returns 排序键，-1 表示"无匹配"。
     */
    function matchScore(name, q) {
      if (q === '') return 0
      const lower = name.toLowerCase()
      const at = lower.indexOf(q)
      if (at >= 0) return at
      let cursor = 0
      for (let i = 0; i < lower.length && cursor < q.length; i += 1) {
        if (lower[i] === q[cursor]) cursor += 1
      }
      return cursor === q.length ? 1000 + lower.length : -1
    }

    /** 插件样式表：胶囊触发器和重做的下拉菜单，仅用主题 token。 */
    const CSS = `
.mss-root { position: relative; min-width: 0; }
.mss-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  min-width: 0; max-width: 220px; max-width: min(360px, 45cqw);
  height: 28px; padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 13px; line-height: 20px; font-weight: 400;
  cursor: pointer;
}
.mss-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.mss-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
}
.mss-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.mss-trigger[data-open] { border-color: var(--dsw-alias-border-l2); }
/* composer 会测量展开行的高度需求，并在工具行（ui-conversation InputBar）上发布
   这两个变量：当行宽不足时隐藏文字、显示图标。不遵守该契约的占用者会让行溢出
   而不是折叠，因此文字部分和回退字形都要遵循它。 */
.mss-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
.mss-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mss-glyph { display: var(--dsh-composer-model-icon-display, none); flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.mss-dot, .mss-name { display: var(--dsh-composer-model-text-display, block); }
.mss-effort {
  display: var(--dsh-composer-model-text-display, inline-block);
  flex: 0 0 auto; padding: 0 6px; border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px; line-height: 16px;
}
.mss-chevron { flex: 0 0 auto; width: 12px; height: 12px; color: var(--dsw-alias-label-caption); transition: transform 120ms ease; }
.mss-chevron[data-open] { transform: rotate(180deg); }
.mss-menu {
  position: fixed; z-index: 1100;
  display: flex; flex-direction: column;
  /* 固定宽度（受屏幕限制）：否则"全部收起"后模型行消失，
     max-content 的菜单会缩到 min-width，展开/收起时宽度跟着变。 */
  width: min(440px, calc(100vw - 32px)); min-width: min(360px, calc(100vw - 32px));
  max-width: min(440px, calc(100vw - 32px));
  max-height: min(380px, calc(100vh - 96px)); overflow: hidden;
  padding: 6px;
  /* 官方 popupSelect 卡片的表面：半透明填充 + 40px 背景模糊，
   加上烘焙进 --dsw-elevation-prominent 的 0.5px 描边（不用真正的 border，
   见 MenuSurface.module.css 与 PopupSelectView.module.css）。 */
  border: 0; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-overlay));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  box-shadow: var(--dsw-elevation-prominent);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.mss-section { padding: 4px 8px 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.mss-efforts { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 6px 6px; }
.mss-chip {
  padding: 2px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; cursor: pointer;
}
.mss-chip:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.mss-chip[data-on] {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  /* 官方的"实心品牌填充上的前景色"token：在两个主题下都是 brand-primary 的精确补色。 */
  color: var(--dsw-alias-label-primary-foreground);
}
.mss-chip:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.mss-search { display: flex; align-items: center; gap: 6px; margin: 2px 0 4px; }
.mss-search input {
  flex: 1; min-width: 0; height: 28px; padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px;
}
.mss-search input::placeholder { color: var(--dsw-alias-label-caption); }
.mss-search input:focus-visible { outline: none; border-color: var(--dsw-alias-border-l2); }
.mss-scroll { min-height: 0; overflow-y: auto; }
.mss-group {
  position: sticky; top: 0; z-index: 1;
  box-sizing: border-box; width: 100%;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px 4px;
  /* 分组标题用官方专用的不透明实心底：sticky 悬停时滚过的行不会从它下面
     透出来，分组之间的边界也比半透明表面清楚。 */
  background: var(--dsw-alias-menu-group-header-fill, var(--dsw-alias-bg-overlay));
  border: 0; border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: 11px; line-height: 16px; text-align: left;
  cursor: pointer;
}
.mss-group:hover { color: var(--dsw-alias-label-secondary); }
.mss-group:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.mss-group-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 600; }
/* 折叠箭头：展开时朝下，收起时朝右。 */
.mss-group-caret {
  flex: 0 0 auto; width: 10px; height: 10px;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}
.mss-group[data-collapsed] .mss-group-caret { transform: rotate(-90deg); }
@media (prefers-reduced-motion: reduce) { .mss-group-caret { transition: none; } }
/* 分组标题里的整行按钮不抢焦点顺序，键盘走列表本身。 */
/* 全部展开/收起：放在搜索行右侧，不额外占一行、不撑宽菜单。 */
.mss-collapse-all {
  display: flex; align-items: center; gap: 4px;
  flex: 0 0 auto; white-space: nowrap;
  padding: 2px 8px; border: 0; border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11px; line-height: 18px; cursor: pointer;
}
.mss-collapse-all:hover { background: var(--dsw-alias-interactive-bg-hover); }
.mss-collapse-all:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
/* 没有背景模糊时，半透明表面会让页面透出来，因此退回不透明的 overlay 填充。 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .mss-menu { background: var(--dsw-alias-bg-overlay); }
}
.mss-count {
  box-sizing: border-box; flex: 0 0 auto; margin-left: auto;
  min-width: 18px; padding: 0 6px;
  border: none; border-radius: 999px;
  /* 品牌彩色强调色：浅色为 rgb(65,118,230)，深色为 rgb(86,134,254)。
   alias 的 brand-primary 在本主题是近黑的中性色（rgb(15,17,21)），
   这正是徽章之前显示为黑色的原因。这个长名字是设计系统自己的 token，
   ui-trajectory 和 ui-dockkit 也是这么用的。 */
  background: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);
  /* 实心品牌填充的前景色：浅色为白，深色为近黑。
   在上面的蓝色上都保持可读。 */
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 11px; line-height: 16px; font-weight: 600;
  text-align: center; font-variant-numeric: tabular-nums;
}
.mss-row {
  box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 32px; padding: 5px 8px;
  border: none; border-radius: var(--dsw-radius-md);
  background: transparent; color: inherit; text-align: left;
  font-size: 13px; line-height: 18px; cursor: pointer;
}
.mss-row:hover:not(:disabled), .mss-row[data-active]:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.mss-row[data-selected] { background: var(--dsw-alias-interactive-bg-hover); font-weight: 500; }
.mss-row:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.mss-row:focus-visible { outline: none; background: var(--dsw-alias-interactive-bg-hover); }
.mss-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.mss-model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mss-desc { overflow: hidden; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 15px; text-overflow: ellipsis; white-space: nowrap; }
.mss-check { display: grid; flex: 0 0 14px; place-items: center; color: var(--dsw-alias-brand-primary); }
.mss-status, .mss-empty { padding: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.mss-error {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 6px;
  margin-bottom: 3px; padding: 6px 7px; border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px; line-height: 16px;
}
.mss-retry {
  flex: 0 0 auto; padding: 0; border: none; background: transparent;
  color: inherit; font: inherit; font-weight: 600; cursor: pointer;
}
.mss-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary);
  animation: mss-spin 700ms linear infinite;
}
@keyframes mss-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .mss-spinner { animation: none; }
  .mss-chevron { transition: none; }
}
.mss-toast {
  position: fixed; left: 50%; bottom: 108px; transform: translateX(-50%);
  z-index: 1200;
  max-width: min(360px, 80vw); padding: 6px 10px; border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-state-error-primary);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px; line-height: 18px;
}
`

    /** 对那些完全没有目录的会话，返回空操作的取消订阅。 */
    const NO_SUBSCRIBE = () => () => {}

    /**
     * 无法解析到目录时（例如被寻址的子代理会话）使用的稳定空目录快照。
     * 它必须是同一个冻结引用，这样 `useSyncExternalStore` 不会看到变化而重渲染。
     */
    const EMPTY_STATE = Object.freeze({
      current: null, routable: null, groups: [], failures: [], status: 'idle', pending: null, error: null,
    })

    /** 本插件唯一样式表元素的标记属性。 */
    const STYLE_MARK = 'data-dsh-model-select-skin'

    /**
     * 插入插件样式表一次，返回移除函数。
     *
     * 普通 bundle 的 Client factory 只收到 `require`，所以动态外观的 `styles` 内建
     * 在这里不可用；真实元素是受支持的做法（与已安装的第三方插件一致）。
     * @returns 移除本次创建元素的清理函数。
     */
    function insertStyle() {
      let element = document.querySelector(`style[${STYLE_MARK}]`)
      if (element === null) {
        element = document.createElement('style')
        element.setAttribute(STYLE_MARK, '')
        document.head.append(element)
      }
      // 始终（重）写规则。client bundle 通过软链接实时编辑，
      // 较早一次加载残留的 <style> 标签会保留旧规则
      // （HMR 不会可靠重跑这个 effect），可能隐藏
      // 后来新增的选择器，例如 mss-group-name。
      element.textContent = CSS
      return () => { element.remove() }
    }

    /** 内联对勾图标（不依赖图标包）。 */
    function CheckIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: false,
      }, h('path', {
        d: 'M3.2 8.4 6.3 11.4 12.8 4.9', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /**
     * 内联的向下箭头。
     * @param props - `open` 会旋转字形。
     * @returns 箭头元素。
     */
    function ChevronIcon(props) {
      return h('svg', {
        className: 'mss-chevron', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
        ...(props.open === true ? { 'data-open': '' } : {}),
      }, h('path', {
        d: 'M4 6.5 8 10.5 12 6.5', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /** 分组标题右侧的折叠箭头；收起时由 CSS 旋转成朝右。 */
    function CaretIcon() {
      return h('svg', {
        className: 'mss-group-caret', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
      }, h('path', {
        d: 'M4 6.5 8 10.5 12 6.5', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /**
     * 当 composer 工具行宽度不足时，替代触发器文字显示的紧凑字形
     * （工具行会发布 `--dsh-composer-model-icon-display`）。
     * @returns 字形元素。
     */
    function ModelGlyph() {
      return h('svg', {
        className: 'mss-glyph', viewBox: '0 0 16 16', width: 16, height: 16,
        'aria-hidden': true, focusable: false,
      }, h('path', {
        d: 'M2.5 12.5V5.2l3 4 3-4 3 4 2-2.6v6', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /**
     * 提供商强调圆点。
     * @param props - 提供商 `id`。
     * @returns 圆点元素。
     */
    function Dot(props) {
      return h('span', {
        className: 'mss-dot', 'aria-hidden': true,
        style: { background: providerColor(props.id) },
      })
    }

    /**
     * 胶囊芯片模型席位。
     * @param props - owner 传入（`locked`）、注入的目录外观、以及语言席位。
     * @returns 触发器；打开时同时返回重做的下拉菜单。
     */
    function ModelSkin(props) {
      const { locked, available, load, select } = props
      const resolve = typeof props.resolve === 'function' ? props.resolve : () => null
      const t = typeof props.t === 'function' ? props.t : (key) => key

      // 会话的目录在挂载时可能无法解析（其作用域或绑定尚未就绪）。
      // 通过注入外观的 resolver 重试，让席位自我修复，
      // 而不是在整页生命周期里保持无反应。
      const [directory, setDirectory] = useState(props.directory ?? null)
      useEffect(() => {
        if (directory !== null) return undefined
        let cancelled = false
        const attempt = () => {
          if (cancelled) return
          const next = resolve()
          if (next !== null) { setDirectory(next.store); return }
          timer = setTimeout(attempt, 1000)
        }
        let timer = setTimeout(attempt, 250)
        return () => { cancelled = true; clearTimeout(timer) }
      }, [directory, resolve])

      // 当这个会话没有模型席位时，`directory` 为 null。
      // 两个回调都按它做记忆化，这样 React 不会在每次渲染时重新订阅。
      const subscribe = useMemo(
        () => (directory === null ? NO_SUBSCRIBE : (notify) => directory.subscribe(notify)),
        [directory],
      )
      const readSnapshot = useMemo(
        () => (directory === null ? () => EMPTY_STATE : () => directory.getSnapshot()),
        [directory],
      )
      const state = useSyncExternalStore(subscribe, readSnapshot)

      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [active, setActive] = useState(0)
      const [toast, setToast] = useState(null)
      const [pos, setPos] = useState(null)
      // 已收起的分组 id。只影响渲染，不影响目录数据；搜索时自动全展开。
      const [collapsed, setCollapsed] = useState(() => new Set())
      // 展开某个分组后，需要把该组第一条行滚动到可见位置；滚动完清空。
      const [scrollTarget, setScrollTarget] = useState(null)

      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const menuRef = useRef(null)
      const scrollRef = useRef(null)
      const itemRefs = useRef([])
      const toastSeq = useRef(0)
      // 守卫每次打开的一次性"把选中项滚动到可见位置"：
      // 选中行要等目录加载落地才存在，所以这里要等它。
      const centeredRef = useRef(false)

      const groups = useMemo(() => {
        const source = Array.isArray(state.groups) ? state.groups : []
        return source.map(group => ({
          id: group.id,
          name: group.id === ACCOUNT_PROVIDER ? t('providerAccount') : (group.name || group.id),
          models: Array.isArray(group.models) ? group.models : [],
        }))
      }, [state.groups, t])

      const flat = useMemo(
        () => groups.flatMap(group => group.models.map(model => ({ group, model }))),
        [groups],
      )
      const now = state.current ?? null
      const currentIndex = now === null ? -1
        : flat.findIndex(entry => entry.group.id === now.provider && entry.model.id === now.model)
      const current = currentIndex >= 0 ? flat[currentIndex] : undefined
      const reasoning = current === undefined ? undefined : current.model.reasoning
      const effectiveEffort = now === null ? undefined : now.reasoningEffort ?? reasoning?.defaultEffort

      const effortLabel = current === undefined
        ? undefined
        : reasoning === undefined
          ? state.retainedEffort
          : effectiveEffort === undefined
            ? t('providerDefault')
            : (reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort)

      const effortChoices = useMemo(() => {
        if (reasoning === undefined) return []
        const choices = []
        if (reasoning.defaultEffort === undefined) {
          choices.push({ key: 'provider-default', effort: undefined, label: t('providerDefault') })
        }
        for (const level of reasoning.efforts) {
          choices.push({ key: `effort:${level.id}`, effort: level.id, label: level.name })
        }
        return choices
      }, [reasoning, t])

      const showSearch = flat.length > 4
      const trimmed = showSearch ? query.trim().toLowerCase() : ''
      const visible = useMemo(() => {
        const out = []
        for (const group of groups) {
          const scored = []
          for (const model of group.models) {
            const score = matchScore(model.name, trimmed)
            if (score >= 0) scored.push({ model, score })
          }
          if (scored.length === 0) continue
          scored.sort((a, b) => a.score - b.score)
          // 展开 group，让每个条目同时保留 id/name 和
          // 过滤后的 models。下游代码（分组标题、可选择的
          // 行、choose()）直接读取 entry.id/entry.name；
          // 在这里存成嵌套的 { group, models } 包装
          // 会静默产生 undefined 的提供商 id 和名字。
          out.push({ ...group, models: scored.map(item => item.model) })
        }
        return out
      }, [groups, trimmed])

      // 有搜索词时强制展开：结果被折叠藏起来就没有意义了。
      const searching = trimmed.length > 0
      const isCollapsed = (groupId) => !searching && collapsed.has(groupId)
      const anyExpanded = visible.some(group => !isCollapsed(group.id))
      const allCollapsed = visible.length > 0 && !anyExpanded

      const toggleGroup = (groupId) => {
        // 当前是收起的，点击后就是展开。
        const willExpand = collapsed.has(groupId)
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (next.has(groupId)) next.delete(groupId)
          else next.add(groupId)
          return next
        })
        // 展开某个分组时，滚动到它的第一条模型行，省得用户自己翻。
        if (willExpand) setScrollTarget(groupId)
      }

      const toggleAll = () => {
        setCollapsed((prev) => {
          // 全部已收起就全展开，否则全部收起。
          if (visible.every(group => prev.has(group.id))) return new Set()
          return new Set(visible.map(group => group.id))
        })
      }

      // 折叠的分组不进入键盘导航与 activeIndex。
      const visibleFlat = useMemo(
        () => visible.flatMap(group => (isCollapsed(group.id)
          ? []
          : group.models.map(model => ({ group, model })))),
        [visible, collapsed, searching],
      )
      const activeIndex = visibleFlat.length === 0 ? -1 : Math.min(Math.max(active, 0), visibleFlat.length - 1)
      const busy = state.pending !== null && state.pending !== undefined

      const close = (restoreFocus) => {
        setOpen(false)
        setQuery('')
        if (restoreFocus === true) queueMicrotask(() => { triggerRef.current?.focus() })
      }

      const announce = (text) => {
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text })
      }

      const settle = (result) => {
        if (result === undefined || result === null) return
        if (result.ok) { close(true); return }
        const code = result.error === undefined ? '' : result.error.code
        const message = result.error === undefined ? '' : result.error.message
        announce(code === 'session/writer-held' ? t('sessionInUse') : t('actionError', { message: `${code}: ${message}` }))
      }

      const submit = (selection) => {
        let outcome
        try {
          outcome = select(selection)
        } catch (error) {
          announce(t('actionError', { message: String(error?.message ?? error) }))
          return
        }
        if (outcome === undefined || outcome === null || typeof outcome.then !== 'function') return
        outcome.then(settle, (error) => {
          announce(t('actionError', { message: String(error?.message ?? error) }))
        })
      }

      const choose = (entry) => {
        if (now !== null && now.provider === entry.group.id && now.model === entry.model.id) {
          close(true)
          return
        }
        const defaultEffort = entry.model.reasoning?.defaultEffort
        // 只转发非空字符串的 effort；越出枚举或畸形的值
        // 会触发网关的请求边界校验，所以让
        // 后端应用默认值，而不是猜一个。
        const effort = typeof defaultEffort === 'string' && defaultEffort.length > 0 ? defaultEffort : undefined
        submit({
          provider: entry.group.id,
          model: entry.model.id,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
        })
      }

      const chooseEffort = (effort) => {
        if (now === null) return
        if (effectiveEffort === effort) { close(true); return }
        submit({
          provider: now.provider,
          model: now.model,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
        })
      }

      const show = () => {
        setQuery('')
        // 每次打开都恢复全展开：折叠状态只服务本次浏览，
        // 而且这样"打开即定位到选中项"才能一定找到那一行。
        setCollapsed(new Set())
        setActive(Math.max(0, currentIndex))
        setOpen(true)
        load()
      }

      // 外部点击关闭；固定的卡片位于触发器子树之外。
      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (rootRef.current?.contains(event.target) === true) return
          if (menuRef.current?.contains(event.target) === true) return
          setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return () => { document.removeEventListener('mousedown', onDown) }
      }, [open])

      // 从实时测量把固定卡片定位到触发器上方。
      useLayoutEffect(() => {
        if (!open) { setPos(null); return undefined }
        const place = () => {
          const rect = triggerRef.current?.getBoundingClientRect()
          if (rect === undefined) return
          const MARGIN = 12
          const width = menuRef.current?.offsetWidth ?? 0
          const height = menuRef.current?.offsetHeight ?? 0
          let x = rect.right - width
          let y = rect.top - 8 - height
          if (width > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - width - MARGIN)
          if (height > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - height - MARGIN)
          setPos({ left: x, top: y })
        }
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        const card = menuRef.current
        const observer = typeof ResizeObserver !== 'undefined' && card !== null ? new ResizeObserver(place) : null
        if (card !== null) observer?.observe(card)
        return () => {
          observer?.disconnect()
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open, state, query, visible])

      // 每次菜单打开，把当前选中项滚动到可见位置，
      // 而不是总是落在长目录的顶部。每次打开只执行一次；
      // 它会等待目录，因为选中行只在
      // 加载落地、分组渲染后才存在。
      useLayoutEffect(() => {
        if (!open) { centeredRef.current = false; return }
        if (centeredRef.current) return
        const scroller = scrollRef.current
        if (scroller === null) return
        const row = scroller.querySelector('[data-selected]')
        if (row === null) return
        const view = scroller.getBoundingClientRect()
        const box = row.getBoundingClientRect()
        // 已经完整可见：列表保持用户上次离开的位置不动。
        if (box.top < view.top || box.bottom > view.bottom) {
          // 否则把行居中；scrollTop 会在两端自然贴边。
          const offset = scroller.scrollTop + (box.top - view.top)
          scroller.scrollTop = offset - (view.height - box.height) / 2
        }
        centeredRef.current = true
      })

      // 展开某个分组后，把它的第一条行滚到滚动容器顶部。
      // 分组标题是 sticky，会贴在顶部，第一条行正好在它下方。
      useLayoutEffect(() => {
        if (scrollTarget === null) return
        const scroller = scrollRef.current
        if (scroller === null) return
        const groupEl = [...scroller.children].find(el => el.dataset?.group === scrollTarget)
        if (groupEl === undefined) return
        const row = groupEl.querySelector('.mss-row')
        if (row === null) return
        const view = scroller.getBoundingClientRect()
        const box = row.getBoundingClientRect()
        // sticky 分组标题会贴在滚动容器顶部，把它的高度算进去，
        // 否则第一条行会被标题遮住一截，看起来"还差一点才到第一个"。
        const headerHeight = groupEl.querySelector('.mss-group')?.offsetHeight ?? 0
        const topInContent = scroller.scrollTop + (box.top - view.top - scroller.clientTop)
        scroller.scrollTop = Math.max(0, topInContent - headerHeight - 4)
        setScrollTarget(null)
      }, [scrollTarget])

      // 临时的失败提示会自己消失。
      useEffect(() => {
        if (toast === null) return undefined
        const id = setTimeout(() => { setToast(null) }, 4000)
        return () => { clearTimeout(id) }
      }, [toast])

      const onKeyDown = (event) => {
        if (event.nativeEvent !== undefined && event.nativeEvent.isComposing === true) return
        // 分组标题与"全部展开/收起"是独立按钮：让它们自己处理 Enter/Space，
        // 不要在这里再当成"选中模型"处理。
        const origin = event.target
        if (origin instanceof Element
          && (origin.classList.contains('mss-group') || origin.classList.contains('mss-collapse-all'))) return
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          close(true)
          return
        }
        if (!open) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (visibleFlat.length === 0) return
          const direction = event.key === 'ArrowDown' ? 1 : -1
          const next = activeIndex < 0 ? 0 : (activeIndex + direction + visibleFlat.length) % visibleFlat.length
          setActive(next)
          const node = itemRefs.current[next]
          node?.scrollIntoView({ block: 'nearest' })
          node?.focus()
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const target = visibleFlat[activeIndex]
          if (target !== undefined && !busy) choose(target)
        }
      }

      // 只有被显式寻址的子代理会话才隐藏这个席位（官方
      // 选择器自己的规则）。其余所有状态都渲染一些
      // 可见内容：本条目遮蔽官方选择器，所以对意外值返回 null
      // 会让 composer 的模型选择器变空
      // 且背后没有任何东西接管。
      if (available === false) return null
      const unusable = directory === null

      const waiting = !unusable && current === undefined && state.status === 'loading'
      const providerLabel = current === undefined ? '' : current.group.name
      const modelLabel = waiting
        ? t('triggerLoading')
        : (current === undefined ? t('triggerFallback') : `${providerLabel} · ${current.model.name}`)
      const triggerAria = waiting
        ? t('triggerLoading')
        : current === undefined
          ? t('selectAria')
          : `${modelLabel}${effortLabel === undefined ? '' : ` · ${effortLabel}`}`

      try {
        return renderSeat()
      } catch (error) {
        // 最后兜底守卫：本条目遮蔽官方选择器，渲染抛错会
        // 让 composer 的整个模型席位变空白（框架的错误边界只会
        // 退役本条目，无法
        // 复活下面那个）。因此降级为可见但无反应的胶囊。
        console.error('model-select-skin: render failed; falling back to an inert chip', error)
        return h('div', { className: 'mss-root' },
          h('button', {
            type: 'button', className: 'mss-trigger', disabled: true,
            title: t('triggerFallback'), 'aria-label': t('triggerFallback'),
          }, h('span', { className: 'mss-name' }, t('triggerFallback'))))
      }

      function renderSeat() {
      let rowIndex = 0
      const emptyNode = h('div', { className: 'mss-empty', role: 'status' },
        t(state.status === 'ready' && flat.length > 0 ? 'searchEmpty' : 'emptyModels'))
      const groupNodes = visible.map((group) => {
        const collapsedNow = isCollapsed(group.id)
        // 收起时完全不渲染行：键盘导航与 activeIndex 也已排除它们，
        // 两边必须一致，否则方向键会跳到看不见的行上。
        const rows = collapsedNow ? null : group.models.map((model) => {
          const index = rowIndex
          rowIndex += 1
          const selected = now !== null && now.provider === group.id && now.model === model.id
          const pending = busy && state.pending.provider === group.id && state.pending.model === model.id
          const marker = pending ? h('span', { className: 'mss-spinner' }) : (selected ? h(CheckIcon) : null)
          // 提供商名字只放在 sticky 分组标题上；
          // 在每一行重复它是噪音。
          const copy = h('span', { className: 'mss-copy' },
            h('span', { className: 'mss-model' }, model.name),
            model.description === undefined ? null : h('span', { className: 'mss-desc' }, model.description))
          return h('button', {
            key: `${group.id}/${model.id}`,
            ref: (node) => { itemRefs.current[index] = node },
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': selected,
            className: 'mss-row',
            disabled: busy,
            title: model.name,
            ...(index === activeIndex ? { 'data-active': '' } : {}),
            ...(selected ? { 'data-selected': '' } : {}),
            onMouseMove: () => { if (!busy && index !== activeIndex) setActive(index) },
            onClick: () => { choose({ group, model }) },
          }, copy, h('span', { className: 'mss-check' }, marker))
        })
        return h('div', { key: group.id, 'data-group': group.id },
          h('button', {
            type: 'button',
            className: 'mss-group',
            // 分组标题本身是折叠开关；搜索期间强制展开，因此不可折叠。
            'aria-expanded': !collapsedNow,
            'aria-label': `${group.name}（${collapsedNow ? t('expandGroup') : t('collapseGroup')}）`,
            title: collapsedNow ? t('expandGroup') : t('collapseGroup'),
            disabled: searching,
            ...(collapsedNow ? { 'data-collapsed': '' } : {}),
            onClick: () => { toggleGroup(group.id) },
          },
          h(Dot, { id: group.id }),
          h('span', {
            className: 'mss-group-name',
            // 内联颜色，让可见性不依赖样式表
            // 是否被（重）写：分组标题位于 sticky
            // 覆盖层之后，某个与背景融合的 token 之前让"DeepSeek"
            // 在实际里隐形过。var 回退覆盖两个主题。
            style: { color: 'var(--dsw-alias-label-primary, #0f172a)', fontWeight: 600 },
          }, group.name),
          h('span', { className: 'mss-count' }, String(group.models.length)),
          h(CaretIcon)),
          rows)
      })


      const effortBlock = effortChoices.length === 0 ? null : [
        h('div', { className: 'mss-section', key: 'effort-label' }, t('effortSection')),
        h('div', { className: 'mss-efforts', key: 'effort-chips' }, effortChoices.map(choice =>
          h('button', {
            key: choice.key,
            type: 'button',
            className: 'mss-chip',
            disabled: busy,
            ...(effectiveEffort === choice.effort ? { 'data-on': '' } : {}),
            onClick: () => { chooseEffort(choice.effort) },
          }, choice.label))),
      ]
      // 一键全部展开/收起：只在有多个分组、且不在搜索态时出现。
      const collapseAllButton = visible.length > 1 && !searching
        ? h('button', {
          type: 'button',
          className: 'mss-collapse-all',
          'aria-label': allCollapsed ? t('expandAll') : t('collapseAll'),
          onClick: () => { toggleAll() },
        }, allCollapsed ? t('expandAll') : t('collapseAll'))
        : null
      // 按钮放进搜索行右侧：不额外占一行，也不撑宽菜单。
      // 没有搜索框时单独一行，但宽度仍由菜单固定值决定，不受影响。
      const searchBlock = showSearch
        ? h('div', { className: 'mss-search' }, h('input', {
          type: 'text',
          role: 'searchbox',
          value: query,
          placeholder: t('searchPlaceholder'),
          'aria-label': t('searchPlaceholder'),
          readOnly: busy,
          onChange: (event) => { setQuery(event.target.value); setActive(0) },
        }), collapseAllButton)
        : (collapseAllButton === null
          ? null
          : h('div', { className: 'mss-search' }, collapseAllButton))
      const statusBlock = state.status === 'loading' ? h('div', { className: 'mss-status' }, t('loading')) : null
      const errorBlock = state.status === 'error' && state.error !== null && state.error !== undefined
        ? h('div', { className: 'mss-error' },
          h('span', null, t('actionError', { message: state.error })),
          h('button', { type: 'button', className: 'mss-retry', onClick: () => { load() } }, t('retry')))
        : null
      const failureBlocks = (state.failures ?? []).map(failure => h('div', { className: 'mss-error', key: failure.id },
        h('span', null, t('groupLoadError', {
          name: failure.id === ACCOUNT_PROVIDER ? t('providerAccount') : failure.name,
          message: failure.message,
        })),
        h('button', { type: 'button', className: 'mss-retry', onClick: () => { load() } }, t('retry'))))
      const toastBlock = toast === null ? null : h('div', { className: 'mss-toast', role: 'status' }, toast.text)

      const trigger = h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'mss-trigger',
        title: triggerAria,
        'aria-label': triggerAria,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-busy': busy,
        ...(unusable ? { 'data-unusable': '' } : {}),
        disabled: locked === true || unusable,
        ...(open ? { 'data-open': '' } : {}),
        onClick: () => { if (unusable) return; if (open) close(true); else show() },
      },
      h(ModelGlyph),
      current === undefined ? null : h(Dot, { id: current.group.id }),
      h('span', { className: 'mss-name' }, modelLabel),
      effortLabel === undefined ? null : h('span', { className: 'mss-effort' }, effortLabel),
      busy ? h('span', { className: 'mss-spinner', 'aria-hidden': true }) : h(ChevronIcon, { open }))

      // 通过 createPortal 挂到 body，这样 composer 卡片的溢出不会裁剪
      // 卡片；React 合成事件仍能从这个子树冒泡，
      // 从而让根元素的 onKeyDown/onBlur 保持生效。
      const menu = open ? createPortal(h('div', {
        ref: menuRef,
        className: 'mss-menu',
        role: 'menu',
        'aria-label': t('menuAria'),
        'aria-busy': state.status === 'loading' || busy,
        style: pos ?? { visibility: 'hidden', left: 0, top: 0 },
      },
      effortBlock,
      searchBlock,
      statusBlock,
      errorBlock,
      failureBlocks,
      h('div', { className: 'mss-scroll', ref: scrollRef }, visible.length === 0 ? emptyNode : groupNodes)), document.body) : null

      return h('div', {
        ref: rootRef,
        className: 'mss-root',
        onKeyDown,
        onBlur: (event) => {
          const next = event.relatedTarget
          if (next instanceof Node
            && (rootRef.current?.contains(next) === true || menuRef.current?.contains(next) === true)) return
          close(false)
        },
        onMouseDown: (event) => {
          // WebKit 会在点击前让聚焦的行失焦，除非 mousedown 保持焦点。
          if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault()
        },
      }, trigger, menu, toastBlock)
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // 字典和样式表都是本插件自身运行的 effect。
        ctx.effect(() => ctx.locale.register(NS, DICT), 'model-select-skin: dictionaries')
        ctx.effect(() => insertStyle(), 'model-select-skin: stylesheet')

        // 遮蔽官方席位：最低优先级先渲染，所以 -1 胜过
        // 官方入口默认的 0，且不触碰官方入口。
        // `remote`、`remote.session`、`sessions` 都在这里声明（对照
        // 官方选择器自己的清单），因为
        // `modelDirectories.directoryFor()` 在服务内部会访问 `remote.session`。
        // Cordis 按*字面量*属性路径守卫嵌套访问，
        // 所以只声明 `"remote"` 不够；没有精确的 `"remote.session"` 注入时调用会抛
        // 「cannot get property "remote.session" without inject」。
        ctx.inject(['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'], (scope) => {
          scope.slots.inject('conversation.input.model', () => scope.slots.register({
            name: 'conversation.input.model',
            // 任何低于官方入口默认 0 的优先级都会遮蔽它
            // （最低优先级先渲染）。用一个较大的负数，避开
            // 动态外观自动分配的 rank（从 -1 向下递减）；
            // 与完全相同的优先级会抛错而不是遮蔽。
            priority: -1000,
            locale: NS,
            inject: (sessionId) => {
              // 被寻址的子代理会话没有模型席位——与官方
              // 选择器相同的规则。探测做了守卫，失败时保持
              // 打开（席位可见）：抛错的探测绝不能成为
              // 本插件悄悄隐藏 composer 模型选择器的原因。
              let available = true
              try {
                available = scope.sessions.subagentAddress(sessionId) === undefined
              } catch (error) {
                console.error('model-select-skin: subagent probe failed; keeping the seat visible', error)
              }
              // 延迟解析且绝不缓存失败。`directoryFor` 会抛错
              // 当会话的作用域或绑定还不可解析时，且
              // 注入工厂本身对每个（条目 × 会话）只运行一次。
              // 永久返回 null 目录会让这个条目——
              // 遮蔽的胜者——在整页生命周期里渲染一个无反应胶囊。
              // 组件改为通过这个函数重试。
              let directory = null
              // 临时不可解析状态只记录一次：组件
              // 每秒重试一次，每次都重新记录会刷爆
              // 控制台。硬性的配置错误（例如本条目从未注入的服务）
              // 会被单独记录，且不会自愈。
              let loggedUnresolvable = false
              const resolve = () => {
                if (directory !== null) return directory
                try {
                  directory = scope.modelDirectories.directoryFor(sessionId)
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error)
                  if (!loggedUnresolvable) {
                    loggedUnresolvable = true
                    if (/without inject/.test(message)) {
                      console.error('model-select-skin: model directory needs an injected service that this bundle does not declare; the model picker will stay inert. Declare the missing service in dsh.client.inject.', error)
                    } else {
                      console.warn('model-select-skin: model directory not resolvable yet (will retry until the session scope is ready)')
                    }
                  }
                  return null
                }
                // 解析成功：之前的警告不应再作为
                // 唯一控制台信号残留，所以确认一次恢复。
                if (loggedUnresolvable) {
                  loggedUnresolvable = false
                  console.info('model-select-skin: model directory resolved')
                }
                return directory
              }
              resolve()
              return {
                available,
                directory: directory === null ? null : directory.store,
                resolve,
                load: () => {
                  if (!available) return
                  const target = resolve()
                  if (target === null) return
                  target.load().catch(() => { /* 显示在共享 store 上 */ })
                },
                select: (selection) => {
                  if (!available) return Promise.resolve(undefined)
                  const target = resolve()
                  if (target === null) return Promise.resolve(undefined)
                  return target.select(selection)
                },
              }
            },
          }, ModelSkin))
        })
      },
    }
  },
})
