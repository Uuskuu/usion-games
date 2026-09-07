// Smoke test: solo round + a real 2-player race over a fake relay.
// The fake host SDK simulates https://usions.com/usion-sdk.js; a Node-side relay
// carries action()/realtime() between the two browser contexts, so the waiting
// hall, the seeded queue, the host loop and the gameover path are all exercised.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.join(__dirname, 'dist', 'type-rush', 'index.html');

// Fake host SDK injected before page scripts. __send/__deliver bridge to Node.
const FAKE_SDK = (me, name, mode, roomId, playerIds, bareReceipt) => `
window.__calls=[];window.__errors=[];const mem={};const P=v=>Promise.resolve(v);
const H={};                                   // event name -> handler
window.__deliver=(ev,m)=>{ if(H[ev]) H[ev](m); };
window.Usion={config:{},
 init(cb){const cfg={userId:'${me}',userName:'${name}',theme:'dark',language:'mn',mode:'${mode}',roomId:${JSON.stringify(roomId)},playerIds:${JSON.stringify(playerIds)}};this.config=cfg;setTimeout(()=>cb(cfg),30);return P(cfg);},
 getLaunchParams(){return {mode:'${mode}',roomId:${JSON.stringify(roomId)}}},getTheme(){return 'dark'},getLanguage(){return 'mn'},
 user:{getId(){return '${me}'},getName(){return '${name}'},getAvatar(){return null}},
 storage:{get(k){return P(mem[k]??null)},set(k,v){mem[k]=v;return P({success:true})},remove(k){delete mem[k];return P({success:true})},keys(){return P(Object.keys(mem))},clear(){return P({})}},
 wallet:{getBalance(){return P(5000)},hasCredits(){return P(true)},onBalanceChange(){},
   requestPayment(a,r,o){window.__calls.push(['pay',a,r,o&&o.idempotencyKey]);return P(${bareReceipt?"{receiptToken:\'rt_bare\'}":"{success:true,newBalance:5000-a,receiptToken:\'rt_test_1\',transactionId:\'tx1\'}"})}},
 leaderboard:{submit(s,m){window.__calls.push(['submit',s,m]);return P({success:true,score:s,best:s,previous:null,rank:1,updated:true})},
   top(){return P([{user_id:'x',name:'Bat',score:500,rank:1},{user_id:'${me}',name:'${name}',score:100,rank:2,is_me:true}])},
   friends(){return P([{user_id:'${me}',name:'${name}',score:100,rank:1,is_me:true}])},me(){return P({score:100,rank:2,total:2})}},
 game:{
   connect(){return P(true)}, join(r){window.__calls.push(['join',r]);setTimeout(()=>H.joined&&H.joined({player_ids:${JSON.stringify(playerIds)}}),10);return P({room_id:r})},
   isConnected(){return true}, isMultiplayer(){return '${mode}'==='multiplayer'},
   action(t,d){window.__calls.push(['action',t]);window.__send('action',{player_id:'${me}',action_type:t,action_data:d});return P({success:true,sequence:1})},
   realtime(t,d){window.__send('realtime',{player_id:'${me}',action_type:t,action_data:d});return P({success:true})},
   invite(){window.__calls.push(['invite']);return P({success:true,roomId:${JSON.stringify(roomId)},invited:['x']})},
   reportResult(r){window.__calls.push(['reportResult',r]);return P({success:true})},
   requestSync(){}, setState(){return P({success:true})}, saveState(){return false}, loadState(){return null},
   onJoined(cb){H.joined=cb}, onPlayerJoined(cb){H.player_joined=cb}, onPlayerLeft(cb){H.player_left=cb},
   onRoomAssigned(cb){H.room_assigned=cb}, onAction(cb){H.action=cb}, onRealtime(cb){H.realtime=cb},
   onSync(cb){H.sync=cb}, onError(cb){H.error=cb}, onConnectionState(cb){H.conn=cb}, onReconnected(cb){H.reconn=cb},
   onDisconnect(){}, onReconnect(){}, onPlayerConnection(){}, onGameFinished(){}, onStateUpdate(){}
 },
 releaseBackButton(){},claimBackButton(){},share(){},exit(){}};`;

