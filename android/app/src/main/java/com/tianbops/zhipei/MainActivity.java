package com.tianbops.zhipei;

import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.AbsoluteSizeSpan;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 智配One 主界面。
 * 在 Capacitor 默认 BridgeActivity 之上只加了几件事：
 *   1. 返回键统一转交 Web 层中央控制器（ui-unified.js 的 zpSystemBack/zpHandleBack）：
 *      有历史可退则 goBack 触发 popstate 让其分层关闭/离开；无历史可退则直接调用
 *      window.zpSystemBack()。「再按一次退出」与分层关闭语义全部由 Web 决定，
 *      原生不再自带第二套返回逻辑，保证顶部返回键/物理返回键/手势返回三者行为一致。
 *   2. 仅当收到 Web 的退出指令（ZhipeiNative.exitApp()）才真正 finish() 结束 Activity。
 *   3. 系统栏 inset 转成 WebView 上下外边距，内容不压状态栏/手势条
 *   4. 状态栏/导航栏底色与图标明暗跟随「网页外观主题」（深色/浅色）
 * 业务代码一行没动，全部走 WebView 里的 web 端。
 */
public class MainActivity extends BridgeActivity {

    /** 首帧兜底色：与 web 深色主题背景 --zp-bg 一致，避免白条闪一下 */
    private static final int DEFAULT_BG = Color.parseColor("#05070A");

