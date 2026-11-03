#!/usr/bin/env node
/**
 * 状态栏换色时序护栏。
 *
 * 为什么需要它：网页切换深浅外观时，原生侧必须把「状态栏/窗口底色」的更换排到
 * WebView 后面那一帧，而不是立即执行。真机逐帧实测（状态栏与页面各取众数色）：
 * 网页改完 data-zp-theme 后 WebView 还要 1 帧才把新色合成上屏，而 DecorView
 * setBackgroundColor 是立即 invalidate、当帧就画出来 —— 两边差 1 帧，屏幕上
 * 就是「状态栏已换色、页面还是旧色」的一条错色带（浅切深像顶部闪一道白）。
 *
 * 关键细节：**单次 postOnAnimation 等于没延迟**。它的回调排在 Choreographer 的
 * ANIMATION 阶段，同一帧随后的 TRAVERSAL 就会重绘 —— v1.0.30 只写了一跳，
 * 用户装上去错色带照旧（实测间隔还是 16ms）。必须嵌套两次才会登记到下一帧。
 *
 * 这类退化不会报错、不会崩溃，`applyChrome` 的单测也依然全绿：
 *   - 改回 runOnUiThread 立即执行 → 错色带回来；
 *   - 只写一跳 postOnAnimation → 同上，且看起来「已经修了」；
 *   - 去掉 isAttachedToWindow 兜底 → WebView 未挂载时状态栏永远不更新。
 * 所以把这几条约束固化成断言。
 *
 * 用法：node scripts/check-statusbar-sync.mjs
 * 退出码：0 通过；1 有破坏。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const SOURCES = [
  "android/app/src/main/java/com/tianbops/zhipei/MainActivity.java",
  "android-template/app/src/main/java/com/tianbops/zhipei/MainActivity.java",
];

const errors = [];

/** 去掉注释：注释里提到 postOnAnimation 不代表代码真的用了它。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 取出 methodName 方法体（按大括号配平，跳过字符串/注释里的括号足够用）。 */
function methodBody(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

for (const rel of SOURCES) {
  const file = path.join(REPO, rel);
  let src;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch (e) {
    errors.push(`无法读取 ${rel}（${e.code || e.message}）`);
    continue;
  }

  const applyThemeRaw = methodBody(src, "public void applyTheme(");
  if (!applyThemeRaw) {
    errors.push(`${rel}: 找不到 NativeChrome.applyTheme(String, boolean)`);
    continue;
  }
  const applyTheme = stripComments(applyThemeRaw);

  if (!applyTheme.includes("postOnAnimation")) {
    errors.push(
      `${rel}: applyTheme 必须用 postOnAnimation 把换色排到后面的合成帧；` +
      `直接 runOnUiThread 会让状态栏比页面早 1 帧变色`
    );
  }
  // 必须是**两跳**：Choreographer 的 ANIMATION 阶段之后同帧就 TRAVERSAL，
  // 单跳等于立即执行（v1.0.30 实测只有单跳，错色带仍然在，间隔还是 16ms）。
  const hops = (applyTheme.match(/postOnAnimation/g) || []).length;
  if (applyTheme.includes("postOnAnimation") && hops < 2) {
    errors.push(
      `${rel}: applyTheme 的 postOnAnimation 必须嵌套两次（当前 ${hops} 次）。` +
      `单跳的回调与绘制在同一帧，净延迟为 0，状态栏仍会比页面早 1 帧`
    );
  }
  if (!applyTheme.includes("isAttachedToWindow")) {
    errors.push(
      `${rel}: applyTheme 必须有 isAttachedToWindow 判断——WebView 未挂载时没有帧可对齐，` +
      `必须退回立即执行，否则状态栏永远停在旧色`
    );
  }
  if (!applyTheme.includes("applyChrome")) {
    errors.push(`${rel}: applyTheme 最终必须调用 applyChrome 完成染色`);
  }
  if (!applyTheme.includes("parseColor")) {
    errors.push(`${rel}: applyTheme 必须经 parseColor 校验色值，非法入参不得直接进染色通道`);
  }

  // 兜底分支必须存在且可达：applyTheme 内应当同时出现 postOnAnimation 与 runOnUiThread。
  if (applyTheme.includes("postOnAnimation") && !applyTheme.includes("runOnUiThread")) {
    errors.push(`${rel}: applyTheme 缺少 runOnUiThread 兜底分支（WebView 未挂载时会静默不换色）`);
  }

  // applyChrome 必须同时改「窗口背景 / WebView 背景 / 状态栏图标 / 导航栏」四件，缺一件都会露出旧色。
  const applyChromeRaw = methodBody(src, "private void applyChrome(");
  if (!applyChromeRaw) {
    errors.push(`${rel}: 找不到 applyChrome(int, boolean)`);
  } else {
    const applyChrome = stripComments(applyChromeRaw);
    const required = [
      ["getDecorView().setBackgroundColor", "窗口（透明状态栏后方）底色"],
      ["setNavigationBarColor", "导航栏底色"],
      ["setAppearanceLightStatusBars", "状态栏图标明暗"],
      ["setAppearanceLightNavigationBars", "导航栏图标明暗"],
    ];
    for (const [needle, label] of required) {
      if (!applyChrome.includes(needle)) errors.push(`${rel}: applyChrome 缺少 ${label}（${needle}）`);
    }
  }
}

if (errors.length) {
  console.error("✗ 状态栏换色时序护栏未通过：");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ 状态栏换色时序护栏通过（两跳 postOnAnimation + 未挂载兜底 + 四件套染色）");
