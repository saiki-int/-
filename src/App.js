import React from 'react';
import {
  useState, useMemo, useCallback, useContext,
  createContext, useEffect,
} from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ayhmqmadkfvuhcldhrkl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_a10l4wMFtVmFBGDl781ASA_2PB4rIT7';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── ユーティリティ ──────────────────────────────────────────────
const daysDiff = (a, b = new Date()) => Math.floor((b - a) / 86400000);
const isSnoozed = (t) => t.snooze && t.snooze > new Date();
const toDateStr = (d) => (d ? new Date(d).toISOString().split('T')[0] : '');
const genId = () => `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

// ── 定数 ────────────────────────────────────────────────────────
const C = {
  bg: '#0f172a', sur: '#1e293b', bdr: 'rgba(51,65,85,.55)',
  txt: '#f1f5f9', mut: '#64748b', dim: '#334155',
  red: '#ef4444', ora: '#f97316', yel: '#facc15', grn: '#22c55e',
};

const CFG = {
  neglect: { w: 4, d: 8 },
  deadline: { w: 3, d: 2 },
  overload: { maxT: 5, maxD: 2, rate: 40 },
};

// ── 危険度判定エンジン ──────────────────────────────────────────
function assess(task, overloadedUids) {
  if (isSnoozed(task))
    return { ...task, risk: 'healthy', reasons: [], score: 0, snoozed: true };
  const stale = daysDiff(task.upd);
  const dtd = task.due ? -daysDiff(task.due) : null;
  const rs = []; let score = 0;

  if (stale >= CFG.neglect.d)                                           { rs.push('stale');    score += 40 + stale; }
  if (task.due && dtd < 0)                                              { rs.push('overdue');  score += 50 + Math.abs(dtd) * 5; }
  if (!task.uid)                                                        { rs.push('unassigned'); score += 45; }
  if (task.pri === 'high' && dtd !== null && dtd >= 0 && dtd <= CFG.deadline.d) { rs.push('highNear'); score += 60; }
  if (task.uid && overloadedUids.has(task.uid))                         { rs.push('workload'); score += 30; }

  const dSet = new Set(['stale', 'overdue', 'unassigned', 'highNear', 'workload']);
  if (!rs.some((r) => dSet.has(r))) {
    if (stale >= CFG.neglect.w && stale < CFG.neglect.d) { rs.push('staleWarn'); score += 20; }
    if (dtd !== null && dtd >= 0 && dtd <= CFG.deadline.w) { rs.push('nearDL'); score += 25; }
  }
  const risk = rs.some((r) => dSet.has(r)) ? 'danger' : rs.length > 0 ? 'warning' : 'healthy';
  return { ...task, risk, reasons: rs, score, snoozed: false };
}

const REASON_LABELS = {
  stale: '8日以上更新なし', overdue: '期限超過', unassigned: '担当者未設定',
  highNear: '優先度高・期限間近', workload: '担当者に負荷集中',
  staleWarn: '4〜7日更新なし', nearDL: '期限まで3日以内',
};

function assessAll(tasks) {
  const mmap = new Map();
  for (const t of tasks) {
    if (!t.uid) continue;
    if (!mmap.has(t.uid)) mmap.set(t.uid, { total: 0, danger: 0 });
    mmap.get(t.uid).total++;
    if (t.risk === 'danger') mmap.get(t.uid).danger++;
  }
  const overloaded = new Set();
  for (const [id, e] of mmap) {
    const rate = e.total > 0 ? (e.danger / e.total) * 100 : 0;
    if (e.total >= CFG.overload.maxT || e.danger >= CFG.overload.maxD || rate >= CFG.overload.rate)
      overloaded.add(id);
  }
  return tasks.map((t) => assess(t, overloaded)).sort((a, b) => b.score - a.score);
}

// ── ユーザー一覧（固定）─────────────────────────────────────────
const USERS = [
  { id: 'u1', name: '山田 太郎', dept: '営業部' },
  { id: 'u2', name: '鈴木 花子', dept: '企画部' },
  { id: 'u3', name: '田中 健一', dept: '開発部' },
  { id: 'u4', name: '佐藤 美咲', dept: 'マーケ部' },
  { id: 'u5', name: '高橋 誠', dept: '営業部' },
];
const findUser = (id) => USERS.find((x) => x.id === id) ?? null;

// ── グローバルState ─────────────────────────────────────────────
const Ctx = createContext(null);

function AppProvider({ children }) {
  const [tasks, setTasks]       = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    await Promise.all([loadTasks(), loadProjects()]);
    setLoading(false);
  };

  // ── タスク読み込み ──────────────────────────────────────────
  const loadTasks = async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*, users!tasks_user_id_fkey(id, name, department), projects!tasks_project_id_fkey(id, name, color)')
      .order('created_at', { ascending: false });
    if (error) { console.error('loadTasks error:', error); return; }
    const enriched = (data || []).map((t) => ({
      id: t.id,
      title: t.title,
      pid: t.project_id,
      uid: t.user_id,
      status: t.status,
      pri: t.priority,
      type: t.type,
      due: t.due_date ? new Date(t.due_date) : null,
      upd: t.last_activity_at ? new Date(t.last_activity_at) : new Date(),
      snooze: t.snoozed_until ? new Date(t.snoozed_until) : undefined,
      snoozeR: t.snooze_reason,
      risk: 'healthy', reasons: [],
      projectName: t.projects?.name ?? '',
      userName: t.users?.name ?? null,
    }));
    const recalced = reCalc(enriched);
    setTasks(recalced);
  };

  // ── プロジェクト読み込み ────────────────────────────────────
  const loadProjects = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('loadProjects error:', error); return; }
    setProjects((data || []).map((p) => ({
      ...p,
      archived: !!p.archived,
      desc: p.description ?? '',
    })));
  };

  const reCalc = (ts) => {
    const a = assessAll(ts);
    return ts.map((t) => {
      const x = a.find((y) => y.id === t.id);
      return x ? { ...t, risk: x.risk, reasons: x.reasons } : t;
    });
  };

  // ── タスク CRUD ─────────────────────────────────────────────
  const addTask = useCallback(async (f) => {
    const id = genId();
    const { error } = await supabase.from('tasks').insert({
      id,
      title: f.title.trim(),
      project_id: f.pid,
      user_id: f.uid || null,
      status: f.status,
      priority: f.pri,
      type: f.type,
      due_date: f.due || null,
      last_activity_at: f.upd ? new Date(f.upd) : new Date(),
    });
    if (error) { console.error('addTask error:', error); return; }
    await loadTasks();
  }, []);

  const updateTask = useCallback(async (id, f) => {
    const patch = {};
    if (f.title !== undefined)  patch.title          = f.title.trim();
    if (f.pid   !== undefined)  patch.project_id     = f.pid;
    if (f.uid   !== undefined)  patch.user_id        = f.uid || null;
    if (f.status !== undefined) patch.status         = f.status;
    if (f.pri   !== undefined)  patch.priority       = f.pri;
    if (f.type  !== undefined)  patch.type           = f.type;
    if (f.due   !== undefined)  patch.due_date       = f.due || null;
    if (f.upd   !== undefined)  patch.last_activity_at = f.upd ? new Date(f.upd) : new Date();
    patch.updated_at = new Date();
    const { error } = await supabase.from('tasks').update(patch).eq('id', id);
    if (error) { console.error('updateTask error:', error); return; }
    await loadTasks();
  }, []);

  const deleteTask = useCallback(async (id) => {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) { console.error('deleteTask error:', error); return; }
    await loadTasks();
  }, []);

  const setStatus = useCallback(async (id, status) => {
    await supabase.from('tasks').update({ status, last_activity_at: new Date() }).eq('id', id);
    await loadTasks();
  }, []);

  const setAssignee = useCallback(async (id, uid) => {
    await supabase.from('tasks').update({ user_id: uid || null, last_activity_at: new Date() }).eq('id', id);
    await loadTasks();
  }, []);

  const setPriority = useCallback(async (id, pri) => {
    await supabase.from('tasks').update({ priority: pri, last_activity_at: new Date() }).eq('id', id);
    await loadTasks();
  }, []);

  const snoozeTask = useCallback(async (id, days) => {
    if (days === null) {
      await supabase.from('tasks').update({ snoozed_until: null, snooze_reason: null }).eq('id', id);
    } else {
      const until = new Date();
      until.setDate(until.getDate() + days);
      await supabase.from('tasks').update({ snoozed_until: until, snooze_reason: `${days}日間スヌーズ` }).eq('id', id);
    }
    await loadTasks();
  }, []);

  // ── プロジェクト CRUD ───────────────────────────────────────
  const addProject = useCallback(async (f) => {
    const id = `p${Date.now()}`;
    const { error } = await supabase.from('projects').insert({
      id,
      name: f.name.trim(),
      color: f.color,
      description: f.desc || null,
      archived: false,
    });
    if (error) { console.error('addProject error:', error); return; }
    await loadProjects();
  }, []);

  const updateProject = useCallback(async (id, f) => {
    const { error } = await supabase.from('projects').update({
      name: f.name.trim(),
      color: f.color,
      description: f.desc || null,
      updated_at: new Date(),
    }).eq('id', id);
    if (error) { console.error('updateProject error:', error); return; }
    await loadProjects();
  }, []);

  const archiveProject = useCallback(async (id, archived) => {
    const { error } = await supabase.from('projects').update({
      archived,
      updated_at: new Date(),
    }).eq('id', id);
    if (error) { console.error('archiveProject error:', error); return; }
    await loadProjects();
  }, []);

  const deleteProject = useCallback(async (id) => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) { console.error('deleteProject error:', error); return; }
    await loadProjects();
  }, []);

  const assessed = useMemo(() => assessAll(tasks), [tasks]);

  const value = {
    tasks, projects, assessed, loading,
    addTask, updateTask, deleteTask, setStatus, setAssignee, setPriority, snoozeTask,
    addProject, updateProject, archiveProject, deleteProject,
    loadTasks, loadProjects,
  };

  return (
    <Ctx.Provider value={value}>
      {loading
        ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: C.bg, color: C.mut, fontSize: 14 }}>データを読み込み中...</div>
        : children
      }
    </Ctx.Provider>
  );
}

const useApp = () => useContext(Ctx);

// ── 共通UIパーツ ────────────────────────────────────────────────
const Bar = ({ pct, color, h = 5 }) => (
  <div style={{ height: h, borderRadius: 999, background: 'rgba(51,65,85,.5)', overflow: 'hidden' }}>
    <div style={{ height: '100%', borderRadius: 999, background: color, width: `${Math.min(100, Math.max(0, pct))}%`, transition: 'width .4s' }} />
  </div>
);

function Toast({ msg, type = 'success', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); });
  const bg = type === 'danger' ? '#dc2626' : type === 'info' ? '#1d4ed8' : '#15803d';
  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: '#fff', background: bg, boxShadow: '0 8px 24px rgba(0,0,0,.5)', whiteSpace: 'nowrap' }}>
      {type === 'danger' ? '✕' : type === 'info' ? 'ℹ' : '✓'} {msg}
    </div>
  );
}

function Confirm({ title, msg, onOk, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)' }} onClick={onCancel} />
      <div style={{ position: 'relative', zIndex: 10, maxWidth: 360, width: '100%', borderRadius: 18, border: '1px solid rgba(185,28,28,.5)', background: C.bg, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.7)' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, margin: '0 auto 12px' }}>🗑</div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.txt, textAlign: 'center', marginBottom: 8 }}>{title}</h3>
        <p style={{ fontSize: 12, color: C.mut, textAlign: 'center', marginBottom: 18, lineHeight: 1.6 }}>{msg}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: 9, fontSize: 13, borderRadius: 10, border: '1px solid rgba(51,65,85,.6)', color: '#94a3b8', background: 'transparent', cursor: 'pointer' }}>キャンセル</button>
          <button onClick={onOk} style={{ flex: 1, padding: 9, fontSize: 13, fontWeight: 600, borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer' }}>削除する</button>
        </div>
      </div>
    </div>
  );
}

function SBtn({ label, c, onClick }) {
  const [hov, setHov] = useState(false);
  const s = {
    blue:  { b: 'rgba(59,130,246,.4)',  t: '#60a5fa', h: 'rgba(59,130,246,.12)' },
    red:   { b: 'rgba(239,68,68,.4)',   t: '#f87171', h: 'rgba(239,68,68,.12)'  },
    slate: { b: 'rgba(71,85,105,.4)',   t: C.mut,     h: 'rgba(71,85,105,.15)'  },
  }[c];
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ padding: '3px 8px', fontSize: 10, borderRadius: 6, border: `1px solid ${s.b}`, color: s.t, background: hov ? s.h : 'transparent', cursor: 'pointer' }}>
      {label}
    </button>
  );
}

// ── ナビゲーション ──────────────────────────────────────────────
function Nav({ page, setPage }) {
  const links = [
    { id: 'dashboard', label: '🛡 ダッシュボード' },
    { id: 'tasks',     label: '📋 課題管理' },
    { id: 'projects',  label: '📁 プロジェクト' },
    { id: 'settings',  label: '⚙️ 設定' },
  ];
  return (
    <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(15,23,42,.96)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${C.bdr}`, padding: '0 16px', display: 'flex', alignItems: 'center', height: 48 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginRight: 24 }}>🛡 TrackFlow</span>
      {links.map((l) => (
        <button key={l.id} onClick={() => setPage(l.id)}
          style={{ padding: '4px 12px', borderRadius: 6, fontSize: 13, border: 'none', cursor: 'pointer', transition: 'all .15s', background: page === l.id ? 'rgba(99,102,241,.25)' : 'transparent', color: page === l.id ? '#a5b4fc' : C.mut, fontWeight: page === l.id ? 600 : 400 }}>
          {l.label}
        </button>
      ))}
    </nav>
  );
}

