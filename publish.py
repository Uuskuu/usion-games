#!/usr/bin/env python3
"""Register / update the games in the Usion service registry (Path C, API token).

Usage (run on YOUR machine, the token never goes into the repo):
  export USION_API_TOKEN=usion_sk_...          # Service Creator -> Agent API Access
  export USION_BASE_URL=https://<your-host>    # where dist/ is hosted, e.g. https://usion-games.vercel.app
  export USION_API_URL=https://mobile.mongolai.mn   # optional, default shown
  python3 publish.py               # register all (skips ones already registered by name -> updates them)
  python3 publish.py --dry-run     # print payloads only
  python3 publish.py --only type-rush # one game
"""
import json, os, sys, urllib.request, urllib.error
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # Windows consoles default to cp1252
except Exception: pass

API = os.environ.get('USION_API_URL', 'https://mobile.mongolai.mn').rstrip('/')
TOKEN = os.environ.get('USION_API_TOKEN')
BASE = os.environ.get('USION_BASE_URL', '').rstrip('/')
DRY = '--dry-run' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method,
        headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def main():
    if not DRY and (not TOKEN or not BASE):
        sys.exit('Set USION_API_TOKEN and USION_BASE_URL (or use --dry-run).')
    games = json.load(open(os.path.join(os.path.dirname(__file__), 'games.json'), encoding='utf-8'))
    existing = {}
    if not DRY:
        st, mine = req('GET', '/registry/services/my')
        if st == 200 and isinstance(mine, (list, dict)):
            items = mine if isinstance(mine, list) else mine.get('items') or mine.get('services') or []
            existing = {s.get('name'): s for s in items if isinstance(s, dict)}
        else:
            print('warn: could not list existing services:', st, str(mine)[:200])
    for g in games:
        if ONLY and g['slug'] != ONLY: continue
        payload = {
            'name': g['name'],
            'description': g['description'],
            'service_type': 'game',
            'iframe_url': f"{BASE or 'https://HOST'}/{g['slug']}/",
            'cost': 0,
            'tags': ['game', 'iframe', 'multiplayer'],
            'min_players': 1,
            'max_players': g.get('max_players', 6),
            'realtime': {'connection_mode': 'platform', 'connection_transport': 'websocket'},
            'is_published': True,
            'guest_access': 'full',
            'leaderboard': g['leaderboard'],
            'metadata': {'age_group': g['age'], 'languages': ['mn', 'en']},
        }
        if DRY:
            print(json.dumps(payload, ensure_ascii=False, indent=2)); continue
        if g['name'] in existing and existing[g['name']].get('id'):
            sid = existing[g['name']]['id']
            st, res = req('PUT', f'/registry/services/my/{sid}', payload)
            print(f"[update] {g['slug']} -> {st} {str(res)[:160]}")
        else:
            st, res = req('POST', '/registry/services/register', payload)
            print(f"[register] {g['slug']} -> {st} {str(res)[:160]}")
            if st == 200 and isinstance(res, dict) and res.get('id'):
                st2, res2 = req('PATCH', f"/registry/services/my/{res['id']}/publish", {'is_published': True})
                print(f"   publish -> {st2}")

if __name__ == '__main__':
    main()
