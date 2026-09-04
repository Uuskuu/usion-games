// Smoke test: load each game with a fake host Usion, play, assert leaderboard submit + no console errors.
const { chromium } = require('playwright');
const path = require('path');
const games = ['color-dash', 'type-rush', 'nonogram', 'pair-match', 'sudoku'];

// Fake host SDK injected before page scripts (simulates https://usions.com/usion-sdk.js)
const FAKE_SDK = `
window.__calls=[];const mem={};const P=v=>Promise.resolve(v);
window.Usion={config:{},
 init(cb){const cfg={userId:'u1',userName:'Tester',theme:'dark',language:'mn',mode:'single'};this.config=cfg;setTimeout(()=>cb(cfg),50);return P(cfg);},
 getLaunchParams(){return {mode:'single'}},getTheme(){return 'dark'},getLanguage(){return 'mn'},
 user:{getId(){return 'u1'},getName(){return 'Tester'},getAvatar(){return null}},
 storage:{get(k){return P(mem[k]??null)},set(k,v){mem[k]=v;return P({success:true})},remove(k){delete mem[k];return P({success:true})},keys(){return P(Object.keys(mem))},clear(){return P({})}},
 leaderboard:{submit(s,m){window.__calls.push(['submit',s,m]);return P({success:true,score:s,best:s,rank:1,updated:true})},
   top(){return P([{user_id:'x',name:'Bat',score:500,rank:1},{user_id:'u1',name:'Tester',score:100,rank:2,is_me:true}])},
   friends(){return P([{user_id:'u1',name:'Tester',score:100,rank:1,is_me:true}])},me(){return P({score:100,rank:2,total:2})}},
 releaseBackButton(){},claimBackButton(){},share(){},exit(){}};`;

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  for (const g of games) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('https://usions.com/usion-sdk.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_SDK }));
    await page.goto('file://' + path.join(__dirname, 'dist', g, 'index.html'));
    await page.waitForTimeout(400);
    // menu/end overlays must be hidden on launch (instant play)
    const visibleOverlays = await page.$$eval('.overlay:not([hidden])', els => els.length);
    let ok = visibleOverlays === 0;
    let note = '';
    await page.screenshot({ path: `shots/${g}-1.png` });
    try {
      if (g === 'color-dash') {
        // click the correct tile 20 times using the game's state
        for (let i = 0; i < 20; i++) { await page.evaluate(() => pick(cur.answer)); }
        await page.evaluate(() => { timeLeft = 0.05; });
        await page.waitForTimeout(400);
      } else if (g === 'type-rush') {
        for (let i = 0; i < 5; i++) { const t = await page.evaluate(() => target); await page.fill('#inp', ''); await page.type('#inp', t, { delay: 5 }); }
        await page.waitForTimeout(300);
      } else if (g === 'nonogram') {
        // force 10x10 to test leaderboard branch, then fill solution
        await page.evaluate(() => { N = 10; start(); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (sol[r][c]) setCell(r, c, 1); });
        await page.waitForTimeout(300);
      } else if (g === 'pair-match') {
        await page.evaluate(async () => { const cards = [...document.querySelectorAll('.card')]; const by = {}; cards.forEach(c => { (by[deck[+c.dataset.i]] ||= []).push(c); }); for (const k in by) { flip(by[k][0]); flip(by[k][1]); } });
        await page.waitForTimeout(800);
      } else if (g === 'sudoku') {
        const uniq = await page.evaluate(() => solveCount(puzzle.slice(), 2));
        note += ` uniqueSolutions=${uniq}`; if (uniq !== 1) ok = false;
        const clues = await page.evaluate(() => puzzle.filter(Boolean).length); note += ` clues=${clues}`;
        await page.evaluate(() => { for (let i = 0; i < 81; i++) if (!given[i]) { select(i); input(solution[i]); } });
        await page.waitForTimeout(300);
      }
      const calls = await page.evaluate(() => window.__calls);
      const submitted = calls.some(c => c[0] === 'submit');
      note += ` submits=${JSON.stringify(calls.map(c => c[1]))}`;
      if (!submitted) ok = false;
      const endVisible = await page.$eval('#endOv', e => !e.hidden);
      if (!endVisible) { ok = false; note += ' endOverlayHidden'; }
      const lbRows = await page.$$eval('#lb .lbrow', e => e.length); note += ` lbRows=${lbRows}`; if (!lbRows) ok = false;
      await page.screenshot({ path: `shots/${g}-2.png` });
      if (g === 'sudoku') { await page.evaluate(() => { newGame(); select(vals.indexOf(0)); input(solution[vals.indexOf(0)]); });
        const saved = await page.evaluate(() => Usion.storage.get('sudoku:save').then(s => !!s)); note += ` saved=${saved}`; if (!saved) ok = false; }
      // language toggle works
      await page.evaluate(() => I18N.toggle()); const title = await page.$eval('.topbar h1', e => e.textContent); note += ` en="${title}"`;
      // light theme render
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await page.screenshot({ path: `shots/${g}-3-light.png` });
    } catch (e) { ok = false; note += ' EXC:' + e.message.split('\n')[0]; }
    if (errors.length) { ok = false; note += ' ERRORS:' + errors.join(' | ').slice(0, 300); }
    console.log((ok ? 'PASS' : 'FAIL'), g, 'overlaysAtLaunch=' + visibleOverlays, note);
    if (!ok) failures++;
    await ctx.close();
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
