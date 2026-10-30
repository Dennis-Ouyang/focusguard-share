/* FocusGuard 今日专注分享：朋友端（免登录）。
   数据来自 Supabase RPC fg_get_share；互动经 fg_friend_action；更新提示经 Realtime 公共广播，另有轮询兜底。 */
(() => {
  const CFG = window.FG_CONFIG || {};
  const ICON = {
    lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.6"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.4 6.6 11.4 12.5 4.8"/></svg>',
    minus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 8h6"/></svg>',
    shield: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 1.8 13 3.6v4c0 3.1-2.1 5.4-5 6.6-2.9-1.2-5-3.5-5-6.6v-4Z"/><path d="M8 1.8v12.4" stroke-opacity=".5"/></svg>',
    eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="2"/></svg>',
    spark: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.2v2.6M8 11.2v2.6M2.2 8h2.6M11.2 8h2.6M4 4l1.7 1.7M10.3 10.3 12 12M4 12l1.7-1.7M10.3 5.7 12 4"/></svg>',
    load: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2.2a5.8 5.8 0 1 1-5.8 5.8"/></svg>',
    hidden: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 2.5l11 11M6.4 4.1A6.6 6.6 0 0 1 8 3.8c4 0 6.2 4.2 6.2 4.2a10 10 0 0 1-1.6 2.1M4.2 5.4C2.7 6.6 1.8 8 1.8 8s2.2 4.2 6.2 4.2c.9 0 1.7-.2 2.4-.5"/></svg>'
  };

  const STATES = {
    focus:   { label: '专注中', c: 'var(--focus)', live: true },
    pause:   { label: '暂停中', c: 'var(--pause)' },
    rest:    { label: '休息中', c: 'var(--rest)' },
    idle:    { label: '闲暇中', c: 'var(--mute)' },
    offline: { label: '已离线', c: 'var(--mute)', hollow: true },
    empty:   { label: '还没开始', c: 'var(--mute)', hollow: true }
  };
  const NOTE = {
    pause: '你的伙伴或许正在小憩、散步，或是享受美食中。不过好的专注确实需要劳逸结合。',
    rest: '一张一弛，你的伙伴刚刚结束一轮投入，正在回血蓄力中。',
    idle: '今日已有所斩获，伙伴此刻或许正忙于生活里的其他要事。',
    offline: '伙伴的电脑似乎合上了盖子，数据停留在上次同步的时刻。',
    empty: '快去提醒你的伙伴，开始今天的第一轮专注！'
  };
  const SECRET = '某项大业';
  const OFFLINE_AFTER = 15 * 60 * 1000;
  const PUNS = [
    { k: 'ban', label: f => `封禁 ${f.target || f.app || '对应应用'}`, unit: '分钟', opts: [15, 30, 60] },
    { k: 'points', label: () => '扣除积分', unit: '积分', opts: [10, 20, 50] },
    { k: 'extra', label: () => '追加一项专注任务', unit: '分钟', opts: [15, 30, 45] }
  ];
  const CHEERS = ['加油，你可以的', '学完一起去吃饭', '再坚持一下下', '别摸鱼啦'];
  const NUDGES = ['该开始今天的第一轮啦', '一起学习吗', '今天也要加油'];

  /* ---------- local state ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let visitorKey = store.get('fg-visitor-key', '');
  if (!visitorKey) {
    const b = new Uint8Array(16); (crypto.getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; }));
    visitorKey = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    store.set('fg-visitor-key', visitorKey);
  }
  const S = {
    tab: 'now', src: 'screen', open: null, vopen: null, scrub: {}, pun: null, amt: { ban: 30, points: 20, extra: 30 },
    visitor: store.get('fg-visitor', ''), asking: null, cheerOpen: false, cheerDraft: '', busy: null, error: '',
    data: null, loaded: false
  };
  try { const t = sessionStorage.getItem('fg-tab'); if (t === 'now' || t === 'review') S.tab = t; } catch (e) {}

  const code = (() => {
    const m = location.hash.match(/#\/?s\/([A-Za-z0-9]+)/);
    if (m) return m[1];
    return new URLSearchParams(location.search).get('s') || '';
  })();

  /* ---------- time ---------- */
  let skew = 0, TZ = undefined;
  const nowMs = () => Date.now() + skew;
  const fmt = opts => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, hourCycle: 'h23', ...opts });
  const parts = (ms, opts) => Object.fromEntries(fmt(opts).formatToParts(ms).map(p => [p.type, p.value]));
  const hhmmMs = ms => { const p = parts(ms, { hour: '2-digit', minute: '2-digit' }); return `${p.hour}:${p.minute}`; };
  const hhmm = sec => hhmmMs(sec * 1000);
  const dayLabel = ms => { const p = parts(ms, { month: 'numeric', day: 'numeric', weekday: 'long' }); return `${p.month}月${p.day}日 ${p.weekday}`; };
  const mdhm = ms => { const p = parts(ms, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); return `${p.month}月${p.day}日 ${p.hour}:${p.minute}`; };
  const ms = iso => (iso ? Date.parse(iso) : NaN);
  function ago(upd) {
    const d = Math.floor((nowMs() - upd) / 60000);
    if (d < 1) return '刚刚同步';
    if (d < 60) return `${d} 分钟前同步`;
    if (d < 24 * 60) return `${Math.floor(d / 60)} 小时前同步`;
    return `上次同步 ${mdhm(upd)}`;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeURL = u => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');

  /* ---------- backend ---------- */
  async function rpc(fn, args) {
    const r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', cache: 'no-store',
      headers: { apikey: CFG.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error((body && body.message) || `HTTP ${r.status}`);
    return body;
  }

  let loading = null;
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const d = await rpc('fg_get_share', { p_code: code, p_visitor_key: visitorKey });
        if (d && d.now) skew = Date.parse(d.now) - Date.now();
        if (d && d.snapshot && d.snapshot.tz) TZ = d.snapshot.tz;
        S.data = d; S.loaded = true; S.error = '';
        if (d && d.channel) realtime(d.channel);
      } catch (e) {
        S.loaded = true;
        if (!S.data) S.error = '暂时连不上，稍后再试试。';
      } finally { loading = null; }
      render();
      schedule();
    })();
    return loading;
  }

  /* refresh while open: snapshot pushes arrive by broadcast; this is the fallback */
  let pollTimer = null;
  function schedule() {
    clearTimeout(pollTimer);
    if (document.hidden) return;
    const pending = mine().some(a => a.status === 'pending');
    const live = ['focus', 'pause', 'rest'].includes(view().key);
    pollTimer = setTimeout(load, pending ? 8000 : live ? 60000 : 180000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); else clearTimeout(pollTimer); });

  /* minimal Phoenix client for Supabase Realtime public broadcast */
  let ws = null, wsTopic = null, wsRef = 0, wsBeat = null, wsRetry = 1000;
  function realtime(channel) {
    const topic = `realtime:fg-s-${channel}`;
    if (wsTopic === topic && ws && ws.readyState <= 1) return;
    wsTopic = topic;
    try { if (ws) ws.close(); } catch (e) {}
    const url = `${CFG.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(CFG.anonKey)}&vsn=1.0.0`;
    try { ws = new WebSocket(url); } catch (e) { return; }
    const send = (t, event, payload) => ws.readyState === 1 && ws.send(JSON.stringify({ topic: t, event, payload, ref: String(++wsRef) }));
    ws.onopen = () => {
      wsRetry = 1000;
      send(topic, 'phx_join', { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false } });
      clearInterval(wsBeat); wsBeat = setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
    };
    let debounce = null;
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.topic === topic && m.event === 'broadcast') { clearTimeout(debounce); debounce = setTimeout(load, 400); }
    };
    ws.onclose = () => {
      clearInterval(wsBeat);
      if (wsTopic !== topic) return;
      setTimeout(() => { if (wsTopic === topic) { wsTopic = null; realtime(channel); } }, wsRetry);
      wsRetry = Math.min(wsRetry * 2, 60000);
    };
  }

  /* ---------- derived view ---------- */
  const mine = () => (S.data && S.data.mine) || [];
  function toChecks(list, fails) {
    return (list || []).map(c => {
      const sec = Math.round(ms(c.at) / 1000);
      const fail = c.ok ? null : (fails[c.id] || { id: c.id, app: '', why: '不合格', result: '', excused: !!c.excused });
      if (fail && c.excused) fail.excused = true;
      return { id: c.id, sec, ok: !!c.ok, friend: c.friend || null, fail, screen: c.screen, camera: c.camera, why: c.why, app: c.app };
    }).filter(c => !isNaN(c.sec)).sort((a, b) => a.sec - b.sec);
  }
  let viewCache = null;
  function view() {
    const d = S.data;
    if (viewCache && viewCache.d === d && viewCache.t === Math.floor(nowMs() / 30000)) return viewCache.v;
    const v = compute(d);
    viewCache = { d, t: Math.floor(nowMs() / 30000), v };
    return v;
  }
  function compute(d) {
    if (!d) return { key: 'loading' };
    if (d.status === 'missing') return { key: 'missing', owner: {} };
    if (d.status === 'expired') return { key: 'ended', owner: d.owner || {} };
    const snap = d.snapshot;
    const owner = d.owner || {};
    const now = nowMs();
    const base = { owner, expires: ms(d.expires_at), perms: { task: true, log: true, shots: true, acts: false }, sessions: [], current: null, fails: [] };
    if (!snap || !(ms(snap.dayEnd) > now)) {
      return { ...base, key: 'empty', dayStart: now, dayEnd: now + 864e5, upd: null, perms: (snap && snap.perms) || base.perms };
    }
    const perms = Object.assign({}, base.perms, snap.perms || {});
    const fails = {};
    (snap.fails || []).forEach(f => { fails[f.id] = { ...f, sec: Math.round(ms(f.at) / 1000) }; });
    const sessions = (snap.sessions || []).map(x => ({
      id: x.id, task: x.task, s: ms(x.start), e: ms(x.end), minutes: x.minutes, done: !!x.done, failLimit: x.failLimit || 4,
      checks: toChecks(x.checks, fails)
    })).filter(x => !isNaN(x.s) && !isNaN(x.e));
    const upd = ms(d.snapshot_at) || ms(snap.generatedAt);
    let key = snap.state;
    if (key === 'focus' && now - upd > OFFLINE_AFTER) key = 'offline';
    if (key === 'rest' && snap.restEndsAt && ms(snap.restEndsAt) < now) key = 'idle';
    if (!STATES[key]) key = 'idle';
    if (key === 'idle' && !sessions.length) key = 'empty';
    let current = null;
    if (snap.current && ['focus', 'pause', 'offline'].includes(key)) {
      const c = snap.current, s = ms(c.start);
      const at = ms(c.at) || upd;
      current = {
        id: c.id || 'cur', task: c.task, s, at: Math.round(at / 1000), plan: c.planMin, failLimit: c.failLimit || 4,
        elapsedMin: Math.floor((c.elapsedSec || 0) / 60),
        kind: key === 'offline' ? 'stale' : key === 'pause' ? 'paused' : 'live',
        checks: toChecks(c.checks, fails)
      };
    }
    return { ...base, key, perms, sessions, current, fails: Object.values(fails), upd, dayStart: ms(snap.dayStart), dayEnd: ms(snap.dayEnd), lastEnd: ms(snap.lastEnd) };
  }
  const taskName = (t, perms) => (!perms.task || !t) ? null : t;
  const realFails = list => list.filter(c => !c.ok && !c.fail.excused);

  /* ---------- evidence + detail ---------- */
  function shot(item, perms) {
    if (!perms.shots) return `<div class="shot-hidden"><span>${ICON.hidden}</span>伙伴没有公开抽查截图</div>`;
    const screen = safeURL(item.screen), camera = safeURL(item.camera);
    if (!screen && !camera) return `<div class="shot-hidden"><span>${ICON.hidden}</span>这次没有留下截图</div>`;
    const cam = (S.src === 'camera' && camera) || !screen;
    const toggle = screen && camera ? `<div class="shot-src" role="group" aria-label="证据来源"><button data-src="screen" aria-pressed="${!cam}">屏幕</button><button data-src="camera" aria-pressed="${cam}">摄像头</button></div>` : '';
    return `<div class="shot ${cam ? 'cam' : ''}"><img src="${esc(cam ? camera : screen)}" alt="${cam ? '摄像头画面' : '屏幕截图'}" loading="lazy" referrerpolicy="no-referrer">${toggle}</div>`;
  }

  function detail(c, live, v) {
    const t = hhmm(c.sec);
    if (c.ok) {
      return `<div class="detail">
        <div class="detail-top"><span class="dot" style="--c:var(--accent)"></span><span class="verdict">合格</span><span class="when">${t}  ${esc(c.friend)}发起的抽查</span></div>
        ${shot(c, v.perms)}
        <dl class="facts">${c.app ? `<dt>前台应用</dt><dd>${esc(c.app)}</dd>` : ''}<dt>判定</dt><dd>${esc(c.why || '屏幕内容与当前任务相关')}</dd></dl>
      </div>`;
    }
    const f = c.fail;
    return `<div class="detail">
      <div class="detail-top"><span class="dot" style="--c:var(--fail)"></span><span class="verdict" style="color:var(--fail)">${f.excused ? '不合格，已申诉' : '不合格'}</span><span class="when">${t}${c.friend ? `  ${esc(c.friend)}发起的抽查` : ''}</span></div>
      ${shot(f, v.perms)}
      <dl class="facts">${f.app ? `<dt>前台应用</dt><dd>${esc(f.app)}</dd>` : ''}<dt>判定</dt><dd>${esc(f.why)}</dd>${f.result ? `<dt>处理</dt><dd class="${f.excused ? 'ok' : ''}">${esc(f.result)}</dd>` : ''}</dl>
      ${live && v.perms.acts && !f.excused ? proposeBlock(f) : ''}
    </div>`;
  }

  const punText = p => {
    const pun = PUNS.find(x => x.k === p.type);
    return pun ? `${pun.label({ target: p.target })} ${p.amount} ${pun.unit}` : '追加惩罚';
  };
  function proposeBlock(f) {
    const sent = mine().filter(a => a.kind === 'punish' && a.payload && a.payload.fail_id === f.id).pop();
    if (sent) {
      const text = punText(sent.payload);
      const map = {
        pending: ['var(--pause)', `已发送给伙伴：${text}。等 TA 点头。`, true],
        approved: ['var(--focus)', `伙伴同意了，${text}已生效。`, false],
        done: ['var(--focus)', `伙伴同意了，${text}已生效。`, false],
        declined: ['var(--mute)', '伙伴这次婉拒了，或许 TA 自有分寸。', false],
        failed: ['var(--mute)', `伙伴同意了，但没能生效：${(sent.result && sent.result.message) || '当时无法执行'}`, false]
      };
      const [c, txt, live] = map[sent.status] || map.pending;
      return `<div class="propose in"><div class="status-line"><span class="dot ${live ? 'live' : ''}" style="--c:${c}"></span>${esc(txt)}</div></div>`;
    }
    return `<div class="propose" data-fail="${esc(f.id)}">
      <div class="propose-head"><span class="propose-title">追加惩罚</span><span class="propose-sub">尽管当时的惩罚或许已经结束，你仍可以追加以下惩罚。</span></div>
      <div class="puns" role="radiogroup" aria-label="选择惩罚">${PUNS.map(p => `
        <label class="pun ${S.pun === p.k ? 'on' : ''}" data-pun="${p.k}"><input type="radio" name="pun" value="${p.k}" ${S.pun === p.k ? 'checked' : ''}><span class="radio"></span><span class="pl">${esc(p.label(f))}</span>
          ${S.pun === p.k ? `<span class="chips in" role="group">${p.opts.map(n => `<button type="button" data-amt="${p.k}:${n}" aria-pressed="${S.amt[p.k] === n}">${n} ${p.unit}</button>`).join('')}</span>` : ''}</label>`).join('')}
      </div>
      ${S.pun ? `<div class="propose-foot in"><span class="propose-hint">伙伴只有同意了才会生效哦！</span><button class="btn-w warn" data-act="punish" ${S.busy === 'punish' ? 'disabled' : ''}>发送给伙伴</button></div>` : ''}
    </div>`;
  }

  /* ---------- scrubber ---------- */
  const SCR = {};
  function scrubHTML(sess, live, dim, v) {
    const sid = sess.id;
    const start = Math.floor(sess.s / 1000);
    const end = sess.plan ? start + sess.plan * 60 : Math.floor(sess.e / 1000);
    const reached = sess.at || Math.floor(sess.e / 1000);
    SCR[sid] = { sess, start, end: Math.max(end, reached, start + 60), reached, live, v };
    const span = SCR[sid].end - start;
    if (S.scrub[sid] == null || !sess.checks.some(c => c.sec === S.scrub[sid])) S.scrub[sid] = sess.checks.length ? sess.checks[sess.checks.length - 1].sec : start;
    const p = s => ((s - start) / span * 100).toFixed(3);
    const color = !sess.at || dim ? 'var(--block)' : sess.kind === 'paused' ? 'var(--pause)' : 'var(--focus)';
    const step = span > 3 * 3600 ? 120 : span > 90 * 60 ? 60 : 30;
    const minor = [];
    for (let t = Math.ceil(start / step) * step; t <= start + span; t += step) minor.push(`<i class="mt ${t > reached ? 'future' : ''}" style="left:${p(t)}%" data-sec="${t}"></i>`);
    const ticks = minor.join('') + sess.checks.map(c => `<i class="tk ${c.ok ? '' : c.fail.excused ? 'excused' : 'fail'} ${c.friend ? 'friend' : ''}" style="left:${p(c.sec)}%" data-sec="${c.sec}"></i>`).join('');
    const near = nearest(sid, S.scrub[sid]);
    return `<div class="scrub" data-sid="${esc(sid)}" style="--c:${color}">
        <div class="scrub-rail">
          ${ticks}
          <div class="playhead" tabindex="0" role="slider" aria-label="拖动查看抽查" aria-valuemin="${start}" aria-valuemax="${reached}" aria-valuenow="${S.scrub[sid]}" aria-valuetext="${hhmm(S.scrub[sid])}" style="left:${p(S.scrub[sid])}%"><span class="bubble">${hhmm(S.scrub[sid])}</span></div>
        </div>
        <div class="strip-axis"><span>${hhmm(start)}</span><span>${hhmm(start + span)}</span></div>
      </div>
      <div class="slot" data-slot="${esc(sid)}" data-cid="${near ? esc(near.id) : ''}">${slotHTML(sid, near)}</div>`;
  }
  function nearest(sid, sec) {
    const { sess } = SCR[sid];
    let best = null;
    sess.checks.forEach(c => { if (!best || Math.abs(c.sec - sec) < Math.abs(best.sec - sec)) best = c; });
    return best;
  }
  function slotHTML(sid, c) {
    if (!c) return '';
    const { sess, live, v } = SCR[sid];
    if (!c.ok) {
      const hits = realFails(sess.checks);
      const k = hits.indexOf(c);
      const limit = Math.max(sess.failLimit || 4, hits.length);
      const misses = `<div class="misses"><div class="misses-bar">${Array.from({ length: limit }, (_, i) => {
          const h = hits[i];
          return h ? `<button class="miss hit ${h === c ? 'cur' : ''}" data-jump="${esc(sid)}|${h.sec}" aria-label="跳到 ${hhmm(h.sec)} 的不合格"></button>` : `<span class="miss" aria-hidden="true"></span>`;
        }).join('')}</div><span class="misses-t">${c.fail.excused ? '这次申诉通过了，不计入失误' : `本轮第 ${k + 1} 次失误`}</span></div>`;
      return misses + detail(c, live, v);
    }
    if (c.friend) return detail(c, live, v);
    return `<div class="brief"><span class="dot" style="--c:var(--focus)"></span><span>合格</span><span class="when">${hhmm(c.sec)}</span>${c.why || c.app ? `<span class="why">${esc([c.app, c.why].filter(Boolean).join('  '))}</span>` : ''}</div>`;
  }
  function paintScrub(el, sec, dragging) {
    const sid = el.dataset.sid, cfg = SCR[sid];
    if (!cfg) return;
    const span = cfg.end - cfg.start;
    const p = (sec - cfg.start) / span * 100;
    const head = el.querySelector('.playhead'), bubble = el.querySelector('.bubble');
    head.style.left = p + '%';
    bubble.style.transform = `translateX(-${Math.min(100, Math.max(0, p)).toFixed(1)}%)`;
    const near = nearest(sid, sec);
    const w = el.querySelector('.scrub-rail').getBoundingClientRect().width || 1;
    el.querySelectorAll('.tk, .mt').forEach(tk => {
      const d = Math.abs(Number(tk.dataset.sec) - sec) / span * w;
      const k = Math.max(0, 1 - d / 56);
      tk.style.setProperty('--s', (1 + (tk.classList.contains('mt') ? 1.4 : .6) * k * k * (3 - 2 * k)).toFixed(3));
      if (tk.classList.contains('tk')) tk.classList.toggle('on', !!near && Number(tk.dataset.sec) === near.sec);
    });
    const snapped = near && Math.abs(near.sec - sec) / span * w < 7;
    bubble.textContent = hhmm(dragging ? sec : near ? near.sec : sec);
    bubble.className = 'bubble' + (snapped && near && !near.ok ? ' fail' : snapped && near && near.friend ? ' friend' : '');
    head.setAttribute('aria-valuenow', Math.round(sec));
    head.setAttribute('aria-valuetext', `${hhmm(sec)}${near ? (near.ok ? ' 合格' : ' 不合格') : ''}`);
    const slot = document.querySelector(`[data-slot="${CSS.escape(sid)}"]`);
    if (slot && near && slot.dataset.cid !== near.id) {
      slot.dataset.cid = near.id;
      slot.innerHTML = slotHTML(sid, near);
      [...slot.children].forEach(ch => { ch.classList.remove('in'); void ch.offsetWidth; ch.classList.add('in'); });
    }
  }
  let drag = null;
  const secAt = (el, x) => {
    const cfg = SCR[el.dataset.sid], r = el.querySelector('.scrub-rail').getBoundingClientRect();
    const sec = cfg.start + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (cfg.end - cfg.start);
    return Math.min(cfg.reached, Math.max(cfg.start, sec));
  };
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('.scrub');
    if (!el || !SCR[el.dataset.sid]) return;
    drag = { el, id: e.pointerId };
    el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    paintScrub(el, secAt(el, e.clientX), true);
    e.preventDefault();
  });
  document.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) paintScrub(drag.el, secAt(drag.el, e.clientX), true); });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el } = drag; drag = null;
    el.classList.remove('dragging');
    const near = nearest(el.dataset.sid, secAt(el, e.clientX));
    if (near) { S.scrub[el.dataset.sid] = near.sec; paintScrub(el, near.sec, false); }
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', e => {
    const head = e.target.closest && e.target.closest('.playhead');
    if (!head) return;
    const el = head.closest('.scrub'), sid = el.dataset.sid, checks = SCR[sid].sess.checks;
    if (!checks.length) return;
    let i = checks.findIndex(c => c.sec === S.scrub[sid]);
    if (e.key === 'ArrowRight') i = Math.min(checks.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = checks.length - 1;
    else return;
    e.preventDefault();
    S.scrub[sid] = checks[i].sec; paintScrub(el, checks[i].sec, false);
  });

  /* ---------- 现在 ---------- */
  function renderNow(v) {
    const { key, sessions, current, perms, upd } = v;
    const st = STATES[key];
    const last = sessions[sessions.length - 1];
    const dotCls = ['dot', st.live ? 'live' : '', st.hollow ? 'hollow' : ''].join(' ');
    const fresh = upd ? `<time class="fresh ${key === 'offline' ? 'stale' : ''}" title="${hhmmMs(upd)} 同步">${ago(upd)}</time>` : '';
    const row = meta => `<div class="state-row" style="--c:${st.c}"><span class="${dotCls}"></span><span class="state-label">${st.label}</span>${meta ? `<span class="state-meta">${meta}</span>` : ''}${fresh}</div>`;
    const taskH = (t, quiet) => {
      const name = taskName(t, perms);
      return name ? `<h2 class="task ${quiet ? 'quiet' : ''}">${esc(name)}</h2>` : `<h2 class="task private ${quiet ? 'quiet' : ''}">${ICON.lock}${SECRET}</h2>`;
    };
    const aside = NOTE[key] ? `<p class="aside">${NOTE[key]}</p>` : '';

    let hero = '';
    const sess = current || (key === 'rest' ? last : null);
    if (sess) {
      const nFail = realFails(sess.checks).length;
      const curMin = current ? current.elapsedMin : 0;
      const meta = [current ? `已专注 <b>${curMin}</b> 分钟` : `这一轮 <b>${last.minutes}</b> 分钟`];
      if (key === 'focus' && current.plan) meta.push(`还剩 <b>${Math.max(0, current.plan - curMin)}</b> 分钟`);
      if (key === 'pause') meta.push('已暂停');
      meta.push(`抽查 <b>${sess.checks.length}</b> 次`);
      if (nFail) meta.push(`不合格 <b class="bad">${nFail}</b> 次`);
      hero = `${row(key === 'rest' ? `${hhmmMs(last.e)} 起` : '')}${taskH(sess.task, key === 'offline')}
        <div class="meta-line">${meta.map(m => `<span>${m}</span>`).join('')}</div>
        ${scrubHTML(sess, key === 'focus', key === 'offline', v)}${aside}`;
    } else if (key === 'idle') hero = `${row(last ? `最后一轮 ${hhmmMs(last.e)} 结束` : '')}${aside}`;
    else if (key === 'empty') hero = `${row('')}<h2 class="task quiet">今天还没有专注记录</h2>${aside}`;
    return `<section class="now">${hero}</section>${renderActs(v)}`;
  }

  function renderActs(v) {
    const { key, perms } = v;
    if (!perms.acts || key === 'offline') return '';
    const canCheck = key === 'focus';
    const head = `<div class="sec-head"><span class="sec-title">和伙伴互个动</span>${S.visitor ? `<span class="sec-meta"><span>${esc(S.visitor)}</span></span>` : ''}</div>`;
    const err = S.error ? `<span class="err-line">${esc(S.error)}</span>` : '';
    if (S.asking) {
      return `<section class="sec rule" aria-label="和伙伴互动">${head}
        <form class="who-ask in" id="askForm"><label for="visitorName">先留一个称呼！</label><span class="who-ask-r">
          <input id="visitorName" maxlength="12" placeholder="比如 小林" autocomplete="nickname">
          <button class="btn-w solid" type="submit">好了</button></span></form></section>`;
    }
    if (S.cheerOpen) {
      const presets = key === 'empty' ? NUDGES : CHEERS;
      return `<section class="sec rule" aria-label="和伙伴互动">${head}
        <form class="composer in" id="cheerForm">
          <textarea id="cheerText" maxlength="60" placeholder="${key === 'empty' ? '叫 TA 一声' : '写一句想对 TA 说的话'}" aria-label="想说的话">${esc(S.cheerDraft)}</textarea>
          <div class="presets">${presets.map(p => `<button type="button" class="preset" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
          <div class="composer-foot"><span id="cheerCount">${S.cheerDraft.length} / 60</span>
            <span style="display:flex;gap:6px"><button type="button" class="btn-w ghosty" data-act="cheer-cancel">取消</button><button class="btn-w solid" type="submit" ${S.busy === 'cheer' ? 'disabled' : ''}>送出</button></span></div>
        </form>${err}</section>`;
    }
    const checks = mine().filter(a => a.kind === 'check');
    const lastCheck = checks[checks.length - 1];
    const running = S.busy === 'check' || (lastCheck && lastCheck.status === 'pending' && nowMs() - ms(lastCheck.at) < 5 * 60000);
    const left = S.data.checks_left;
    const who = ((v.owner && v.owner.nickname) || '').trim() || 'TA';
    let checkDesc = `看看 ${esc(who)} 此刻在做什么？`;
    if (running) checkDesc = '截一张图，交给 AI 看看';
    else if (lastCheck && lastCheck.status === 'failed') checkDesc = '这次没查成，稍后再试试';
    const badge = running ? '' : `<span class="act-badge">${left ? `可查 ${left} 次` : '今天已查完'}</span>`;
    const checkCard = canCheck ? `
      <button class="act ${running ? 'busy' : ''}" data-act="check" ${running || !left ? 'disabled' : ''}>${badge}
        <span class="act-t">${running ? ICON.load : ICON.eye}${running ? '正在抽查' : '立即抽查'}</span>
        <span class="act-d">${checkDesc}</span>
      </button>` : '';
    const cheers = mine().filter(a => a.kind === 'cheer');
    const lastCheer = cheers[cheers.length - 1];
    const showSent = lastCheer && nowMs() - ms(lastCheer.at) < 15 * 60000;
    const cheerT = key === 'empty' ? '提醒 TA 开始' : '为 TA 打气';
    const cheerCard = showSent ? `
      <button class="act in" data-act="cheer" aria-live="polite"><span class="act-t">${ICON.check}已送达</span><span class="act-d sent-note"><q>${esc(lastCheer.payload && lastCheer.payload.text)}</q></span></button>` : `
      <button class="act" data-act="cheer">
        <span class="act-t">${ICON.spark}${cheerT}</span>
        <span class="act-d verse">${key === 'empty' ? '流水既一去不再回头，时光更不会为你停留。\n愿你一分一秒珍惜，如今要赶上正是时候。' : '也许一生到底 一切超出估计\n但是我总会找到你鼓励'}</span>
      </button>`;
    return `<section class="sec rule" aria-label="和伙伴互动">${head}
      <div class="acts" style="${canCheck ? '' : 'grid-template-columns:1fr'}">${checkCard}${cheerCard}</div>${err}
    </section>`;
  }

  /* ---------- 今日回顾 ---------- */
  const hm = min => { const h = Math.floor(min / 60), m = min % 60; return h ? `<span data-count="${h}">${h}</span><small>小时</small><span data-count="${m}">${m}</span><small>分钟</small>` : `<span data-count="${m}">${m}</span><small>分钟</small>`; };
  function renderReview(v) {
    const { key, sessions, current, perms } = v;
    if (key === 'empty') {
      return `<section class="now"><div class="state-row" style="--c:var(--mute)"><span class="dot hollow"></span><span class="state-label">还没开始</span></div>
        <h2 class="task quiet">今天还没有专注记录</h2><p class="aside">${NOTE.empty}</p></section>`;
    }
    const st = STATES[key];
    const all = current ? sessions.concat(current) : sessions;
    const curMin = current ? current.elapsedMin : 0;
    const total = sessions.reduce((a, x) => a + (x.minutes || 0), 0) + curMin;
    const doneCount = sessions.filter(x => x.done).length;
    const checks = all.flatMap(x => x.checks);
    const passed = checks.filter(c => c.ok || c.fail.excused).length;
    const rate = checks.length ? Math.round(passed / checks.length * 100) : 100;

    const totals = `<section class="totals" aria-label="今日累计">
      <div class="total"><span class="total-k">今日专注</span><span class="total-v">${hm(total)}</span></div>
      <div class="total"><span class="total-k">完成</span><span class="total-v"><span data-count="${doneCount}">${doneCount}</span><small>轮</small></span></div>
      <div class="total"><span class="total-k">抽查合格</span><span class="total-v"><span data-count="${rate}">${rate}</span><small>%</small><small style="margin-left:2px">${passed} / ${checks.length}</small></span></div>
    </section>`;

    const span = v.dayEnd - v.dayStart;
    const pos = t => Math.min(100, Math.max(0, (t - v.dayStart) / span * 100));
    const nowM = nowMs();
    const label = t => taskName(t, perms) || SECRET;
    let segs = sessions.map(x => `<span class="seg ${x.done ? '' : 'cut'}" style="left:${pos(x.s)}%;width:${pos(x.e) - pos(x.s)}%" title="${hhmmMs(x.s)}–${hhmmMs(x.e)}  ${esc(label(x.task))}"></span>`).join('');
    if (current) {
      const l = pos(current.s), r = pos(current.at * 1000);
      segs += `<span class="seg cur ${current.kind === 'paused' ? 'paused' : ''} ${current.kind === 'stale' ? 'stale' : ''}" style="--c:${current.kind === 'stale' ? 'var(--block)' : st.c};left:${l}%;width:${r - l}%"></span>`;
      if (key === 'focus' && current.plan) segs += `<span class="seg plan" style="--c:${st.c};left:${r}%;width:${Math.max(0, pos(current.s + current.plan * 60000) - r)}%"></span>`;
    }
    const flags = realFails(checks).map(c => `<span class="flag" style="left:${pos(c.sec * 1000)}%"></span>`).join('');
    const ticks = [0, 1, 2, 3, 4, 5, 6].map(i => `<span style="left:${i / 6 * 100}%">${hhmmMs(v.dayStart + i * span / 6).slice(0, 2)}</span>`).join('');
    const timeline = `<section class="sec rule" aria-label="全天时间轴">
      <div class="tl" role="img" aria-label="全天专注时间轴">
        <div class="tl-track"><div class="tl-future" style="left:${pos(nowM)}%"></div>${segs}</div>${flags}
        <span class="nowline" style="left:${pos(nowM)}%" title="现在 ${hhmmMs(nowM)}"></span>
      </div>
      <div class="ticks" aria-hidden="true">${ticks}</div>
    </section>`;

    let log = '';
    if (perms.log && all.length) {
      const cell = t => `<span class="n ${taskName(t, perms) ? '' : 'private'}">${esc(label(t))}</span>`;
      const rows = all.map(x => {
        const isCur = x === current;
        const nf = realFails(x.checks).length;
        const open = S.open === x.id;
        return `<li class="${isCur ? 'cur' : x.done ? '' : 'cut'}" ${isCur ? `style="--c:${current.kind === 'stale' ? 'var(--ink-2)' : st.c}"` : ''}>
          <button class="row" data-open="${esc(x.id)}" aria-expanded="${open}">
            <span class="t">${hhmmMs(x.s)}–${isCur ? '' : hhmmMs(x.e)}</span>${cell(x.task)}
            <span class="q ${nf ? 'bad' : ''}">${nf ? `不合格 ${nf}` : `抽查 ${x.checks.length}`}</span>
            <span class="d">${isCur ? curMin : x.minutes} 分钟</span>
            <span class="s">${isCur ? `<span class="dot ${current.kind === 'live' ? 'live' : ''}" style="--c:${current.kind === 'stale' ? 'var(--mute)' : st.c}"></span>` : x.done ? ICON.check : ICON.minus}</span>
          </button>
          ${open ? `<div class="more">${scrubHTML(isCur ? current : x, false, false, v)}</div>` : ''}
        </li>`;
      }).join('');
      log = `<section class="sec rule" aria-label="每一轮"><div class="sec-head"><span class="sec-title">每一轮</span><span class="sec-meta"><span>点开后拖动看抽查</span></span></div><ul class="log">${rows}</ul></section>`;
    }

    const vs = all.flatMap(x => x.checks.filter(c => !c.ok).map(c => c));
    const vrows = vs.map(c => {
      const open = S.vopen === c.id;
      const f = c.fail;
      const img = safeURL(f.screen) || safeURL(f.camera);
      const isCam = !safeURL(f.screen) && !!safeURL(f.camera);
      const thumb = perms.shots && img ? `<span class="thumb ${isCam ? 'cam' : ''}"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : `<span class="thumb blank">${ICON.hidden}</span>`;
      return `<li><button class="vrow" data-vopen="${esc(c.id)}" aria-expanded="${open}">${thumb}
          <span style="min-width:0"><span class="v1" style="display:block">${esc(f.why)}</span><span class="v2">${hhmm(c.sec)}  ${esc(f.app)}</span></span>
          <span class="tag ${f.excused ? 'ok' : ''}">${f.excused ? '申诉通过' : /提前结束/.test(f.result || '') ? '本轮结束' : '已处理'}</span></button>
        ${open ? `<div class="more">${detail(c, false, v)}</div>` : ''}</li>`;
    }).join('');
    const vsec = vs.length ? `<section class="sec rule" aria-label="不合格记录"><div class="sec-head"><span class="sec-title">不合格记录</span><span class="sec-meta"><span>${vs.length} 次</span></span></div><ul class="vlist">${vrows}</ul></section>` : '';

    const visits = (S.data.visits || []).map(visitLine).filter(Boolean);
    const vis = visits.length ? `<section class="sec rule" aria-label="朋友来访"><div class="sec-head"><span class="sec-title">朋友来访</span></div>
      <ul class="visits">${visits.join('')}</ul></section>` : '';
    return `${totals}${timeline}${log}${vsec}${vis}`;
  }
  function visitLine(a) {
    let what = '';
    if (a.kind === 'check') what = a.status === 'done' ? `发起了一次抽查，${a.result && a.result.ok ? '合格' : '不合格'}` : a.status === 'pending' ? '发起了一次抽查' : '发起了一次抽查，没查成';
    else if (a.kind === 'cheer') what = '为 TA 打了气';
    else if (a.kind === 'punish') what = `提议追加惩罚：${punText(a.payload || {})}${a.status === 'declined' ? '，被婉拒了' : a.status === 'pending' ? '' : a.status === 'failed' ? '，没能生效' : '，已生效'}`;
    if (!what) return '';
    return `<li><span class="t">${hhmmMs(ms(a.at))}</span><span>${esc(a.visitor)}${esc(what)}</span></li>`;
  }

  /* ---------- shell ---------- */
  function head(v, tabs) {
    const owner = v.owner || {};
    const avatar = safeURL(owner.avatar_url);
    const name = (owner.nickname || '').trim() || '伙伴';
    const date = v.dayStart ? dayLabel(v.dayStart) : dayLabel(nowMs());
    return `<header class="head">
        <div class="head-id">${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : ''}
          <div class="head-title"><h1>${esc(name)}今天的专注</h1><span class="head-date">${date}</span></div></div>
        ${tabs ? `<div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="now" aria-selected="${S.tab === 'now'}">现在</button>
          <button class="tab" role="tab" data-tab="review" aria-selected="${S.tab === 'review'}">今日回顾</button><span class="tab-ind" aria-hidden="true"></span></div>` : ''}
      </header>`;
  }
  function renderPage(enter) {
    if (!CFG.url || !CFG.anonKey) return `<article class="card"><div class="loading">分享服务还没有配置好。</div></article>`;
    if (!code) return ended({ owner: {} }, '这个链接似乎不完整，请向你的伙伴重新获取。', enter);
    if (!S.loaded) return `<article class="card"><div class="loading">正在打开…</div></article>`;
    if (!S.data) return `<article class="card"><div class="loading">${esc(S.error || '暂时连不上，稍后再试试。')}</div></article>`;
    const v = view();
    if (v.key === 'ended') return ended(v, '此分享链接已过期，请向你的伙伴重新获取。', enter);
    if (v.key === 'missing') return ended(v, '没有找到这个分享，请向你的伙伴重新获取。', enter);
    document.title = `${(v.owner.nickname || '').trim() || '伙伴'}今天的专注`;
    return `<article class="card">
      ${head(v, true)}<div class="tabs-wrap"></div>
      <div class="panel ${enter ? 'enter' : ''}">${S.tab === 'now' ? renderNow(v) : renderReview(v)}</div>
      <footer class="foot rule"><span>有效期至 ${mdhm(v.expires)}</span><a href="https://github.com/Dennis-Ouyang/FocusGuard" target="_blank" rel="noopener">${ICON.shield}FocusGuard</a></footer>
    </article>`;
  }
  function ended(v, text, enter) {
    return `<article class="card">${head(v, false)}<div class="ended ${enter ? 'enter' : ''}"><h2><span>无可奈何花落去，</span><span>似曾相识燕归来。</span></h2>
      <p>${esc(text)}</p></div></article>`;
  }

  /* ---------- render + motion ---------- */
  const $ = s => document.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = { tab: null, key: null }, ind = null;
  function render() {
    if (drag) return;
    const active = document.activeElement;
    const keepFocus = active && (active.id === 'cheerText' || active.id === 'visitorName');
    if (keepFocus) return;
    const key = S.data ? view().key : 'loading';
    const enter = last.tab !== S.tab || last.key !== key;
    $('#share').innerHTML = renderPage(enter);
    last = { tab: S.tab, key };
    placeIndicator();
    document.querySelectorAll('.scrub').forEach(el => paintScrub(el, S.scrub[el.dataset.sid], false));
    if (enter && S.tab === 'review' && !reduce) countUp();
    const inp = $('#visitorName') || $('#cheerText'); if (inp) inp.focus();
  }
  function placeIndicator() {
    const el = $('.tab-ind'), on = $('.tab[aria-selected="true"]');
    if (!el || !on) return;
    const next = { left: on.offsetLeft, width: on.offsetWidth };
    if (ind && !reduce) {
      el.style.transition = 'none'; el.style.left = ind.left + 'px'; el.style.width = ind.width + 'px';
      void el.offsetWidth; el.style.transition = '';
    }
    el.style.left = next.left + 'px'; el.style.width = next.width + 'px';
    ind = next;
  }
  function countUp() {
    const els = [...document.querySelectorAll('[data-count]')];
    const t0 = performance.now(), D = 700;
    const tick = now => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      els.forEach(el => { el.textContent = Math.round(Number(el.dataset.count) * e); });
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const friendlyError = m => ({
    'fg: check limit': '今天的抽查次数用完了。',
    'fg: not focusing': 'TA 现在没在专注，抽查不了。',
    'fg: actions disabled': '伙伴关闭了互动。',
    'fg: share unavailable': '这个分享已经失效了。',
    'fg: cheer limit': '今天的话已经说得够多啦。',
    'fg: punish limit': '今天的提议已经够多啦。',
    'fg: punish pending': '上一个提议还在等 TA 回应。'
  }[(m || '').trim()] || '没发出去，稍后再试试。');

  async function act(kind, payload) {
    S.busy = kind; S.error = ''; render();
    try {
      await rpc('fg_friend_action', { p_code: code, p_visitor_key: visitorKey, p_visitor: S.visitor, p_kind: kind, p_payload: payload || {} });
      if (kind === 'cheer') { S.cheerOpen = false; S.cheerDraft = ''; }
      if (kind === 'punish') S.pun = null;
    } catch (e) {
      S.error = friendlyError(e.message);
    }
    S.busy = null;
    await load();
  }
  function runAction(kind) {
    if (kind === 'check') act('check');
    else if (kind === 'cheer') { S.cheerOpen = true; S.error = ''; render(); }
    else if (kind === 'punish') {
      const box = document.querySelector('.propose[data-fail]');
      const v = view();
      const f = box && v.fails.find(x => x.id === box.dataset.fail);
      if (!f || !S.pun) return;
      act('punish', { type: S.pun, amount: S.amt[S.pun], fail_id: f.id, target: f.target || f.app || '', at: f.at });
    }
  }

  document.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'askForm') {
      const v = $('#visitorName').value.trim();
      if (!v) { $('#visitorName').focus(); return; }
      S.visitor = v.slice(0, 12); store.set('fg-visitor', S.visitor);
      const kind = S.asking; S.asking = null;
      $('#visitorName').blur();
      runAction(kind);
    } else if (e.target.id === 'cheerForm') {
      const v = $('#cheerText').value.trim();
      if (!v) { $('#cheerText').focus(); return; }
      S.cheerDraft = v; $('#cheerText').blur();
      act('cheer', { text: v });
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'cheerText') { S.cheerDraft = e.target.value; const c = $('#cheerCount'); if (c) c.textContent = `${e.target.value.length} / 60`; }
  });
  document.addEventListener('click', e => {
    const t = e.target;
    const tab = t.closest('[data-tab]');
    if (tab) { S.tab = tab.dataset.tab; try { sessionStorage.setItem('fg-tab', S.tab); } catch (err) {} render(); return; }
    const jump = t.closest('[data-jump]');
    if (jump) { const [sid, sec] = jump.dataset.jump.split('|'); S.scrub[sid] = Number(sec); const el = document.querySelector(`.scrub[data-sid="${CSS.escape(sid)}"]`); if (el) paintScrub(el, Number(sec), false); return; }
    const src = t.closest('[data-src]');
    if (src) { S.src = src.dataset.src; render(); return; }
    const op = t.closest('[data-open]');
    if (op) { S.open = S.open === op.dataset.open ? null : op.dataset.open; render(); return; }
    const vo = t.closest('[data-vopen]');
    if (vo) { S.vopen = S.vopen === vo.dataset.vopen ? null : vo.dataset.vopen; render(); return; }
    const amt = t.closest('[data-amt]');
    if (amt) { e.preventDefault(); const [k, n] = amt.dataset.amt.split(':'); S.amt[k] = Number(n); S.pun = k; render(); return; }
    const pun = t.closest('[data-pun]');
    if (pun) { e.preventDefault(); if (S.pun !== pun.dataset.pun) { S.pun = pun.dataset.pun; render(); } return; }
    const preset = t.closest('[data-preset]');
    if (preset) { const ta = $('#cheerText'); ta.value = preset.dataset.preset; S.cheerDraft = ta.value; $('#cheerCount').textContent = `${ta.value.length} / 60`; ta.focus(); return; }
    const a = t.closest('[data-act]');
    if (a && !a.disabled) {
      if (a.dataset.act === 'cheer-cancel') { S.cheerOpen = false; S.error = ''; $('#cheerText') && $('#cheerText').blur(); render(); return; }
      if (!S.visitor) { S.asking = a.dataset.act; render(); return; }
      runAction(a.dataset.act);
    }
  });
  window.addEventListener('resize', () => document.querySelectorAll('.scrub').forEach(el => paintScrub(el, S.scrub[el.dataset.sid], false)));
  window.addEventListener('hashchange', () => location.reload());
  setInterval(() => { if (!document.hidden) render(); }, 30000);

  render();
  if (CFG.url && CFG.anonKey && code) load();
})();
