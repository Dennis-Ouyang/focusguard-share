/* 演示模式：链接 #/s/demo 打开。数据全部在本页内生成，不连接 Supabase，刷新即恢复初始状态。
   朋友的抽查、判定、打气和追加惩罚都在本地模拟伙伴端的回应。 */
window.FG_DEMO = (() => {
  const MIN = 60000;
  const T0 = Date.now();
  const iso = t => new Date(t).toISOString();
  const at = m => iso(T0 + m * MIN);                 // 相对打开页面时刻的分钟数
  const img = name => new URL(`demo/${name}`, location.href).href;
  const SHOT = { notes: img('screen-notes.svg'), code: img('screen-code.svg'), video: img('screen-video.svg'), cam: img('camera.svg') };

  const mid = new Date(T0); mid.setHours(0, 0, 0, 0);
  const dayStart = Math.min(mid.getTime(), T0 - 6 * 60 * MIN);

  const S1 = 'demo-s1', S2 = 'demo-s2', CUR = 'demo-cur';
  const sessions = [
    { id: S1, task: '高等数学 第五章 定积分', start: at(-262), end: at(-202), minutes: 56, done: true, failLimit: 4,
      checks: [
        { id: 'c11', at: at(-248), ok: true, why: '正在阅读定积分换元法的讲义', app: '预览' },
        { id: 'c12', at: at(-229), ok: false },
        { id: 'c13', at: at(-211), ok: true, why: '正在手写习题 5-3', app: '预览' }
      ],
      patrols: [], pauses: [[at(-236), at(-232)]] },
    { id: S2, task: '英语一 阅读真题 2019', start: at(-176), end: at(-128), minutes: 45, done: true, failLimit: 4,
      checks: [
        { id: 'c21', at: at(-160), ok: true, friend: '小林', judge: '小林', why: '屏幕内容与当前任务相关', app: '预览', screen: SHOT.notes, camera: SHOT.cam },
        { id: 'c22', at: at(-141), ok: true, why: '正在作答阅读第二篇', app: 'Safari 浏览器' }
      ],
      patrols: [{ id: 'p21', at: at(-150), target: '微博', why: '专注期间打开了社交媒体', ban: 15 }], pauses: [] }
  ];
  const fails = [
    { id: 'c12', sid: S1, at: at(-229), app: 'Safari 浏览器  bilibili.com', target: 'bilibili.com', why: '前台是与学习无关的视频页面',
      excused: false, result: '已扣除 20 积分', screen: SHOT.video, camera: SHOT.cam }
  ];
  const current = { id: CUR, task: '408 数据结构 二叉树遍历', start: at(-34), planMin: 90, failLimit: 4,
    checks: [{ id: 'c31', at: at(-21), ok: true, why: '正在编写二叉树非递归中序遍历', app: 'Xcode', screen: SHOT.code }],
    patrols: [], pauses: [[at(-27), at(-25)]] };

  const visits = [
    { at: at(-190), visitor: '小林', kind: 'cheer', payload: {}, status: 'done' },
    { at: at(-160), visitor: '小林', kind: 'check', payload: {}, status: 'done', result: { ok: true } }
  ];
  const mine = [];
  let quotaUsed = 0, seq = 0;
  const api = { onChange: null };
  const changed = () => { if (api.onChange) api.onChange(); };
  const later = (ms, fn) => setTimeout(() => { fn(); changed(); }, ms);
  const fail = msg => { throw new Error(msg); };

  function snapshot() {
    const now = Date.now();
    const elapsed = (now - Date.parse(current.start)) / 1000 - 2 * 60;
    return {
      v: 1, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayStart: iso(dayStart), dayEnd: iso(dayStart + 24 * 60 * MIN), generatedAt: iso(now),
      perms: { task: true, log: true, shots: true, acts: true, quota: 2, judge: true, dev: false },
      sessions, lastEnd: sessions[sessions.length - 1].end, state: 'focus',
      current: { ...current, at: iso(now), elapsedSec: Math.max(0, Math.round(elapsed)) },
      fails
    };
  }

  function share() {
    return {
      status: 'ok', now: iso(Date.now()), scope: 'day', session_id: null, created_at: at(-300), expires_at: iso(dayStart + 24 * 60 * MIN),
      owner: { nickname: '阿远', avatar_url: null },
      snapshot: snapshot(), snapshot_at: iso(Date.now()),
      quota: 2, checks_left: Math.max(0, 2 - quotaUsed),
      visits: visits.concat(mine.filter(a => a.status !== 'judging')).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      punished: mine.filter(a => a.kind === 'punish' && ['pending', 'approved', 'done'].includes(a.status)),
      mine: mine.map(a => ({ ...a }))
    };
  }

  function action(args) {
    const a = { id: `demo-a${++seq}`, at: iso(Date.now()), kind: args.p_kind, visitor: args.p_visitor || '朋友', payload: args.p_payload || {}, status: 'pending', result: null };
    if (a.kind === 'cheer') {
      a.payload = { text: String(a.payload.text || '').slice(0, 60) };
      a.status = 'done';
    } else if (a.kind === 'check') {
      if (quotaUsed >= 2) fail('fg: check limit');
      quotaUsed++;
      later(2600, () => {
        a.status = 'judging';
        a.result = { deadline: iso(Date.now() + 5 * MIN), screen: SHOT.code, app: 'Xcode', task: current.task,
          ai_why: '屏幕上是二叉树遍历的代码，与当前任务相关' };
        a.timer = setTimeout(() => { if (a.status === 'judging') { settle(a, 'ok', '', 'ai'); changed(); } }, 5 * MIN);
      });
    } else if (a.kind === 'punish') {
      if (mine.some(x => x.kind === 'punish' && x.status === 'pending')) fail('fg: punish pending');
      later(4000, () => { a.status = 'approved'; });
    } else fail('fg: invalid kind');
    mine.push(a);
    return { id: a.id, status: a.status };
  }

  // 判定落定：把这次抽查放进当前一轮的时间轴；判为违规时同时记一条违规
  function settle(a, verdict, reason, judge) {
    clearTimeout(a.timer);
    const ok = verdict === 'ok';
    const id = `demo-c${a.id}`;
    current.checks.push({ id, at: a.at, ok, friend: a.visitor, judge: judge || a.visitor, app: 'Xcode',
      why: ok ? '屏幕内容与当前任务相关' : undefined, screen: SHOT.code });
    if (!ok) fails.push({ id, sid: CUR, at: a.at, app: 'Xcode', target: 'Xcode', why: reason, excused: false, judge: a.visitor, result: '', screen: SHOT.code });
    a.status = 'done';
    a.result = { ok, check_id: id, judge: judge || a.visitor };
  }

  function verdict(args) {
    const a = mine.find(x => x.id === args.p_id && x.kind === 'check');
    if (!a || a.status !== 'judging') fail('fg: not judging');
    if (Date.parse(a.result.deadline) < Date.now()) fail('fg: judge timeout');
    settle(a, args.p_verdict, String(args.p_reason || '').slice(0, 30));
    return { id: a.id, status: 'judged' };
  }

  api.rpc = async (fn, args) => {
    await new Promise(r => setTimeout(r, 180));
    if (fn === 'fg_get_share') return share();
    if (fn === 'fg_friend_action') return action(args);
    if (fn === 'fg_friend_verdict') return verdict(args);
    fail(`fg: unknown ${fn}`);
  };
  return api;
})();
