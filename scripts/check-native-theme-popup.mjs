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
const nightStyles = read("android/app/src/main/res/values-night/styles.xml");
const templateNightStyles = read("android-template/app/src/main/res/values-night/styles.xml");const colors = read("android/app/src/main/res/values/colors.xml");
const nightColors = read("android/app/src/main/res/values-night/colors.xml");
const templateColors = read("android-template/app/src/main/res/values/colors.xml");
const templateNightColors = read("android-template/app/src/main/res/values-night/colors.xml");

check(main === template, "MainActivity 与 android-template 原生模板逐字节一致");
check(manifest === templateManifest, "AndroidManifest 与原生模板逐字节一致");
check(styles === templateStyles, "styles.xml 与原生模板逐字节一致");
check(nightStyles === templateNightStyles, "values-night/styles.xml 与原生模板逐字节一致");
check(/android:statusBarColor/.test(styles) && /@android:color\\/transparent/.test(styles), "日间主题声明透明状态栏");
check(/android:windowLightStatusBar">true<\\/item>/.test(styles), "日间主题默认使用深色状态栏图标");
check(/android:statusBarColor/.test(nightStyles) && /@android:color\\/transparent/.test(nightStyles), "夜间主题声明透明状态栏");
check(/android:windowLightStatusBar">false<\\/item>/.test(nightStyles), "夜间主题默认使用浅色状态栏图标");
check(colors === templateColors && nightColors === templateNightColors, "日间/夜间颜色资源与原生模板一致");
check(/Theme\.AppCompat\.DayNight\.NoActionBar/.test(styles), "宿主主题使用 AppCompat DayNight");
check(/configChanges="[^"]*uiMode/.test(manifest), "Activity 接收 uiMode 配置变化，不因主题同步重建页面");

const applyStart = main.indexOf("private void applyChrome(");
const applyEnd = main.indexOf("\n    private static int parseColor", applyStart);
const applyBody = applyStart >= 0 ? main.slice(applyStart, applyEnd > applyStart ? applyEnd : undefined) : "";
const configureStart = main.indexOf("private void configureTransparentStatusBar()");
const configureEnd = main.indexOf("\\n    /**", configureStart);
const configureBody = configureStart >= 0 ? main.slice(configureStart, configureEnd > configureStart ? configureEnd : undefined) : "";
check(/configureTransparentStatusBar\\(\\)/.test(main), "Activity 创建时启用透明状态栏配置");
check(/WindowCompat\\.setDecorFitsSystemWindows\\(getWindow\\(\\), false\\)/.test(configureBody)
  && /setStatusBarColor\\(Color\\.TRANSPARENT\\)/.test(configureBody),
  "Edge-to-Edge 与透明状态栏在首帧初始化阶段统一配置");
check(!/setStatusBarColor\\(/.test(applyBody) && !/setStatusBarContrastEnforced\\(/.test(applyBody),
  "主题切换期间不重复写状态栏背景或对比度策略");
check(/setAppearanceLightStatusBars\\(!darkBg\\)/.test(applyBody) && /setAppearanceLightNavigationBars\\(!darkBg\\)/.test(applyBody),
  "状态栏与导航栏图标明暗跟随当前主题");
check(/AppCompatDelegate\\.getDefaultNightMode\\(\\)\\s*!=\\s*desiredNightMode/.test(applyBody)
  && /AppCompatDelegate\\.setDefaultNightMode\\(desiredNightMode\\)/.test(applyBody),
  "原生 DayNight 外观仅在主题实际变化时更新，避免重复重配置");
check(/getSharedPreferences\(PREFS/.test(applyBody) && /initialChromeDark\(\)/.test(main),
  "冷启动恢复上次主题，首次启动跟随系统外观");
check(/public void applyTheme\(String colorHex, boolean darkBg\)/.test(main) && /runOnUiThread\(\(\) -> applyChrome\(color, darkBg\)\)/.test(main),
  "applyTheme 原生桥存在且在 UI 线程更新主题");
check(/splashBackground/.test(colors) && /#05070A/i.test(colors) && /#05070A/i.test(nightColors),
  "启动屏日间/夜间资源统一为品牌黑 #05070A");
const capacitor = JSON.parse(read("capacitor.config.json"));
check(capacitor.plugins?.SplashScreen?.backgroundColor === "#05070A",
  "Capacitor 启动屏背景与原生 logo 底色一致");

if (errors.length) {
  console.error("\n✗ 原生弹层主题契约失败：");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}
console.log("\n✓ 原生弹层主题同步契约完整");
