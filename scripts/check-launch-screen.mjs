#!/usr/bin/env node
/**
 * 启动屏护栏：保证「启动屏一直显示到网页首帧就绪」这条链路不被改坏。
 *
 * 为什么需要它：这条链路横跨 XML 主题、Java 生命周期和网页脚本三方，任何一处退化
 * 都不会报错，只会让用户重新看到「启动屏已退、内容还没来」的空窗——正是 v1.0.22 修掉
 * 的那个问题，肉眼可见但单测很难覆盖。把关键约束固化成断言，改坏即红。
 *
 * 检查项：
 *   1. 启动主题必须继承 Theme.SplashScreen（core-splashscreen 的契约），
 *      否则 installSplashScreen 失效、keepOnScreenCondition 无人读取；
 *   2. 启动主题必须声明 postSplashScreenTheme 且指向真实存在的主题，
 *      否则启动屏退出后 Activity 仍套着启动主题，界面会异常；
 *   3. MainActivity 必须在 super.onCreate() 之前 installSplashScreen，
 *      放到之后调用不会生效（Activity 已按启动主题完成初始化）；
 *   4. 必须注册 keepOnScreenCondition，条件读 sWebReady；
 *   5. 必须有超时兜底，避免网页永不就绪时卡在启动屏。
 *
 * 用法：node scripts/check-launch-screen.mjs
 * 退出码：0 通过；1 有破坏。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const STYLES = path.join(REPO, "android/app/src/main/res/values/styles.xml");
const MAIN = path.join(REPO, "android/app/src/main/java/com/tianbops/zhipei/MainActivity.java");
const LAUNCH_THEME = "AppTheme.NoActionBarLaunch";

const errors = [];

function read(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    errors.push(`无法读取 ${path.relative(REPO, p)}（${e.code || e.message}）`);
    return "";
  }
}

const styles = read(STYLES);
const main = read(MAIN);

/* ---------- 1. 启动主题继承 Theme.SplashScreen ---------- */
const styleBlock = (() => {
  const re = new RegExp(`<style\\s+name="${LAUNCH_THEME.replace(/\./g, "\\.")}"[\\s\\S]*?</style>`);
  return (styles.match(re) || [""])[0];
})();

if (!styleBlock) {
  errors.push(`styles.xml 缺少启动主题 <style name="${LAUNCH_THEME}">`);
} else {
  if (!/parent="Theme\.SplashScreen"/.test(styleBlock)) {
    errors.push(
      `启动主题必须继承 Theme.SplashScreen（当前：${(styleBlock.match(/parent="([^"]*)"/) || [])[1] || "无"}）——` +
        `否则 installSplashScreen 不生效，启动屏仍会在窗口首帧退出`
    );
  }
  for (const attr of ["windowSplashScreenBackground", "windowSplashScreenAnimatedIcon"]) {
    if (!new RegExp(`name="${attr}"`).test(styleBlock)) {
      errors.push(`启动主题缺少 ${attr}`);
    }
  }
  const post = (styleBlock.match(/name="postSplashScreenTheme">@style\/([^<]+)</) || [])[1];
  if (!post) {
    errors.push("启动主题缺少 postSplashScreenTheme —— 启动屏退出后 Activity 会一直套着启动主题");
  } else if (!new RegExp(`<style\\s+name="${post.replace(/\./g, "\\.")}"`).test(styles)) {
    errors.push(`postSplashScreenTheme 指向不存在的主题 @style/${post}`);
  }
}

/* ---------- 2. installSplashScreen 必须在 super.onCreate 之前 ---------- */
if (!/SplashScreen\.installSplashScreen\(\s*this\s*\)/.test(main)) {
  errors.push("MainActivity 未调用 SplashScreen.installSplashScreen(this)");
} else {
  const onCreateAt = main.indexOf("public void onCreate(Bundle");
  const superAt = main.indexOf("super.onCreate(savedInstanceState)");
  const installCallAt = main.indexOf("installLaunchScreen()");
  if (onCreateAt < 0 || superAt < 0 || installCallAt < 0) {
    errors.push("MainActivity.onCreate 结构异常：找不到 onCreate / installLaunchScreen() / super.onCreate");
  } else if (!(installCallAt > onCreateAt && installCallAt < superAt)) {
    errors.push(
      "installLaunchScreen() 必须写在 onCreate 内、super.onCreate() 之前 —— " +
        "放到之后调用不会生效（Activity 已按启动主题完成初始化）"
    );
  }
}

/* ---------- 3. 保持条件与超时兜底 ---------- */
if (!/setKeepOnScreenCondition\(\s*\(\)\s*->\s*!\s*sWebReady\s*\)/.test(main)) {
  errors.push("未注册 setKeepOnScreenCondition(() -> !sWebReady) —— 启动屏会退回「窗口首帧即退出」");
}
if (!/sWebReady\s*=\s*true/.test(main)) {
  errors.push("找不到 sWebReady 置位点（webReady 桥方法或超时兜底）");
}
if (!/SPLASH_TIMEOUT_MS/.test(main) || !/postDelayed/.test(main)) {
  errors.push("缺少启动屏超时兜底 —— 网页永不就绪时用户会卡在 logo 上");
}
if (!/public\s+void\s+webReady\(\s*\)/.test(main)) {
  errors.push("缺少 webReady() 桥方法 —— 网页无法通知首帧就绪");
}

/* ---------- 输出 ---------- */
if (errors.length) {
  console.error("✗ 启动屏配置被破坏：");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log("✓ 启动屏链路完整");
console.log(`  · 启动主题 ${LAUNCH_THEME} 继承 Theme.SplashScreen`);
console.log("  · installSplashScreen 位于 super.onCreate 之前");
console.log("  · keepOnScreenCondition 读 sWebReady，带超时兜底");
console.log("  · webReady() 桥方法存在");
