# Usion mini-games — Type Rush

| Нас | Тоглоом | Хавтас | Leaderboard |
|-----|---------|--------|-------------|
| 20–30 | Хурдан бичээч · Type Rush (зүйр үг / quotes бичих уралдаан, WPM, 2–6 хүн live race) | `dist/type-rush/` | оноо, desc |

Нэг `index.html` (CSS/JS inline, CDN-гүй), Монгол/Англи хэл (`Usion.getLanguage()` + toggle),
light/dark theme (`Usion.getTheme()`), `mode:'single'`-д **шууд эхэлдэг** (меню байхгүй),
game over бүрт `Usion.leaderboard.submit()` + Найзууд/Глобал самбар, `Usion.storage`-д тохиргоо/явц хадгалдаг,
"game is not a web page" reset (selection/zoom/rubber-band хаасан).

## Горимууд

**Ганцаараа (`mode:'single'`, GameTok/Explore)** — нээмэгц шууд эхэлдэг. 5 өгүүлбэр, цаг хязгаартай,
эцэст нь оноо, WPM, нарийвчлал + **дээд амжилтын самбар** (🏆 товч): дээд оноо, дээд WPM,
дээд нарийвчлал, бичсэн өгүүлбэр, уралдааны тоо, ялалт — `Usion.storage`-д хадгалагдаж,
`Usion.leaderboard.submit()`-ээр Game Center-т ордог ("найз чиний рекордыг давлаа" мэдэгдэл эндээс гарна).

**Найзуудтай (`mode:'multiplayer'`, чат урилга)** — **хүлээх танхим**: хэн ирсэн, тус бүр READY,
хост л эхлүүлнэ (доод тал нь 2 хүн), `Usion.game.invite()`-ээр платформын найз сонгогч нээгдэнэ,
хэн ч ирэхгүй бол "Ботуудтай" гарц. Дараа нь 3-2-1 тоолол → **live race**: бүгд ижил өгүүлбэрүүдийг
(хостын seed-ээс гаралтай) бичиж, дэлгэц дээр тус бүрийн явц/WPM бар-аар харагдана.
Эхнийх нь дуусмагц бусдад 10 секундын эцсийн боломж өгөөд уралдаан дуусна.

Техникийн тал: хост эрхтэй (`playerIds[0]`) — 15 Гц-ээр `realtime('state')` цацаж, ялагчийг шийдэж,
`Usion.game.reportResult()`-ээр чатад дүнгийн карт илгээнэ. Уралдааны эхлэл нь `action('race_start')`
(sequenced + stored) тул дахин холбогдоход sync-ээс сэргээгддэг. Тоглогч бүр өөрийн оноогоо
leaderboard-д илгээнэ. Тоглоом дотор **шуурхай чат** (8 бэлэн хэллэг + өөрөө бичих) —
`realtime('quick_chat')`-аар, дэлгэц дээр богино bubble болж харагдана.
Холболт тасрахад "Дахин холбогдож байна…" overlay, гарсан тоглогчид 20с grace.

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

- Өгүүлбэрийн санг `Usion.cloud.shared`-аас татаж, тогтмол шинэчлэх.
- Rating board (`mode:"rating"`) — уралдааны ELO зэрэглэл.
