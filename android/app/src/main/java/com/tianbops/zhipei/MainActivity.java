package com.tianbops.zhipei;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 智配One 主界面。
 * 在 Capacitor 默认 BridgeActivity 之上只加了两件事：
 *   1. 返回键优先让 WebView 后退（网页内路由可用），退不动才退出 App
 *   2. 2 秒内连按两次返回键才真正退出，避免误触
 * 业务代码一行没动，全部走 WebView 里的 web 端。
 */
public class MainActivity extends BridgeActivity {

    private static final long BACK_EXIT_INTERVAL = 2000L;
    private long lastBackPressedAt = 0L;

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
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setLoadWithOverviewMode(true);
        // 锁定 WebView 文字缩放为 100%：系统字体缩放会在网页自身字号之上再叠加放大，
        // 导致标题与正文重叠、控件溢出（网页的「外观模式-跟随系统」下尤其明显）。
        // 网页自带「全局文字大小」滑杆，想要大字由它控制，布局不会乱。
        webView.getSettings().setTextZoom(100);
        applySystemBarInsets(webView);
        applyStatusBarAppearance();
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
     * 状态栏背景透明，图标颜色跟随系统深浅色模式：
     * 浅色模式用深色图标（否则白图标压在浅色页面上看不清），深色模式用浅色图标。
     */
    private void applyStatusBarAppearance() {
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        int mask = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        boolean darkMode = mask == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsControllerCompat c =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(!darkMode);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        boolean handledByWeb = webView != null && webView.canGoBack();

        if (handledByWeb) {
            webView.goBack();
            return;
        }

        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt > BACK_EXIT_INTERVAL) {
            lastBackPressedAt = now;
            Toast.makeText(this, "再按一次退出智配One", Toast.LENGTH_SHORT).show();
            return;
        }
        super.onBackPressed();
    }
}
