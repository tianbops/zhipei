#!/usr/bin/env python3
"""从 assets-src/ 的 web 端图标生成安卓图标与启动图。

    python scripts/gen-icons.py

输入：
    assets-src/icon.png          512 以上，方形主图标（来源：web 仓库 assets/icons/icon-512.png）
    assets-src/icon-maskable.png 512 以上，带安全边距（来源：web 仓库 assets/icons/icon-maskable-512.png）
输出：
    android/app/src/main/res/mipmap-*/ 各密度图标
    android/app/src/main/res/drawable*/  启动图

图标沿用 web 端同一张图，保证 App 和 web 视觉一致。
"""
import os
from PIL import Image, ImageDraw

BRAND = (5, 7, 10, 255)  # #05070A，与 manifest.json 的 theme_color 一致

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets-src")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SPLASH = {"mdpi": 480, "hdpi": 720, "xhdpi": 960, "xxhdpi": 1440, "xxxhdpi": 1920}


def circle_mask(size):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    return mask


def round_mask(size, ratio):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * ratio), fill=255
    )
    return mask


def base_image(kind):
    path = os.path.join(SRC, kind)
    if not os.path.exists(path):
        raise SystemExit(f"缺少 {path}")
    return Image.open(path).convert("RGBA")


def compose(size, src, mask):
    img = src.resize((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BRAND)
    canvas.alpha_composite(img, (0, 0))
    canvas.putalpha(Image.composite(mask(size), Image.new("L", (size, size), 0), canvas.split()[3]))
    return canvas


def main():
    icon = base_image("icon.png")
    maskable = base_image("icon-maskable.png")
    logo = icon if not os.path.exists(os.path.join(SRC, "logo.png")) else base_image("logo.png")

    for density, size in LEGACY.items():
        folder = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)
        compose(size, icon, lambda s, r=0.22: round_mask(s, r)).save(
            os.path.join(folder, "ic_launcher.png")
        )
        compose(size, icon, circle_mask).save(os.path.join(folder, "ic_launcher_round.png"))

        # 自适应图标前景：maskable 图本身已留好安全边距，按 66% 缩放居中
        fg_size = FOREGROUND[density]
        fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
        inner = int(fg_size * 0.66)
        pad = (fg_size - inner) // 2
        fg.alpha_composite(maskable.resize((inner, inner), Image.LANCZOS), (pad, pad))
        fg.save(os.path.join(folder, "ic_launcher_foreground.png"))

        # 启动图：品牌色底 + 居中 logo
        sp_size = SPLASH[density]
        splash = Image.new("RGBA", (sp_size, sp_size), BRAND)
        mark = int(sp_size * 0.28)
        splash.alpha_composite(
            logo.resize((mark, mark), Image.LANCZOS),
            ((sp_size - mark) // 2, (sp_size - mark) // 2),
        )
        for folder_name in (f"drawable-{density}", f"drawable-land-{density}"):
            d = os.path.join(RES, folder_name)
            os.makedirs(d, exist_ok=True)
            splash.save(os.path.join(d, "splash.png"))
        print(f"{density}: icon {size}px / fg {fg_size}px / splash {sp_size}px")

    anydpi = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(anydpi, name), "w", encoding="utf-8") as f:
            f.write(
                '<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@drawable/ic_launcher_background"/>\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
                "</adaptive-icon>\n"
            )

    drawable = os.path.join(RES, "drawable")
    os.makedirs(drawable, exist_ok=True)
    with open(os.path.join(drawable, "ic_launcher_background.xml"), "w", encoding="utf-8") as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<shape xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <solid android:color="@color/ic_launcher_background"/>\n'
            "</shape>\n"
        )
    # 注意：不要生成 drawable/splash.xml。
    # Capacitor 模板自带 drawable/splash.png，同名不同扩展名会被 aapt2 判为重复资源而构建失败。
    # 启动图直接用各密度的 drawable-*/splash.png，styles.xml 里的 @drawable/splash 会自动按密度命中。
    print(f"完成：{RES}")


if __name__ == "__main__":
    main()
