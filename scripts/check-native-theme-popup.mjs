#!/usr/bin/env node
/**
 * 原生弹层主题与状态栏透明度契约。
 * Web 外观独立于系统外观；原生弹层需同步 AppCompat uiMode，
 * 状态栏则必须在日/夜主题资源中始终透明，切换时只更新图标明暗。
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const errors = [];
const check = (ok, message) => { if (ok) console.log("✓ " + message); else errors.push(message); };

const main = read("android/app/src/main/java/com/tianbops/zhipei/MainActivity.java");
const template = read("android-template/app/src/main/java/com/tianbops/zhipei/MainActivity.java");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const templateManifest = read("android-template/app/src/main/AndroidManifest.xml");
const styles = read("android/app/src/main/res/values/styles.xml");
const templateStyles = read("android-template/app/src/main/res/values/styles.xml");
const nightStyles = read("android/app/src/main/res/values-night/styles.xml");
const templateNightStyles = read("android-template/app/src/main/res/values-night/styles.xml");
const colors = read("android/app/src/main/res/values/colors.xml");
const nightColors = read("android/app/src/main/res/values-night/colors.xml");
const templateColors = read("android-template/app/src/main/res/values/colors.xml");
const templateNightColors = read("android-template/app/src/main/res/values-night/colors.xml");

check(main === template, "MainActivity 与 android-template 原生模板逐字节一致");
check(manifest === templateManifest, "AndroidManifest 与原生模板逐字节一致");
check(styles === templateStyles, "styles.xml 与原生模板逐字节一致");
check(nightStyles === templateNightStyles, "values-night/styles.xml 与原生模板逐字节一致");
check(colors === templateColors && nightColors === templateNightColors, "日间/夜间颜色资源与原生模板一致");
check(styles.includes('<item name="android:statusBarColor">@android:color/transparent</item>'), "日间主题声明透明状态栏");
check(styles.includes('<item name="android:windowLightStatusBar">true</item>'), "日间主题默认使用深色状态栏图标");
check(nightStyles.includes('<item name="android:statusBarColor">@android:color/transparent</item>'), "夜间主题声明透明状态栏");
check(nightStyles.includes('<item name="android:windowLightStatusBar">false</item>'), "夜间主题默认使用浅色状态栏图标");
check(styles.includes("Theme.AppCompat.DayNight.NoActionBar"), "宿主主题使用 AppCompat DayNight");
check(/configChanges="[^"]*uiMode/.test(manifest), "Activity 接收 uiMode 配置变化，不因主题同步重建页面");

const applyStart = main.indexOf("private void applyChrome(");
const applyEnd = main.indexOf("\n    private static int parseColor", applyStart);
const applyBody = applyStart >= 0 ? main.slice(applyStart, applyEnd > applyStart ? applyEnd : undefined) : "";
const configureStart = main.indexOf("private void configureTransparentStatusBar()");
const configureEnd = main.indexOf("private void installLaunchScreen()", configureStart);
const configureBody = configureStart >= 0 ? main.slice(configureStart, configureEnd > configureStart ? configureEnd : undefined) : "";
check(main.includes("configureTransparentStatusBar();"), "Activity 创建时启用透明状态栏配置");
check(configureBody.includes("WindowCompat.setDecorFitsSystemWindows(getWindow(), false)")
  && configureBody.includes("getWindow().setStatusBarColor(Color.TRANSPARENT)"),
  "Edge-to-Edge 与透明状态栏在首帧初始化阶段统一配置");
check(!applyBody.includes("setStatusBarColor(") && !applyBody.includes("setStatusBarContrastEnforced("),
  "主题切换期间不重复写状态栏背景或对比度策略");
check(applyBody.includes("c.setAppearanceLightStatusBars(!darkBg)")
  && applyBody.includes("c.setAppearanceLightNavigationBars(!darkBg)"),
  "状态栏与导航栏图标明暗跟随当前主题");
check(applyBody.includes("if (AppCompatDelegate.getDefaultNightMode() != desiredNightMode)")
  && applyBody.includes("AppCompatDelegate.setDefaultNightMode(desiredNightMode)"),
  "原生 DayNight 外观仅在主题实际变化时更新，避免重复重配置");
const modeSwitchAt = applyBody.indexOf("AppCompatDelegate.setDefaultNightMode(desiredNightMode)");
check(modeSwitchAt > 0
  && applyBody.indexOf("webViewRef.setBackgroundColor(color)") < modeSwitchAt
  && applyBody.indexOf("getWindow().getDecorView().setBackgroundColor(color)") < modeSwitchAt,
  "先更新状态栏透明区域底色，再执行 DayNight 重配置，避免旧主题底板闪现");
const onCreateStart = main.indexOf("public void onCreate(Bundle savedInstanceState)");
const onCreateEnd = main.indexOf("private void configureTransparentStatusBar()", onCreateStart);
const onCreateBody = onCreateStart >= 0 ? main.slice(onCreateStart, onCreateEnd > onCreateStart ? onCreateEnd : undefined) : "";
check(onCreateBody.includes("initialChromeDark()")
  && onCreateBody.indexOf("setDefaultNightMode") < onCreateBody.indexOf("super.onCreate(savedInstanceState)"),
  "Activity 首帧前恢复 DayNight 模式，避免先绘制默认主题");
check(/getSharedPreferences\(PREFS/.test(applyBody) && main.includes("initialChromeDark()"),
  "冷启动恢复上次主题，首次启动跟随系统外观");
check(/public void applyTheme\(String colorHex, boolean darkBg\)/.test(main)
  && main.includes("runOnUiThread(() -> applyChrome(color, darkBg))"),
  "applyTheme 原生桥存在且在 UI 线程更新主题");
check(/splashBackground/.test(colors) && /#05070A/i.test(colors) && /#05070A/i.test(nightColors),
  "启动屏日间/夜间资源统一为品牌黑 #05070A");
const capacitor = JSON.parse(read("capacitor.config.json"));
check(capacitor.plugins?.SplashScreen?.backgroundColor === "#05070A",
  "Capacitor 启动屏背景与原生 logo 底色一致");

if (errors.length) {
  console.error("\n✗ 原生主题/状态栏契约失败：");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}
console.log("\n✓ 原生主题与透明状态栏同步契约完整");
