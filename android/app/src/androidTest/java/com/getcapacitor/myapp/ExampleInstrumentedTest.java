package com.getcapacitor.myapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.util.Log;

import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.tianbops.zhipei.MainActivity;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicReference;

/** 原生宿主与状态栏主题切换的真实模拟器仪器测试。 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
    private static final String TAG = "ZPThemeTest";

    @Test
    public void useAppContext() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.tianbops.zhipei", appContext.getPackageName());
    }

    @Test(timeout = 120_000)
    public void statusBarRemainsStableWithoutRecreatingActivityAcrossThemeSwitches() {
        Log.i(TAG, "Starting MainActivity scenario");
        final int originalNightMode = AppCompatDelegate.getDefaultNightMode();
        final AtomicReference<MainActivity> originalActivity = new AtomicReference<>();

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(originalActivity::set);
            Log.i(TAG, "MainActivity scenario launched; defaultNightMode=" + originalNightMode);

            int light = Color.parseColor("#F6F7F9");
            int dark = Color.parseColor("#121826");
            int[] colors = {dark, light, dark, light, dark, light, dark, light};
            boolean[] darkModes = {true, false, true, false, true, false, true, false};

            for (int i = 0; i < colors.length; i++) {
                final int expectedColor = colors[i];
                final boolean expectedDark = darkModes[i];
                Log.i(TAG, "Starting theme transition " + (i + 1) + ", dark=" + expectedDark);
                scenario.onActivity(activity -> {
                    assertSame("Theme changes must not replace MainActivity",
                            originalActivity.get(), activity);
                    invokeApplyChrome(activity, expectedColor, expectedDark);
                });

                // Drain posted configuration/recreation work before inspecting the next frame.
                InstrumentationRegistry.getInstrumentation().waitForIdleSync();
                scenario.onActivity(activity -> {
                    assertSame("Theme changes must not recreate MainActivity",
                            originalActivity.get(), activity);
                    assertWindowChrome(activity, expectedColor, expectedDark);
                });
                assertEquals("Web appearance must not change the process AppCompat night mode",
                        originalNightMode, AppCompatDelegate.getDefaultNightMode());
                Log.i(TAG, "Completed stable theme transition " + (i + 1));
            }
        }
        Log.i(TAG, "All theme transitions completed without Activity recreation");
    }

    /**
     * 走桥方法的换色路径：applyTheme 把换色排到下一动画帧，必须确认它最终真的落到窗口上。
     * 若哪天 postOnAnimation 的回调丢失（WebView 未 attach、帧回调被吞），窗口会一直停在旧色，
     * 而 applyChrome 的单测依然全绿——所以这条必须独立存在。
     */
    @Test(timeout = 60_000)
    public void themeAppliedThroughBridgeEventuallyReachesWindowChrome() throws Exception {
        final int light = Color.parseColor("#F6F7F9");
        final int dark = Color.parseColor("#121826");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            // 先压到浅色，确保后续断言不是"本来就是深色"蒙对。
            scenario.onActivity(activity -> invokeApplyChrome(activity, light, false));
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(activity ->
                    assertEquals("前置状态必须是浅色", light, decorBackgroundColor(activity)));

            scenario.onActivity(activity -> invokeBridgeApplyTheme(activity, "#121826", true));

            // postOnAnimation 排在下一帧；waitForIdleSync 只等消息队列，再补一帧余量。
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            Thread.sleep(120);
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();

            scenario.onActivity(activity -> assertWindowChrome(activity, dark, true));
        }
    }

    private static int decorBackgroundColor(MainActivity activity) {
        android.graphics.drawable.Drawable background =
                activity.getWindow().getDecorView().getBackground();
        assertTrue("DecorView must have a solid background", background instanceof ColorDrawable);
        return ((ColorDrawable) background).getColor();
    }

    private static void invokeApplyChrome(MainActivity activity, int color, boolean dark) {
        try {
            Method method = MainActivity.class.getDeclaredMethod("applyChrome", int.class, boolean.class);
            method.setAccessible(true);
            method.invoke(activity, color, dark);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError("Unable to invoke the native theme transition", error);
        }
    }

    /**
     * 网页切换外观时真正走的是 NativeChrome.applyTheme → postOnAnimation → applyChrome。
     *
     * 为什么必须单测这一条：applyTheme 把换色排到下一个动画帧，与 WebView 的合成对齐
     * （真机实测原来差 1 帧，状态栏先于页面变色）。这类"延后执行"最怕的是延后到
     * 永远不执行——此时状态栏会一直停在旧色，而 applyChrome 本身的单测仍然全绿。
     * 这里从桥方法进去、等一帧、再验窗口颜色，才能钉住这条路径。
     */
    private static void invokeBridgeApplyTheme(MainActivity activity, String hex, boolean dark) {
        try {
            Class<?> chromeClass = Class.forName("com.tianbops.zhipei.MainActivity$NativeChrome");
            java.lang.reflect.Constructor<?> ctor =
                    chromeClass.getDeclaredConstructor(MainActivity.class);
            ctor.setAccessible(true);
            Object chrome = ctor.newInstance(activity);
            Method method = chromeClass.getDeclaredMethod("applyTheme", String.class, boolean.class);
            method.setAccessible(true);
            method.invoke(chrome, hex, dark);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError("Unable to invoke the bridge theme transition", error);
        }
    }

    private static void assertWindowChrome(MainActivity activity, int color, boolean dark) {
        assertEquals("Status bar background must remain transparent",
                Color.TRANSPARENT, activity.getWindow().getStatusBarColor());

        assertTrue("DecorView must have a solid theme-matched background",
                activity.getWindow().getDecorView().getBackground() instanceof ColorDrawable);
        ColorDrawable background = (ColorDrawable) activity.getWindow().getDecorView().getBackground();
        assertEquals("Transparent status-bar area must reveal the current theme color",
                color, background.getColor());

        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(
                activity.getWindow(), activity.getWindow().getDecorView());
        assertEquals("Status-bar icon brightness must match the page theme",
                !dark, controller.isAppearanceLightStatusBars());
        assertEquals("Navigation-bar icon brightness must match the page theme",
                !dark, controller.isAppearanceLightNavigationBars());
        assertEquals("Navigation bar background must match the page theme",
                color, activity.getWindow().getNavigationBarColor());
    }
}
