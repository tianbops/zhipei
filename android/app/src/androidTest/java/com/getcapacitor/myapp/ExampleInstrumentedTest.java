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

    private static void invokeApplyChrome(MainActivity activity, int color, boolean dark) {
        try {
            Method method = MainActivity.class.getDeclaredMethod("applyChrome", int.class, boolean.class);
            method.setAccessible(true);
            method.invoke(activity, color, dark);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError("Unable to invoke the native theme transition", error);
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