    private WebView webViewRef;
    private int chromeColor = DEFAULT_BG;
    private boolean darkChrome = true;
    /** 网页「全局文字大小」缩放（0.85–1.3，默认 1）。网页内文字由页面自身缩放，
     *  壳只用它放大原生 Toast 等浮层文字；JS Bridge 线程写、UI 线程读，加 volatile。 */
    private volatile float fontScale = 1f;
    /** Bridge/WebView 在部分 Capacitor 版本的 onCreate 阶段尚未创建，
     *  此时直接 return 会让状态栏/边距修复全部失效（线上仍遮挡）。
     *  改为有限次延后重试，确保修复一定会执行。 */
    private int webViewRetry = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebView();
    }

    private void configureWebView() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            if (webViewRetry++ < 30) {
                getWindow().getDecorView().postDelayed(this::configureWebView, 100);
            }
            return;
        }
        webViewRef = webView;
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setLoadWithOverviewMode(true);
        // 锁定 WebView 文字缩放为 100%：系统字体缩放会在网页自身字号之上再叠加放大，
        // 导致标题与正文重叠、控件溢出（网页的「外观模式-跟随系统」下尤其明显）。
        // 网页自带「全局文字大小」滑杆，想要大字由它控制，布局不会乱。
        webView.getSettings().setTextZoom(100);
        // 网页外观主题变化时由 web 端回调 applyTheme()，这里先按深色兜底，
        // 保证首帧状态栏就是「深色底 + 浅色图标」，不会闪白条。
        webView.addJavascriptInterface(new NativeChrome(), "ZhipeiNative");
        // WebView 内点「下载应用 / 最新安装包」时的 APK 下载接管。
        // Capacitor 默认不处理下载：点击带 download 的链接只会触发 onDownloadStart，
        // 没人监听就毫无反应（用户反馈「安卓端点击下载最新版本没反应」即此）。
        // 走系统 DownloadManager 下到公共 Downloads 目录，通知栏完成后点击即装。
        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) ->
                startDownload(url, userAgent, contentDisposition, mimetype));
        applySystemBarInsets(webView);
        applyChrome(DEFAULT_BG, true);
    }

    /**
     * 统一的 APK 下载入口：DownloadListener 与 JS 接口 downloadApk() 共用。
     * 下到公共 Downloads 目录，通知栏完成后点击即装；公共目录不可用时
     * 退回应用私有目录。
     */
    private void startDownload(String url, String userAgent, String contentDisposition, String mimetype) {
        if (url == null || url.isEmpty()) {
            return;
        }
        String fileName = URLUtil.guessFileName(url, contentDisposition, mimetype);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        if (userAgent != null) {
            request.addRequestHeader("User-Agent", userAgent);
        }
        request.setTitle(fileName);
        request.setDescription("智配One 安装包");
        request.setMimeType(mimetype != null ? mimetype : "application/vnd.android.package-archive");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        try {
            // 公共目录对 DownloadManager 始终可用（系统进程代写，不受分区存储限制）
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
        } catch (Exception e) {
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
        }
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm != null) {
            dm.enqueue(request);
            showToast("开始下载「智配One」安装包，下载完成后点击通知栏即可安装");
        }
    }

    /**
     * Toast 文字跟随网页「全局文字大小」缩放。
     * 原生 Toast 的文字尺寸由系统主题决定，不认 App 内字号滑杆——用户把滑杆
     * 拉到最大时，页面文字都大了，唯独下载提示还是小字，观感割裂。
     * 用 SpannableString + AbsoluteSizeSpan 按 fontScale 缩放（基准 14sp，
     * 与系统默认 Toast 文字尺寸一致；scale=1 时走原路径，不增加开销）。
     */
    private void showToast(String text) {
        Toast toast;
        if (Math.abs(fontScale - 1f) > 0.001f) {
            float density = getResources().getDisplayMetrics().scaledDensity;
            int sizePx = Math.round(14f * fontScale * density);
            SpannableString styled = new SpannableString(text);
            styled.setSpan(new AbsoluteSizeSpan(sizePx), 0, text.length(),
                    Spanned.SPAN_INCLUSIVE_EXCLUSIVE);
            toast = Toast.makeText(this, styled, Toast.LENGTH_LONG);
        } else {
            toast = Toast.makeText(this, text, Toast.LENGTH_LONG);
        }
        toast.show();
    }

    /**
     * targetSdk 35 起 Android 强制 edge-to-edge，App 内容会顶到状态栏/刘海/手势条下面。
     * 监听挂在 DecorView 上（根视图，必定收到 inset 派发），把系统栏高度换算成
     * WebView 的上下外边距，让所有页面内容都落在安全区内。
     * 另外先用系统 status_bar_height 资源兜底，避免 insets 派发前首帧顶到状态栏。
     */
    private void applySystemBarInsets(WebView webView) {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (id > 0) {
            int h = getResources().getDimensionPixelSize(id);
            if (h > 0) {
                applyInsetsMargins(webView, h, 0);
            }
        }
        // 内容延伸到系统栏之下（由下面的边距让开），否则 inset 不会派发。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        final View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, windowInsets) -> {
            Insets topBars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.statusBars()
                            | WindowInsetsCompat.Type.displayCutout());
            Insets nav = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            applyInsetsMargins(webView, topBars.top, nav.bottom);
            return windowInsets;
        });
        webView.post(() -> ViewCompat.requestApplyInsets(decorView));
    }

    /**
     * 用外边距让出系统栏区域。注意不能用 WebView 自身的 padding——
     * android.webkit.WebView 的已知行为是内容渲染忽略自身 padding，
     * 设了也无效（这正是此前「顶部遮挡」长期未修好的根因）。
     * 边距区露出的是窗口背景，由 applyChrome 统一设为主题色。
     */
    private void applyInsetsMargins(WebView webView, int top, int bottom) {
        ViewGroup.LayoutParams lp = webView.getLayoutParams();
        if (lp instanceof ViewGroup.MarginLayoutParams) {
            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) lp;
            if (mlp.topMargin != top || mlp.bottomMargin != bottom) {
                mlp.topMargin = top;
                mlp.bottomMargin = bottom;
                webView.setLayoutParams(mlp);
            }
        }
    }

    /**
     * 状态栏 / 导航栏配色跟随网页外观主题。
     *
     * 历史教训：此前这里写的是 setStatusBarColor(Color.TRANSPARENT) + 图标跟随
     * 「系统」深色模式。两个后果：
     *   1) 状态栏透明后，露出的是 WebView 顶部 padding 区（WebView 没设背景色，默认白），
     *      深色页面上方就出现一条白条；
     *   2) 用户在 App 里切「深色外观」但系统是浅色模式时，图标仍是深色，
     *      深色图标压在深色页面上——状态栏直接看不见。
     * 现在底色改为不透明并取网页主题色，图标明暗由「是否深色底」决定，
     * 系统与 App 外观不一致时也不会再吞掉状态栏。
     */
    private void applyChrome(int color, boolean darkBg) {
        chromeColor = color;
        darkChrome = darkBg;
        // App 日夜间模式与网页主题同步：WebView 的原生弹层（select 下拉、
        // 日期选择对话框）在不少内核版本不读网页的 CSS color-scheme，
        // 只认宿主 Activity 的 uiMode——系统浅色 + 网页深色时，弹层会一直
        // 是白底黑字（线上「深色模式弹层不跟随」的根因）。
        // 主题是 Theme.AppCompat.DayNight 且 manifest 的 configChanges 含
        // uiMode：此处切换只触发 onConfigurationChanged，不会重建
        // Activity、不会重载网页。
        AppCompatDelegate.setDefaultNightMode(darkBg
                ? AppCompatDelegate.MODE_NIGHT_YES
                : AppCompatDelegate.MODE_NIGHT_NO);
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        // Android 15 会强制给手势条加对比蒙层，关掉才能用上我们自己的底色。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
        // WebView 背景同色：状态栏/手势条对应的边距区不再露白。
        if (webViewRef != null) {
            webViewRef.setBackgroundColor(color);
        }
        // WebView 上下外边距让出的区域露出的是窗口（DecorView）背景，同样设为主题色。
        getWindow().getDecorView().setBackgroundColor(color);
        WindowInsetsControllerCompat c =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        // appearanceLight* = true 表示「底色浅、图标画深色」，深色底要传 false（白图标）。
        c.setAppearanceLightStatusBars(!darkBg);
        c.setAppearanceLightNavigationBars(!darkBg);
    }

    private static int parseColor(String hex, int fallback) {
        try {
            return Color.parseColor(hex);
        } catch (Exception e) {
            return fallback;
        }
    }

    /** 供网页调用：window.ZhipeiNative.applyTheme("#05070A", true) */
    private class NativeChrome {
        @JavascriptInterface
        public void applyTheme(String colorHex, boolean darkBg) {
            int color = parseColor(colorHex, DEFAULT_BG);
            // JS 接口跑在 JavaBridge 线程，UI 操作必须切回主线程。
            runOnUiThread(() -> applyChrome(color, darkBg));
        }

        /**
         * 供网页调用：window.ZhipeiNative.setFontScale(1.3)。
         * 网页「外观-全局文字大小」滑杆的值（0.85–1.3）。网页内文字由页面自身
         * 缩放（appearance.js 的 scanText），壳只把它用于原生 Toast 文字；
         * WebView 的 setTextZoom 仍锁 100%，避免两层缩放叠乘挤压布局。
         * 原生 select 下拉/日期对话框已由页内自建弹层（zp-picker）替代，
         * 那些浮层跟随网页主题与字号，无需壳再操心。
         */
        @JavascriptInterface
        public void setFontScale(float scale) {
            fontScale = Math.max(0.85f, Math.min(1.3f, scale));
        }

        /**
         * 供网页调用：window.ZhipeiNative.appVersion() 返回 APK 版本名（如 1.0.12）。
         * App 壳 server.url 指向线上网页，页面内容实时更新，但原生能力
         * （下载/返回/状态栏）锁在 APK 里——所以「关于」页的当前版本必须
         * 显示壳版本而非网页版本，用户才能判断自己要不要更新。
         * 取 PackageInfo.versionName 而非 BuildConfig：AGP 8 起生成类的
         * 字段/可用性随版本有变动（v1.0.12 首次尝试 BuildConfig 编译即失败），
         * 而 versionName 永远与安装包实际版本一致，CI 按 tag 覆盖 gradle
         * 版本后这里自然跟随，且无生成类依赖。
         */
        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        /**
         * 供网页调用：window.ZhipeiNative.appVersionCode() 返回 APK 版本号。
         * 与 appVersion() 配套，供网页做精确版本比较（versionName 相同时的兜底）。
         */
        @JavascriptInterface
        public int appVersionCode() {
            try {
                return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
            } catch (Exception e) {
                return 0;
            }
        }

        /**
         * 供网页调用：window.ZhipeiNative.getClipboardText() 读取系统剪贴板纯文本。
         * 为什么需要它：WebView 里 navigator.clipboard.readText() 在国产 WebView 与
         * 系统内置浏览器上普遍不可用或被拒，网页的「一键粘贴」只能退化成"请长按粘贴"。
         * 壳直接读系统剪贴板，网页据此实现真·一键粘贴。
         * <p>
         * 返回约定（三态，网页据此决定「直接粘入」还是「继续降级」）：
         *   非空字符串 = 剪贴板纯文本，网页直接粘入；
         *   ""         = 剪贴板里没有文字（空剪贴板，或复制的是图片/文件等非文本条目）；
         *   null       = 读取本身失败（系统异常 / 无剪贴板服务），网页应继续走自己的降级链路。
         * <p>
         * 读取约束：Android 10+ 只有「前台 + 有输入焦点」的应用才能读剪贴板；本接口
         * 由用户在 App 内点击「一键粘贴」时触发，满足该条件。同步返回，与 appVersion() 一致；
         * 剪贴板读取只是一次轻量的系统服务调用。
         */
        @JavascriptInterface
        public String getClipboardText() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null) {
                    return null; // 读取失败：交回网页降级
                }
                ClipData clip = cm.getPrimaryClip();
                if (clip == null) {
                    return ""; // 无剪贴板内容
                }
                // 逐条找第一个带文本的条目：剪贴板可能是图片/文件/Intent，getText() 为 null
                for (int i = 0; i < clip.getItemCount(); i++) {
                    CharSequence text = clip.getItemAt(i).getText();
                    if (text != null && text.length() > 0) {
                        return text.toString();
                    }
                }
                return "";
            } catch (Exception e) {
                return null; // 读取失败：交回网页降级
            }
        }

        /**
         * 供网页调用：window.ZhipeiNative.downloadApk(url) 直接下 APK。
         * 为什么不用 WebView 的 download 事件链路：壳内点「下载应用」是网页
         *  JS 程序化 click()  `<a download>` 链接，onDownloadStart 对程序化
         * 点击的派发并不 100% 可靠；且 v1.0.10 及更早的壳根本没注册监听。
         * 由网页显式调原生接口、原生直接 enqueue DownloadManager，是唯一
         * 全版本可靠的路径。userAgent 等由系统按 URL 自行推断。
         */
        @JavascriptInterface
        public void downloadApk(String url) {
            if (url == null || url.isEmpty()) {
                return;
            }
            // JS 接口跑在 JavaBridge 线程，DownloadManager 操作切回主线程。
            runOnUiThread(() -> startDownload(url, null, null, null));
        }

        /**
         * 供网页调用：window.ZhipeiNative.exitApp()。
         * Web 层返回控制器（zpHandleBack）在工作区根第二次返回、或登录页第二次返回时
         * 确认退出，回调此方法真正结束 Activity。壳内 window.close() 是空操作、
         * history.back() 也退不出 WebView，唯一可靠的退出就是这里 finish()。
         */
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> {
                try {
                    finish();
                } catch (Exception ignore) {
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // 有历史可退（工作区页进入时 ui-unified.js 压了占位历史）：goBack 触发 popstate，
        // 由 Web 中央控制器决定「关闭最上层弹层 / 离开当前页 / 进入再按一次退出」。
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // 无历史可退（登录/引导页，或工作区根已消耗占位后的第二次返回）：
        // 直接转交 Web 控制器。确认退出时由 Web 回调 ZhipeiNative.exitApp()，
        // 原生不再自带「再按一次退出」——否则会与 Web 的提示叠加成双 Toast、三次才退出。
        webView.evaluateJavascript("window.zpSystemBack && window.zpSystemBack()", null);
    }
}