async function newPage(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // serve the fake SDK in place of the real one the built page loads from usions.com
  await page.route('https://mobile.mongolai.mn/**', r => {
    receipts.push(r.request().url());
    // opts.deadSettle simulates the CORS/network failure that used to strand the unlock
    if (opts.deadSettle) return r.abort('failed');
    return r.fulfill({ contentType: 'application/json', body: '{"outcome":"settled","status":"completed"}' });
  });
  await page.route('https://usions.com/usion-sdk.js', r => r.fulfill({
    contentType: 'application/javascript',
    body: FAKE_SDK(opts.me, opts.name, opts.mode, opts.roomId, opts.playerIds, !!opts.bareReceipt),
  }));
  return { ctx, page, errors };
}

const receipts = [];

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  const fail = (what, why) => { console.log('FAIL', what, why); failures++; };
  const ok = (what, note) => console.log('PASS', what, note || '');

  /* ---------- 1. solo: instant play, score submit, records ---------- */
  {
    const { ctx, page, errors } = await newPage(browser, { me: 'u1', name: 'Tester', mode: 'single', roomId: null, playerIds: ['u1'] });
    await page.exposeFunction('__send', () => {});
    await page.goto(URL);
    await page.waitForTimeout(400);
    const overlays = await page.$$eval('.overlay:not([hidden])', e => e.length);
    if (overlays !== 0) fail('solo', 'overlay visible at launch: ' + overlays);
    // a fresh round starts on the caret, never on an error mark
    const first = await page.evaluate(() => ({
      cls: document.querySelector('#text span').className,
      acc: document.getElementById('acc').textContent,
    }));
    if (!/\bcur\b/.test(first.cls) || /\bbad\b/.test(first.cls)) fail('solo', 'first character is not the caret: ' + first.cls);
    if (first.acc !== '100%') fail('solo', 'accuracy at launch is ' + first.acc);
    await page.screenshot({ path: 'shots/type-rush-1-solo.png' });
    // keyboard open: the whole game must still fit above it, with nothing panned off screen
    await page.setViewportSize({ width: 390, height: 420 });
    await page.waitForTimeout(300);
    const fits = await page.evaluate(() => {
      const h = window.innerHeight;
      const off = ['.stats', '#tbarw', '#typebox'].filter(sel => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return r.top < -1 || r.bottom > h + 1;
      });
      return { off, scrolled: window.scrollY };
    });
    if (fits.off.length || fits.scrolled) fail('solo', `keyboard layout: offscreen=${fits.off.join(',')} scrollY=${fits.scrolled}`);
    // and the whole sentence stays readable inside the card, never cut off
    const clip = await page.evaluate(() => {
      const box = document.getElementById('typebox').getBoundingClientRect();
      const spans = [...document.querySelectorAll('#text span')];
      const last = spans[spans.length - 1].getBoundingClientRect();
      return { over: last.bottom - box.bottom, chars: spans.length };
    });
    if (clip.over > -2) fail('solo', `sentence clipped by ${clip.over.toFixed(0)}px with the keyboard open`);
    await page.screenshot({ path: 'shots/type-rush-11-keyboard.png' });
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(250);
    const nSolo = await page.evaluate(() => R.sents);
    for (let i = 0; i < nSolo; i++) { const t = await page.evaluate(() => target); await page.fill('#inp', ''); await page.type('#inp', t, { delay: 4 }); }
    await page.waitForTimeout(400);
    const calls = await page.evaluate(() => window.__calls);
    if (!calls.some(c => c[0] === 'submit')) fail('solo', 'no leaderboard submit');
    if (await page.$eval('#endOv', e => e.hidden)) fail('solo', 'end overlay hidden');
    const lbRows = await page.$$eval('#lb .lbrow', e => e.length);
    if (!lbRows) fail('solo', 'leaderboard empty');
    const recs = await page.$$eval('#endRecs .rec', e => e.length);
    if (recs !== 6) fail('solo', 'record tiles=' + recs);
    const best = await page.evaluate(() => Usion.storage.get('type-rush:records').then(r => r && r.best));
    if (!best) fail('solo', 'best not persisted');
    await page.screenshot({ path: 'shots/type-rush-2-solo-end.png' });
    // records panel + language toggle + light theme
    await page.evaluate(() => openRecords());   // topbar sits under the end overlay, as designed
    if (await page.$eval('#recOv', e => e.hidden)) fail('solo', 'records panel did not open');
    await page.evaluate(() => I18N.toggle());
    const title = await page.$eval('.topbar h1', e => e.textContent);
    if (title !== 'Type Rush') fail('solo', 'i18n toggle: ' + title);
    await page.screenshot({ path: 'shots/type-rush-3-records.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.waitForTimeout(300);                           // let the colour transitions settle
    await page.screenshot({ path: 'shots/type-rush-4-light.png' });
    if (errors.length) fail('solo', 'console: ' + errors.join(' | ').slice(0, 300));
    if (!failures) ok('solo', `submits=${JSON.stringify(calls.filter(c => c[0] === 'submit').map(c => c[1]))} best=${best}`);
    await ctx.close();
  }

  /* ---------- 2. multiplayer: waiting hall -> race -> gameover ---------- */
  {
    const before = failures;
    const ids = ['u1', 'u2'];
    const host = await newPage(browser, { me: 'u1', name: 'Host', mode: 'multiplayer', roomId: 'room1', playerIds: ids });
    const guest = await newPage(browser, { me: 'u2', name: 'Guest', mode: 'multiplayer', roomId: 'room1', playerIds: ids });
    const peers = [host, guest];
    for (const p of peers) {
      await p.page.exposeFunction('__send', async (kind, msg) => {
        for (const q of peers) {
          if (q === p) continue;                              // relay: never echo to the sender
          await q.page.evaluate(([k, m]) => window.__deliver(k, m), [kind, msg]).catch(() => {});
        }
      });
      await p.page.goto(URL);
    }
    await host.page.waitForTimeout(600);
    for (const p of peers) if (await p.page.$eval('#hallOv', e => e.hidden)) fail('mp', 'waiting hall not shown');
    // both rosters list two players
    for (const p of peers) {
      const n = await p.page.$$eval('#roster .pl', e => e.length);
      if (n !== 2) fail('mp', 'roster rows=' + n);
    }
    await host.page.screenshot({ path: 'shots/type-rush-5-hall.png' });
    // host start is gated until everyone is ready
    if (!(await host.page.$eval('#startBtn', e => e.disabled))) fail('mp', 'start enabled before READY');
    if (!(await guest.page.$eval('#startBtn', e => e.hidden))) fail('mp', 'guest sees the host Start button');
    await guest.page.click('#readyBtn');
    await host.page.click('#readyBtn');
    await host.page.waitForTimeout(300);
    if (await host.page.$eval('#startBtn', e => e.disabled)) fail('mp', 'start still disabled after both READY');
    // quick chat rides the relay
    await guest.page.evaluate(() => Chat.send('Сайн уу! 👋'));
    await host.page.waitForTimeout(150);
    await host.page.click('#startBtn');
    await host.page.waitForTimeout(2900);                     // 3-2-1 countdown
    for (const p of peers) {
      if (p.page.url() && await p.page.$eval('#track', e => e.hidden)) fail('mp', 'race track hidden');
      const seats = await p.page.$$eval('#track .lane', e => e.length);
      if (seats !== 2) fail('mp', 'track rows=' + seats);
    }
    // both clients derived the same sentence queue from the host's seed
    const q1 = await host.page.evaluate(() => queue.map(q => q[0]).join('|'));
    const q2 = await guest.page.evaluate(() => queue.map(q => q[0]).join('|'));
    if (q1 !== q2) fail('mp', 'seeded queues differ');
    await host.page.screenshot({ path: 'shots/type-rush-6-race.png' });
    // host types the whole race, guest only the first sentence -> host must win
    const nRace = await host.page.evaluate(() => R.sents);
    for (let i = 0; i < nRace; i++) { const t = await host.page.evaluate(() => target); await host.page.fill('#inp', ''); await host.page.type('#inp', t, { delay: 3 }); }
    const g = await guest.page.evaluate(() => target); await guest.page.fill('#inp', ''); await guest.page.type('#inp', g, { delay: 3 });
    await host.page.waitForTimeout(1200);
    const seenBeforeGrace = await host.page.evaluate(() => (R.prog['u2'] || {}).f || 0);
    await host.page.waitForTimeout(11000);      // the first finisher gives the rest a 10s grace
    // the guest's progress reached the host's aggregated state
    const guestSeen = seenBeforeGrace;
    if (!(guestSeen > 0)) fail('mp', 'host never saw the guest progress');
    // host ends the race and both sides land on the result
    for (const p of peers) if (await p.page.$eval('#endOv', e => e.hidden)) fail('mp', 'end overlay hidden');
    const hostTitle = await host.page.$eval('#endTitle', e => e.textContent);
    const guestTitle = await guest.page.$eval('#endTitle', e => e.textContent);
    if (!/Түрүүл|won/i.test(hostTitle)) fail('mp', 'host is not the winner: ' + hostTitle);
    if (/Түрүүл|won/i.test(guestTitle)) fail('mp', 'guest also won: ' + guestTitle);
    const hostCalls = await host.page.evaluate(() => window.__calls);
    const rr = hostCalls.find(c => c[0] === 'reportResult');
    if (!rr) fail('mp', 'host did not reportResult');
    else if (rr[1].winnerId !== 'u1') fail('mp', 'reportResult winner=' + rr[1].winnerId);
    if (!hostCalls.some(c => c[0] === 'action')) fail('mp', 'race_start was not a stored action');
    for (const p of peers) {
      const c = await p.page.evaluate(() => window.__calls);
      if (!c.some(x => x[0] === 'submit')) fail('mp', 'no leaderboard submit');
      const wins = await p.page.evaluate(() => Records.get('races'));
      if (wins !== 1) fail('mp', 'races record=' + wins);
    }
    await host.page.screenshot({ path: 'shots/type-rush-7-race-end.png' });
    for (const p of peers) if (p.errors.length) fail('mp', 'console: ' + p.errors.join(' | ').slice(0, 300));
    if (failures === before) ok('multiplayer', `host="${hostTitle}" guest="${guestTitle}" winner=${rr && rr[1].winnerId}`);
    for (const p of peers) await p.ctx.close();
  }

  /* ---------- 3. bots: the waiting-hall escape hatch ---------- */
  {
    const before = failures;
    const { ctx, page, errors } = await newPage(browser, { me: 'u1', name: 'Solo', mode: 'single', roomId: null, playerIds: ['u1'] });
    await page.exposeFunction('__send', () => {});
    await page.goto(URL);
    await page.waitForTimeout(400);
    await page.evaluate(() => openHall(null));
    await page.click('#botsBtn');
    await page.waitForTimeout(3200);                          // countdown
    const seats = await page.$$eval('#track .lane', e => e.length);
    if (seats !== 3) fail('bots', 'track rows=' + seats);
    await page.waitForTimeout(1500);
    const botMoved = await page.evaluate(() => Object.keys(R.bots).some(id => (R.prog[id] || {}).f > 0));
    if (!botMoved) fail('bots', 'bots never advanced');
    await page.screenshot({ path: 'shots/type-rush-8-bots.png' });
    if (errors.length) fail('bots', 'console: ' + errors.join(' | ').slice(0, 300));
    if (failures === before) ok('bots', 'seats=' + seats);
    await ctx.close();
  }

  /* ---------- 4. hard level: short, symbol-heavy sentences render and type exactly ---------- */
  {
    const before = failures;
    const { ctx, page, errors } = await newPage(browser, { me: 'u1', name: 'Sym', mode: 'single', roomId: null, playerIds: ['u1'] });
    await page.exposeFunction('__send', () => {});
    await page.goto(URL);
    await page.waitForTimeout(400);
    // english hard pool: brackets, digits, &, <, > — the escaping path
    await page.evaluate(() => { tl = 'en'; lvl = 3; startSolo(); });
    await page.waitForTimeout(200);
    const n = await page.evaluate(() => R.sents);
    if (n !== 5) fail('hard', 'sentence count=' + n);
    const lens = await page.evaluate(() => queue.map(q => q[0].length));
    if (Math.max(...lens) > 45) fail('hard', 'hard sentences are not short: ' + lens.join(','));
    for (let i = 0; i < n; i++) {
      // what the player reads must be exactly what they have to type (no &amp; leaking through)
      const [shown, want] = await page.evaluate(() => [document.getElementById('text').textContent, target]);
      if (shown !== want) fail('hard', `rendered "${shown}" != target "${want}"`);
      await page.fill('#inp', '');
      await page.type('#inp', want, { delay: 3 });
    }
    await page.waitForTimeout(400);
    if (await page.$eval('#endOv', e => e.hidden)) fail('hard', 'round did not finish');
    const acc = await page.evaluate(() => +document.getElementById('acc').textContent.replace('%', ''));
    if (acc !== 100) fail('hard', 'typing the exact text scored ' + acc + '% accuracy');
    await page.screenshot({ path: 'shots/type-rush-9-hard.png' });
    // a phone keyboard opens unshifted: typing the sentence in lower case must still be clean
    await page.evaluate(() => { tl = 'en'; lvl = 1; startSolo(); });
    await page.waitForTimeout(200);
    const nLower = await page.evaluate(() => R.sents);
    for (let i = 0; i < nLower; i++) {
      const want = await page.evaluate(() => target);
      await page.fill('#inp', '');
      await page.type('#inp', want.toLowerCase(), { delay: 3 });
    }
    await page.waitForTimeout(300);
    const lowerAcc = await page.evaluate(() => +document.getElementById('acc').textContent.replace('%', ''));
    if (lowerAcc !== 100) fail('hard', 'lower-case typing scored ' + lowerAcc + '% (missed Shift should not count)');
    if (await page.$eval('#endOv', e => e.hidden)) fail('hard', 'lower-case round did not finish');
    // the settings panel explains what the levels mean
    await page.evaluate(() => { markChips(); openMenu(); });
    await page.waitForTimeout(250);
    const help = await page.$eval('.lvlhelp', e => e.textContent.trim());
    if (!help) fail('hard', 'level help line is empty');
    await page.screenshot({ path: 'shots/type-rush-10-levels.png' });
    if (errors.length) fail('hard', 'console: ' + errors.join(' | ').slice(0, 300));
    if (failures === before) ok('hard level', `sentences=${n} maxLen=${Math.max(...lens)} acc=${acc}%`);
    await ctx.close();
  }

  /* ---------- 5. tabs: Race, and the practice course ---------- */
  {
    const before = failures;
    const { ctx, page, errors } = await newPage(browser, { me: 'u1', name: 'Tabs', mode: 'single', roomId: null, playerIds: ['u1'] });
    await page.exposeFunction('__send', () => {});
    await page.goto(URL);
    await page.waitForTimeout(400);
    if (await page.$eval('#tabs', e => e.hidden)) fail('tabs', 'tab bar hidden on a solo launch');
    if (!(await page.$eval('#tabs .tab', e => e.classList.contains('on')))) fail('tabs', 'race tab not active by default');

    // practice tab opens a grid of finger cards
    await page.click('[data-tab="drill"]');
    await page.waitForTimeout(300);
    if (await page.$eval('#lessons', e => e.hidden)) fail('tabs', 'practice tab did not open the course');
    const cards = await page.$$eval('#llist .fcard', cs => cs.map(c => ({
      name: c.querySelector('.fname').textContent,
      keys: c.querySelector('.fkeys').textContent,
      hand: !!c.querySelector('.hand'),
      badge: c.querySelector('.fbadge').textContent,
    })));
    if (cards.length !== 8) fail('tabs', 'expected 8 finger cards, got ' + cards.length);
    if (!cards.every(c => c.hand)) fail('tabs', 'a finger card has no hand illustration');
    if (cards[0].name !== 'Зүүн гарын долоовор хуруу') fail('tabs', 'first card is ' + cards[0].name);
    if (cards[4].name !== 'Баруун гарын долоовор хуруу') fail('tabs', 'fifth card is ' + cards[4].name);
    if (cards[0].keys !== 'ө а ж э с м ₮ :') fail('tabs', 'left index keys are ' + cards[0].keys);
    if (cards[0].badge !== '0/5') fail('tabs', 'card progress badge reads ' + cards[0].badge);
    if (!(await page.$('#llist .les.free'))) fail('tabs', 'free typing row missing from the grid');
    await page.screenshot({ path: 'shots/type-rush-12-lessons.png' });

    // tapping a card opens that finger's lessons
    await page.click('#llist .fcard');
    await page.waitForTimeout(250);
    if (await page.$eval('#lesUp', e => e.hidden)) fail('tabs', 'no back button inside a finger');
    if (await page.$eval('#lTitle', e => e.textContent) !== 'Зүүн гарын долоовор хуруу') fail('tabs', 'finger screen title is wrong');
    let rows = await page.$$('#llist .les');
    if (rows.length !== 5) fail('tabs', 'finger opened with ' + rows.length + ' lessons');
    await page.screenshot({ path: 'shots/type-rush-16-finger.png' });

    // lesson 2 is behind the paywall, lesson 1 is not
    if (await page.$eval('#buyBar', e => e.hidden)) fail('pay', 'unlock bar not shown to a locked user');
    const locks = await page.$$eval('#llist .les', els => ({ first: els[0].classList.contains('lock'), second: els[1].classList.contains('lock') }));
    if (locks.first) fail('pay', 'the first lesson is not free');
    if (!locks.second) fail('pay', 'later lessons are not locked');
    await rows[1].click();
    await page.waitForTimeout(250);
    if (await page.$eval('#payOv', e => e.hidden)) fail('pay', 'locked lesson did not open the unlock sheet');
    await page.screenshot({ path: 'shots/type-rush-15-unlock.png' });
    await page.click('#payCancel');
    await page.waitForTimeout(150);

    // lesson 1 drills exactly the left index home-row keys
    await page.click('#llist .les');
    await page.waitForTimeout(300);
    const les = await page.evaluate(() => ({ i: R.lesson, drill: R.drill, endless: R.endless, lines: queue.length, text: queue[0][0] }));
    if (les.i !== 0 || !les.drill || les.endless) fail('tabs', 'lesson round not started (i=' + les.i + ')');
    if (!/^[өа ]+$/.test(les.text)) fail('tabs', 'lesson 1 drills the wrong keys: ' + les.text);

    // a lesson teaches Shift: the wrong case is a mistake here, unlike in a race
    const wrongCase = await page.evaluate(() => target.toUpperCase());
    await page.fill('#inp', '');
    await page.type('#inp', wrongCase.slice(0, 6), { delay: 2 });
    const strict = await page.evaluate(() => ({
      acc: +document.getElementById('acc').textContent.replace('%', ''),
      bad: document.querySelectorAll('#text .bad').length,
    }));
    if (strict.acc === 100 || !strict.bad) fail('tabs', 'lesson accepted the wrong case (acc=' + strict.acc + ')');
    if (await page.evaluate(() => inp.getAttribute('autocapitalize')) !== 'off') fail('tabs', 'lesson leaves auto-capitalise on');

    await page.evaluate(() => { startLesson(0); });
    await page.waitForTimeout(250);
    for (let i = 0; i < les.lines; i++) { const w = await page.evaluate(() => target); await page.fill('#inp', ''); await page.type('#inp', w, { delay: 1 }); }
    await page.waitForTimeout(400);
    if (await page.$eval('#lesOv', e => e.hidden)) fail('tabs', 'lesson result did not show');
    const lesBest = await page.evaluate(() => lessonBest(0));
    if (!lesBest) fail('tabs', 'lesson best WPM was not stored');
    if (await page.evaluate(() => window.__calls.some(c => c[0] === 'submit'))) fail('tabs', 'a lesson submitted a score');
    await page.screenshot({ path: 'shots/type-rush-13-lesson.png' });

    // the result screen goes back to the finger it came from, and the lesson is marked done
    await page.click('#lesBack');
    await page.waitForTimeout(250);
    if (await page.$eval('#lTitle', e => e.textContent) !== 'Зүүн гарын долоовор хуруу') fail('tabs', 'result did not return to the finger');
    if (!(await page.$eval('#llist .les', e => e.classList.contains('done')))) fail('tabs', 'finished lesson not marked done');
    await page.click('#lesUp');
    await page.waitForTimeout(200);
    if (await page.$eval('#llist .fcard .fbadge', e => e.textContent) !== '1/5') fail('tabs', 'card badge did not count the finished lesson');

    // paying once unlocks every lesson, and the receipt is settled immediately
    await page.click('#llist .fcard');
    await page.waitForTimeout(200);
    rows = await page.$$('#llist .les');
    await rows[1].click();
    await page.waitForTimeout(200);
    await page.click('#payGo');
    await page.waitForTimeout(700);
    const paid = await page.evaluate(() => ({ pro, calls: window.__calls.filter(c => c[0] === 'pay'), lesson: R.lesson }));
    if (!paid.pro) fail('pay', 'unlock flag not set after payment');
    if (paid.calls.length !== 1 || paid.calls[0][1] !== 1000) fail('pay', 'wallet charge was ' + JSON.stringify(paid.calls));
    if (!paid.calls[0][3]) fail('pay', 'no idempotency key on the charge');
    if (paid.lesson !== 1) fail('pay', 'the lesson the user wanted did not start (lesson=' + paid.lesson + ')');
    if (!receipts.some(u => u.endsWith('/wallet/receipt/settle'))) fail('pay', 'receipt was never settled');
    if (await page.evaluate(() => Usion.storage.get('type-rush:receipt'))) fail('pay', 'settled receipt still pending in storage');
    await page.evaluate(() => { fingerOpen = 0; lessonScreen(); });
    await page.waitForTimeout(200);
    if (await page.$$eval('#llist .les', els => els.filter(e => e.classList.contains('lock')).length)) fail('pay', 'rows still locked after paying');
    if (!(await page.$eval('#buyBar', e => e.hidden))) fail('pay', 'unlock bar still shown after paying');

    // switching the course language switches the alphabet being drilled
    await page.click('#lesUp');
    await page.waitForTimeout(150);
    await page.click('#langBtn');
    await page.waitForTimeout(300);
    const en = await page.$$eval('#llist .fcard', cs => ({
      first: cs[0].querySelector('.fkeys').textContent,
      name: cs[0].querySelector('.fname').textContent,
      badge: cs[0].querySelector('.fbadge').textContent,
    }));
    if (en.first !== 'f g r t v b 4 5') fail('tabs', 'english course keys are ' + en.first);
    if (en.name !== 'Left index finger') fail('tabs', 'interface did not switch with the course, got ' + en.name);
    if (en.badge !== '0/5') fail('tabs', 'mongolian progress leaked into the english course');
    await page.click('#llist .fcard');
    await page.waitForTimeout(200);
    await page.click('#llist .les');
    await page.waitForTimeout(250);
    const enText = await page.evaluate(() => queue[0][0]);
    if (!/^[fg ]+$/.test(enText)) fail('tabs', 'english lesson 1 drills the wrong keys: ' + enText);
    await page.screenshot({ path: 'shots/type-rush-14-english.png' });
    await page.click('[data-tab="drill"]');   // tapping the active tab returns to the grid
    await page.waitForTimeout(250);
    await page.click('#langBtn');             // back to Mongolian, one control for both
    await page.waitForTimeout(250);
    if (await page.$eval('#llist .fcard .fbadge', e => e.textContent) !== '1/5') fail('tabs', 'mongolian progress lost after switching back');

    // free typing: untimed and endless
    await page.click('#llist .les.free');
    await page.waitForTimeout(400);
    const drill = await page.evaluate(() => ({
      on: R.drill, endless: R.endless, bar: document.getElementById('tbarw').hidden,
      dots: document.getElementById('dots').hidden, track: document.getElementById('track').hidden,
    }));
    if (!drill.on || !drill.endless) fail('tabs', 'free typing did not start');
    if (!drill.bar || !drill.dots || !drill.track) fail('tabs', 'free typing still shows the race chrome');
    const many = (await page.evaluate(() => R.sents)) + 2;
    for (let i = 0; i < many; i++) { const w = await page.evaluate(() => target); await page.fill('#inp', ''); await page.type('#inp', w, { delay: 2 }); }
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      typed: finished, ended: document.getElementById('endOv').hidden, t: document.getElementById('time').textContent,
      subs: window.__calls.filter(c => c[0] === 'submit').length,
    }));
    if (!after.ended) fail('tabs', 'free typing showed a game-over screen');
    if (after.typed < many) fail('tabs', 'free typing stopped after ' + after.typed + ' sentences');
    if (after.subs) fail('tabs', 'free typing submitted a score');
    if (after.t === '0:00') fail('tabs', 'practice clock did not count up');

    // and back to the scored mode
    await page.click('[data-tab="race"]');
    await page.waitForTimeout(300);
    if (await page.evaluate(() => R.drill)) fail('tabs', 'race tab did not leave practice');
    if (await page.$eval('#lessons', e => !e.hidden)) fail('tabs', 'lesson screen still showing in race mode');
    if (errors.length) fail('tabs', 'console: ' + errors.join(' | ').slice(0, 300));
    if (failures === before) ok('practice course', '8 fingers, lesson1=' + lesBest + 'wpm, freeTyped=' + after.typed + ', clock=' + after.t);
    await ctx.close();
  }

  /* ---------- 6. the unlock survives a host that answers oddly and a settle that fails ---------- */
  {
    const before = failures;
    const { ctx, page, errors } = await newPage(browser, {
      me: 'u9', name: 'Payer', mode: 'single', roomId: null, playerIds: ['u9'],
      bareReceipt: true, deadSettle: true,
    });
    await page.exposeFunction('__send', () => {});
    await page.goto(URL);
    await page.waitForTimeout(400);
    await page.click('[data-tab="drill"]');
    await page.waitForTimeout(300);
    await page.click('#llist .fcard');
    await page.waitForTimeout(250);
    await (await page.$$('#llist .les'))[1].click();
    await page.waitForTimeout(200);
    await page.click('#payGo');
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({ pro, lesson: R.lesson, sheet: document.getElementById('payOv').hidden }));
    if (!st.pro) fail('pay-resilience', 'a charged user was left locked out');
    if (!st.sheet) fail('pay-resilience', 'unlock sheet stayed open after paying');
    if (st.lesson !== 1) fail('pay-resilience', 'the requested lesson did not start');
    // the unsettled receipt is kept so the next launch can capture it
    const kept = await page.evaluate(() => Usion.storage.get('type-rush:receipt'));
    if (kept !== 'rt_bare') fail('pay-resilience', 'unsettled receipt was not kept for retry, got ' + kept);
    // the aborted settle logs a network error on purpose here; anything else is a real fault
    const real = errors.filter(e => !/ERR_FAILED|mongolai/.test(e));
    if (real.length) fail('pay-resilience', 'console: ' + real.join(' | ').slice(0, 200));
    if (failures === before) ok('payment resilience', 'unlocked despite a bare reply and a dead settle endpoint');
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
})();
