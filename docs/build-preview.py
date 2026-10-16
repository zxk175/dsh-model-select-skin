#!/usr/bin/env python3
"""生成 README 用的界面截图。

做法：把 `client.js` 里的真实 CSS 与 DSH 主题的真实 token 拼成一个静态页面，
再用无头 Chrome 截图。因此图中的样式与实际插件完全一致（模型名与提供商名
是示意数据，取自真实目录快照）。

用法：
    python3 docs/build-preview.py [DSH 检出目录]

默认从 /Volumes/ZT-7100/Script/DsHarness/deepseek-harness 读取主题 token；
也可用参数或 DSH_CHECKOUT 环境变量指定。
"""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
PLUGIN_DIR = HERE.parent
CLIENT = PLUGIN_DIR / 'client.js'
CHECKOUT = pathlib.Path(
    sys.argv[1] if len(sys.argv) > 1
    else os.environ.get('DSH_CHECKOUT', '/Volumes/ZT-7100/Script/DsHarness/deepseek-harness')
)
THEME_CSS = CHECKOUT / 'packages/client/ui-theme/src/styles/design-platform.css'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def extract_css() -> str:
    """从 client.js 里取出插件样式表（const CSS = `...`）。"""
    src = CLIENT.read_text(encoding='utf-8')
    m = re.search(r'const CSS = `(.*?)`\n', src, re.DOTALL)
    if m is None:
        raise SystemExit('未能从 client.js 提取 CSS')
    return m.group(1)


def extract_theme() -> tuple[str, str]:
    """从 design-platform.css 取出浅色与深色的 token 块。"""
    lines = THEME_CSS.read_text(encoding='utf-8').split('\n')

    def block(start: int) -> str:
        depth, out, started = 0, [], False
        for ln in lines[start:]:
            out.append(ln)
            depth += ln.count('{') - ln.count('}')
            if '{' in ln:
                started = True
            if started and depth <= 0:
                break
        return '\n'.join(out)

    light_idx = next(i for i, l in enumerate(lines) if l.strip() == 'body {')
    dark_idx = next(i for i, l in enumerate(lines) if l.startswith('body[data-ds-dark-theme]'))
    return block(light_idx), block(dark_idx)


# 主题里分散在别处的少量 token，这里补齐以还原真实观感。
EXTRA = """
body{--dsw-radius-md:8px;--dsw-radius-lg:12px;
--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
--dsw-elevation-stroke:0 0 0 .5px var(--dsw-elevation-stroke-color);
--dsw-elevation-prominent:var(--dsw-elevation-stroke),0 3px 8px 0 rgba(0,0,0,.04),0 0 20px 0 rgba(0,0,0,.05);
--dsw-menu-backdrop-filter:blur(40px) saturate(150%);
--dsw-alias-scrollbar-bg-l2:rgba(0,0,0,.2);--dsw-alias-scrollbar-hover-l2:rgba(0,0,0,.3);}
"""

# 与 client.js 的 PROVIDER_COLORS 保持一致
DOT = {'DeepSeek': '#4d6bfe', 'SenseNova': '#00b96b'}

CHECK = ('<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
         '<path d="M3.2 8.4 6.3 11.4 12.8 4.9" fill="none" stroke="currentColor" '
         'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')
GLYPH = ('<svg class="mss-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
         '<rect x="2.5" y="4" width="11" height="8" rx="2.5" fill="none" stroke="currentColor" '
         'stroke-width="1.4"/></svg>')
