# Usion mini-games — 5 насны бүлэгт зориулсан тоглоом

| Нас | Тоглоом | Хавтас | Leaderboard |
|-----|---------|--------|-------------|
| 10–20 | Өнгө хурд · Color Dash (Stroop рефлекс, 60с, 3 горим) | `dist/color-dash/` | оноо, desc |
| 20–30 | Хурдан бичээч · Type Rush (зүйр үг / quotes бичих уралдаан, WPM) | `dist/type-rush/` | оноо, desc |
| 30–40 | Зурган логик · Nonogram (5×5 / 7×7 / 10×10) | `dist/nonogram/` | 10×10 секунд, **asc** |
| 40–50 | Хос олох · Pair Match (Монгол сэдэвт санах ойн тоглоом) | `dist/pair-match/` | оноо, desc |
| 50–60 | Судоку · Sudoku (уникал шийдтэй generator, тэмдэглэл, авто-хадгалалт) | `dist/sudoku/` | оноо, desc |

Бүгд: нэг `index.html` (CSS/JS inline, CDN-гүй), Монгол/Англи хэл (`Usion.getLanguage()` + toggle),
light/dark theme (`Usion.getTheme()`), `mode:'single'`-д **шууд эхэлдэг** (меню байхгүй),
game over бүрт `Usion.leaderboard.submit()` + Найзууд/Глобал самбар, `Usion.storage`-д тохиргоо/явц хадгалдаг,
"game is not a web page" reset (selection/zoom/rubber-band хаасан).

## Бүтэц

```
src/_shared.js      SDK давхарга: stub (host-гүй үед), i18n, Store (Usion.storage), Board (leaderboard UI), bootApp
src/_shared.css     дизайн систем (black/white flat, dark/light токен)
src/<game>.html     тоглоом бүр — /*SHARED_CSS*/ /*SHARED_JS*/ <!--SDK--> гэсэн placeholder-той
build.py            → dist/<game>/index.html (Path B: SDK <script> tag орсон). `--path-a` бол tag-гүй (AI Creator/S3).
test.js             Playwright smoke test (fake host SDK, тоглоом бүрийг тоглож submit шалгана)
games.json          нэр, тайлбар, leaderboard тохиргоо
publish.py          Path C — API токеноор registry-д бүртгэх/шинэчлэх
```

## Ажиллуулах

```bash
python3 build.py                      # dist/ үүсгэх
NODE_PATH=$(npm root -g) node test.js # тест (playwright шаардлагатай)
```

Локал нээхэд `usions.com/usion-sdk.js` ачаалагдвал жинхэнэ SDK, ачаалагдахгүй бол stub ажиллана (тоглоом бүтэн тоглогдоно).

## Нийтлэх (Path C)

1. `dist/`-г статик хостод байршуул (Vercel: `npx vercel dist --prod`, эсвэл GitHub Pages / S3).
   Тоглоом бүрийн URL: `https://<host>/<slug>/`.
2. Usion апп → **Service Creator → Agent API Access** → токен (`usion_sk_…`).
3. ```bash
   export USION_API_TOKEN=usion_sk_...
   export USION_BASE_URL=https://<host>
   python3 publish.py --dry-run   # payload харах
   python3 publish.py             # бүртгэх (дахин ажиллуулбал update хийнэ)
   ```
   `USION_API_URL` default: `https://mobile.mongolai.mn` (skill-д заасан backend).

Хэрэв AI Creator (Path A, S3) замаар нийтлэх бол `python3 build.py --path-a` — SDK tag-ийг платформ өөрөө оруулдаг.

## Дараагийн шат (санал)

- Type Rush, Color Dash → multiplayer race (waiting hall + `Usion.game.realtime`, skill-ийн Step 3.5 checklist).
- Nonogram — гараар зурсан puzzle багц (одоо random generator).
- Type Rush — өгүүлбэрийн санг `Usion.cloud.shared`-аас татах.
