package com.tianbops.zhipei;

import android.os.Bundle;
import android.webkit.WebView;
import android.widget.Toast;

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
