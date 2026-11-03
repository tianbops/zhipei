#!/usr/bin/env node
/**
 * 原生宿主固定主题与状态栏透明度契约。
 * Web 外观独立于系统外观；切换时不得触发 AppCompat DayNight 重配置，
 * 状态栏保持透明，只更新窗口底色与系统栏图标明暗。
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
check(nightStyles.includes('<item name="android:windowLightStatusBar">true</item>'), "夜间系统配置仍使用稳定的固定主题默认图标，运行时再由网页主题覆盖");
check(styles.includes("Theme.AppCompat.Light.NoActionBar")
  && nightStyles.includes("Theme.AppCompat.Light.NoActionBar")
  && !styles.includes("Theme.AppCompat.DayNight")
  && !nightStyles.includes("Theme.AppCompat.DayNight"),
  "日间/夜间资源均使用固定原生主题，不跟随系统 DayNight 重配置");
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
check(!main.includes("AppCompatDelegate") && !main.includes("setDefaultNightMode("),
  "网页深浅外观切换不调用 AppCompat DayNight API，不触发原生主题重配置");
check(applyBody.includes("webViewRef.setBackgroundColor(color)")
  && applyBody.includes("getWindow().getDecorView().setBackgroundColor(color)")
  && applyBody.includes("c.setAppearanceLightStatusBars(!darkBg)")
  && applyBody.includes("c.setAppearanceLightNavigationBars(!darkBg)"),
  "主题切换只更新窗口承接色与系统栏图标明暗，不更换 Activity 主题");
const onCreateStart = main.indexOf("public void onCreate(Bundle savedInstanceState)");
const onCreateEnd = main.indexOf("private void configureTransparentStatusBar()", onCreateStart);
const onCreateBody = onCreateStart >= 0 ? main.slice(onCreateStart, onCreateEnd > onCreateStart ? onCreateEnd : undefined) : "";
check(!onCreateBody.includes("setDefaultNightMode") && onCreateBody.includes("super.onCreate(savedInstanceState)"),
  "Activity 创建阶段不切换 AppCompat DayNight 模式");
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

// 起始窗口 / 宿主主题的 windowBackground 必须显式钉死。
// 不声明则继承父级（Theme.SplashScreen / AppCompat.Light）的近白色：冷启动会在黑色
// 启动屏之前先露一帧纯白，且透明状态栏区域露出的也正是这块底板 —— 深浅外观都躲不过，
// 因为本壳的原生宿主主题刻意不随系统 DayNight 切换。
const BG_ITEM = '<item name="android:windowBackground">@color/splashBackground</item>';
check(styles.includes(BG_ITEM), "日间宿主主题显式声明 windowBackground，不继承近白底板");
check(nightStyles.includes(BG_ITEM), "夜间宿主主题显式声明 windowBackground，不继承近白底板");
check(/name="AppTheme\.NoActionBarLaunch"[\s\S]*?android:windowBackground">@color\/splashBackground/.test(styles),
  "启动主题（冷启动起始窗口）同样钉死 windowBackground，交接零色差");

if (errors.length) {
  console.error("\n✗ 原生主题/状态栏契约失败：");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}
console.log("\n✓ 原生主题与透明状态栏同步契约完整");
