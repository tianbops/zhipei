#!/usr/bin/env bash
# 智配One · 版本统一脚本
# 约定：git tag（vX.Y.Z）为唯一真值。每次发版先打 tag，再跑本脚本把版本同步到：
#   1) android/app/build.gradle 的 versionName / versionCode
#   2) （若同目录父级存在 zhipei-one）zhipei-one/version.json 的 version
# versionCode 编码规则：(major*100 + minor)*100 + patch  —— 1.0.13 => 10013，单调递增且唯一。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 取最新的语义化 tag（形如 v1.0.13），按版本号数值排序而非字典序
LATEST_TAG="$(git tag --list 'v*.*.*' | sort -V | tail -1)"
if [ -z "$LATEST_TAG" ]; then
  echo "✗ 找不到任何 vX.Y.Z 形式的 tag，无法同步" >&2
  exit 1
fi

# 去掉前缀 v，拆出 major/minor/patch
VER="${LATEST_TAG#v}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$VER"
VERSION_CODE=$(( (MAJOR * 100 + MINOR) * 100 + PATCH ))

echo "==> 真值 tag: $LATEST_TAG  ->  versionName=$VER  versionCode=$VERSION_CODE"

# 1) Android build.gradle
GRADLE="android/app/build.gradle"
if [ -f "$GRADLE" ]; then
  # 只替换 defaultConfig 块内的 versionCode / versionName 行
  perl -0pi -e "s/(versionCode\s+)\d+/\${1}$VERSION_CODE/; s/(versionName\s+\")(?:[^\"]+)\"/\${1}$VER\"/" "$GRADLE"
  echo "✓ 已更新 $GRADLE"
fi

# 2) Web version.json（若存在）
WEB="../zhipei-one/version.json"
if [ -f "$WEB" ]; then
  TODAY="$(date +%Y-%m-%d)"
  node -e "const fs=require('fs');const p='$WEB';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version='$VER';j.updated='$TODAY';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
  echo "✓ 已更新 $WEB"
fi

echo "完成。请 git add 改动后提交；如需发版再 git tag v$VER 并推送触发 Android 构建。"
