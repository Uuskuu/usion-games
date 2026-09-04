// Smoke test: solo round + a real 2-player race over a fake relay.
// The fake host SDK simulates https://usions.com/usion-sdk.js; a Node-side relay
// carries action()/realtime() between the two browser contexts, so the waiting
// hall, the seeded queue, the host loop and the gameover path are all exercised.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.join(__dirname, 'dist', 'type-rush', 'index.html');

// Fake host SDK injected before page scripts. __send/__deliver bridge to Node.
const FAKE_SDK = (me, name, mode, roomId, playerIds) => `
window.__calls=[];window.__errors=[];const mem={};const P=v=>Promise.resolve(v);
const H={};                                   // event name -> handler
window.__deliver=(ev,m)=>{ if(H[ev]) H[ev](m); };
window.Usion={config:{},
 init(cb){const cfg={userId:'${me}',userName:'${name}',theme:'dark',language:'mn',mode:'${mode}',roomId:${JSON.stringify(roomId)},playerIds:${JSON.stringify(playerIds)}};this.config=cfg;setTimeout(()=>cb(cfg),30);return P(cfg);},
 getLaunchParams(){return {mode:'${mode}',roomId:${JSON.stringify(roomId)}}},getTheme(){return 'dark'},getLanguage(){return 'mn'},
 user:{getId(){return '${me}'},getName(){return '${name}'},getAvatar(){return null}},
 storage:{get(k){return P(mem[k]??null)},set(k,v){mem[k]=v;return P({success:true})},remove(k){delete mem[k];return P({success:true})},keys(){return P(Object.keys(mem))},clear(){return P({})}},
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
  await page.route('https://usions.com/usion-sdk.js', r => r.fulfill({
    contentType: 'application/javascript',
    body: FAKE_SDK(opts.me, opts.name, opts.mode, opts.roomId, opts.playerIds),
  }));
  return { ctx, page, errors };
}

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
    await page.screenshot({ path: 'shots/type-rush-1-solo.png' });
    for (let i = 0; i < 5; i++) { const t = await page.evaluate(() => target); await page.fill('#inp', ''); await page.type('#inp', t, { delay: 4 }); }
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
      const seats = await p.page.$$eval('#track .trk', e => e.length);
      if (seats !== 2) fail('mp', 'track rows=' + seats);
    }
    // both clients derived the same sentence queue from the host's seed
    const q1 = await host.page.evaluate(() => queue.map(q => q[0]).join('|'));
    const q2 = await guest.page.evaluate(() => queue.map(q => q[0]).join('|'));
    if (q1 !== q2) fail('mp', 'seeded queues differ');
    await host.page.screenshot({ path: 'shots/type-rush-6-race.png' });
    // host types the whole race, guest only the first sentence -> host must win
    for (let i = 0; i < 5; i++) { const t = await host.page.evaluate(() => target); await host.page.fill('#inp', ''); await host.page.type('#inp', t, { delay: 3 }); }
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
    const seats = await page.$$eval('#track .trk', e => e.length);
    if (seats !== 3) fail('bots', 'track rows=' + seats);
    await page.waitForTimeout(1500);
    const botMoved = await page.evaluate(() => Object.keys(R.bots).some(id => (R.prog[id] || {}).f > 0));
    if (!botMoved) fail('bots', 'bots never advanced');
    await page.screenshot({ path: 'shots/type-rush-8-bots.png' });
    if (errors.length) fail('bots', 'console: ' + errors.join(' | ').slice(0, 300));
    if (failures === before) ok('bots', 'seats=' + seats);
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
})();
