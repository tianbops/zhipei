# 智配One · 安卓 App

安卓端是 Capacitor 原生壳，**直接加载线上 web**（`zhipei-one` 仓库部署的那个站点）。

页面就是 web 端那一套，一个字符都不复制、不改写；数据走同一套 `/api/*` 接口和同一份 cookie 会话，
所以 web 端和 App 看到的是同一份数据 —— 不需要额外的同步逻辑。

## 为什么是「远程加载」而不是「把网页塞进 APK」

web 端的前端请求写的是同源相对路径 `/api/login`，登录态靠 `credentials: same-origin` 的 cookie。
如果把页面内置进 APK，页面的 origin 会变成 App 自己的本地域名，`/api/*` 会打到 App 内部而不是服务器，
接口和登录都会失效。

远程加载保留了正确的 origin，因此：

- 页面与 web 端完全一致，web 端更新后 App 自动跟着更新，不用重新发版
- 接口同源，cookie 正常，数据天然同步
- web 端的 Service Worker 在 WebView 里照样生效，首次联网后仍具备离线能力

代价是首次打开需要联网。断网且无缓存时，App 会显示 `www/offline.html`（从 web 仓库同步过来的兜底页）。

## 目录

| 路径 | 说明 |
| --- | --- |
| `capacitor.config.json` | App ID、名称、线上地址、状态栏与启动屏配置 |
| `www/` | 离线兜底页，打包进 APK |
| `android/` | 原生安卓工程（Gradle） |
| `android-template/` | 被覆盖进 `android/` 的原生配置：Manifest、MainActivity、主题 |
| `scripts/gen-icons.py` | 用 `assets-src/` 里的 web 端图标生成安卓图标与启动图 |
| `assets-src/` | 图标源图，取自 web 仓库 `assets/icons/` |
| `.github/workflows/android.yml` | 推 tag 自动出 APK |

## 改线上地址

编辑 `capacitor.config.json` 的 `server.url`，改完执行：

```bash
npx cap sync android
```

也可以在触发 Actions 时填 `web_url` 参数临时指定，不必改文件。

## 本地构建

环境：Node 20+、**JDK 21**（Capacitor 7 要求，用 17 会报 `invalid source release: 21`）、Android SDK（装 Android Studio 即可）。

```bash
npm ci
npm run android:apk        # debug 包
npm run android:release    # release 包
npm run android:open       # 用 Android Studio 打开
```

APK 在 `android/app/build/outputs/apk/`。

## 签名

```bash
keytool -genkey -v -keystore android/app/zhipei.jks -keyalg RSA -keysize 2048 -validity 10000 -alias zhipei

cd android && ./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=app/zhipei.jks \
  -Pandroid.injected.signing.store.password=库密码 \
  -Pandroid.injected.signing.key.alias=zhipei \
  -Pandroid.injected.signing.key.password=密钥密码
```

用 `-Pandroid.injected.signing.*` 注入，不用改 `build.gradle`，密钥也不会进仓库。

## 自动构建

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Actions 会打出 debug + release 两个包并挂到 Release。
正式 Release 必须配置签名 Secrets，否则工作流会在构建前失败，不会生成未签名 Release 包。
在仓库 Settings → Secrets 配置：
`KEYSTORE_BASE64`（keystore 文件的 Base64 内容）、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`。
工作流会先检查 Secrets 是否齐全、keystore 密码是否正确以及 alias 是否存在；正式 Gradle Release 构建会进一步验证密钥密码。不要把 keystore 或密码提交到仓库。

## 可调项

- App ID `com.tianbops.zhipei`（上架后不能改）
- 最低系统 Android 8.0（API 26），见 `android/variables.gradle`
- 原生主题基础色 `colorPrimary=#05070A`、图标底色 `#05070A`；启动屏背景按日夜资源切换：浅色 `#F6F7F9`、深色 `#121826`（见 `android/app/src/main/res/values[-night]/colors.xml`）
- 网页主题与原生状态栏/弹层同步；启动屏保持到 Web 首屏就绪（`webReady()` 桥接，最长 6 秒兜底），见 `MainActivity.java`
- 返回键统一交给 Web 端中央返回控制器，见 `MainActivity.java` 与 Web 仓库 `js/ui/back.js`

## 上架前要知道

Google Play 对「纯网页包装」类应用有最低功能性要求。当前这版是纯壳，
如果要上架，建议至少补一项原生能力（推送、相机直接调用、本地文件分享等），
或先在组织内分发。国内应用商店同样要求软著和隐私政策。
