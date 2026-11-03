#!/usr/bin/env node
/**
 * 版本一致性（scripts/check-version.mjs）
 * ------------------------------------------------------------------
 * 2026-11-03 体检 P0-1：tag 已到 v1.0.29，android/app/build.gradle 仍写 1.0.22。
 * 成因：android.yml 在构建时用 sed 现场注入版本（第 108-109 行），改完不提交；
 * main 又要求 PR，自动化没有合规路径把结果写回。于是「仓库文件」长期落后于 tag。
 *
 * 本脚本把这条漂移变成可见输出：
 *   - 默认：不一致只告警（exit 0）——避免每次发版后所有 PR 集体变红；
 *   - --strict：不一致即失败（exit 1）——发版前人工把关用，见 AGENTS 发布检查单。
 *
 * 用法：
 *   node scripts/check-version.mjs
 *   node scripts/check-version.mjs --strict
 *   node scripts/check-version.mjs --gradle <path> --tag v1.2.3
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const has = (n) => process.argv.includes(n);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const ROOT = resolve(arg("--root", process.cwd()));
const GRADLE = resolve(arg("--gradle", `${ROOT}/android/app/build.gradle`));
const FORCED = arg("--tag");
const STRICT = has("--strict");

function latestTag() {
  if (FORCED) return FORCED;
  try {
    const out = execFileSync("git", ["tag", "--list", "v*.*.*", "--sort=-v:refname"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

const tag = latestTag();
if (!tag) {
  console.log("! 取不到 vX.Y.Z tag（浅克隆）：跳过版本一致性检查");
  process.exit(0);
}

const ver = tag.replace(/^v/, "");
const [MAJOR, MINOR, PATCH] = ver.split(".").map(Number);
const expectCode = (MAJOR * 100 + MINOR) * 100 + PATCH;

let src;
try {
  src = readFileSync(GRADLE, "utf8");
} catch (e) {
  console.error(`✗ build.gradle 读取失败：${e.message}`);
  process.exit(1);
}

const name = /versionName\s+"([^"]+)"/.exec(src)?.[1] || "";
const code = Number(/versionCode\s+(\d+)/.exec(src)?.[1] || 0);
const aligned = name === ver && code === expectCode;

if (aligned) {
  console.log(`✓ 版本一致：build.gradle ${name}/${code} = ${tag}`);
  process.exit(0);
}

const msg =
  `build.gradle 版本 ${name || "(空)"}/${code} 与最新 tag ${tag}/${expectCode} 不一致。\n` +
  `  构建期由 android.yml 注入正确版本，仓库文件不会自动回写；\n` +
  `  发版前请跑 scripts/sync-version.sh 并提交（见 AGENTS「发布检查单」）。`;

if (STRICT) {
  console.error("✗ " + msg);
  process.exit(1);
}
console.log("! " + msg);
process.exit(0);
