# AGENTS.md — 智配One 客户端（zhipei / Android 壳）

> 本文件是**唯一约束来源**，与任何 AI 厂商无关。任何具备 git / gh 操作能力的执行 Agent
> 接手本仓库前必须完整阅读。约束不含厂商特定语法，换 Agent 不需要改本文件。

## 1. 项目本质（先读这一节，否则会严重误判）

**这不是一个独立的应用，而是一层 Capacitor 7 远程 WebView 壳。**

```json
"server": { "url": "https://tianyou-zhipei.pages.dev/" }
```

- `www/` 里**只有** `offline.html`——没有业务页面，没有业务 JS，没有 CSS。
- 所有界面、逻辑、样式、会话，全部来自 Web 端仓库 `tianbops/zhipei-one`。
- 本仓只做三件事：**加载远程页面** + **暴露 7 个原生桥方法** + **打包签名分发**。
- **没有本地数据层**：无 SharedPreferences / SQLite / Room / 文件缓存。

因此：改界面不要在这里改（去 Web 仓）；这里的每一行代码都影响**所有**用户的启动与原生能力。

## 2. 硬约束（不可协商）

1. **零费用**：不引入付费 SDK、付费构建服务、需绑卡的依赖。
2. **不上架应用商店**：只通过 GitHub Releases + Web 站点 `downloads/` 分发。
3. **零人工代码审核**：CI 是唯一裁判。
4. **签名凭证绝不入库**：keystore 只存在于 GitHub Secrets
   （`KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`）。
5. **不得把权限判定放到客户端**：客户端没有、也不应有任何权限逻辑。
6. **不得降低桥接契约**：删改 `@JavascriptInterface` 方法等于删网页端功能。
7. **不得修改本文件**来绕开约束。

## 3. 仓库结构与职责

| 路径 | 作用 | 注意 |
|---|---|---|
| `android-template/` | **原生真值源**（MainActivity、Manifest、res） | 改原生优先改这里 |
| `android/` | Capacitor 生成 + 同步的工程 | 会被 `cap sync` 覆盖 |
| `www/` | 仅 `offline.html` | 不要往里放业务资源 |
| `scripts/check-bridge-contract.mjs` | 桥接契约守卫 | **必跑** |
| `scripts/check-template-drift.mjs` | 模板漂移守卫 | **必跑** |
| `assets-src/` | 图标源文件 | 改图标跑 `npm run android:icons` |

**模板漂移的代价（历史事故）**：`android-template/` 与实际 `android/` 不一致时，
"用模板覆盖 android/" 会静默丢掉已注册的 `@JavascriptInterface` 桥接能力
（2026-10-28 一次丢失 6 个方法）。这就是 `check:template-drift` 存在的原因。

## 4. 标准工作流

```bash
git checkout -b backup/<任务名>-<YYYYMMDD>   # 先备份
git checkout main

npm ci
npm run check:bridge          # 桥接契约（必须绿）
npm run check:template-drift  # 模板漂移（必须绿）
npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon   # 构建验证

git push origin main
```

发版只能由 tag 触发（`v*`）或手动 `workflow_dispatch`，见 `.github/workflows/android.yml`。
**不要**在普通提交里改版本号——版本号由 `scripts/sync-version.sh` 与 tag 对齐。

### 4.1 Gradle / AGP / JDK 主版本升级：必须跑两条路径

`android-ci.yml` 只构建 **debug**，而真正发版走的是 `android.yml` 的 **release**（签名 + R8）。
两者不是同一套任务图，debug 绿**不能**证明 release 绿。主版本升级（Gradle、AGP、JDK）按下面流程走：

1. 在升级分支上等 `android-debug-build` 绿；
2. **额外**手动触发 release 构建验证（不产生 Release、不影响线上）：

   ```bash
   gh workflow run android.yml --ref <升级分支> -f build_type=release -f version_name=1.0.99
   ```

   判据：`构建 Release APK`、`整理产物`、`上传 APK` 三个步骤 success（`挂到 Release` 在非 tag 时会跳过）。
3. 两条都绿才合并。

背景（2026-10-30，Gradle 8.11.1 → 9.8.2）：CI 只覆盖 debug，release 侧的签名参数
（`-Pandroid.injected.signing.*`）与 minify 行为是独立的失败面；当时正是靠第 2 步才敢合并。
另外 Gradle 缓存与 `gradle-wrapper.jar`、`gradlew` 会被 dependabot 一并改写，
合并后注意 `android/gradlew` 的可执行位（工作流里有 `chmod +x` 兜底）。

## 5. 7 个原生桥方法（删改即破坏网页端功能）

| 方法 | 签名 | 网页端用途 |
|---|---|---|
| `applyTheme` | `(String colorHex, boolean darkBg)` | 状态栏/导航栏跟随主题 |
| `setFontScale` | `(float scale)` | 设置页字号调节 |
| `appVersion` | `() String` | 设置页「当前版本」显示 |
| `appVersionCode` | `() int` | 版本比较 |
| `getClipboardText` | `() String` | 首页「一键粘贴」 |
| `downloadApk` | `(String url)` | 设置页「更新到 Vx.x.x」 |
| `exitApp` | `()` | 退出 |

改任何一个，必须同时更新：
1. `android-template/` 与 `android/` 两侧（否则漂移守卫红）；
2. Web 仓 `js/` 中的调用点（跨仓跑 `node scripts/check-bridge-contract.mjs --web <zhipei-one 路径>`）；
3. Web 仓的降级路径（桥不存在时网页必须能优雅退化，不能报错）。

## 6. 更新通道（已建成，勿重造）

```
GitHub tag v* → android.yml 构建签名 → Releases 附件 APK
                                      ↓
             Web 仓 downloads/manifest.json 记录最新版本
                                      ↓
             网页端设置页比对版本 → 「已是最新」/「更新到 Vx.x.x」
```

改这条链要同时动三个地方（Release、manifest、网页端三态文案），
漏一处就会出现"永远显示已是最新"或"永远提示更新"。

## 7. 提交规范

`type(scope): 中文描述`，scope 常用 `android` / `bridge` / `ci` / `release`。
安全类、签名类改动必须单独提交并说明影响面。