CHEV = ('<svg class="mss-chevron" data-open viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">'
        '<path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke="currentColor" stroke-width="1.5" '
        'stroke-linecap="round" stroke-linejoin="round"/></svg>')

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
{light}
{dark}
{extra}
{mss}
html,body{{margin:0;height:100%;font-family:-apple-system,"PingFang SC",system-ui,sans-serif;}}
body{{background:linear-gradient(160deg,#eef2f7,#e2e8f0 55%,#dbe3ee);display:flex;align-items:center;justify-content:center;}}
body[data-ds-dark-theme]{{background:linear-gradient(160deg,#26272b,#1c1d21 55%,#17181c);}}
.stage{{position:relative;width:760px;height:392px;}}
.composer{{position:absolute;left:30px;right:30px;bottom:30px;height:96px;border-radius:22px;
background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
box-shadow:0 8px 30px rgba(15,23,42,.08);display:flex;align-items:flex-end;padding:0 16px 14px;gap:12px;}}
.hint{{color:var(--dsw-alias-label-caption);font-size:13px;margin-bottom:5px;}}
.mss-root{{margin-bottom:3px;}}
.mss-menu{{position:absolute;left:30px;bottom:126px;visibility:visible;}}
</style></head><body{bodyattr}>
<div class="stage">
  <div class="composer">
    <span class="hint">输入消息…</span>
    <div class="mss-root">
      <button type="button" class="mss-trigger" aria-expanded="true">
        {glyph}
        <span class="mss-dot" style="background:{dot}"></span>
        <span class="mss-name">DeepSeek · DeepSeek-V4.1-Flash</span>
        <span class="mss-effort">High</span>
        {chev}
      </button>
    </div>
  </div>
  <div class="mss-menu" role="menu">
    <div class="mss-section">思考档位</div>
    <div class="mss-efforts">
      <button type="button" class="mss-chip">Low</button>
      <button type="button" class="mss-chip" data-on>High</button>
    </div>
    <div class="mss-search"><input placeholder="搜索模型" /></div>
    <div class="mss-scroll">
      {groups}
    </div>
  </div>
</div>
</body></html>
"""


def row(model: str, desc: str | None = None, selected: bool = False) -> str:
    copy = f'<span class="mss-model">{model}</span>'
    if desc:
        copy += f'<span class="mss-desc">{desc}</span>'
    check = f'<span class="mss-check">{CHECK}</span>' if selected else ''
    attr = ' data-selected' if selected else ''
    return (f'<button type="button" class="mss-row"{attr}>'
            f'<span class="mss-copy">{copy}</span>{check}</button>')


def group(name: str, count: int, rows: list[str]) -> str:
    return (f'<div><div class="mss-group">'
            f'<span class="mss-dot" style="background:{DOT[name]}"></span>'
            f'<span class="mss-group-name">{name}</span>'
            f'<span class="mss-count">{count}</span></div>{"".join(rows)}</div>')


def build(light: str, dark: str, mss: str, dark_mode: bool) -> str:
    groups = (
        group('DeepSeek', 2, [
            row('DeepSeek-V4.1-Flash', selected=True),
            row('DeepSeek-V4-Pro',
                'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex work.'),
        ])
        + group('SenseNova', 9, [row('deepseek-v4-flash'), row('glm-5.2')])
    )
    return PAGE.format(
        light=light, dark=dark, extra=EXTRA, mss=mss, groups=groups,
        glyph=GLYPH, chev=CHEV, dot=DOT['DeepSeek'],
        bodyattr=' data-ds-dark-theme' if dark_mode else '',
    )


def main() -> None:
    if not THEME_CSS.exists():
        raise SystemExit(f'未找到主题文件：{THEME_CSS}\n请把 DSH 检出目录作为参数传入。')
    mss = extract_css()
    light, dark = extract_theme()

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = pathlib.Path(tmp)
        for name, dark_mode in (('light', False), ('dark', True)):
            html = tmpdir / f'demo-{name}.html'
            html.write_text(build(light, dark, mss, dark_mode), encoding='utf-8')
            out = HERE / f'preview-{name}.png'
            subprocess.run([
                CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                '--force-device-scale-factor=2', '--window-size=900,500',
                f'--screenshot={out}', html.as_uri(),
            ], check=True, stderr=subprocess.DEVNULL)
            print(f'已生成 {out.relative_to(PLUGIN_DIR)}')


if __name__ == '__main__':
    main()
