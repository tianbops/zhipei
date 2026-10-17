package com.tianbops.zhipei;

import android.os.Bundle;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

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
        applyTopInset(webView);
    }

    /**
     * targetSdk 35 起 Android 强制 edge-to-edge，App 内容会顶到状态栏/挖孔下面，
     * 造成页面标题与系统时间、电量图标重叠。这里把状态栏和刘海的高度转成
     * WebView 的顶部内边距，让页面内容从系统栏下方开始。
     */
    private void applyTopInset(WebView webView) {
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.statusBars()
                            | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(0, bars.top, 0, 0);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
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
