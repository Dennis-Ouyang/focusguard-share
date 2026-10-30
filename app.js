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
    x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
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

  /* access password: kept for this tab only, sent with every call */
  const pwKey = `fg-pw-${code}`;
  const sharePassword = () => { try { return sessionStorage.getItem(pwKey) || null; } catch (e) { return S.pw || null; } };
  const setPassword = v => { S.pw = v; try { v ? sessionStorage.setItem(pwKey, v) : sessionStorage.removeItem(pwKey); } catch (e) {} };

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
        const d = await rpc('fg_get_share', { p_code: code, p_visitor_key: visitorKey, p_password: sharePassword(), p_visitor: S.visitor || null });
        if (d && d.status === 'locked' && sharePassword()) setPassword('');
        if (d && d.now) skew = Date.parse(d.now) - Date.now();
        if (d && d.snapshot && d.snapshot.tz) TZ = d.snapshot.tz;
        S.data = d; S.loaded = true; if (!modalStep()) S.error = '';
        trackWatched();
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
    const pending = mine().some(a => a.status === 'pending' || a.status === 'judging');
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
      return { id: c.id, sec, ok: !!c.ok, friend: c.friend || null, judge: c.judge || null, fail, screen: c.screen, camera: c.camera, why: c.why, app: c.app };
    }).filter(c => !isNaN(c.sec)).sort((a, b) => a.sec - b.sec);
  }
  const toPatrols = list => (list || []).map(p => ({ id: p.id, sec: Math.round(ms(p.at) / 1000), patrol: true, ok: true,
    target: p.target || '', why: p.why || '', ban: p.ban || 0, screen: p.screen })).filter(p => !isNaN(p.sec));
  const toPauses = list => (list || []).map(([a, b]) => [ms(a) / 1000, ms(b) / 1000]).filter(([a, b]) => b > a);
  const marksOf = sess => sess.checks.concat(sess.patrols || []).sort((a, b) => a.sec - b.sec);
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
    if (d.status === 'expired') return { key: 'ended', owner: d.owner || {}, once: d.scope === 'once' };
    if (d.status === 'locked') return { key: 'locked', owner: d.owner || {}, once: d.scope === 'once', pwLen: d.pw_len || 4,
      lockedUntil: ms(d.locked_until), wrong: !!d.wrong };
    const snap = d.snapshot;
    const owner = d.owner || {};
    const now = nowMs();
    const base = { owner, expires: ms(d.expires_at), perms: { task: true, log: true, shots: true, acts: false }, sessions: [], current: null, fails: [] };
    if (!snap || !(ms(snap.dayEnd) > now)) {
      if (d.scope === 'once') return { ...base, key: 'ended', once: true };
      return { ...base, key: 'empty', dayStart: now, dayEnd: now + 864e5, upd: null, perms: (snap && snap.perms) || base.perms };
    }
    const perms = Object.assign({}, base.perms, snap.perms || {});
    const fails = {};
    (snap.fails || []).forEach(f => { fails[f.id] = { ...f, sec: Math.round(ms(f.at) / 1000) }; });
    const sessions = (snap.sessions || []).map(x => ({
      id: x.id, task: x.task, s: ms(x.start), e: ms(x.end), minutes: x.minutes, done: !!x.done, failLimit: x.failLimit || 4,
      checks: toChecks(x.checks, fails), patrols: toPatrols(x.patrols), pauses: toPauses(x.pauses)
    })).filter(x => !isNaN(x.s) && !isNaN(x.e));
    const upd = ms(d.snapshot_at) || ms(snap.generatedAt);
    let key = snap.state;
    if (key === 'focus' && now - upd > OFFLINE_AFTER) key = 'offline';
    if (key === 'rest' && snap.restEndsAt && ms(snap.restEndsAt) < now) key = 'idle';
    if (!STATES[key]) key = 'idle';
    if (key === 'idle' && !sessions.length) key = 'empty';
    const once = d.scope === 'once';
    let current = null;
    if (snap.current && ['focus', 'pause', 'offline'].includes(key)) {
      const c = snap.current, s = ms(c.start);
      // while focusing, the round keeps running after the last sync: project it to this moment
      const synced = ms(c.at) || upd;
      const live = key === 'focus' ? Math.max(0, now - synced) : 0;
      const elapsedSec = Math.min((c.elapsedSec || 0) + live / 1000, (c.planMin || Infinity) * 60);
      const at = synced + live;
      current = {
        id: c.id || 'cur', task: c.task, s, e: at, at: Math.round(at / 1000), plan: c.planMin, failLimit: c.failLimit || 4,
        elapsedMin: Math.floor(elapsedSec / 60),
        patrols: toPatrols(c.patrols), pauses: toPauses(c.pauses),
        kind: key === 'offline' ? 'stale' : key === 'pause' ? 'paused' : 'live',
        checks: toChecks(c.checks, fails)
      };
    }
    let shown = sessions, roundEnded = false;
    if (once) {
      // a single-round share shows only its round: live while it runs, then the end page until the link expires
      if (current && current.id === d.session_id) shown = [];
      else {
        const round = sessions.find(x => x.id === d.session_id);
        if (!round) return { ...base, key: 'ended', once: true };
        shown = [round]; current = null; key = 'rest'; roundEnded = true;
      }
    }
    const roundStart = once ? (current ? current.s : shown[0].s) : null;
    return { ...base, key, perms, sessions: shown, current, fails: Object.values(fails), upd, dayStart: ms(snap.dayStart), dayEnd: ms(snap.dayEnd),
      lastEnd: ms(snap.lastEnd), once, roundEnded, roundStart };
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
        <div class="detail-top"><span class="dot" style="--c:var(--accent)"></span><span class="verdict">合格</span><span class="when">${t}  ${esc(c.friend)}发起${c.judge && c.judge !== 'ai' ? `，${esc(c.judge)}判定` : c.judge === 'ai' ? '，超时由 AI 判定' : '的抽查'}</span></div>
        ${shot(c, v.perms)}
        <dl class="facts">${c.app ? `<dt>前台应用</dt><dd>${esc(c.app)}</dd>` : ''}<dt>判定</dt><dd>${esc(c.why || '屏幕内容与当前任务相关')}</dd></dl>
      </div>`;
    }
    const f = c.fail;
    return `<div class="detail">
      <div class="detail-top"><span class="dot" style="--c:var(--fail)"></span><span class="verdict" style="color:var(--fail)">${f.excused ? '不合格，已申诉' : '不合格'}</span><span class="when">${t}${f.judge ? `  ${esc(f.judge)}判定` : c.friend ? `  ${esc(c.friend)}发起的抽查` : ''}</span></div>
      ${shot(f, v.perms)}
      <dl class="facts">${f.app ? `<dt>前台应用</dt><dd>${esc(f.app)}</dd>` : ''}<dt>${f.judge ? '理由' : '判定'}</dt><dd>${esc(f.why)}</dd>${f.result ? `<dt>处理</dt><dd class="${f.excused ? 'ok' : ''}">${esc(f.result)}</dd>` : ''}</dl>
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
      <div class="propose-head"><span class="propose-title">追加惩罚</span><span class="propose-sub">你仍可以追加以下惩罚。</span></div>
      <div class="puns" role="radiogroup" aria-label="选择惩罚">${PUNS.map(p => `
        <label class="pun ${S.pun === p.k ? 'on' : ''}" data-pun="${p.k}"><input type="radio" name="pun" value="${p.k}" ${S.pun === p.k ? 'checked' : ''}><span class="radio"></span><span class="pl">${esc(p.label(f))}</span>
          ${S.pun === p.k ? `<span class="chips in" role="group">${p.opts.map(n => `<button type="button" data-amt="${p.k}:${n}" aria-pressed="${S.amt[p.k] === n}">${n} ${p.unit}</button>`).join('')}</span>` : ''}</label>`).join('')}
      </div>
      ${S.pun ? `<div class="propose-foot in"><span class="propose-hint">伙伴只有同意了才会生效哦！</span><button class="btn-w warn" data-act="punish" ${S.busy === 'punish' ? 'disabled' : ''}>发送给伙伴</button></div>` : ''}
    </div>`;
  }

  function patrolDetail(p, v) {
    const pic = !v.perms.shots ? `<div class="shot-hidden"><span>${ICON.hidden}</span>伙伴没有公开截图</div>`
      : safeURL(p.screen) ? `<div class="shot"><img src="${esc(p.screen)}" alt="屏幕截图" loading="lazy" referrerpolicy="no-referrer"></div>`
      : `<div class="shot-hidden"><span>${ICON.hidden}</span>这次没有留下截图</div>`;
    return `<div class="detail">
      <div class="detail-top"><span class="dot" style="--c:var(--patrol)"></span><span class="verdict" style="color:var(--patrol)">实时巡查</span><span class="when">${hhmm(p.sec)}</span></div>
      ${pic}
      <dl class="facts"><dt>拦截</dt><dd>封禁 ${esc(p.target)} ${p.ban} 分钟</dd><dt>原因</dt><dd>${esc(p.why)}</dd></dl>
    </div>`;
  }

  /* ---------- per-round scrubber (今日回顾) ----------
     One set of ticks, every 30 s. A check takes over the tick nearest to it and is drawn wider;
     the slots around it stretch by exactly that extra width, so every gap on the rail stays the same.
     Time ↔ x is then piecewise linear through the slots, and the playhead follows the same map. */
  const SCR = {};
  const SC_TICK = 1.5, SC_CHECK = 3.5, SC_PITCH = 5;
  function scrubHTML(sess, live, v) {
    const sid = sess.id;
    const start = Math.floor(sess.s / 1000);
    const end = Math.max(Math.floor(sess.e / 1000), start + 60);
    SCR[sid] = { sess, start, end, reached: end, live, v };
    if (S.scrub[sid] == null || !marksOf(sess).some(c => c.sec === S.scrub[sid])) S.scrub[sid] = sess.checks.length ? sess.checks[sess.checks.length - 1].sec : start;
    const near = nearest(sid, S.scrub[sid]);
    return `<div class="scrub" data-sid="${esc(sid)}" style="--c:var(--block)">
        <div class="scrub-rail">
          <div class="playhead" tabindex="0" role="slider" aria-label="拖动查看抽查" aria-valuemin="${start}" aria-valuemax="${end}" aria-valuenow="${S.scrub[sid]}" aria-valuetext="${hhmm(S.scrub[sid])}"><span class="bubble">${hhmm(S.scrub[sid])}</span></div>
        </div>
        <div class="strip-axis"><span>${hhmm(start)}</span><span>${hhmm(end)}</span></div>
      </div>
      <div class="slot" data-slot="${esc(sid)}" data-cid="${near ? esc(near.id) : ''}">${slotHTML(sid, near)}</div>`;
  }
  function nearest(sid, sec) {
    const { sess } = SCR[sid];
    let best = null;
    marksOf(sess).forEach(c => { if (!best || Math.abs(c.sec - sec) < Math.abs(best.sec - sec)) best = c; });
    return best;
  }
  function slotHTML(sid, c) {
    if (!c) return '';
    const { sess, live, v } = SCR[sid];
    if (c.patrol) return patrolDetail(c, v);
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
  const rankCheck = c => (!c.ok && !c.fail.excused) ? 3 : c.friend ? 2 : !c.ok ? 1 : 0;
  function layoutScrub(el) {
    const cfg = SCR[el.dataset.sid], rail = el.querySelector('.scrub-rail');
    const W = rail.clientWidth;
    if (!W || el._w === W) return;
    el._w = W;
    const { start, end, reached, sess } = cfg, span = end - start;
    const ts = [];
    // fixed on-screen density: one tick every SC_PITCH px whatever the round's length, so every round reads alike
    const count = Math.max(2, Math.floor(W / SC_PITCH) + 1), step = span / (count - 1);
    for (let j = 0; j < count; j++) ts.push(start + j * step);
    cfg.step = step;
    const own = new Array(ts.length).fill(null);
    sess.checks.forEach(c => {
      const j = Math.min(ts.length - 1, Math.max(0, Math.round((c.sec - ts[0]) / step)));
      if (!own[j] || rankCheck(c) > rankCheck(own[j])) own[j] = c;
    });
    const x0 = (ts[0] - start) / span * W, xN = (ts[ts.length - 1] - start) / span * W;
    const extra = (SC_CHECK - SC_TICK) / 2;
    let widen = 0;
    for (let j = 0; j < ts.length - 1; j++) widen += extra * (!!own[j] + !!own[j + 1]);
    const a = (xN - x0 - widen) / Math.max(1, ts.length - 1);
    const xs = [x0];
    for (let j = 1; j < ts.length; j++) xs.push(xs[j - 1] + a + extra * (!!own[j - 1] + !!own[j]));
    cfg.ts = ts; cfg.xs = xs; cfg.W = W;
    rail.querySelectorAll('.tk, .mt, .pd').forEach(n => n.remove());
    cfg.checkX = new Map();
    const head = rail.querySelector('.playhead');
    ts.forEach((t, j) => {
      const c = own[j], i = document.createElement('i');
      if (c) {
        cfg.checkX.set(c.sec, xs[j]);
        i.className = `tk ${c.ok ? '' : c.fail.excused ? 'excused' : 'fail'} ${c.friend ? 'friend' : ''}`;
        i.dataset.sec = c.sec;
        i.dataset.h = !c.ok && !c.fail.excused || c.friend ? 18 : 15;
      } else {
        const paused = (sess.pauses || []).some(([a, b]) => t >= a && t <= b);
        i.className = `mt ${t > reached ? 'future' : ''} ${paused ? 'paused' : ''}`;
        i.dataset.sec = t; i.dataset.h = 10;
      }
      i.dataset.x = xs[j];
      i.style.left = xs[j].toFixed(2) + 'px';
      rail.insertBefore(i, head);
    });
    (sess.patrols || []).forEach(pt => {
      const i = document.createElement('i');
      i.className = 'pd'; i.dataset.sec = pt.sec; i.style.left = scrubX(cfg, pt.sec).toFixed(2) + 'px';
      cfg.checkX.set(pt.sec, scrubX(cfg, pt.sec));
      rail.insertBefore(i, head);
    });
  }
  function scrubX(cfg, sec) {
    const { ts, xs, W } = cfg, span = cfg.end - cfg.start;
    if (sec <= ts[0]) return (sec - cfg.start) / span * W;
    if (sec >= ts[ts.length - 1]) return xs[xs.length - 1] + (sec - ts[ts.length - 1]) / span * W;
    const j = Math.min(ts.length - 2, Math.floor((sec - ts[0]) / cfg.step));
    return xs[j] + (xs[j + 1] - xs[j]) * (sec - ts[j]) / cfg.step;
  }
  function scrubSec(cfg, x) {
    const { ts, xs, W } = cfg, span = cfg.end - cfg.start;
    if (x <= xs[0]) return cfg.start + x / W * span;
    if (x >= xs[xs.length - 1]) return ts[ts.length - 1] + (x - xs[xs.length - 1]) / W * span;
    let j = 0; while (j < xs.length - 2 && xs[j + 1] < x) j++;
    return ts[j] + cfg.step * (x - xs[j]) / (xs[j + 1] - xs[j]);
  }
  function paintScrub(el, sec, dragging) {
    const sid = el.dataset.sid, cfg = SCR[sid];
    if (!cfg) return;
    layoutScrub(el);
    if (!cfg.xs) return;
    const near0 = !dragging && nearest(sid, sec);
    const hx = near0 && near0.sec === sec && cfg.checkX.has(sec) ? cfg.checkX.get(sec) : scrubX(cfg, sec), p = hx / cfg.W * 100;
    const head = el.querySelector('.playhead'), bubble = el.querySelector('.bubble');
    head.style.left = hx.toFixed(2) + 'px';
    bubble.style.transform = `translateX(-${Math.min(100, Math.max(0, p)).toFixed(1)}%)`;
    const near = nearest(sid, sec);
    el.querySelectorAll('.tk, .mt').forEach(tk => {
      const d = Math.abs(Number(tk.dataset.x) - hx);
      const k = Math.max(0, 1 - d / 56);
      // every tick grows by the same 12px at the playhead, so they all move together
      tk.style.setProperty('--s', (1 + 12 / Number(tk.dataset.h) * k * k * (3 - 2 * k)).toFixed(3));
      if (tk.classList.contains('tk')) tk.classList.toggle('on', !!near && Number(tk.dataset.sec) === near.sec);
    });
    el.querySelectorAll('.pd').forEach(d => d.classList.toggle('on', !!near && near.patrol && Number(d.dataset.sec) === near.sec));
    const snapped = near && Math.abs((cfg.checkX.get(near.sec) ?? scrubX(cfg, near.sec)) - hx) < 7;
    bubble.textContent = hhmm(dragging ? sec : near ? near.sec : sec);
    bubble.className = 'bubble' + (snapped && near && near.patrol ? ' patrol' : snapped && near && !near.ok ? ' fail' : snapped && near && near.friend ? ' friend' : '');
    head.setAttribute('aria-valuenow', Math.round(sec));
    head.setAttribute('aria-valuetext', `${hhmm(sec)}${near ? (near.patrol ? ' 实时巡查' : near.ok ? ' 合格' : ' 不合格') : ''}`);
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
    layoutScrub(el);
    const sec = scrubSec(cfg, Math.min(r.width, Math.max(0, x - r.left)));
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
    const head = e.target.closest && e.target.closest('.scrub .playhead');
    if (!head) return;
    const el = head.closest('.scrub'), sid = el.dataset.sid, checks = marksOf(SCR[sid].sess);
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

  /* ---------- 现在: a window onto today's real timeline ----------
     The rail is the share day (04:00 → next 04:00) seen through a viewport [v0, v1] in epoch seconds.
     Ticks keep a fixed 3px pitch on screen, so zooming changes how much time each tick covers, never how dense the rail looks.
     On open the viewport fits this round from its start to its projected end; while paused, the projected end slides right in real time. */
  const PITCH = 3, MIN_SPAN = 8 * 60;
  const VP = { key: null, round: null, v0: 0, v1: 1, sel: null, anim: null, touched: false, headTouched: false, m: 0, mT: 0, mRaf: 0, fresh: false };
  let VD = null, LASTV = null;

  function viewData(v) {
    const { key, sessions, current } = v;
    const nowSec = Math.floor(nowMs() / 1000);
    const spans = sessions.map(x => ({ s: x.s / 1000, e: x.e / 1000, k: x.done ? 'done' : 'cut' }));
    sessions.concat(current ? [current] : []).forEach(x => (x.pauses || []).forEach(([a, b]) => spans.push({ s: a, e: b, k: 'paused' })));
    const checks = [];
    sessions.forEach(x => x.checks.forEach(c => { c.sess = x; checks.push(c); }));
    let start, projEnd, focusSess = current, at = null;
    if (current) {
      start = current.s / 1000;
      at = current.at;
      spans.push({ s: start, e: at, k: key === 'offline' ? 'stale' : 'cur' });
      if (key === 'pause') spans.push({ s: at, e: nowSec, k: 'paused' });
      projEnd = Math.max(start + (current.plan || current.elapsedMin) * 60 + (key === 'pause' ? Math.max(0, nowSec - at) : 0), at);
      spans.push({ s: key === 'pause' ? nowSec : at, e: projEnd, k: 'plan' });
      current.checks.forEach(c => { c.sess = current; checks.push(c); });
    } else {
      focusSess = sessions[sessions.length - 1];
      start = focusSess.s / 1000; projEnd = focusSess.e / 1000;
    }
    checks.sort((a, b) => a.sec - b.sec);
    spans.sort((a, b) => (a.k === 'paused') - (b.k === 'paused'));  // pauses win over the round they sit in
    const patrols = sessions.concat(current ? [current] : []).flatMap(x => (x.patrols || []).map(p => Object.assign(p, { sess: x })));
    const marks = checks.concat(patrols).sort((a, b) => a.sec - b.sec);
    return { key, spans, checks, patrols, marks, start, projEnd, nowSec, at, current, focusSess, day0: v.dayStart / 1000, day1: v.dayEnd / 1000,
      colorVar: STATES[key].c.slice(4, -1), live: key === 'focus', v };
  }
  // fit the whole round as of this moment: from its start to whichever is later, the projected end or now
  const fitRange = () => { const end = Math.max(VD.projEnd, VD.current ? VD.nowSec : VD.start), pad = (end - VD.start) * .14; return [VD.start - pad, end + pad]; };
  // a single-round share only ever shows that round, with a little air on both sides
  const vpBounds = () => VD.v.once ? [VD.start - 900, Math.max(VD.projEnd, VD.current ? VD.nowSec : VD.projEnd) + 900]
    : [VD.day0, Math.min(VD.day1, Math.max(VD.projEnd, VD.nowSec) + 3600)];
  function clampView(v0, v1) {
    const [lo, hi] = vpBounds();
    const span = Math.min(Math.max(v1 - v0, MIN_SPAN), hi - lo);
    v0 = Math.min(Math.max(v0, lo), hi - span);
    return [v0, v0 + span];
  }
  const ARROW_L = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 2.5 4 6l3.5 3.5"/></svg>';
  const ARROW_R = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>';

  function viewHTML(v) {
    LASTV = v;
    VD = viewData(v);
    const round = VD.focusSess && VD.focusSess.id;
    if (VP.key !== v.key || VP.round !== round) {
      VP.key = v.key; VP.round = round; VP.fresh = true;
      [VP.v0, VP.v1] = fitRange();
      const own = VD.focusSess.checks;
      VP.sel = own.length ? own[own.length - 1].sec : VD.start;
    } else if (!VD.marks.some(c => c.sec === VP.sel) && VD.focusSess.checks.length) {
      VP.sel = VD.focusSess.checks[VD.focusSess.checks.length - 1].sec;
    }
    // a round without checks yet shows nothing under the pointer rather than an earlier round's last check
    const c = marksOf(VD.focusSess).length ? nearestAll(VP.sel) : null;
    return `<div class="vp" id="vp" style="--c:${STATES[v.key].c}">
        <div class="vp-stage" id="vpStage">
          <canvas id="vpCanvas" height="64" aria-hidden="true"></canvas>
          <i class="edge-hint l ${VP.touched ? 'gone' : ''}" aria-hidden="true">${ARROW_L}</i><i class="edge-hint r ${VP.touched ? 'gone' : ''}" aria-hidden="true">${ARROW_R}</i>
          <div class="playhead vp-head" id="vpHead" tabindex="0" role="slider" aria-label="选择一次抽查" aria-valuetext="${hhmm(VP.sel)}"><span class="bubble" id="vpBubble">${hhmm(VP.sel)}</span><i class="head-hint l ${VP.headTouched ? 'gone' : ''}" aria-hidden="true">${ARROW_L}</i><i class="head-hint r ${VP.headTouched ? 'gone' : ''}" aria-hidden="true">${ARROW_R}</i></div>
        </div>
        <div class="vp-bar">
          <span class="vp-tools">
            <button class="vp-fit" data-vp="fit" hidden>回到本轮</button>
            <button data-vp="out" aria-label="缩小时间">−</button><button data-vp="in" aria-label="放大时间">+</button>
          </span>
        </div>
      </div>
      <div class="slot" id="vpSlot" data-cid="${c ? esc(c.id) : ''}">${c ? vpSlotHTML(c) : ''}</div>`;
  }
  function nearestAll(sec) {
    let best = null;
    VD.marks.forEach(c => { if (!best || Math.abs(c.sec - sec) < Math.abs(best.sec - sec)) best = c; });
    return best;
  }
  function vpSlotHTML(c) {
    SCR.vp = { sess: c.sess, live: VD.live && c.sess === VD.current, v: VD.v };
    return slotHTML('vp', c);
  }

  // label steps align to the sharer's local clock, not UTC
  const localOff = () => { const d0 = VD.day0, h = Number(hhmm(d0).slice(0, 2)), m = Number(hhmm(d0).slice(3)); return ((h * 3600 + m * 60) - (d0 % 86400) + 86400 * 2) % 86400; };
  function cssVar(el, n) { return getComputedStyle(el).getPropertyValue(n).trim(); }
  function vpDraw() {
    const cv = document.getElementById('vpCanvas');
    if (!cv || !VD) return;
    const W = cv.clientWidth, H = 64, dpr = window.devicePixelRatio || 1;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = H * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const C = { c: cssVar(cv, VD.colorVar), ink: cssVar(cv, '--ink'), ink2: cssVar(cv, '--ink-2'), ink4: cssVar(cv, '--ink-4'), fail: cssVar(cv, '--fail'), accent: cssVar(cv, '--accent'), patrol: cssVar(cv, '--patrol'), pause: cssVar(cv, '--pause'), font: cssVar(cv, '--sans') };
    const spp = (VP.v1 - VP.v0) / W, X = t => (t - VP.v0) / spp, mid = 25;
    let hx = X(VP.sel);
    const centers = new Map();
    const lift = px => { const k = Math.max(0, 1 - Math.abs(px - hx) / 60); return k * k * (3 - 2 * k); };
    const spanAt = t => { for (let i = VD.spans.length - 1; i >= 0; i--) { const s = VD.spans[i]; if (t >= s.s && t <= s.e) return s.k; } return null; };
    const step = PITCH * spp;
    // when checks (~170s apart) come closer than a few px, morph into the 今日回顾 look: one rounded block per round, fails flagged on top
    const gap = 170 / spp, want = VP.m > .5 ? (gap < 7 ? 1 : 0) : (gap < 4.5 ? 1 : 0);
    if (VP.m !== want) {
      const now = performance.now(), dt = Math.min(48, now - (VP.mT || now));
      VP.m = reduce ? want : want > VP.m ? Math.min(1, VP.m + dt / 320) : Math.max(0, VP.m - dt / 320);
      VP.mT = now;
      if (VP.m !== want && !VP.mRaf) VP.mRaf = requestAnimationFrame(() => { VP.mRaf = 0; vpDraw(); });
    } else VP.mT = 0;
    const m = VP.m, em = m * m * (3 - 2 * m);
    const bar = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else g.rect(x, y, w, h); g.fill(); };
    const tint = k => k === 'cur' ? [C.c, .8] : k === 'paused' ? [C.pause, .45] : k === 'plan' ? [C.c, .24] : k === 'done' ? [C.ink, .42] : k === 'cut' ? [C.ink, .18] : k === 'stale' ? [C.ink, .32] : null;
    // a check takes two tick slots (i, i+1) and fills them edge to edge, so the gaps on either side stay exactly one normal gap
    const own = new Map();
    VD.checks.forEach(c => {
      if (c.sec < VP.v0 - 2 * step || c.sec > VP.v1 + step) return;
      let i = Math.floor(c.sec / step);
      if (own.has(i - 1)) i -= 1;
      const o = own.get(i);
      if (!o || rankCheck(c) > rankCheck(o) || (rankCheck(c) === rankCheck(o) && c.sess === VD.focusSess)) own.set(i, c);
    });
    const snap = t => Math.round(X(t) * dpr) / dpr;
    const BLK = 16, flags = [];
    function drawCheck(x, h, w, col, exc) {
      if (exc) { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); if (g.roundRect) g.roundRect(x - w / 2 + .5, mid - h / 2 + .5, w - 1 || 1, h - 1, w / 2); else g.rect(x - w / 2, mid - h / 2, w, h); g.stroke(); }
      else { g.fillStyle = col; bar(x - w / 2, mid - h / 2, w, h, w / 2); }
    }
    for (let i = Math.ceil(VP.v0 / step); i * step <= VP.v1; i++) {
      const t = i * step, px = X(t), x = Math.round(px * dpr) / dpr, k = spanAt(t), lf = 1 + 1.2 * lift(px);
      const c = own.get(i);
      if (!c && own.has(i - 1) && em === 0) continue;
      if (c) {
        const xa = x, xb = snap(t + step), cx = (xa + xb) / 2, cw = xb - xa + .5;
        centers.set(c, cx);
        const fail = !c.ok && !c.fail.excused, exc = !c.ok && c.fail.excused;
        const col = fail || exc ? C.fail : c.friend ? C.accent : C.ink2;
        const h0 = (fail || c.friend ? 18 : 15) + 10 * (lf - 1), keep = fail || exc || c.friend;
        const h = keep ? h0 + (BLK + 8 - h0) * em : h0, w = cw + (2 - cw) * em;
        g.globalAlpha = (c.sess === VD.focusSess || c.friend || fail ? 1 : .6) * (keep ? 1 : 1 - em);
        if (keep && em > 0) flags.push([cx, h, w, col, exc, g.globalAlpha]);
        else if (g.globalAlpha > .01) drawCheck(cx, h, w, col, exc);
        if (em === 0) continue;
      }
      const tn = tint(k);
      const [col, a] = tn || [C.ink4, t > VD.nowSec ? .16 : .32];
      const h = (10 + (BLK - 10) * (tn ? em : 0)) * (tn ? 1 + (lf - 1) * (1 - em) : lf);
      g.globalAlpha = tn ? a * (1 - em) : a * (1 - .45 * em); g.fillStyle = col;
      if (g.globalAlpha > .01) bar(x - .5, mid - h / 2, 1, h, .5);
    }
    if (em > 0) VD.spans.forEach(sp => {
      const [col, a] = tint(sp.k), x0 = Math.max(-8, X(sp.s)), x1 = Math.min(W + 8, X(sp.e));
      if (x1 <= x0) return;
      g.globalAlpha = a * em; g.fillStyle = col;
      bar(x0, mid - BLK / 2, Math.max(2, x1 - x0), BLK, 3);
    });
    flags.forEach(([x, h, w, col, exc, a]) => { g.globalAlpha = a; drawCheck(x, h, w, col, exc); });
    // 实时巡查 sits above the rail as an orange dot
    const selMark = VD.marks.find(c => c.sec === VP.sel);
    VD.patrols.forEach(pt => {
      const px = X(pt.sec);
      if (px < -6 || px > W + 6) return;
      const on = selMark === pt;
      g.globalAlpha = pt.sess === VD.focusSess || on ? 1 : .7; g.fillStyle = C.patrol;
      g.beginPath(); g.arc(px, 5, on ? 3.5 : 2.75, 0, Math.PI * 2); g.fill();
    });
    // resting on a check, the pointer sits on that tick's centre rather than its exact second
    if (!VP.free && selMark && centers.has(selMark)) hx = centers.get(selMark);
    VP.hx = hx;
    const nx = X(VD.nowSec);
    if (nx > -2 && nx < W + 2) {
      g.globalAlpha = .9; g.fillStyle = C.ink;
      g.beginPath(); g.arc(nx, mid + 17, 2, 0, Math.PI * 2); g.fill();
    }
    const L = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600].find(l => l / spp >= 64) || 21600;
    const off = localOff();
    g.font = `500 10.5px ${C.font}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = C.ink4; g.globalAlpha = 1;
    for (let t = Math.ceil((VP.v0 + off) / L) * L - off; t <= VP.v1; t += L) {
      const px = X(t);
      if (Math.abs(px - nx) < 34) continue;
      g.fillText(hhmm(t), px, H - 4);
    }
    if (nx > 0 && nx < W) { g.fillStyle = C.ink; g.globalAlpha = .75; g.fillText('现在', nx, H - 4); }
    g.globalAlpha = 1;

    const head = document.getElementById('vpHead');
    head.style.left = hx + 'px';
    head.classList.toggle('off', hx < 0 || hx > W);
    const fit = document.querySelector('[data-vp="fit"]');
    if (fit) fit.hidden = !(VD.start > VP.v1 - (VP.v1 - VP.v0) * .2 || VD.projEnd < VP.v0 + (VP.v1 - VP.v0) * .2 || (VP.v1 - VP.v0) > (VD.projEnd - VD.start) * 4);
  }

  function vpSelect(sec, free) {
    VP.sel = sec; VP.free = !!free;
    const c = nearestAll(sec);
    const bubble = document.getElementById('vpBubble'), head = document.getElementById('vpHead');
    if (!bubble) return;
    const cv = document.getElementById('vpCanvas'), spp = (VP.v1 - VP.v0) / (cv.clientWidth || 1);
    const snapped = c && Math.abs(c.sec - sec) / spp < 7;
    bubble.textContent = hhmm(free || !snapped ? sec : c.sec);
    bubble.className = 'bubble' + (snapped && c && c.patrol ? ' patrol' : snapped && !c.ok ? ' fail' : snapped && c.friend ? ' friend' : '');
    head.setAttribute('aria-valuetext', `${hhmm(sec)}${c ? (c.patrol ? ' 实时巡查' : c.ok ? ' 合格' : ' 不合格') : ''}`);
    const slot = document.getElementById('vpSlot');
    // only describe a check the pointer actually rests on (or is being dragged near)
    const shown = c && (free || snapped) ? c : null;
    if (slot && !shown && slot.dataset.cid) { slot.dataset.cid = ''; slot.innerHTML = ''; }
    if (slot && shown && slot.dataset.cid !== shown.id) {
      slot.dataset.cid = shown.id;
      slot.innerHTML = vpSlotHTML(shown);
      [...slot.children].forEach(ch => { ch.classList.remove('in'); void ch.offsetWidth; ch.classList.add('in'); });
    }
    vpDraw();
  }
  const ease = k => 1 - Math.pow(1 - k, 3);
  function vpAnimTo(v0, v1, dur = 460) {
    cancelAnimationFrame(VP.anim);
    [v0, v1] = clampView(v0, v1);
    if (reduce) { VP.v0 = v0; VP.v1 = v1; vpDraw(); return; }
    const a0 = VP.v0, a1 = VP.v1, t0 = performance.now();
    const tick = now => {
      const k = Math.min(1, (now - t0) / dur), e = ease(k);
      VP.v0 = a0 + (v0 - a0) * e; VP.v1 = a1 + (v1 - a1) * e; vpDraw();
      if (k < 1) VP.anim = requestAnimationFrame(tick);
    };
    VP.anim = requestAnimationFrame(tick);
  }
  function vpZoom(factor, anchorT) {
    const span = (VP.v1 - VP.v0) * factor;
    const f = (anchorT - VP.v0) / (VP.v1 - VP.v0);
    return clampView(anchorT - f * span, anchorT - f * span + span);
  }
  function vpReveal(sec) {
    const span = VP.v1 - VP.v0;
    if (sec < VP.v0 + span * .1 || sec > VP.v1 - span * .1) vpAnimTo(sec - span / 2, sec + span / 2);
  }
  function vpAfterRender() {
    if (!document.getElementById('vp')) return;
    if (VP.fresh && !reduce) {
      VP.fresh = false;
      const [f0, f1] = fitRange(), [lo, hi] = vpBounds();
      VP.v0 = Math.max(lo, f0 - (f1 - f0) * 2.5); VP.v1 = Math.min(hi, f1 + (f1 - f0) * 1.5);
      vpDraw(); vpAnimTo(f0, f1, 820);
    } else { VP.fresh = false; vpDraw(); }
    vpSelect(VP.sel, false);
  }

  /* gestures: one finger pans (with inertia) or taps to pick a check; two fingers pinch; the playhead itself can be dragged */
  const ptrs = new Map();
  let G = null;
  const stageX = (st, x) => x - st.getBoundingClientRect().left;
  const timeAtX = (st, x) => VP.v0 + stageX(st, x) / st.clientWidth * (VP.v1 - VP.v0);
  function headTouched() { if (!VP.headTouched) { VP.headTouched = true; document.querySelectorAll('.head-hint').forEach(h => h.classList.add('gone')); } }
  function touched() { if (!VP.touched) { VP.touched = true; document.querySelectorAll('.vp .edge-hint').forEach(h => h.classList.add('gone')); } }
  document.addEventListener('pointerdown', e => {
    const st = e.target.closest('#vpStage');
    if (!st) return;
    cancelAnimationFrame(VP.anim);
    ptrs.set(e.pointerId, e.clientX);
    try { st.setPointerCapture(e.pointerId); } catch (err) {}
    touched();
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      G = { type: 'pinch', d0: Math.max(20, Math.abs(a - b)), span0: VP.v1 - VP.v0, anchor: timeAtX(st, (a + b) / 2), st };
    } else if (e.target.closest('#vpHead') || Math.abs(stageX(st, e.clientX) - (VP.hx ?? -999)) < 26) {
      G = { type: 'head', st }; headTouched();
      st.classList.add('dragging');
    } else {
      G = { type: 'pan', st, x0: e.clientX, a0: VP.v0, a1: VP.v1, moved: false, lx: e.clientX, lt: performance.now(), vel: 0 };
    }
    e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!G || !ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e.clientX);
    const st = G.st, W = st.clientWidth;
    if (G.type === 'pinch' && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const span = G.span0 * G.d0 / Math.max(20, Math.abs(a - b));
      const mx = stageX(st, (a + b) / 2) / W;
      [VP.v0, VP.v1] = clampView(G.anchor - mx * span, G.anchor - mx * span + span);
      vpDraw();
    } else if (G.type === 'head') {
      vpSelect(Math.min(Math.max(timeAtX(st, e.clientX), VD.day0), VD.nowSec), true);
    } else if (G.type === 'pan') {
      const dx = e.clientX - G.x0, spp = (G.a1 - G.a0) / W;
      if (Math.abs(dx) > 4) G.moved = true;
      [VP.v0, VP.v1] = clampView(G.a0 - dx * spp, G.a1 - dx * spp);
      const now = performance.now(), dt = Math.max(1, now - G.lt);
      G.vel = .8 * ((e.clientX - G.lx) / dt) + .2 * G.vel; G.lx = e.clientX; G.lt = now;
      vpDraw();
    }
  });
  function endPtr(e) {
    if (!G || !ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    const st = G.st;
    if (G.type === 'pinch') {
      if (ptrs.size === 1) { const x = [...ptrs.values()][0]; G = { type: 'pan', st, x0: x, a0: VP.v0, a1: VP.v1, moved: true, lx: x, lt: performance.now(), vel: 0 }; }
      else G = null;
      return;
    }
    if (G.type === 'head') {
      st.classList.remove('dragging');
      const c = nearestAll(VP.sel); if (c) vpSelect(c.sec, false);
    } else if (G.type === 'pan') {
      if (!G.moved) {
        const c = nearestAll(timeAtX(st, e.clientX)); if (c) vpSelect(c.sec, false);
      } else if (!reduce && Math.abs(G.vel) > .05) {
        let vel = G.vel * (VP.v1 - VP.v0) / st.clientWidth, last = performance.now();
        const glide = now => {
          const dt = now - last; last = now;
          [VP.v0, VP.v1] = clampView(VP.v0 - vel * dt, VP.v1 - vel * dt);
          vel *= Math.pow(.94, dt / 16); vpDraw();
          if (Math.abs(vel) * 16 > (VP.v1 - VP.v0) / st.clientWidth * .2) VP.anim = requestAnimationFrame(glide);
        };
        VP.anim = requestAnimationFrame(glide);
      }
    }
    G = null;
  }
  document.addEventListener('pointerup', endPtr);
  document.addEventListener('pointercancel', endPtr);
  document.addEventListener('wheel', e => {
    const st = e.target.closest && e.target.closest('#vpStage');
    if (!st) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); touched(); cancelAnimationFrame(VP.anim);
      [VP.v0, VP.v1] = vpZoom(Math.exp(e.deltaY * .01), timeAtX(st, e.clientX)); vpDraw();
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      e.preventDefault(); touched(); cancelAnimationFrame(VP.anim);
      const d = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, spp = (VP.v1 - VP.v0) / st.clientWidth;
      [VP.v0, VP.v1] = clampView(VP.v0 + d * spp, VP.v1 + d * spp); vpDraw();
    }
  }, { passive: false });
  document.addEventListener('keydown', e => {
    if (!e.target.closest || !e.target.closest('#vpHead') || !VD.marks.length) return;
    const list = VD.marks;
    let i = list.findIndex(c => c.sec === VP.sel);
    if (e.key === 'ArrowRight') i = Math.min(list.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    else if (e.key === '+' || e.key === '=') { vpAnimTo(...vpZoom(1 / 1.6, VP.sel)); e.preventDefault(); return; }
    else if (e.key === '-') { vpAnimTo(...vpZoom(1.6, VP.sel)); e.preventDefault(); return; }
    else return;
    e.preventDefault(); touched(); headTouched();
    vpSelect(list[i].sec, false); vpReveal(list[i].sec);
  });
  // while paused the clock keeps running: "已暂停" ticks and the projected end slides right
  setInterval(() => {
    if (!LASTV || LASTV.key !== 'pause' || S.tab !== 'now' || !document.getElementById('vp')) return;
    VD = viewData(LASTV);
    const pe = document.getElementById('vpEnd'), pp = document.getElementById('vpPaused');
    if (pe) pe.textContent = hhmm(VD.projEnd);
    if (pp) pp.textContent = pausedText(VD);
    if (!G) vpDraw();
  }, 1000);
  const pausedText = vd => { const s = Math.max(0, vd.nowSec - vd.at); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  window.addEventListener('resize', () => vpDraw());

  /* ---------- 现在 ---------- */
  function renderNow(v) {
    const { key, sessions, current, perms, upd } = v;
    const st = STATES[key];
    const last = sessions[sessions.length - 1];
    const dotCls = ['dot', st.live ? 'live' : '', st.hollow ? 'hollow' : ''].join(' ');
    const fresh = upd ? `<time class="fresh ${key === 'offline' ? 'stale' : ''}" title="${hhmmMs(upd)} 同步">${ago(upd)}</time>` : '';
    const onceEnd = v.roundEnded;
    const row = meta => `<div class="state-row" style="--c:${onceEnd ? 'var(--mute)' : st.c}"><span class="${onceEnd ? 'dot hollow' : dotCls}"></span><span class="state-label">${onceEnd ? '这一轮结束了' : st.label}</span>${meta ? `<span class="state-meta">${meta}</span>` : ''}${onceEnd ? '' : fresh}</div>`;
    const taskH = (t, quiet) => {
      const name = taskName(t, perms);
      return name ? `<h2 class="task ${quiet ? 'quiet' : ''}">${esc(name)}</h2>` : `<h2 class="task private ${quiet ? 'quiet' : ''}">${ICON.lock}${SECRET}</h2>`;
    };
    const aside = onceEnd ? '' : NOTE[key] ? `<p class="aside">${NOTE[key]}</p>` : '';

    let hero = '';
    const sess = current || (key === 'rest' ? last : null);
    if (sess) {
      const nFail = realFails(sess.checks).length;
      const curMin = current ? current.elapsedMin : 0;
      const vh = viewHTML(v);
      const meta = [current ? `已专注 <b>${curMin}</b> 分钟` : `这一轮 <b>${last.minutes}</b> 分钟`];
      if (key === 'focus' && current.plan) meta.push(`还剩 <b>${Math.max(0, current.plan - curMin)}</b> 分钟`);
      if (key === 'pause') meta.push(`已暂停 <b id="vpPaused">${pausedText(VD)}</b>`);
      if ((key === 'focus' || key === 'pause') && current.plan) meta.push(`预计 <b id="vpEnd">${hhmm(VD.projEnd)}</b> 结束`);
      meta.push(`抽查 <b>${sess.checks.length}</b> 次`);
      if (nFail) meta.push(`不合格 <b class="bad">${nFail}</b> 次`);
      if ((sess.patrols || []).length) meta.push(`拦截 <b class="pat">${sess.patrols.length}</b> 次`);
      hero = `${row(key === 'rest' ? `${hhmmMs(last.e)} ${onceEnd ? '结束' : '起'}` : '')}${taskH(sess.task, key === 'offline')}
        <div class="meta-line">${meta.map(m => `<span>${m}</span>`).join('')}</div>
        ${vh}${aside}`;
    } else {
      LASTV = null;
      if (key === 'idle') hero = `${row(last ? `最后一轮 ${hhmmMs(last.e)} 结束` : '')}${aside}`;
      else if (key === 'empty') hero = `${row('')}<h2 class="task quiet">今天还没有专注记录</h2>${aside}`;
    }
    return `<section class="now">${hero}</section>${renderActs(v)}`;
  }

  function renderActs(v) {
    const { key, perms } = v;
    if (!perms.acts || key === 'offline') return '';
    const canCheck = key === 'focus';
    const head = `<div class="sec-head"><span class="sec-title">和伙伴互个动</span>${S.visitor ? `<span class="sec-meta"><span>${esc(S.visitor)}</span></span>` : ''}</div>`;
    const err = S.error ? `<span class="err-line">${esc(S.error)}</span>` : '';
    const checks = mine().filter(a => a.kind === 'check');
    const lastCheck = checks[checks.length - 1];
    const running = S.busy === 'check' || (lastCheck && lastCheck.status === 'pending' && nowMs() - ms(lastCheck.at) < 5 * 60000);
    const left = S.data.checks_left;
    let checkDesc = '看看 TA 此刻在做什么？';
    if (running) checkDesc = '截一张图，交给 AI 看看';
    else if (judgingCheck()) checkDesc = '等你判定';
    else if (lastCheck && lastCheck.status === 'done' && nowMs() - ms(lastCheck.at) < 10 * 60000) checkDesc = '结果在上面';
    else if (lastCheck && lastCheck.status === 'failed' && nowMs() - ms(lastCheck.at) < 10 * 60000) checkDesc = '这次没查成，稍后再试试';
    const checkCard = canCheck ? `
      <button class="act ${running ? 'busy' : ''}" data-act="${judgingCheck() ? 'judge-open' : 'check'}" ${running || (!left && !judgingCheck()) ? 'disabled' : ''}>
        <span class="act-t">${running ? ICON.load : ICON.eye}${running ? '正在抽查' : '立即抽查'}<span class="act-n">${left ? `可查 ${left} 次` : '今天已查完'}</span></span>
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
        <span class="act-d verse">${key === 'empty' ? '流水既一去不再回头，时光更不会为你停留。<br>愿你一分一秒珍惜，如今要赶上正是时候。' : '也许一生到底 一切超出估计<br>但是我总会找到你鼓励'}</span>
      </button>`;
    return `<section class="sec rule" aria-label="和伙伴互动">${head}
      <div class="acts" style="${canCheck ? '' : 'grid-template-columns:1fr'}">${checkCard}${cheerCard}</div>${err}
    </section>`;
  }

  /* ---------- 今日回顾 ---------- */
  let LASTR = null;
  /* drag the pointer along the day; the round under it lights up, here and in the list below */
  const tlTime = (tl, x) => { const r = tl.getBoundingClientRect(); return LASTR.dayStart + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (LASTR.dayEnd - LASTR.dayStart); };
  function tlScan(at0) {
    const tl = document.getElementById('tl');
    if (!tl || !LASTR) return;
    const v = LASTR, now = nowMs(), span = v.dayEnd - v.dayStart;
    const head = document.getElementById('tlHead'), bub = document.getElementById('tlBubble');
    const at = at0 == null ? now : Math.min(at0, now);
    const p = Math.min(100, Math.max(0, (at - v.dayStart) / span * 100));
    head.style.left = p + '%';
    bub.textContent = hhmmMs(at);
    bub.style.transform = `translateX(-${p.toFixed(1)}%)`;
    head.setAttribute('aria-valuetext', hhmmMs(at));
    let sid = null;
    if (at0 != null) {
      const all = v.current ? v.sessions.concat(v.current) : v.sessions;
      const hit = all.find(x => at >= x.s - 60000 && at <= (x === v.current ? x.at * 1000 : x.e) + 60000);
      sid = hit ? hit.id : null;
    }
    tl.classList.toggle('scan', at0 != null);
    tl.querySelectorAll('[data-sid]').forEach(el => el.classList.toggle('on', el.dataset.sid === sid));
    const log = document.querySelector('.log');
    if (log) { log.classList.toggle('scan', at0 != null && sid != null); log.querySelectorAll(':scope > li').forEach(li => li.classList.toggle('on', li.dataset.sid === sid)); }
  }
  let TLG = null;
  document.addEventListener('pointerdown', e => {
    const tl = e.target.closest && e.target.closest('#tl');
    if (!tl || !LASTR) return;
    TLG = { id: e.pointerId, tl };
    try { tl.setPointerCapture(e.pointerId); } catch (err) {}
    tl.classList.add('dragging');
    S.tlAt = tlTime(tl, e.clientX); tlScan(S.tlAt);
    e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!TLG || TLG.id !== e.pointerId) return;
    S.tlAt = tlTime(TLG.tl, e.clientX); tlScan(S.tlAt);
  });
  const tlEnd = e => {
    if (!TLG || TLG.id !== e.pointerId) return;
    TLG.tl.classList.remove('dragging'); TLG = null;
    if (S.tlAt >= nowMs() - 120000) S.tlAt = null; // let go at or past now: back to 现在
    tlScan(S.tlAt);
  };
  document.addEventListener('pointerup', tlEnd);
  document.addEventListener('pointercancel', tlEnd);
  document.addEventListener('keydown', e => {
    if (!e.target.closest || !e.target.closest('#tlHead') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const now = nowMs();
    const t = (S.tlAt == null ? now : S.tlAt) + (e.key === 'ArrowRight' ? 1 : -1) * 600000;
    S.tlAt = t >= now ? null : Math.max(LASTR.dayStart, t); tlScan(S.tlAt); e.preventDefault();
  });

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
    LASTR = v;
    let segs = sessions.map(x => `<span class="seg ${x.done ? '' : 'cut'}" data-sid="${esc(x.id)}" style="left:${pos(x.s)}%;width:${pos(x.e) - pos(x.s)}%" title="${hhmmMs(x.s)}–${hhmmMs(x.e)}  ${esc(label(x.task))}"></span>`).join('');
    if (current) {
      const l = pos(current.s), r = pos(current.at * 1000);
      segs += `<span class="seg cur ${current.kind === 'paused' ? 'paused' : ''} ${current.kind === 'stale' ? 'stale' : ''}" data-sid="${esc(current.id)}" style="--c:${current.kind === 'stale' ? 'var(--block)' : st.c};left:${l}%;width:${r - l}%"></span>`;
      if (key === 'focus' && current.plan) segs += `<span class="seg plan" data-sid="${esc(current.id)}" style="--c:${st.c};left:${r}%;width:${Math.max(0, pos(current.s + current.plan * 60000) - r)}%"></span>`;
    }
    const flags = all.flatMap(x => realFails(x.checks).map(c => `<span class="flag" data-sid="${esc(x.id)}" style="left:${pos(c.sec * 1000)}%"></span>`)).join('');
    const ticks = [0, 1, 2, 3, 4, 5, 6].map(i => `<span style="left:${i / 6 * 100}%">${hhmmMs(v.dayStart + i * span / 6).slice(0, 2)}</span>`).join('');
    const timeline = `<section class="sec rule" aria-label="全天时间轴">
      <div class="tl" id="tl" aria-label="全天专注时间轴">
        <div class="tl-track"><div class="tl-future" style="left:${pos(nowM)}%"></div>${segs}</div>${flags}
        <span class="nowline tl-head" id="tlHead" tabindex="0" role="slider" aria-label="拖动看某一轮" aria-valuetext="${hhmmMs(nowM)}" style="left:${pos(nowM)}%"><span class="bubble" id="tlBubble">${hhmmMs(nowM)}</span></span>
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
        return `<li data-sid="${esc(x.id)}" class="${isCur ? 'cur' : x.done ? '' : 'cut'}" ${isCur ? `style="--c:${current.kind === 'stale' ? 'var(--ink-2)' : st.c}"` : ''}>
          <button class="row" data-open="${esc(x.id)}" aria-expanded="${open}">
            <span class="t">${hhmmMs(x.s)}–${isCur ? '' : hhmmMs(x.e)}</span>${cell(x.task)}
            <span class="q ${nf ? 'bad' : ''}">${nf ? `不合格 ${nf}` : `抽查 ${x.checks.length}`}</span>
            <span class="d">${Math.max(1, Math.round(((isCur ? nowMs() : x.e) - x.s) / 60000))} 分钟</span>
            <span class="s">${isCur ? `<span class="dot ${current.kind === 'live' ? 'live' : ''}" style="--c:${current.kind === 'stale' ? 'var(--mute)' : st.c}"></span>` : x.done ? ICON.check : ICON.minus}</span>
          </button>
          ${open ? `<div class="more">${scrubHTML(x, false, v)}</div>` : ''}
        </li>`;
      }).join('');
      log = `<section class="sec rule" aria-label="每一轮"><div class="sec-head"><span class="sec-title">每一轮</span><span class="sec-meta"><span>点开后拖动看抽查</span></span></div><ul class="log">${rows}</ul></section>`;
    }

    const vs = all.flatMap(x => x.checks.filter(c => !c.ok).concat(x.patrols || [])).sort((a, b) => a.sec - b.sec);
    const vrows = vs.map(c => {
      const open = S.vopen === c.id;
      if (c.patrol) {
        const pimg = perms.shots && safeURL(c.screen);
        const thumb = pimg ? `<span class="thumb"><img src="${esc(pimg)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : `<span class="thumb blank">${ICON.hidden}</span>`;
        return `<li><button class="vrow" data-vopen="${esc(c.id)}" aria-expanded="${open}">${thumb}
          <span style="min-width:0"><span class="v1" style="display:block">封禁 ${esc(c.target)} ${c.ban} 分钟</span><span class="v2">${hhmm(c.sec)}  ${esc(c.why)}</span></span>
          <span class="tag pat">已拦截</span></button>
        ${open ? `<div class="more">${patrolDetail(c, v)}</div>` : ''}</li>`;
      }
      const f = c.fail;
      const img = safeURL(f.screen) || safeURL(f.camera);
      const isCam = !safeURL(f.screen) && !!safeURL(f.camera);
      const thumb = perms.shots && img ? `<span class="thumb ${isCam ? 'cam' : ''}"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : `<span class="thumb blank">${ICON.hidden}</span>`;
      return `<li><button class="vrow" data-vopen="${esc(c.id)}" aria-expanded="${open}">${thumb}
          <span style="min-width:0"><span class="v1" style="display:block">${esc(f.why)}</span><span class="v2">${hhmm(c.sec)}  ${esc(f.app)}</span></span>
          <span class="tag ${f.excused ? 'ok' : 'bad'}">${f.excused ? '申诉通过' : '不合格'}</span></button>
        ${open ? `<div class="more">${detail(c, false, v)}</div>` : ''}</li>`;
    }).join('');
    const vsec = vs.length ? `<section class="sec rule" aria-label="违规与拦截"><div class="sec-head"><span class="sec-title">违规与拦截</span><span class="sec-meta"><span>${vs.length} 次</span></span></div><ul class="vlist">${vrows}</ul></section>` : '';

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

  /* ---------- interaction sheet: every step of cheering and checking happens here ---------- */
  let MODAL_LAST = null;
  // the visitor's own check that is waiting for their verdict, if any
  const judgingCheck = () => mine().filter(a => a.kind === 'check' && a.status === 'judging' && a.result && ms(a.result.deadline) > nowMs()).pop() || null;
  const watchedCheck = () => S.watch ? mine().find(a => a.id === S.watch) : null;
  function modalStep() {
    if (S.asking) return 'ask';
    if (S.cheerOpen) return 'cheer';
    if (S.done) return S.done;
    const w = watchedCheck();
    if (S.busy === 'check' || (w && w.status === 'pending')) return 'running';
    if (S.judgeOpen && judgingCheck()) return S.jbad ? 'judge-why' : 'judge';
    return null;
  }
  function jLeftText() {
    const j = judgingCheck(); if (!j) return '';
    const left = Math.max(0, Math.floor((ms(j.result.deadline) - nowMs()) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 内不判定，按 AI 结果`;
  }
  setInterval(() => { const el = document.getElementById('jLeft'); if (el) el.textContent = jLeftText(); }, 1000);
  function modalHTML(v) {
    const step = modalStep();
    if (!step) { MODAL_LAST = null; return ''; }
    const anim = MODAL_LAST == null ? 'm-open' : MODAL_LAST !== step ? 'm-step' : '';
    MODAL_LAST = step;
    const key = v.key;
    const closable = ['ask', 'cheer', 'judge'].includes(step) || step.startsWith('ok-');
    const close = closable ? `<button class="m-x" data-mclose aria-label="关闭">${ICON.x}</button>` : '';
    const err = S.error ? `<p class="judge-note" style="color:var(--fail)">${esc(S.error)}</p>` : '';
    let body = '';
    if (step === 'ask') {
      body = `<h3 class="m-t">先留一个称呼！</h3><p class="m-d">伙伴会看到是谁来过</p>
        <form class="m-form" id="askForm"><input id="visitorName" maxlength="12" placeholder="比如 小林" autocomplete="nickname">
          <button class="btn-w solid m-main" type="submit">好了</button></form>`;
    } else if (step === 'cheer') {
      const presets = key === 'empty' ? NUDGES : CHEERS;
      body = `<h3 class="m-t">${key === 'empty' ? '提醒 TA 开始' : '为 TA 打气'}</h3>
        <form class="composer m-form" id="cheerForm">
          <textarea id="cheerText" maxlength="60" placeholder="${key === 'empty' ? '叫 TA 一声' : '写一句想对 TA 说的话'}" aria-label="想说的话">${esc(S.cheerDraft)}</textarea>
          <div class="presets">${presets.map(p => `<button type="button" class="preset" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
          <div class="composer-foot"><span id="cheerCount">${S.cheerDraft.length} / 60</span><button class="btn-w solid" type="submit" ${S.busy === 'cheer' ? 'disabled' : ''}>送出</button></div>
        </form>${err}`;
    } else if (step === 'running') {
      body = `<h3 class="m-t">正在抽查</h3><p class="m-d">${v.perms.judge ? '截一张图，马上交给你来看' : '截一张图，交给 AI 看看'}</p>
        <div class="m-scan"><i></i></div>`;
    } else if (step === 'judge' || step === 'judge-why') {
      const j = judgingCheck(), res = j.result || {};
      const rs = ['在刷视频', '在聊天', '不在电脑前', '在做别的事'];
      const shotHTML = safeURL(res.screen) ? `<img src="${esc(res.screen)}" alt="屏幕截图" referrerpolicy="no-referrer" style="display:block;width:100%;height:100%;object-fit:cover">`
        : `<div class="shot-hidden"><span>${ICON.hidden}</span>伙伴没有公开截图</div>`;
      body = `<div class="m-head"><h3 class="m-t">由你来判定</h3><span class="m-meta" id="jLeft">${jLeftText()}</span></div>
        <div class="judge-shot">${shotHTML}<span class="judge-time">${hhmmMs(ms(j.at))}</span></div>
        <dl class="facts">${res.app ? `<dt>前台应用</dt><dd>${esc(res.app)}</dd>` : ''}<dt>任务</dt><dd>${esc(res.task || SECRET)}</dd>${res.ai_why ? `<dt>AI 参考</dt><dd class="muted">${esc(res.ai_why)}</dd>` : ''}</dl>
        ${step === 'judge-why' ? `<form class="judge-why" id="judgeForm">
            <div class="presets">${rs.map(x => `<button type="button" class="preset ${S.freason === x ? 'on' : ''}" data-reason="${x}">${x}</button>`).join('')}</div>
            <input id="judgeText" maxlength="30" placeholder="或者写一句理由" value="${esc(rs.includes(S.freason) ? '' : S.freason)}">
            <p class="judge-note">会计入 TA 本轮的失误，TA 可以申诉</p>
            <div class="judge-acts"><button type="button" class="btn-w ghosty" data-judge="back">返回</button><button class="btn-w bad" type="submit" ${S.freason && S.busy !== 'judge' ? '' : 'disabled'}>确认违规</button></div>
          </form>` : `<div class="judge-acts"><button class="btn-w judge-ok" data-judge="ok" ${S.busy === 'judge' ? 'disabled' : ''}>${ICON.check}合格</button><button class="btn-w judge-bad" data-judge="bad">违规</button></div>`}${err}`;
    } else {
      const R = {
        'ok-cheer': ['🎉', '成功！', key === 'empty' ? '伙伴马上就会收到你的提醒！' : '伙伴在结束后就可以看到你的加油与祝福了！'],
        'ok-judge': ['👍', '判定为合格', '伙伴会看到这次是你判的，继续加油！'],
        'ok-bad': ['🚩', '已记为违规', '伙伴会收到通知，TA 可以申诉。你还可以追加惩罚。'],
        'ok-check': ['🔍', '抽查完成', '结果已经放在时间轴上了。'],
        'ok-failed': ['😶', '这次没查成', '伙伴那边没能完成抽查，稍后再试试。']
      }[step];
      body = `<div class="m-done"><span class="m-emoji" aria-hidden="true">${R[0]}${step === 'ok-cheer' ? '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>' : ''}</span>
        <h3 class="m-t">${R[1]}</h3><p class="m-d">${R[2]}</p><button class="btn-w solid m-main" data-mclose>好的</button></div>`;
    }
    return `<div class="m-layer ${anim === 'm-open' ? 'm-open' : ''}" role="presentation" ${closable ? 'data-mback' : ''}>
      <div class="m-card ${anim}" role="dialog" aria-modal="true">${close}<div class="m-body">${body}</div></div></div>`;
  }
  // the sheet lives outside the card and is only rebuilt when its content changes, so its animations play once
  let MODAL_SIG = null;
  function renderModal() {
    let host = document.getElementById('modal');
    if (!host) { host = document.createElement('div'); host.id = 'modal'; document.body.appendChild(host); }
    const v = S.data ? view() : null;
    const ok = v && !['loading', 'missing', 'ended', 'locked'].includes(v.key);
    const step = ok ? modalStep() : null;
    const sig = step ? `${step}|${S.error}|${S.busy}|${(judgingCheck() || {}).id || ''}` : '';
    if (sig === MODAL_SIG) return;
    MODAL_SIG = sig;
    host.innerHTML = step ? modalHTML(v) : '';
    if (!step) MODAL_LAST = null;
    const inp = host.querySelector('#visitorName, #cheerText');
    if (inp) { inp.focus(); const end = inp.value.length; try { inp.setSelectionRange(end, end); } catch (e) {} }
  }
  function closeModal() {
    const l = document.querySelector('.m-layer');
    const done = () => { S.asking = null; S.cheerOpen = false; S.done = null; S.judgeOpen = false; S.jbad = false; S.error = ''; MODAL_LAST = null; render(); };
    if (l && !reduce) { l.classList.add('m-out'); setTimeout(done, 200); } else done();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('[data-mback]')) closeModal(); });
  // follow the watched check: running → (friend judges) → result
  function trackWatched() {
    const w = watchedCheck();
    if (!w) return;
    if (w.status === 'judging') { S.watch = null; S.judgeOpen = true; S.jbad = false; S.freason = ''; }
    else if (w.status === 'done') { S.watch = null; S.done = 'ok-check'; }
    else if (w.status === 'failed') { S.watch = null; S.done = 'ok-failed'; }
  }
  async function submitVerdict(verdict) {
    const j = judgingCheck(); if (!j) return;
    S.busy = 'judge'; S.error = ''; render();
    try {
      await rpc('fg_friend_verdict', { p_code: code, p_visitor_key: visitorKey, p_id: j.id, p_verdict: verdict,
        p_reason: verdict === 'bad' ? S.freason : null, p_password: sharePassword() });
      S.judgeOpen = false; S.jbad = false; S.done = verdict === 'bad' ? 'ok-bad' : 'ok-judge';
    } catch (e) {
      S.error = /timeout/.test(e.message) ? '已经超过 5 分钟，按 AI 结果处理了' : '没提交上，稍后再试试';
    }
    S.busy = null;
    await load();
  }

  /* ---------- shell ---------- */
  function head(v, tabs) {
    const owner = v.owner || {};
    const avatar = safeURL(owner.avatar_url);
    const name = (owner.nickname || '').trim() || '伙伴';
    const date = v.once && v.roundStart ? `${mdhm(v.roundStart).replace(' ', ' ')} 开始` : v.dayStart ? dayLabel(v.dayStart) : dayLabel(nowMs());
    return `<header class="head">
        <div class="head-id">${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : ''}
          <div class="head-title"><h1>${esc(name)}${v.once ? '的这一轮专注' : '今天的专注'}</h1><span class="head-date">${date}</span></div></div>
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
    if (v.key === 'ended') return ended(v, v.once ? '这一轮专注已经结束，分享链接已失效。' : '此分享链接已过期，请向你的伙伴重新获取。', enter);
    if (v.key === 'locked') return gate(v, enter);
    if (v.key === 'missing') return ended(v, '没有找到这个分享，请向你的伙伴重新获取。', enter);
    document.title = `${(v.owner.nickname || '').trim() || '伙伴'}${v.once ? '的这一轮专注' : '今天的专注'}`;
    const tab = v.once ? 'now' : S.tab;
    const until = !v.once ? `有效期至 ${mdhm(v.expires)}` : v.roundEnded ? `链接将于 ${hhmmMs(v.expires)} 失效` : '本轮结束 1 小时后失效';
    return `<article class="card">
      ${head(v, !v.once)}<div class="tabs-wrap"></div>
      <div class="panel ${enter ? 'enter' : ''}">${tab === 'now' ? renderNow(v) : renderReview(v)}</div>
      <footer class="foot rule"><span>${until}</span><a href="https://github.com/Dennis-Ouyang/FocusGuard" target="_blank" rel="noopener">${ICON.shield}FocusGuard</a></footer>
    </article>`;
  }
  function gate(v, enter) {
    const len = Math.min(6, Math.max(4, v.pwLen || 4));
    const locked = v.lockedUntil && v.lockedUntil > nowMs();
    const cells = Array.from({ length: len }, (_, i) => `<span class="pin-c ${i === 0 ? 'cur' : ''}" data-i="${i}"></span>`).join('');
    const err = locked ? `尝试次数太多了，请 ${hhmmMs(v.lockedUntil)} 后再试` : v.wrong ? '密码不对，再问问伙伴' : '';
    return `<article class="card">${head(v, false)}<form class="gate ${enter ? 'enter' : ''}" id="gateForm" autocomplete="off">
        <span class="gate-ico">${ICON.lock}</span>
        <h2>输入访问密码</h2>
        <p class="gate-sub">伙伴给这个链接加了密码</p>
        <label class="pin ${v.wrong && !S.gateShook ? 'bad' : ''}"><input id="pinIn" inputmode="numeric" pattern="[0-9]*" maxlength="${len}" aria-label="访问密码" autocomplete="one-time-code" ${locked ? 'disabled' : ''}><span class="pin-cells" aria-hidden="true">${cells}</span></label>
        <p class="gate-err" id="gateErr" aria-live="polite">${esc(err)}</p>
      </form></article>`;
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
    if (drag || G || TLG) return;
    const active = document.activeElement;
    // don't wipe a half-typed password; the sheet's own fields live outside the card
    if (active && active.id === 'pinIn' && active.value) { renderModal(); return; }
    const key = S.data ? view().key : 'loading';
    const enter = last.tab !== S.tab || last.key !== key;
    $('#share').innerHTML = renderPage(enter);
    renderModal();
    last = { tab: S.tab, key };
    placeIndicator();
    document.querySelectorAll('.scrub').forEach(el => paintScrub(el, S.scrub[el.dataset.sid], false));
    vpAfterRender();
    if (document.getElementById('tl')) tlScan(S.tlAt ?? null);
    if (enter && S.tab === 'review' && !reduce) countUp();
    const inp = $('#pinIn'); if (inp && !inp.disabled) inp.focus();
    if ($('.pin.bad')) S.gateShook = true;
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
      const res = await rpc('fg_friend_action', { p_code: code, p_visitor_key: visitorKey, p_visitor: S.visitor, p_kind: kind, p_payload: payload || {}, p_password: sharePassword() });
      if (kind === 'cheer') { S.cheerOpen = false; S.cheerDraft = ''; S.done = 'ok-cheer'; }
      if (kind === 'check' && res && res.id) S.watch = res.id;
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
    } else if (e.target.id === 'judgeForm') {
      const v = ($('#judgeText').value || '').trim();
      if (v) S.freason = v.slice(0, 30);
      if (S.freason) { $('#judgeText').blur(); submitVerdict('bad'); }
    } else if (e.target.id === 'cheerForm') {
      const v = $('#cheerText').value.trim();
      if (!v) { $('#cheerText').focus(); return; }
      S.cheerDraft = v; $('#cheerText').blur();
      act('cheer', { text: v });
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'pinIn') {
      const len = Number(e.target.maxLength) || 4;
      const val = e.target.value = e.target.value.replace(/\D/g, '').slice(0, len);
      document.querySelectorAll('.pin-c').forEach((c, i) => { c.textContent = val[i] ? '•' : ''; c.classList.toggle('cur', i === val.length); });
      const err = $('#gateErr'); if (err) err.textContent = '';
      if (val.length === len) { e.target.blur(); S.gateShook = false; setPassword(val); viewCache = null; load(); }
      return;
    }
    if (e.target.id === 'judgeText') {
      if (e.target.value.trim()) { S.freason = e.target.value.trim(); document.querySelectorAll('[data-reason]').forEach(b => b.classList.remove('on')); }
      const b = $('#judgeForm [type=submit]'); if (b) b.disabled = !S.freason;
      return;
    }
    if (e.target.id === 'cheerText') { S.cheerDraft = e.target.value; const c = $('#cheerCount'); if (c) c.textContent = `${e.target.value.length} / 60`; }
  });
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-mclose]') || (t.matches && t.matches('[data-mback]'))) { closeModal(); return; }
    const jb = t.closest('[data-judge]');
    if (jb) { const vj = jb.dataset.judge; if (vj === 'ok') submitVerdict('ok'); else { S.jbad = vj === 'bad'; S.error = ''; render(); } return; }
    const rb = t.closest('[data-reason]');
    if (rb) { S.freason = rb.dataset.reason; const ti = $('#judgeText'); if (ti) ti.value = ''; document.querySelectorAll('[data-reason]').forEach(b => b.classList.toggle('on', b === rb)); const sb = $('#judgeForm [type=submit]'); if (sb) sb.disabled = false; return; }
    const tab = t.closest('[data-tab]');
    if (tab) { S.tab = tab.dataset.tab; try { sessionStorage.setItem('fg-tab', S.tab); } catch (err) {} render(); return; }
    const jump = t.closest('[data-jump]');
    if (jump && jump.dataset.jump.startsWith('vp|')) { const sec = Number(jump.dataset.jump.slice(3)); vpSelect(sec, false); vpReveal(sec); return; }
    const vpb = t.closest('[data-vp]');
    if (vpb) { touched(); const a = vpb.dataset.vp; if (a === 'fit') vpAnimTo(...fitRange()); else vpAnimTo(...vpZoom(a === 'in' ? 1 / 1.6 : 1.6, Math.min(Math.max(VP.sel, VP.v0), VP.v1))); return; }
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
      if (a.dataset.act === 'cheer-cancel') { closeModal(); return; }
      if (a.dataset.act === 'judge-open') { S.judgeOpen = true; S.jbad = false; S.freason = ''; render(); return; }
      if (!S.visitor) { S.asking = a.dataset.act; render(); return; }
      runAction(a.dataset.act);
    }
  });
  window.addEventListener('resize', () => document.querySelectorAll('.scrub').forEach(el => { el._w = 0; paintScrub(el, S.scrub[el.dataset.sid], false); }));
  window.addEventListener('hashchange', () => location.reload());
  setInterval(() => { if (!document.hidden) render(); }, 30000);

  render();
  if (CFG.url && CFG.anonKey && code) load();
})();
