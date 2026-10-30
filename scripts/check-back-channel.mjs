/**
 * 返回通道契约（客户端仓 · scripts/check-back-channel.mjs）
 * ------------------------------------------------------------
 * 对应 ADR 0003《返回键不依赖浏览器历史》（2026-10-30，v1.0.19）：
 *
 *   1. 原生返回键**不得**把 webView.goBack() 当作第一分支。goBack 只认「上一页文档」，
 *      看不到页面内还开着的确认框/抽屉，会把弹层连同未处理内容一起丢掉。
 *   2. 必须探测 window.zpSystemBack，存在就交出去；goBack/finish 只能作 JS 未就绪的兜底。
 *   3. android/ 与 android-template/ 两份 MainActivity 必须一致（模板漂移由
 *      check-template-drift.mjs 另行校验，这里再兜一层，防止只改一侧就发版）。
 *
 * 用法：node scripts/check-back-channel.mjs（CI 在 assembleDebug 之前跑）
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REL = "app/src/main/java/com/tianbops/zhipei/MainActivity.java";

const files = [join(ROOT, "android", REL), join(ROOT, "android-template", REL)];
const texts = [];
let fail = 0;
const ok = (m) => console.log("  ✅ " + m);
const bad = (m) => {
  fail++;
  console.log("  ✗ " + m);
};

console.log("— 返回通道契约 —");

for (const f of files) {
  const short = f.includes("android-template") ? "android-template/" : "android/";
  if (!existsSync(f)) {
    bad(`${short}MainActivity.java 不存在`);
    continue;
  }
  const src = readFileSync(f, "utf8");
  texts.push(src);

  const iProbe = src.indexOf("(window.zpSystemBack?1:0)");
  const iCall = src.indexOf('evaluateJavascript("window.zpSystemBack()"');
  const iBack = src.indexOf("webView.goBack();");

  iProbe > 0 ? ok(`${short}探测 window.zpSystemBack`) : bad(`${short}缺少 zpSystemBack 探测`);
  iCall > 0 ? ok(`${short}调用 window.zpSystemBack()`) : bad(`${short}缺少 zpSystemBack 调用`);
  iBack > iProbe && iProbe > 0
    ? ok(`${short}goBack 仅作兜底（在探测之后）`)
    : bad(`${short}goBack 出现位置不对（probe=${iProbe} back=${iBack}）`);

  // 红线：不允许「能退就退」的无条件第一分支
  const head = iProbe > 0 ? src.slice(0, iProbe) : src;
  /if \(webView\.canGoBack\(\)\) \{\s*webView\.goBack\(\);\s*return;\s*\}/.test(head)
    ? bad(`${short}仍存在「canGoBack → goBack」的第一分支`)
    : ok(`${short}无「canGoBack → goBack」第一分支`);
}

if (texts.length === 2 && texts[0] !== texts[1]) {
  bad("android/ 与 android-template/ 的 MainActivity 不一致");
} else if (texts.length === 2) {
  ok("android/ 与 android-template/ 的 MainActivity 一致");
}

console.log("");
if (fail) {
  console.log(`✗ 返回通道契约：${fail} 项不通过`);
  process.exit(1);
}
console.log("✓ 返回通道契约一致（返回键交 Web 控制器，goBack 仅兜底）");
