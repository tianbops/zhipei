#!/usr/bin/env node
/**
 * 原生模板漂移护栏
 * ------------------------------------------------------------------
 * 背景（2026-10-28 发现的实据问题）：
 *   README 写明 `android-template/` 是「被覆盖进 android/ 的原生配置」，
 *   即模板是原生部分的**真值源**。但实际开发里改动都直接落在 android/ 上，
 *   模板从 `v1.0.14` 之后再没同步过，到发现时已经漂移：
 *       MainActivity.java：模板 163 行 / 实际 392 行（+249 -20）
 *       · 模板只注册了 1 个 @JavascriptInterface（applyTheme）
 *       · 实际有 7 个：getClipboardText / setFontScale / 下载监听 / applyTheme …
 *       AndroidManifest.xml：allowBackup true→false、usesCleartextTraffic true→false、
 *                            外置存储权限声明差异
 *   这意味着任何人按 README 执行一次「用模板覆盖 android/」，App 会立刻丢掉
 *   6 项原生能力（剪贴板读取读不到 → 一键粘贴失效），而且是**静默失效**，
 *   构建仍然成功、CI 仍然绿 —— 与 check-bridge 要防的那类事故同源。
 *
 * 本护栏：逐个文件比对 android-template/ 与 android/ 的对应内容，任何不一致即失败，
 * 强制开发者在改完原生后显式同步模板（或反过来明晰地把某文件标记为豁免）。
 *
 * 用法：node scripts/check-template-drift.mjs
 * 退出码：0 = 无漂移；1 = 存在漂移（CI 应失败）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

/** 需要保持同步的相对路径（模板 <-> 实际 android/） */
const SYNC_FILES = [
  "app/src/main/AndroidManifest.xml",
  "app/src/main/java/com/tianbops/zhipei/MainActivity.java",
  "app/src/main/res/values/colors.xml",
  "app/src/main/res/values/strings.xml",
  "app/src/main/res/values/styles.xml",
];

/**
 * 豁免清单：确实允许模板与 android/ 不一致的文件（例如 Capacitor 自动生成、
 * 或仅在模板侧保留占位）。**每加一条都要写明理由**，否则等于把护栏拆了。
 */
const EXEMPT = [];

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

function main() {
  const rows = [];
  for (const rel of SYNC_FILES) {
    if (EXEMPT.includes(rel)) continue;
    const tplPath = path.join(REPO, "android-template", rel);
    const appPath = path.join(REPO, "android", rel);
    const tpl = read(tplPath);
    const app = read(appPath);
    if (tpl === null || app === null) {
      rows.push({
        rel,
        status: "MISSING",
        detail: `模板:${tpl === null ? "缺" : "有"} android/:${
          app === null ? "缺" : "有"
        }`,
      });
      continue;
    }
    rows.push({
      rel,
      status: tpl === app ? "OK" : "DRIFT",
      detail:
        tpl === app
          ? `${tpl.split("\n").length} 行一致`
          : `模板 ${tpl.split("\n").length} 行 / android/ ${app.split("\n").length} 行`,
    });
  }

  // 顺带记录桥接方法数，直观体现"丢了几个原生能力"
  const mainActivity = path.join(REPO, "android", "app/src/main/java/com/tianbops/zhipei/MainActivity.java");
  const tplMainActivity = path.join(REPO, "android-template", "app/src/main/java/com/tianbops/zhipei/MainActivity.java");
  const countBridges = (p) => {
    const src = read(p);
    return src ? (src.match(/@JavascriptInterface/g) || []).length : -1;
  };
  const appBridges = countBridges(mainActivity);
  const tplBridges = countBridges(tplMainActivity);

  console.log("原生模板 ↔ android/ 同步状态：");
  for (const r of rows) {
    console.log(
      `  ${r.status === "OK" ? "✓" : "✗"} [${r.status.padEnd(7)}] ${r.rel} — ${r.detail}`
    );
  }
  console.log(
    `\n  @JavascriptInterface 桥接方法：android/ ${appBridges} 个 / android-template/ ${tplBridges} 个`
  );

  const drifted = rows.filter((r) => r.status !== "OK");
  if (drifted.length) {
    console.error(
      `\n✗ 检测到 ${drifted.length} 个文件漂移。模板是 README 定义的真值源，漂移意味着` +
        `\n   「用模板覆盖 android/」会静默丢掉原生能力。` +
        `\n   修复：把 android/ 的最新内容同步回 android-template/，或在本脚本 EXEMPT 中写明豁免理由。`
    );
    process.exit(1);
  }
  console.log("\n✓ 原生模板与 android/ 完全同步（无漂移）");
  process.exit(0);
}

main();
