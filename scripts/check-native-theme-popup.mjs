#!/usr/bin/env node
/**
 * 原生弹层主题契约：
 * Web 外观可以独立于系统外观切换。Android WebView 的 select/date 原生弹层
 * 不保证读取 CSS color-scheme，因此宿主 Activity 必须同步 AppCompat uiMode。
 * 这里锁住桥接、宿主主题、DayNight 资源和模板一致性，防止深色模式再次出现白底弹窗。
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const errors = [];
const check = (ok, message) => { if (!ok) errors.push(message); else console.log("✓ " + message); };

const mainPath = "android/app/src/main/java/com/tianbops/zhipei/MainActivity.java";
const templatePath = "android-template/app/src/main/java/com/tianbops/zhipei/MainActivity.java";
const main = read(mainPath);
const template = read(templatePath);
const manifest = read("android/app/src/main/AndroidManifest.xml");
const templateManifest = read("android-template/app/src/main/AndroidManifest.xml");
const styles = read("android/app/src/main/res/values/styles.xml");
const templateStyles = read("android-template/app/src/main/res/values/styles.xml");
const colors = read("android/app/src/main/res/values/colors.xml");
const nightColors = read("android/app/src/main/res/values-night/colors.xml");
const templateColors = read("android-template/app/src/main/res/values/colors.xml");
const templateNightColors = read("android-template/app/src/main/res/values-night/colors.xml");

check(main === template, "MainActivity 与 android-template 原生模板逐字节一致");
check(manifest === templateManifest, "AndroidManifest 与原生模板逐字节一致");
check(styles === templateStyles, "styles.xml 与原生模板逐字节一致");
check(colors === templateColors && nightColors === templateNightColors, "日间/夜间颜色资源与原生模板一致");
check(/Theme\.AppCompat\.DayNight\.NoActionBar/.test(styles), "宿主主题使用 AppCompat DayNight");
check(/configChanges="[^"]*uiMode/.test(manifest), "Activity 接收 uiMode 配置变化，不因主题同步重建页面");

const applyStart = main.indexOf("private void applyChrome(");
const applyEnd = main.indexOf("\n    private static int parseColor", applyStart);
const applyBody = applyStart >= 0 ? main.slice(applyStart, applyEnd > applyStart ? applyEnd : undefined) : "";
check(/AppCompatDelegate\.setDefaultNightMode\(darkBg\s*\?\s*AppCompatDelegate\.MODE_NIGHT_YES\s*:\s*AppCompatDelegate\.MODE_NIGHT_NO\)/.test(applyBody),
  "applyChrome 将 Web 深浅主题同步到 AppCompat uiMode");
check(/setAppearanceLightStatusBars\(!darkBg\)/.test(applyBody) && /setAppearanceLightNavigationBars\(!darkBg\)/.test(applyBody),
  "状态栏与导航栏图标明暗跟随同一主题");
check(/public void applyTheme\(String colorHex, boolean darkBg\)/.test(main) && /runOnUiThread\(\(\) -> applyChrome\(color, darkBg\)\)/.test(main),
  "applyTheme 原生桥存在且在 UI 线程更新主题");
check(/splashBackground/.test(colors) && /#F6F7F9/i.test(colors) && /#121826/i.test(nightColors),
  "启动屏日间/夜间底色分别与 Web 浅色/深色背景一致");

if (errors.length) {
  console.error("\n✗ 原生弹层主题契约失败：");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}
console.log("\n✓ 原生弹层主题同步契约完整");