// ================================================================
// ダッシュボード画面
// ================================================================
function Dashboard({ setPage }) {
  const { assessed, projects, snoozeTask } = useApp();
  const [selPid, setSelPid] = useState('all');
  const [snoozeMenu, setSnoozeMenu] = useState(null);
  const [toast, setToast] = useState(null);

  const activeProjects = projects.filter((p) => !p.archived);

  const filtered = useMemo(
    () => selPid === 'all' ? assessed : assessed.filter((a) => a.pid === selPid),
    [assessed, selPid]
  );

  const active = filtered.filter((a) => !a.snoozed);
  const kpi = {
    danger:    active.filter((a) => a.risk === 'danger').length,
    neglected: active.filter((a) => daysDiff(a.upd) >= 7).length,
    overdue:   active.filter((a) => a.due && daysDiff(a.due) > 0).length,
    snoozed:   filtered.filter((a) => a.snoozed).length,
  };

  const mmap = new Map();
  for (const a of active) {
    const user = a.uid ? findUser(a.uid) : { id: '_', name: '未設定', dept: '' };
    if (!user) continue;
    if (!mmap.has(user.id)) mmap.set(user.id, { user, total: 0, danger: 0, overdue: 0 });
    const e = mmap.get(user.id);
    e.total++;
    if (a.risk === 'danger') e.danger++;
    if (a.due && daysDiff(a.due) > 0) e.overdue++;
  }
  const members = Array.from(mmap.values())
    .map((e) => ({ ...e, status: e.danger >= 2 || e.overdue >= 2 ? 'overloaded' : e.danger >= 1 || e.overdue >= 1 ? 'warning' : 'healthy' }))
    .sort((a, b) => b.danger - a.danger);
  const overloaded = members.filter((m) => m.status === 'overloaded').length;

  const projMap = new Map();
  for (const a of active) {
    if (!projMap.has(a.pid)) projMap.set(a.pid, { danger: 0, overdue: 0, stale: 0, unassign: 0, total: 0, topScore: 0, topTask: null });
    const e = projMap.get(a.pid);
    e.total++;
    if (a.risk === 'danger') e.danger++;
    if (a.due && daysDiff(a.due) > 0) e.overdue++;
    if (daysDiff(a.upd) >= 8) e.stale++;
    if (!a.uid) e.unassign++;
    if (a.score > e.topScore) { e.topScore = a.score; e.topTask = a; }
  }
  const projHealth = activeProjects.map((pr) => {
    const e = projMap.get(pr.id) || { danger: 0, overdue: 0, stale: 0, unassign: 0, total: 0, topTask: null };
    const score = Math.max(0, 100 - e.danger * 15 - e.overdue * 20 - e.stale * 10 - e.unassign * 10);
    return { ...pr, score, status: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'danger', ...e };
  }).filter((x) => x.total > 0).sort((a, b) => a.score - b.score);

  const dangers = active.filter((a) => a.risk === 'danger');
  let summary = `全${filtered.length}件の課題に問題は見当たりません。チーム全体が健全な状態です。`;
  if (dangers.length > 0) {
    const parts = [];
    if (projHealth.length > 0 && projHealth[0].danger > 0)
      parts.push(`${projHealth[0].name}プロジェクトで危険課題が${projHealth[0].danger}件発生しています。`);
    const topM = members.find((m) => m.status === 'overloaded');
    if (topM) {
      const pct = Math.round((topM.danger / dangers.length) * 100);
      parts.push(`危険課題の${pct}%が${topM.user.name}さんに集中しています。`);
    }
    const top = dangers[0];
    const stale = daysDiff(top.upd);
    const dtd = top.due ? -daysDiff(top.due) : null;
    const due = dtd !== null ? (dtd < 0 ? `、すでに${Math.abs(dtd)}日超過` : `、期限まであと${dtd}日`) : '';
    parts.push(`特に「${top.title}」は${stale}日間更新がなく${due}です。担当再配分または進捗確認を推奨します。`);
    summary = parts.join(' ');
  }

  const RSTATUS = {
    danger:  { l: '🔴 危険', bar: C.red, bg: 'rgba(69,10,10,.38)',  bd: 'rgba(185,28,28,.45)' },
    warning: { l: '🟡 注意', bar: C.yel, bg: 'rgba(66,32,6,.32)',   bd: 'rgba(161,98,7,.4)'   },
    healthy: { l: '🟢 健全', bar: C.grn, bg: 'rgba(5,46,22,.28)',   bd: 'rgba(20,83,45,.38)'  },
  };
  const rankItems = filtered.filter((a) => a.risk !== 'healthy' || a.snoozed).slice(0, 5);

  return (
    <div style={{ padding: '20px 14px', maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.txt, margin: 0 }}>
            危険課題ダッシュボード
            {activeProjects.find((p) => p.id === selPid) && (
              <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 999, marginLeft: 8, color: '#fff', background: activeProjects.find((p) => p.id === selPid).color + '44', border: `1px solid ${activeProjects.find((p) => p.id === selPid).color}55` }}>
                {activeProjects.find((p) => p.id === selPid).name}
              </span>
            )}
          </h1>
          <p style={{ fontSize: 11, color: C.mut, margin: '3px 0 0' }}>マネージャーが3秒で状況を把握するための画面</p>
          <button onClick={() => setPage('tasks')}
            style={{ marginTop: 6, fontSize: 11, color: '#818cf8', background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.3)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
            ➕ 課題を追加・管理 →
          </button>
        </div>
      </div>

      {/* フィルター */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', padding: '9px 13px', background: 'rgba(15,23,42,.6)', border: `1px solid ${C.bdr}`, borderRadius: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: C.mut }}>プロジェクト：</span>
        {[{ id: 'all', name: '全体', color: C.mut }, ...activeProjects].map((pr) => {
          const sel = selPid === pr.id;
          return (
            <button key={pr.id} onClick={() => setSelPid(pr.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 999, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: sel ? '1px solid rgba(255,255,255,.25)' : `1px solid ${C.dim}`, background: sel ? 'rgba(255,255,255,.08)' : 'transparent', color: sel ? C.txt : C.mut, transform: sel ? 'scale(1.05)' : 'scale(1)', transition: 'all .15s' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: sel ? pr.color : C.dim }} />
              {pr.name}
            </button>
          );
        })}
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { l: '危険課題',       v: `${kpi.danger}${kpi.snoozed > 0 ? ` (💤${kpi.snoozed})` : ''}`, c: C.red,     bg: 'rgba(69,10,10,.4)',   bd: 'rgba(185,28,28,.4)'  },
          { l: '7日以上放置',    v: kpi.neglected,  c: C.ora,     bg: 'rgba(124,45,18,.35)', bd: 'rgba(194,65,12,.4)'  },
          { l: '期限超過',       v: kpi.overdue,    c: C.yel,     bg: 'rgba(113,63,18,.35)', bd: 'rgba(161,98,7,.4)'   },
          { l: '負荷集中メンバー',v: `${overloaded}人`,c:'#a78bfa', bg: 'rgba(46,16,101,.35)', bd: 'rgba(109,40,217,.4)' },
        ].map((it) => (
          <div key={it.l} style={{ borderRadius: 12, padding: '12px 14px', background: it.bg, border: `1px solid ${it.bd}` }}>
            <p style={{ fontSize: 11, color: it.c, margin: '0 0 5px' }}>{it.l}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: it.c, margin: 0, lineHeight: 1 }}>{it.v}</p>
          </div>
        ))}
      </div>

      {/* AIサマリー */}
      <div style={{ borderRadius: 12, border: '1px solid rgba(99,102,241,.4)', background: 'linear-gradient(90deg,rgba(30,27,75,.5),rgba(46,16,101,.3))', padding: '12px 16px', marginBottom: 14, display: 'flex', gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🤖</div>
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#a5b4fc', margin: '0 0 4px' }}>AIマネージャーサマリー</p>
          <p style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.7, margin: 0 }}>{summary}</p>
        </div>
      </div>

      {/* 2カラム */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 14 }}>
        {/* 危険課題ランキング */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.mut, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 10px' }}>危険課題ランキング</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {rankItems.length === 0 && <p style={{ fontSize: 12, color: C.mut, padding: '16px 0', textAlign: 'center' }}>危険・注意課題はありません 🎉</p>}
            {rankItems.map((a, i) => {
              const isDanger = a.risk === 'danger';
              const due = a.due ? (daysDiff(a.due) > 0 ? `${daysDiff(a.due)}日超過` : daysDiff(a.due) === 0 ? '今日' : `あと${Math.abs(daysDiff(a.due))}日`) : '期限なし';
              const proj = activeProjects.find((x) => x.id === a.pid);
              return (
                <div key={a.id} style={{ borderRadius: 11, border: `1px solid ${a.snoozed ? 'rgba(51,65,85,.4)' : isDanger ? 'rgba(185,28,28,.45)' : 'rgba(161,98,7,.4)'}`, background: a.snoozed ? 'rgba(30,41,59,.3)' : isDanger ? 'rgba(69,10,10,.28)' : 'rgba(66,32,6,.22)', padding: '10px 13px', opacity: a.snoozed ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: a.snoozed ? '#334155' : i === 0 ? '#ef4444' : i === 1 ? '#f97316' : '#334155', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                      {a.snoozed ? '💤' : i + 1}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                    {proj && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: proj.color + '20', color: proj.color, border: `1px solid ${proj.color}40`, flexShrink: 0 }}>{proj.name}</span>}
                    {!a.snoozed && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, border: '1px solid', flexShrink: 0, ...(isDanger ? { background: 'rgba(239,68,68,.2)', color: '#fca5a5', borderColor: 'rgba(239,68,68,.4)' } : { background: 'rgba(234,179,8,.2)', color: '#fde68a', borderColor: 'rgba(234,179,8,.4)' }) }}>
                      {isDanger ? '🔴 危険' : '🟡 注意'}
                    </span>}
                  </div>
                  {!a.snoozed && a.reasons.length > 0 && (
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
                      {a.reasons.map((r) => <span key={r} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: isDanger ? 'rgba(239,68,68,.1)' : 'rgba(234,179,8,.1)', color: isDanger ? '#fca5a5' : '#fde68a', border: `1px solid ${isDanger ? 'rgba(239,68,68,.3)' : 'rgba(234,179,8,.3)'}` }}>⚠ {REASON_LABELS[r]}</span>)}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 10, fontSize: 10, color: C.mut }}>
                      <span>👤 {a.uid ? (findUser(a.uid)?.name ?? a.userName) : <span style={{ color: '#f87171' }}>未設定</span>}</span>
                      <span style={{ color: a.due && daysDiff(a.due) > 0 ? C.red : C.mut }}>📅 {due}</span>
                      <span>🔄 {daysDiff(a.upd)}日前更新</span>
                    </div>
                    <div style={{ position: 'relative' }}>
                      <button onClick={() => setSnoozeMenu(snoozeMenu === a.id ? null : a.id)}
                        style={{ fontSize: 10, padding: '3px 8px', borderRadius: 7, border: `1px solid ${C.dim}`, color: C.mut, background: 'transparent', cursor: 'pointer' }}>
                        {isSnoozed(a) ? '💤 解除' : '💤 スヌーズ'}
                      </button>
                      {snoozeMenu === a.id && (
                        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 40, background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.5)', minWidth: 150, overflow: 'hidden' }}>
                          {(isSnoozed(a) ? [{ l: 'スヌーズ解除', d: null }] : [{ l: '7日間スヌーズ', d: 7 }, { l: '14日間スヌーズ', d: 14 }, { l: '30日間スヌーズ', d: 30 }]).map((o) => (
                            <button key={o.l} onClick={() => { snoozeTask(a.id, o.d); setSnoozeMenu(null); setToast({ msg: o.d ? `${o.d}日間スヌーズしました` : 'スヌーズを解除しました', type: o.d ? 'success' : 'info' }); }}
                              style={{ display: 'block', width: '100%', padding: '8px 12px', fontSize: 11, color: C.txt, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(51,65,85,.4)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                              {o.l}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右カラム */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {selPid === 'all' && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: C.mut, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px' }}>プロジェクト健康度</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {projHealth.map((ph) => {
                  const st = RSTATUS[ph.status];
                  return (
                    <div key={ph.id} style={{ borderRadius: 10, border: `1px solid ${st.bd}`, background: st.bg, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        <div style={{ width: 3, height: 30, borderRadius: 999, background: ph.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: C.txt, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ph.name}</p>
                          <p style={{ fontSize: 9, color: C.mut, margin: 0 }}>{ph.total}件</p>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 600, color: st.bar, flexShrink: 0 }}>{st.l}</span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: st.bar, flexShrink: 0 }}>{ph.score}<span style={{ fontSize: 9, color: C.mut }}>点</span></span>
                      </div>
                      <Bar pct={ph.score} color={st.bar} h={3} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* メンバー負荷 */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: C.mut, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px' }}>メンバー負荷</p>
            <div style={{ borderRadius: 10, border: `1px solid ${C.bdr}`, background: C.sur, overflow: 'hidden' }}>
              {members.map((m, i) => {
                const stColor = m.status === 'overloaded' ? '#fca5a5' : m.status === 'warning' ? '#fde68a' : '#86efac';
                const stLabel = m.status === 'overloaded' ? '負荷集中' : m.status === 'warning' ? '注意' : '健全';
                return (
                  <div key={m.user.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: i < members.length - 1 ? `1px solid rgba(30,41,59,.8)` : 'none', background: m.status === 'overloaded' ? 'rgba(69,10,10,.1)' : m.status === 'warning' ? 'rgba(66,32,6,.08)' : 'transparent' }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: m.status === 'overloaded' ? 'rgba(239,68,68,.25)' : m.status === 'warning' ? 'rgba(234,179,8,.25)' : 'rgba(51,65,85,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: stColor, flexShrink: 0 }}>
                      {m.user.name.charAt(0)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, color: C.txt, fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.user.name}</p>
                      <p style={{ fontSize: 9, color: C.mut, margin: 0 }}>{m.user.dept} · 担当{m.total}件 / 危険{m.danger}件</p>
                    </div>
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 999, background: `${stColor}18`, color: stColor, fontWeight: 600, flexShrink: 0 }}>{stLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

// ================================================================
// 課題管理画面
// ================================================================
const STATUS_L = { open: '未対応', in_progress: '対応中', review: 'レビュー中', closed: '完了' };
const STATUS_C = { open: '#94a3b8', in_progress: '#93c5fd', review: '#c4b5fd', closed: '#86efac' };
const PRI_L = { high: '高', medium: '中', low: '低' };
const PRI_C = { high: '#f87171', medium: '#fbbf24', low: '#64748b' };
const TYPE_L = { task: 'タスク', bug: 'バグ', request: '要望' };

function TasksPage() {
  const { assessed, projects, addTask, updateTask, deleteTask, setStatus, setAssignee, setPriority, snoozeTask } = useApp();
  const [modal, setModal]     = useState(null);
  const [delTarget, setDel]   = useState(null);
  const [toast, setToast]     = useState(null);
  const [fPid, setFPid]       = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [fRisk, setFRisk]     = useState('all');
  const [search, setSearch]   = useState('');

  const showToast = (msg, type = 'success') => setToast({ msg, type });
  const activeProjects = projects.filter((p) => !p.archived);

  const items = useMemo(() =>
    assessed.filter((a) => {
      if (fPid !== 'all' && a.pid !== fPid) return false;
      if (fStatus !== 'all' && a.status !== fStatus) return false;
      if (fRisk !== 'all' && a.risk !== fRisk) return false;
      if (search && !a.title.includes(search)) return false;
      return true;
    }), [assessed, fPid, fStatus, fRisk, search]);

  const dangerN  = assessed.filter((a) => a.risk === 'danger'  && !a.snoozed).length;
  const warningN = assessed.filter((a) => a.risk === 'warning' && !a.snoozed).length;

  return (
    <div style={{ padding: '20px 14px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 10 }}>ダッシュボード / <span style={{ color: '#94a3b8' }}>課題管理</span></div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.txt, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            📋 課題管理
            <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: 'rgba(239,68,68,.2)', color: '#fca5a5', border: '1px solid rgba(239,68,68,.35)' }}>危険 {dangerN}</span>
            <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: 'rgba(234,179,8,.15)', color: '#fde68a', border: '1px solid rgba(234,179,8,.3)' }}>注意 {warningN}</span>
          </h1>
          <p style={{ fontSize: 11, color: C.mut, margin: '4px 0 0' }}>課題を追加・変更するとダッシュボードにリアルタイムで反映されます</p>
        </div>
        <button onClick={() => setModal('create')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(79,70,229,.4)' }}>
          ➕ 課題を追加
        </button>
      </div>

      {/* フィルター */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10, padding: '9px 12px', background: 'rgba(15,23,42,.6)', border: `1px solid ${C.bdr}`, borderRadius: 11 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 タイトルで検索..."
          style={{ flex: 1, minWidth: 140, background: 'rgba(30,41,59,.6)', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '5px 10px', fontSize: 12, color: C.txt, outline: 'none' }} />
        {[
          { val: fPid,    set: setFPid,    opts: [{ v: 'all', l: '全プロジェクト' }, ...activeProjects.map((p) => ({ v: p.id, l: p.name }))] },
          { val: fStatus, set: setFStatus, opts: [{ v: 'all', l: '全ステータス' },  ...Object.entries(STATUS_L).map(([v, l]) => ({ v, l }))] },
          { val: fRisk,   set: setFRisk,   opts: [{ v: 'all', l: '全リスク' }, { v: 'danger', l: '🔴 危険' }, { v: 'warning', l: '🟡 注意' }, { v: 'healthy', l: '🟢 健全' }] },
        ].map((f, i) => (
          <select key={i} value={f.val} onChange={(e) => f.set(e.target.value)}
            style={{ background: 'rgba(30,41,59,.6)', border: `1px solid rgba(51,65,85,.5)`, borderRadius: 8, padding: '5px 10px', fontSize: 12, color: '#cbd5e1', cursor: 'pointer', outline: 'none' }}>
            {f.opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        ))}
        {(fPid !== 'all' || fStatus !== 'all' || fRisk !== 'all' || search) && (
          <button onClick={() => { setFPid('all'); setFStatus('all'); setFRisk('all'); setSearch(''); }}
            style={{ fontSize: 11, color: C.mut, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>リセット</button>
        )}
      </div>
      <p style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>{items.length}件表示 / 全{assessed.length}件</p>

      {/* テーブル */}
      <div style={{ borderRadius: 13, border: `1px solid ${C.bdr}`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(30,41,59,.5)', borderBottom: `1px solid ${C.bdr}` }}>
              {['', '課題タイトル', 'ステータス', '優先度', '担当者', '期限', '最終更新', '操作'].map((h, i) => (
                <th key={i} style={{ padding: i === 0 ? '8px 0' : '8px 10px', fontSize: 10, fontWeight: 600, color: C.mut, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '36px 0', textAlign: 'center', fontSize: 13, color: C.mut }}>課題が見つかりません。フィルターを変更するか「➕ 課題を追加」してください。</td></tr>
            )}
            {items.map((a) => (
              <TaskRow key={a.id} a={a} projects={activeProjects}
                onEdit={() => setModal(a)}
                onDelete={() => setDel(a)}
                onStatus={(s) => { setStatus(a.id, s); showToast('ステータスを変更しました'); }}
                onAssignee={(id) => { setAssignee(a.id, id); showToast('担当者を変更しました'); }}
                onPriority={(p) => { setPriority(a.id, p); showToast('優先度を変更しました'); }}
                onSnooze={(d) => { snoozeTask(a.id, d); showToast(d ? `${d}日間スヌーズしました` : 'スヌーズを解除しました', d ? 'success' : 'info'); }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <TaskModal task={modal === 'create' ? null : modal} projects={activeProjects}
          onSave={(data) => {
            if (modal === 'create') { addTask(data); showToast('課題を作成しました。ダッシュボードに反映されました'); }
            else { updateTask(modal.id, data); showToast('課題を更新しました'); }
            setModal(null);
          }}
          onClose={() => setModal(null)} />
      )}

      {delTarget && (
        <Confirm title={`「${delTarget.title}」を削除しますか？`} msg="削除するとダッシュボードの集計からも除外されます。この操作は取り消せません。"
          onOk={() => { deleteTask(delTarget.id); setDel(null); showToast('課題を削除しました', 'danger'); }}
          onCancel={() => setDel(null)} />
      )}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function TaskRow({ a, projects, onEdit, onDelete, onStatus, onAssignee, onPriority, onSnooze }) {
  const [hov, setHov] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const proj  = projects.find((x) => x.id === a.pid);
  const stale = daysDiff(a.upd);
  const dueD  = a.due ? (daysDiff(a.due) > 0 ? `${daysDiff(a.due)}日超過` : daysDiff(a.due) === 0 ? '今日' : `${Math.abs(daysDiff(a.due))}日後`) : '—';
  const dueOver = a.due && daysDiff(a.due) > 0;
  const RBGS = { danger: 'rgba(69,10,10,.4)', warning: 'rgba(66,32,6,.3)', healthy: 'transparent' };

  return (
    <tr style={{ background: a.snoozed ? 'rgba(30,41,59,.2)' : hov ? 'rgba(30,41,59,.5)' : RBGS[a.risk], borderBottom: `1px solid ${C.bdr}`, opacity: a.snoozed ? 0.55 : 1, transition: 'background .15s' }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <td style={{ width: 3, padding: 0 }}>
        <div style={{ width: 3, height: 48, background: a.snoozed ? '#334155' : a.risk === 'danger' ? C.red : a.risk === 'warning' ? C.yel : 'transparent' }} />
      </td>
      <td style={{ padding: '10px 10px', maxWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: proj?.color ?? '#64748b', flexShrink: 0, marginTop: 5 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: C.txt, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</p>
            <p style={{ fontSize: 9, color: C.mut, margin: '2px 0 0' }}>{proj?.name} · {TYPE_L[a.type]}</p>
            {!a.snoozed && a.reasons.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                {a.reasons.map((r) => <span key={r} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: a.risk === 'danger' ? 'rgba(239,68,68,.15)' : 'rgba(234,179,8,.15)', color: a.risk === 'danger' ? '#fca5a5' : '#fde68a', border: `1px solid ${a.risk === 'danger' ? 'rgba(239,68,68,.3)' : 'rgba(234,179,8,.3)'}` }}>⚠ {REASON_LABELS[r]}</span>)}
              </div>
            )}
            {a.snoozed && a.snooze && <span style={{ fontSize: 9, color: '#475569' }}>💤 {new Date(a.snooze).toLocaleDateString('ja-JP')}まで</span>}
          </div>
        </div>
      </td>
      <td style={{ padding: '10px 8px' }}>
        <select value={a.status} onChange={(e) => { e.stopPropagation(); onStatus(e.target.value); }} onClick={(e) => e.stopPropagation()}
          style={{ background: 'rgba(15,23,42,.8)', border: '1px solid rgba(51,65,85,.5)', borderRadius: 6, padding: '3px 6px', fontSize: 11, color: STATUS_C[a.status], cursor: 'pointer', outline: 'none' }}>
          {Object.entries(STATUS_L).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td style={{ padding: '10px 8px' }}>
        <select value={a.pri} onChange={(e) => { e.stopPropagation(); onPriority(e.target.value); }} onClick={(e) => e.stopPropagation()}
          style={{ background: 'rgba(15,23,42,.8)', border: '1px solid rgba(51,65,85,.5)', borderRadius: 6, padding: '3px 6px', fontSize: 11, color: PRI_C[a.pri], cursor: 'pointer', outline: 'none' }}>
          {Object.entries(PRI_L).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td style={{ padding: '10px 8px' }}>
        <select value={a.uid ?? ''} onChange={(e) => { e.stopPropagation(); onAssignee(e.target.value || null); }} onClick={(e) => e.stopPropagation()}
          style={{ background: 'rgba(15,23,42,.8)', border: '1px solid rgba(51,65,85,.5)', borderRadius: 6, padding: '3px 6px', fontSize: 11, color: a.uid ? C.txt : '#f87171', cursor: 'pointer', outline: 'none' }}>
          <option value="">未設定</option>
          {USERS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </td>
      <td style={{ padding: '10px 8px', fontSize: 11, whiteSpace: 'nowrap', color: dueOver ? C.red : C.mut, fontWeight: dueOver ? 600 : 400 }}>{dueD}</td>
      <td style={{ padding: '10px 8px', fontSize: 11, color: stale >= 8 ? C.red : stale >= 4 ? C.yel : C.mut, whiteSpace: 'nowrap' }}>{stale === 0 ? '今日' : `${stale}日前`}</td>
      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <SBtn label="編集" c="blue" onClick={onEdit} />
          <div style={{ position: 'relative' }}>
            <SBtn label={a.snoozed ? '解除' : '💤'} c="slate" onClick={() => setSnoozeOpen((v) => !v)} />
            {snoozeOpen && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50, background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.5)', minWidth: 148, overflow: 'hidden' }}>
                {(a.snoozed ? [{ l: 'スヌーズ解除', d: null }] : [{ l: '7日間スヌーズ', d: 7 }, { l: '14日間スヌーズ', d: 14 }, { l: '30日間スヌーズ', d: 30 }]).map((o) => (
                  <button key={o.l} onClick={() => { onSnooze(o.d); setSnoozeOpen(false); }}
                    style={{ display: 'block', width: '100%', padding: '8px 12px', fontSize: 11, color: C.txt, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(51,65,85,.4)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    {o.l}
                  </button>
                ))}
              </div>
            )}
          </div>
          <SBtn label="削除" c="red" onClick={onDelete} />
        </div>
      </td>
    </tr>
  );
}

function TaskModal({ task, projects, onSave, onClose }) {
  const [form, setForm] = useState({
    title:  task?.title  ?? '',
    pid:    task?.pid    ?? (projects[0]?.id ?? ''),
    uid:    task?.uid    ?? '',
    status: task?.status ?? 'open',
    pri:    task?.pri    ?? 'medium',
    type:   task?.type   ?? 'task',
    due:    toDateStr(task?.due  ?? null),
    upd:    toDateStr(task?.upd  ?? null),
  });
  const [err, setErr] = useState({});

  const hints = [];
  if (!form.uid) hints.push({ t: '⚠', c: '#fca5a5', m: '担当者が未設定 → 危険課題として判定されます' });
  if (form.upd) {
    const d = daysDiff(new Date(form.upd));
    if (d >= 8) hints.push({ t: '⚠', c: '#fca5a5', m: `最終更新が${d}日前 → 放置・危険判定されます` });
    else if (d >= 4) hints.push({ t: 'ℹ', c: '#93c5fd', m: `最終更新が${d}日前 → 注意課題として表示されます` });
  }
  if (form.due) {
    const d = Math.floor((new Date(form.due) - Date.now()) / 86400000);
    if (d < 0) hints.push({ t: '⚠', c: '#fca5a5', m: `期限を${Math.abs(d)}日超過 → 危険課題として判定されます` });
    else if (d <= 2 && form.pri === 'high') hints.push({ t: '⚠', c: '#fca5a5', m: `高優先度・期限まで${d}日以内 → 危険判定されます` });
    else if (d <= 3) hints.push({ t: 'ℹ', c: '#93c5fd', m: `期限まで${d}日 → 注意課題として表示されます` });
  }

  const submit = () => {
    const e = {};
    if (!form.title.trim()) e.title = 'タイトルを入力してください';
    else if (form.title.length > 60) e.title = '60文字以内で入力してください';
    if (!form.pid) e.pid = 'プロジェクトを選択してください';
    if (Object.keys(e).length) { setErr(e); return; }
    onSave({ ...form, uid: form.uid || null, title: form.title.trim() });
  };

  const iStyle = { width: '100%', borderRadius: 8, background: 'rgba(15,23,42,.7)', border: '1px solid rgba(51,65,85,.6)', padding: '8px 10px', fontSize: 13, color: C.txt, outline: 'none' };
  const sStyle = { ...iStyle, cursor: 'pointer', background: 'rgba(15,23,42,.9)' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px 16px', overflowY: 'auto' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 580, borderRadius: 16, border: `1px solid ${task ? 'rgba(51,65,85,.5)' : 'rgba(99,102,241,.4)'}`, background: C.bg, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.7)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: C.txt, margin: 0 }}>{task ? '✏️ 課題を編集' : '➕ 課題を作成'}</h2>
            {!task && <p style={{ fontSize: 11, color: C.mut, margin: '3px 0 0' }}>作成するとダッシュボードにリアルタイムで反映されます</p>}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid rgba(51,65,85,.5)`, background: 'transparent', color: C.mut, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', display: 'block', marginBottom: 5 }}>タイトル <span style={{ color: '#f87171' }}>*</span></label>
            <input value={form.title} maxLength={60} autoFocus onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); setErr((v) => ({ ...v, title: '' })); }}
              placeholder="例：顧客A社への提案書作成" style={{ ...iStyle, borderColor: err.title ? '#ef4444' : 'rgba(51,65,85,.6)' }} />
            {err.title && <p style={{ fontSize: 11, color: '#f87171', marginTop: 3 }}>{err.title}</p>}
            <p style={{ fontSize: 10, color: C.mut, marginTop: 3, textAlign: 'right' }}>{form.title.length}/60</p>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', display: 'block', marginBottom: 5 }}>プロジェクト <span style={{ color: '#f87171' }}>*</span></label>
            <select value={form.pid} onChange={(e) => { setForm((f) => ({ ...f, pid: e.target.value })); setErr((v) => ({ ...v, pid: '' })); }} style={sStyle}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', display: 'block', marginBottom: 5 }}>担当者</label>
            <select value={form.uid ?? ''} onChange={(e) => setForm((f) => ({ ...f, uid: e.target.value }))} style={{ ...sStyle, color: form.uid ? C.txt : '#f87171' }}>
              <option value="">担当者未設定（危険判定の対象になります）</option>
              {USERS.map((u) => <option key={u.id} value={u.id}>{u.name}（{u.dept}）</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { l: '優先度',     k: 'pri',    opts: Object.entries(PRI_L).map(([v, l]) => ({ v, l })) },
              { l: '種別',       k: 'type',   opts: Object.entries(TYPE_L).map(([v, l]) => ({ v, l })) },
              { l: 'ステータス', k: 'status', opts: Object.entries(STATUS_L).map(([v, l]) => ({ v, l })) },
            ].map((f) => (
              <div key={f.k}>
                <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', display: 'block', marginBottom: 5 }}>{f.l}</label>
                <select value={form[f.k]} onChange={(e) => setForm((v) => ({ ...v, [f.k]: e.target.value }))} style={sStyle}>
                  {f.opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', display: 'block', marginBottom: 5 }}>期限</label>
              <input type="date" value={form.due} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))} style={iStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', display: 'block', marginBottom: 5 }}>最終更新日</label>
              <input type="date" value={form.upd} onChange={(e) => setForm((f) => ({ ...f, upd: e.target.value }))} style={iStyle} />
              <p style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>⬆ 過去日を入れると放置課題として判定されます</p>
            </div>
          </div>
          {hints.length > 0 && (
            <div style={{ borderRadius: 8, background: 'rgba(30,41,59,.6)', border: `1px solid ${C.bdr}`, padding: '10px 12px' }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: C.mut, margin: '0 0 5px' }}>📊 ダッシュボードへの反映イメージ</p>
              {hints.map((h, i) => <p key={i} style={{ fontSize: 11, color: h.c, margin: '2px 0' }}>{h.t} {h.m}</p>)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
            <button onClick={submit} style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(79,70,229,.35)' }}>
              {task ? '変更を保存' : '課題を作成'}
            </button>
            <button onClick={onClose} style={{ padding: '8px 14px', fontSize: 13, borderRadius: 10, border: '1px solid rgba(51,65,85,.6)', color: '#94a3b8', background: 'transparent', cursor: 'pointer' }}>キャンセル</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// プロジェクト管理画面 — Supabase完全対応版
// ================================================================
const PALETTE = ['#ef4444','#f97316','#f59e0b','#eab308','#22c55e','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899','#64748b'];
const PALETTE_L = ['レッド','オレンジ','アンバー','イエロー','グリーン','エメラルド','シアン','ブルー','インディゴ','バイオレット','ピンク','スレート'];

function PForm({ initial, editId: eid, allProjects, onSave, onCancel, isNew }) {
  const [f, setF] = useState(initial);
  const [e, setE] = useState({});
  const iStyle = { width: '100%', borderRadius: 8, background: 'rgba(15,23,42,.7)', border: '1px solid rgba(51,65,85,.6)', padding: '7px 10px', fontSize: 13, color: C.txt, outline: 'none' };
  return (
    <div style={{ borderRadius: 11, border: `1px solid ${isNew ? 'rgba(99,102,241,.4)' : 'rgba(51,65,85,.5)'}`, background: isNew ? 'rgba(99,102,241,.07)' : 'rgba(30,41,59,.5)', padding: 14, marginBottom: isNew ? 11 : 0 }}>
      {isNew && <p style={{ fontSize: 10, fontWeight: 600, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 9 }}>＋ 新規プロジェクト</p>}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', display: 'block', marginBottom: 4 }}>プロジェクト名 <span style={{ color: '#f87171' }}>*</span></label>
        <input value={f.name} maxLength={30} autoFocus onChange={(ev) => { setF((v) => ({ ...v, name: ev.target.value })); setE((v) => ({ ...v, name: '' })); }}
          placeholder="例：顧客A導入" style={{ ...iStyle, borderColor: e.name ? '#ef4444' : 'rgba(51,65,85,.6)' }} />
        {e.name && <p style={{ fontSize: 11, color: '#f87171', marginTop: 3 }}>{e.name}</p>}
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1' }}>テーマカラー</label>
          <div style={{ width: 16, height: 16, borderRadius: '50%', background: f.color, border: '1px solid rgba(255,255,255,.2)' }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PALETTE.map((c, i) => (
            <button key={c} onClick={() => setF((v) => ({ ...v, color: c }))} title={PALETTE_L[i]}
              style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: f.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', transition: 'all .15s', transform: f.color === c ? 'scale(1.15)' : 'scale(1)' }} />
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', display: 'block', marginBottom: 4 }}>説明（任意）</label>
        <textarea value={f.desc} maxLength={100} rows={2} onChange={(ev) => setF((v) => ({ ...v, desc: ev.target.value }))}
          placeholder="このプロジェクトの目的や概要" style={{ ...iStyle, resize: 'none' }} />
      </div>
      <div style={{ display: 'flex', gap: 7 }}>
        <button onClick={() => {
          if (!f.name.trim()) { setE({ name: 'プロジェクト名を入力してください' }); return; }
          if (allProjects.some((p) => p.name === f.name.trim() && p.id !== eid)) { setE({ name: '同じ名前が既に存在します' }); return; }
          onSave(f);
        }} style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>
          {isNew ? '作成する' : '変更を保存'}
        </button>
        <button onClick={onCancel} style={{ padding: '6px 12px', fontSize: 12, borderRadius: 9, border: '1px solid rgba(51,65,85,.6)', color: '#94a3b8', background: 'transparent', cursor: 'pointer' }}>キャンセル</button>
      </div>
    </div>
  );
}

function ProjectsPage() {
  const { assessed, projects, addProject, updateProject, archiveProject, deleteProject } = useApp();
  const [showNew, setShowNew]   = useState(false);
  const [editId, setEditId]     = useState(null);
  const [delTarget, setDel]     = useState(null);
  const [showArch, setShowArch] = useState(false);
  const [toast, setToast]       = useState(null);

  const taskCount  = (id) => assessed.filter((a) => a.pid === id).length;
  const active     = projects.filter((p) => !p.archived);
  const archived   = projects.filter((p) => p.archived);
  const displayed  = showArch ? [...active, ...archived] : active;

  return (
    <div style={{ padding: '20px 14px', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 10 }}>ダッシュボード / <span style={{ color: '#94a3b8' }}>プロジェクト管理</span></div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.txt, margin: 0 }}>📁 プロジェクト管理</h1>
          <p style={{ fontSize: 11, color: C.mut, margin: '4px 0 0' }}>ダッシュボードに表示するプロジェクトの追加・編集・管理ができます</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'rgba(30,41,59,.6)', border: `1px solid ${C.bdr}`, color: '#cbd5e1', fontWeight: 500 }}>アクティブ {active.length}件</span>
          {archived.length > 0 && (
            <>
              <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'rgba(30,41,59,.4)', border: `1px solid rgba(51,65,85,.3)`, color: C.mut }}>アーカイブ {archived.length}件</span>
              <button onClick={() => setShowArch((v) => !v)} style={{ fontSize: 11, color: C.mut, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                {showArch ? 'アーカイブを隠す' : 'アーカイブを表示'}
              </button>
            </>
          )}
        </div>
        <button onClick={() => { setShowNew(true); setEditId(null); }} disabled={showNew}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 10, border: 'none', background: showNew ? '#1e293b' : '#4f46e5', color: showNew ? '#475569' : '#fff', cursor: showNew ? 'not-allowed' : 'pointer', boxShadow: showNew ? 'none' : '0 4px 12px rgba(79,70,229,.4)' }}>
          ＋ 新規プロジェクト
        </button>
      </div>

      {showNew && (
        <PForm initial={{ name: '', color: '#6366f1', desc: '' }} allProjects={projects}
          onSave={async (f) => {
            await addProject(f);
            setShowNew(false);
            setToast({ msg: `「${f.name}」を作成しました` });
          }}
          onCancel={() => setShowNew(false)} isNew />
      )}

      <div style={{ borderRadius: 13, border: `1px solid ${C.bdr}`, background: 'rgba(15,23,42,.5)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 65px 1fr 65px 128px', gap: 10, alignItems: 'center', padding: '6px 14px', borderBottom: `1px solid ${C.bdr}`, background: 'rgba(30,41,59,.4)', fontSize: 10, fontWeight: 500, color: C.mut }}>
          <span /><span>プロジェクト名</span><span style={{ textAlign: 'center' }}>課題数</span><span>説明</span><span style={{ textAlign: 'center' }}>作成日</span><span style={{ textAlign: 'center' }}>操作</span>
        </div>

        {displayed.length === 0 && (
          <p style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: C.mut }}>プロジェクトがありません。「＋ 新規プロジェクト」から作成してください。</p>
        )}

        {displayed.map((pr, i) => (
          <div key={pr.id}>
            {editId !== pr.id ? (
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 65px 1fr 65px 128px', gap: 10, alignItems: 'center', padding: '9px 14px', borderBottom: i < displayed.length - 1 ? `1px solid rgba(30,41,59,.8)` : 'none', opacity: pr.archived ? 0.5 : 1, transition: 'background .15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(30,41,59,.4)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: pr.color }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.name}</span>
                  {pr.archived && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, border: `1px solid rgba(71,85,105,.5)`, color: C.mut, flexShrink: 0 }}>アーカイブ</span>}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 12, color: taskCount(pr.id) > 0 ? '#cbd5e1' : C.dim, fontWeight: 500 }}>{taskCount(pr.id)}</span>
                  <span style={{ fontSize: 10, color: C.mut }}>件</span>
                </div>
                <p style={{ fontSize: 11, color: C.mut, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pr.desc || <span style={{ color: C.dim, fontStyle: 'italic' }}>説明なし</span>}
                </p>
                <p style={{ fontSize: 10, color: C.dim, textAlign: 'center' }}>
                  {pr.created_at ? new Date(pr.created_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '—'}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <SBtn label="編集" c="blue" onClick={() => { setEditId(pr.id); setShowNew(false); }} />
                  <SBtn label={pr.archived ? '戻す' : '保管'} c="slate"
                    onClick={async () => {
                      await archiveProject(pr.id, !pr.archived);
                      setToast({ msg: pr.archived ? `「${pr.name}」を元に戻しました` : `「${pr.name}」をアーカイブしました`, type: pr.archived ? 'success' : 'info' });
                    }} />
                  <SBtn label="削除" c="red" onClick={() => setDel(pr)} />
                </div>
              </div>
            ) : (
              <div style={{ padding: '10px 14px', borderBottom: i < displayed.length - 1 ? `1px solid rgba(30,41,59,.8)` : 'none', background: 'rgba(30,41,59,.3)' }}>
                <PForm initial={{ name: pr.name, color: pr.color, desc: pr.desc ?? '' }} editId={pr.id} allProjects={projects}
                  onSave={async (f) => {
                    await updateProject(pr.id, f);
                    setEditId(null);
                    setToast({ msg: `「${f.name}」を更新しました` });
                  }}
                  onCancel={() => setEditId(null)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 13, borderRadius: 11, border: `1px solid rgba(30,41,59,.7)`, background: 'rgba(15,23,42,.4)', padding: '11px 13px' }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: C.mut, marginBottom: 5 }}>💡 プロジェクトについて</p>
        {['プロジェクトは課題を集計・可視化するためのグループです', 'アーカイブするとダッシュボードのフィルターに表示されなくなります', '削除すると紐づく課題の所属が「未分類」になります'].map((t) => (
          <p key={t} style={{ fontSize: 11, color: C.dim, marginBottom: 2 }}>• {t}</p>
        ))}
      </div>

      {delTarget && (
        <Confirm title={`「${delTarget.name}」を削除しますか？`}
          msg={`${taskCount(delTarget.id)}件の課題が紐づいています。削除すると課題の所属が「未分類」になります。この操作は取り消せません。`}
          onOk={async () => {
            await deleteProject(delTarget.id);
            setDel(null);
            setToast({ msg: `「${delTarget.name}」を削除しました`, type: 'danger' });
          }}
          onCancel={() => setDel(null)} />
      )}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

// ================================================================
// 設定画面
// ================================================================
function SettingsPage() {
  const { assessed } = useApp();
  const [cfg, setCfg] = useState({ neglect: { w: 4, d: 8 }, deadline: { w: 3, d: 2 }, overload: { maxT: 5, maxD: 2, rate: 40 }, notif: { enabled: true, freq: 'daily' } });
  const [saved, setSaved] = useState(cfg);
  const [status, setStatus] = useState('idle');
  const [toast, setToast] = useState(null);
  const hasChanges = JSON.stringify(cfg) !== JSON.stringify(saved);

  const prev = useMemo(() => {
    const tasks = assessed.map((a) => a);
    const mmap = new Map();
    for (const a of tasks) {
      if (!a.uid) continue;
      if (!mmap.has(a.uid)) mmap.set(a.uid, { t: 0, d: 0 });
      mmap.get(a.uid).t++;
      if (a.risk === 'danger') mmap.get(a.uid).d++;
    }
    const ol = new Set();
    for (const [id, e] of mmap) {
      const rate = e.t > 0 ? (e.d / e.t) * 100 : 0;
      if (e.t >= cfg.overload.maxT || e.d >= cfg.overload.maxD || rate >= cfg.overload.rate) ol.add(id);
    }
    let danger = 0, warning = 0;
    for (const a of tasks) {
      if (a.snoozed) continue;
      const stale = daysDiff(a.upd), dtd = a.due ? -daysDiff(a.due) : null;
      const rs = [];
      if (stale >= cfg.neglect.d) rs.push('stale');
      if (a.due && dtd < 0) rs.push('overdue');
      if (!a.uid) rs.push('unassigned');
      if (a.pri === 'high' && dtd !== null && dtd >= 0 && dtd <= cfg.deadline.d) rs.push('highNear');
      const dSet = new Set(['stale', 'overdue', 'unassigned', 'highNear']);
      if (!rs.some((r) => dSet.has(r))) {
        if (stale >= cfg.neglect.w && stale < cfg.neglect.d) rs.push('staleWarn');
        if (dtd !== null && dtd >= 0 && dtd <= cfg.deadline.w) rs.push('nearDL');
      }
      const risk = rs.some((r) => dSet.has(r)) ? 'danger' : rs.length > 0 ? 'warning' : 'healthy';
      if (risk === 'danger') danger++; else if (risk === 'warning') warning++;
    }
    const total = tasks.filter((a) => !a.snoozed).length;
    const healthPct = total > 0 ? Math.round(((total - danger - warning) / total) * 100) : 100;
    return { danger, warning, overloaded: [...ol].length, healthPct, total };
  }, [assessed, cfg]);

  const Slider = ({ label, hint, val, min, max, step = 1, unit, color, markerVal, markerLabel, onChange }) => {
    const COLS = {
      yellow: { fill: '#facc15', bText: '#fde68a', bBd: 'rgba(250,204,21,.3)', bBg: 'rgba(250,204,21,.12)' },
      red:    { fill: '#ef4444', bText: '#fca5a5', bBd: 'rgba(239,68,68,.3)',  bBg: 'rgba(239,68,68,.12)'  },
      blue:   { fill: '#60a5fa', bText: '#93c5fd', bBd: 'rgba(96,165,250,.3)', bBg: 'rgba(96,165,250,.12)' },
      purple: { fill: '#a78bfa', bText: '#c4b5fd', bBd: 'rgba(167,139,250,.3)',bBg: 'rgba(167,139,250,.12)'},
    };
    const c = COLS[color] ?? COLS.blue;
    const pct  = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    const mPct = markerVal != null ? Math.max(0, Math.min(100, ((markerVal - min) / (max - min)) * 100)) : null;
    return (
      <div style={{ marginBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: C.txt, margin: 0, lineHeight: 1.4 }}>{label}</p>
            <p style={{ fontSize: 11, color: C.mut, margin: '3px 0 0', lineHeight: 1.5 }}>{hint}</p>
          </div>
          <div style={{ flexShrink: 0, fontSize: 18, fontWeight: 700, padding: '4px 11px', borderRadius: 8, background: c.bBg, color: c.bText, border: `1px solid ${c.bBd}` }}>
            {val}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 2, opacity: 0.7 }}>{unit}</span>
          </div>
        </div>
        <div style={{ position: 'relative', height: 30, display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, top: '50%', transform: 'translateY(-50%)', height: 8, background: 'rgba(51,65,85,.7)', borderRadius: 999 }} />
          <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', height: 8, background: c.fill, borderRadius: 999, width: `${pct}%`, transition: 'width .1s', pointerEvents: 'none' }} />
          {mPct !== null && (
            <div style={{ position: 'absolute', left: `${mPct}%`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none', zIndex: 1 }}>
              <div style={{ width: 2, height: 16, background: 'rgba(250,204,21,.5)', borderRadius: 999, marginTop: -4 }} />
              {markerLabel && <span style={{ fontSize: 9, color: 'rgba(250,204,21,.55)', marginTop: 2, whiteSpace: 'nowrap' }}>{markerLabel}</span>}
            </div>
          )}
          <div style={{ position: 'absolute', width: 20, height: 20, borderRadius: '50%', background: '#fff', border: `2px solid ${c.fill}`, boxShadow: '0 2px 8px rgba(0,0,0,.45)', left: `calc(${pct}% - 10px)`, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', transition: 'left .1s' }} />
          <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => onChange(+e.target.value)}
            style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', margin: 0 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.dim, padding: '2px 2px 0' }}>
          <span>{min}{unit}</span><span>{Math.round((min + max) / 2)}{unit}</span><span>{max}{unit}</span>
        </div>
      </div>
    );
  };

  const SEC = {
    yellow: { bd: 'rgba(161,98,7,.4)',   bg: 'rgba(66,32,6,.2)',   iconBg: 'rgba(250,204,21,.08)', iconBd: 'rgba(250,204,21,.2)'  },
    red:    { bd: 'rgba(185,28,28,.4)',  bg: 'rgba(69,10,10,.2)',  iconBg: 'rgba(239,68,68,.08)',  iconBd: 'rgba(239,68,68,.2)'   },
    purple: { bd: 'rgba(109,40,217,.4)', bg: 'rgba(46,16,101,.2)', iconBg: 'rgba(167,139,250,.08)',iconBd: 'rgba(167,139,250,.2)' },
    blue:   { bd: 'rgba(29,78,216,.4)',  bg: 'rgba(23,37,84,.2)',  iconBg: 'rgba(96,165,250,.08)', iconBd: 'rgba(96,165,250,.2)'  },
  };
  const Section = ({ emoji, title, desc, color, children }) => {
    const c = SEC[color];
    return (
      <div style={{ borderRadius: 15, border: `1px solid ${c.bd}`, background: c.bg, padding: '16px 18px', marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, border: `1px solid ${c.iconBd}`, background: c.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{emoji}</div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.txt, margin: 0 }}>{title}</p>
            <p style={{ fontSize: 11, color: C.mut, margin: '2px 0 0', lineHeight: 1.55 }}>{desc}</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>{children}</div>
      </div>
    );
  };
  const Div  = () => <div style={{ borderTop: '1px solid rgba(51,65,85,.35)', margin: '2px 0' }} />;
  const Hint = ({ c }) => <div style={{ background: 'rgba(30,41,59,.5)', borderRadius: 7, padding: '7px 11px', fontSize: 11, color: C.mut }}>{c}</div>;

  return (
    <div style={{ padding: '20px 14px', maxWidth: 1060, margin: '0 auto' }}>
      <style>{`input[type=range]{-webkit-appearance:none}`}</style>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 10 }}>ダッシュボード / <span style={{ color: '#94a3b8' }}>チーム健康設定</span></div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: hasChanges ? 8 : 14 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.txt, margin: 0 }}>⚙️ チーム健康設定</h1>
          <p style={{ fontSize: 11, color: C.mut, margin: '4px 0 0' }}>「何日更新がなければ危険?」などの判定ルールをチームに合わせて調整できます</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setCfg({ neglect: { w: 4, d: 8 }, deadline: { w: 3, d: 2 }, overload: { maxT: 5, maxD: 2, rate: 40 }, notif: { enabled: true, freq: 'daily' } }); setToast({ msg: '初期値に戻しました' }); }} disabled={!hasChanges}
            style={{ padding: '6px 13px', fontSize: 12, borderRadius: 9, border: '1px solid rgba(71,85,105,.6)', color: hasChanges ? '#94a3b8' : '#334155', background: 'transparent', cursor: hasChanges ? 'pointer' : 'not-allowed' }}>初期値に戻す</button>
          <button onClick={async () => { setStatus('saving'); await new Promise((r) => setTimeout(r, 600)); setSaved(cfg); setStatus('saved'); setToast({ msg: '設定を保存しました' }); setTimeout(() => setStatus('idle'), 2500); }} disabled={!hasChanges || status === 'saving'}
            style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 9, border: 'none', cursor: hasChanges ? 'pointer' : 'not-allowed', background: status === 'saved' ? '#16a34a' : hasChanges ? '#4f46e5' : '#1e293b', color: (hasChanges || status === 'saved') ? '#fff' : '#334155' }}>
            {status === 'saving' ? '保存中…' : status === 'saved' ? '✓ 保存しました' : '設定を保存'}
          </button>
        </div>
      </div>
      {hasChanges && status === 'idle' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#fbbf24', background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.2)', borderRadius: 7, padding: '6px 11px', marginBottom: 13 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fbbf24', flexShrink: 0 }} />設定が変更されています。右のプレビューに即時反映されています。
        </div>
      )}
      {(!hasChanges || status !== 'idle') && <div style={{ height: 13 }} />}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 13, alignItems: 'start' }}>
        <div>
          <Section emoji="🕐" title="放置日数の設定" color="yellow" desc="課題が何日間更新されないと「注意」や「危険」と判定するかを決めます。">
            <Slider label="注意（⚠️）になる放置日数" hint="この日数以上更新がない課題を「注意」として黄色で表示します" val={cfg.neglect.w} min={1} max={Math.max(cfg.neglect.d - 1, 2)} unit="日" color="yellow" onChange={(v) => setCfg((c) => ({ ...c, neglect: { ...c.neglect, w: Math.min(v, c.neglect.d - 1) } }))} />
            <Div />
            <Slider label="危険（🔴）になる放置日数" hint="この日数以上更新がない課題を「危険」として赤く表示します" val={cfg.neglect.d} min={cfg.neglect.w + 1} max={30} unit="日" color="red" markerVal={cfg.neglect.w} markerLabel={`注意 ${cfg.neglect.w}日`} onChange={(v) => setCfg((c) => ({ ...c, neglect: { ...c.neglect, d: Math.max(v, c.neglect.w + 1) } }))} />
            <Hint c={<>🟢 0〜{cfg.neglect.w - 1}日 → 健全　🟡 {cfg.neglect.w}〜{cfg.neglect.d - 1}日 → 注意　🔴 {cfg.neglect.d}日以上 → 危険</>} />
          </Section>
          <Section emoji="📅" title="期限接近の設定" color="red" desc="期限が何日以内に迫ったら「注意」「危険」と判定するかを決めます。">
            <Slider label="注意（⚠️）になる期限まで残り日数" hint="期限まであとこの日数以内になった課題を「注意」として表示します" val={cfg.deadline.w} min={Math.max(cfg.deadline.d + 1, 2)} max={14} unit="日" color="yellow" onChange={(v) => setCfg((c) => ({ ...c, deadline: { ...c.deadline, w: Math.max(v, c.deadline.d + 1) } }))} />
            <Div />
            <Slider label="危険（🔴）になる期限まで残り日数（高優先度のみ）" hint="優先度「高」の課題が期限まであとこの日数以内になったとき「危険」と判定します" val={cfg.deadline.d} min={1} max={Math.max(cfg.deadline.w - 1, 1)} unit="日" color="red" markerVal={cfg.deadline.w} markerLabel={`注意 ${cfg.deadline.w}日`} onChange={(v) => setCfg((c) => ({ ...c, deadline: { ...c.deadline, d: Math.min(v, c.deadline.w - 1) } }))} />
            <Hint c={<>🟢 {cfg.deadline.w + 1}日以上 → 問題なし　🟡 {cfg.deadline.d + 1}〜{cfg.deadline.w}日 → 注意　🔴 {cfg.deadline.d}日以内（高優先度）→ 危険</>} />
          </Section>
          <Section emoji="👥" title="負荷集中の設定" color="purple" desc="1人のメンバーが課題を抱えすぎている「負荷集中」状態を検知します。3つの条件のうち1つでも満たすと判定します。">
            <Slider label="担当課題数の上限" hint="1人が担当する課題がこの件数以上になると「負荷集中」と判定します" val={cfg.overload.maxT} min={2} max={15} unit="件" color="purple" onChange={(v) => setCfg((c) => ({ ...c, overload: { ...c.overload, maxT: v } }))} />
            <Div />
            <Slider label="危険課題数の上限" hint="1人が担当する「危険」課題がこの件数以上になると「負荷集中」と判定します" val={cfg.overload.maxD} min={1} max={10} unit="件" color="red" onChange={(v) => setCfg((c) => ({ ...c, overload: { ...c.overload, maxD: v } }))} />
            <Div />
            <Slider label="危険課題の占有率" hint="担当課題のうち「危険」課題がこの割合以上を占めると「負荷集中」と判定します" val={cfg.overload.rate} min={10} max={100} step={5} unit="%" color="red" onChange={(v) => setCfg((c) => ({ ...c, overload: { ...c.overload, rate: v } }))} />
            <Hint c="⚡ 上の3条件のうちどれか1つを満たしたメンバーを「負荷集中」と判定します" />
          </Section>
          <Section emoji="🔔" title="通知設定" color="blue" desc="危険課題が発生したときに自動でアラートを送る機能です。">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', background: 'rgba(30,41,59,.5)', border: '1px solid rgba(51,65,85,.45)', borderRadius: 10 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', margin: 0 }}>通知を受け取る</p>
                <p style={{ fontSize: 11, color: C.mut, margin: '2px 0 0' }}>危険課題が発生したとき自動でアラートを送ります</p>
              </div>
              <div onClick={() => setCfg((c) => ({ ...c, notif: { ...c.notif, enabled: !c.notif.enabled } }))}
                style={{ width: 42, height: 23, borderRadius: 999, background: cfg.notif.enabled ? '#4f46e5' : '#334155', position: 'relative', cursor: 'pointer', transition: 'background .2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 2.5, width: 17, height: 17, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.4)', left: cfg.notif.enabled ? 22 : 3, transition: 'left .2s' }} />
              </div>
            </div>
            {cfg.notif.enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <p style={{ fontSize: 11, color: C.mut, fontWeight: 500, margin: 0, paddingLeft: 2 }}>通知の頻度</p>
                {[{ id: 'daily', l: '毎日 1 回', d: '毎朝9時に危険課題をまとめて通知します' }, { id: 'weekly', l: '週 1 回', d: '毎週月曜日にまとめて通知します' }, { id: 'disabled', l: '無効', d: '自動通知を送りません' }].map((f) => {
                  const sel = cfg.notif.freq === f.id;
                  return (
                    <div key={f.id} onClick={() => setCfg((c) => ({ ...c, notif: { ...c.notif, freq: f.id } }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 9, cursor: 'pointer', border: sel ? '1px solid rgba(96,165,250,.5)' : '1px solid rgba(51,65,85,.4)', background: sel ? 'rgba(96,165,250,.12)' : 'rgba(30,41,59,.35)', transition: 'all .15s' }}>
                      <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${sel ? '#60a5fa' : '#475569'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {sel && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa' }} />}
                      </div>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 500, color: sel ? '#93c5fd' : '#94a3b8', margin: 0 }}>{f.l}</p>
                        <p style={{ fontSize: 11, color: C.mut, margin: '1px 0 0' }}>{f.d}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        {/* プレビューパネル */}
        <div style={{ position: 'sticky', top: 60 }}>
          <div style={{ borderRadius: 15, border: '1px solid rgba(109,40,217,.45)', background: 'linear-gradient(160deg,rgba(46,16,101,.4),rgba(15,23,42,.75))', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>👁</div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#c4b5fd', margin: 0 }}>リアルタイムプレビュー</p>
                  <p style={{ fontSize: 10, color: C.mut, margin: 0 }}>現在の設定での判定結果</p>
                </div>
              </div>
              {hasChanges && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#fbbf24', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.25)', padding: '3px 8px', borderRadius: 999 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fbbf24' }} />未保存
              </span>}
            </div>
            {[
              { l: '危険課題',       v: prev.danger,    of: prev.total, unit: '件', tc: '#f87171', bg: 'rgba(69,10,10,.45)',   bd: 'rgba(185,28,28,.4)',  bar: C.red     },
              { l: '注意課題',       v: prev.warning,   of: prev.total, unit: '件', tc: '#facc15', bg: 'rgba(66,32,6,.4)',    bd: 'rgba(161,98,7,.35)',  bar: C.yel     },
              { l: '負荷集中メンバー',v: prev.overloaded,of: 5,          unit: '人', tc: '#c4b5fd', bg: 'rgba(46,16,101,.4)', bd: 'rgba(109,40,217,.4)', bar: '#a78bfa' },
            ].map((k) => {
              const pct = k.of > 0 ? Math.round((k.v / k.of) * 100) : 0;
              return (
                <div key={k.l} style={{ borderRadius: 9, border: `1px solid ${k.bd}`, background: k.bg, padding: '9px 11px', marginBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: k.tc }}>{k.l}</span>
                    <span style={{ fontSize: 19, fontWeight: 700, color: k.tc }}>{k.v}<span style={{ fontSize: 11, fontWeight: 400, color: C.mut, marginLeft: 2 }}>{k.unit}</span></span>
                  </div>
                  <Bar pct={pct} color={k.bar} h={4} />
                  <p style={{ fontSize: 10, color: C.dim, textAlign: 'right', margin: '3px 0 0' }}>全体の {pct}%</p>
                </div>
              );
            })}
            {(() => {
              const s = prev.healthPct >= 70 ? { icon: '🟢', l: '良好', bar: C.grn, bd: 'rgba(20,83,45,.35)', bg: 'rgba(5,46,22,.22)' } : prev.healthPct >= 40 ? { icon: '🟡', l: '注意あり', bar: C.yel, bd: 'rgba(161,98,7,.35)', bg: 'rgba(66,32,6,.22)' } : { icon: '🔴', l: '要対応', bar: C.red, bd: 'rgba(185,28,28,.4)', bg: 'rgba(69,10,10,.3)' };
              return (
                <div style={{ borderRadius: 9, border: `1px solid ${s.bd}`, background: s.bg, padding: '9px 11px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: C.txt, margin: 0 }}>{s.icon} チーム状態：{s.l}</p>
                      <p style={{ fontSize: 10, color: C.mut, margin: '2px 0 0' }}>健全な課題の割合</p>
                    </div>
                    <span style={{ fontSize: 22, fontWeight: 700, color: C.txt }}>{prev.healthPct}<span style={{ fontSize: 12, color: C.mut }}>%</span></span>
                  </div>
                  <Bar pct={prev.healthPct} color={s.bar} h={5} />
                </div>
              );
            })()}
            <p style={{ fontSize: 10, color: '#1e293b', textAlign: 'center', marginTop: 9 }}>Supabaseデータ {prev.total}件で計算</p>
          </div>
          <div style={{ marginTop: 11, borderRadius: 11, border: `1px solid rgba(30,41,59,.7)`, background: 'rgba(15,23,42,.45)', padding: '11px 13px' }}>
            <p style={{ fontSize: 11, fontWeight: 500, color: C.mut, margin: '0 0 5px' }}>💡 使い方のヒント</p>
            {['スライダーを動かすと右のプレビューが即座に変わります', '「注意」閾値は「危険」より必ず小さい値になります', '初期値は一般的なチームの標準的な基準です'].map((t) => (
              <p key={t} style={{ fontSize: 11, color: C.dim, margin: '0 0 3px' }}>• {t}</p>
            ))}
          </div>
        </div>
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

// ================================================================
// アプリルート
// ================================================================
export default function App() {
  const [page, setPage] = useState('dashboard');
  const PAGES = { dashboard: Dashboard, tasks: TasksPage, projects: ProjectsPage, settings: SettingsPage };
  const Page = PAGES[page];
  return (
    <AppProvider>
      <div style={{ background: C.bg, minHeight: '100vh', fontFamily: 'system-ui,-apple-system,sans-serif', color: C.txt }}>
        <style>{`* { box-sizing: border-box; } button, select { outline: none; } tr:last-child td { border-bottom: none !important; }`}</style>
        <Nav page={page} setPage={setPage} />
        <Page setPage={setPage} />
      </div>
    </AppProvider>
  );
}
