package com.tianbops.zhipei;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

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
 *   3. 系统栏 inset 转成 WebView 上下内边距，内容不压状态栏/手势条
 *   4. 状态栏/导航栏底色与图标明暗跟随「网页外观主题」（深色/浅色）
 * 业务代码一行没动，全部走 WebView 里的 web 端。
 */
public class MainActivity extends BridgeActivity {

    /** 首帧兜底色：与 web 深色主题背景 --zp-bg 一致，避免白条闪一下 */
    private static final int DEFAULT_BG = Color.parseColor("#05070A");

    private WebView webViewRef;
    private int chromeColor = DEFAULT_BG;
    private boolean darkChrome = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebView();
    }

    private void configureWebView() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
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
        applySystemBarInsets(webView);
        applyChrome(DEFAULT_BG, true);
    }

    /**
     * targetSdk 35 起 Android 强制 edge-to-edge，App 内容会顶到状态栏/刘海/手势条下面。
     * 监听挂在 DecorView 上（根视图，必定收到 inset 派发），把系统栏高度换算成
     * WebView 的上下内边距，让所有页面内容都落在安全区内。
     * 另外先用系统 status_bar_height 资源兜底，避免 insets 派发前首帧顶到状态栏。
     */
    private void applySystemBarInsets(WebView webView) {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (id > 0) {
            int h = getResources().getDimensionPixelSize(id);
            if (h > 0) {
                webView.setPadding(0, h, 0, 0);
            }
        }
        // 内容延伸到系统栏之下（由下面的 padding 让开），否则 inset 不会派发。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        final View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, windowInsets) -> {
            Insets topBars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.statusBars()
                            | WindowInsetsCompat.Type.displayCutout());
            Insets nav = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            webView.setPadding(0, topBars.top, 0, nav.bottom);
            return windowInsets;
        });
        webView.post(() -> ViewCompat.requestApplyInsets(decorView));
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
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        // Android 15 会强制给手势条加对比蒙层，关掉才能用上我们自己的底色。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
        // WebView 背景同色：状态栏/手势条对应的 padding 区不再露白。
        if (webViewRef != null) {
            webViewRef.setBackgroundColor(color);
        }
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
