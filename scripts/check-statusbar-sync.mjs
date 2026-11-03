#!/usr/bin/env node
/**
 * 状态栏换色护栏（结构 + 时序）。
 *
 * ## 结构（2026-11-04 起，最重要的一条）
 * 状态栏那块像素**只能有一个绘制者**。历史上 WebView 用上外边距让位，露出的是
 * DecorView 原生底色，于是页面与原生各画一半：原生换色下一个 vsync 就上屏，
 * 页面还要多一帧合成，屏幕上就永远有一条错色带。
 *
 * 三次尝试都在调「原生延后多久」（立即 → 1 跳 → 2 跳），每次只差一拍，说明方向错了：
 * 不是谁画得早晚，而是**本来就不该有两个绘制者**。
 *
 * 现在的结构（Android 15 起 Chrome / Gmail / Telegram 一致）：WebView 铺满全屏，
 * 状态栏区域由页面画固定色带，原生只负责图标明暗。这一层如果被改回去
 * （顶部重新让位），错色带会立刻复现，而且**不报错、不崩溃、单测全绿**：
 *   - `applyInsetsMargins(webView, 0, ...)` 的 0 被改回 topBars.top → 两层结构回归；
 *   - 删掉 `statusBarInset()` → 页面拿不到高度，色带塌成 0，页面顶到状态栏图标下；
 *   - `statusBarInsetPx` 去掉 volatile → JS 桥线程可能读到旧值。
 *
 * ## 时序（保留自 v1.0.31）
 * 原生底色/图标仍要排到 WebView 后面那一帧。**单次 postOnAnimation 等于没延迟**：
 * 它的回调排在 Choreographer 的 ANIMATION 阶段，同帧随后的 TRAVERSAL 就重绘。
 * v1.0.30 只写一跳，用户装上后错色带照旧（实测间隔仍 16ms）。必须嵌套两次。
 * 结构改对之后这条只影响细线图标与兜底底色，不再是整条色带。
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
  const code = stripComments(src);

  // ---- 结构：顶部不得让位 ----
  if (!/applyInsetsMargins\(\s*webView\s*,\s*0\s*,/.test(code)) {
    errors.push(
      `${rel}: 顶部 inset 必须归零（applyInsetsMargins(webView, 0, ...)）。` +
      `让位后状态栏区域露出 DecorView 原生底色，与 WebView 形成两个绘制者，错色带必然回归`
    );
  }

  // ---- 结构：状态栏高度必须能传给网页 ----
  const insetRaw = methodBody(src, "public int statusBarInset(");
  if (!insetRaw) {
    errors.push(
      `${rel}: 找不到 NativeChrome.statusBarInset()。网页靠它既做能力协商、又取色带高度；` +
      `缺失会让页面退回旧布局（或色带塌成 0，内容被状态栏图标压住）`
    );
  } else {
    const before = src.slice(0, src.indexOf("public int statusBarInset("));
    if (!/@JavascriptInterface\s*$/.test(before.trimEnd())) {
      errors.push(`${rel}: statusBarInset() 缺少 @JavascriptInterface，网页读不到（会静默返回 undefined）`);
    }
    if (!stripComments(insetRaw).includes("statusBarInsetPx")) {
      errors.push(`${rel}: statusBarInset() 必须返回 statusBarInsetPx（不要另算一份，避免与 inset 监听不同源）`);
    }
  }
  if (!/private\s+volatile\s+int\s+statusBarInsetPx/.test(code)) {
    errors.push(`${rel}: statusBarInsetPx 必须是 volatile —— JS 桥线程读、UI 线程写`);
  }

  // ---- 时序：applyTheme 两跳 ----
  const applyThemeRaw = methodBody(src, "public void applyTheme(");
  if (!applyThemeRaw) {
    errors.push(`${rel}: 找不到 NativeChrome.applyTheme(String, boolean)`);
    continue;
  }
  const applyTheme = stripComments(applyThemeRaw);

  if (!applyTheme.includes("postOnAnimation")) {
    errors.push(
      `${rel}: applyTheme 必须用 postOnAnimation 把换色排到后面的合成帧；` +
      `直接 runOnUiThread 会让原生比页面早 1 帧变色`
    );
  }
  const hops = (applyTheme.match(/postOnAnimation/g) || []).length;
  if (applyTheme.includes("postOnAnimation") && hops < 2) {
    errors.push(
      `${rel}: applyTheme 的 postOnAnimation 必须嵌套两次（当前 ${hops} 次）。` +
      `单跳的回调与绘制在同一帧，净延迟为 0`
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
  if (applyTheme.includes("postOnAnimation") && !applyTheme.includes("runOnUiThread")) {
    errors.push(`${rel}: applyTheme 缺少 runOnUiThread 兜底分支（WebView 未挂载时会静默不换色）`);
  }

  // ---- applyChrome 必须四件套齐全 ----
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
  console.error("✗ 状态栏护栏未通过：");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ 状态栏护栏通过（单绘制者结构：顶部不让位 + statusBarInset 能力协商 + 两跳时序 + 四件套染色）");
