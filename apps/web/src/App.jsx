import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowsOutSimple,
  Bell,
  CalendarBlank,
  Camera,
  ChatCircleDots,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Copy,
  GearSix,
  Heart,
  House,
  ImageSquare,
  ListChecks,
  LockKey,
  MagicWand,
  MapPin,
  PencilSimple,
  PaperPlaneTilt,
  Play,
  Plus,
  SignOut,
  Sparkle,
  Trash,
  UploadSimple,
  Users,
  X,
} from "@phosphor-icons/react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/noto-sans-sc";
import { API_SETTINGS_ENABLED, api, apiOriginStore, authStore, connectRealtime, imageUrl } from "./api";

const navItems = [
  { id: "home", label: "首页", icon: House },
  { id: "timeline", label: "时光", icon: ClockCounterClockwise },
  { id: "gallery", label: "相册", icon: ImageSquare },
  { id: "todos", label: "清单", icon: ListChecks },
  { id: "anniversaries", label: "纪念日", icon: CalendarBlank },
  { id: "chat", label: "情侣话", icon: ChatCircleDots },
  { id: "planner", label: "约会灵感", icon: MagicWand },
];

const emptyData = { me: null, dashboard: null, moments: [], anniversaries: [], todos: [], messages: [] };
const pad = (value) => String(value).padStart(2, "0");
const toDateText = (value) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00`));
const toTime = (value) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const toWeekdayText = (value) => new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date(`${value}T12:00:00`));
const toSlashDate = (value) => value.split("-").map(Number).join("/");
const toCommentTime = (value) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

function filterByDateRange(items, range) {
  return items.filter((item) => (!range.start || item.happened_at >= range.start) && (!range.end || item.happened_at <= range.end));
}

function groupByMomentDate(items) {
  const groups = new Map();
  items.forEach((item) => {
    const current = groups.get(item.happened_at) || [];
    current.push(item);
    groups.set(item.happened_at, current);
  });
  return [...groups.entries()].map(([date, moments]) => ({ date, moments }));
}

function elapsedParts(from) {
  const start = new Date(`${from}T00:00:00`).getTime();
  const diff = Math.max(0, Date.now() - start);
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor(diff / 3600000) % 24,
    minutes: Math.floor(diff / 60000) % 60,
    seconds: Math.floor(diff / 1000) % 60,
  };
}

function daysUntil(value, yearly = true) {
  const raw = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(raw);
  if (yearly) {
    target.setFullYear(today.getFullYear());
    if (target < today) target.setFullYear(today.getFullYear() + 1);
  }
  return Math.ceil((target - today) / 86400000);
}

function useClock(from) {
  const [parts, setParts] = useState(() => elapsedParts(from));
  useEffect(() => {
    setParts(elapsedParts(from));
    const timer = window.setInterval(() => setParts(elapsedParts(from)), 1000);
    return () => window.clearInterval(timer);
  }, [from]);
  return parts;
}

export function App() {
  const [token, setToken] = useState(authStore.get());
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [view, setView] = useState(() => {
    const requested = window.location.hash.replace("#", "");
    return navItems.some((item) => item.id === requested) ? requested : "home";
  });
  const [modal, setModal] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commentVersion, setCommentVersion] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!authStore.get()) return;
    if (!silent) setLoading(true);
    try {
      const [me, dashboard, moments, anniversaries, todos, messages] = await Promise.all([
        api("/api/me"), api("/api/dashboard"), api("/api/moments"), api("/api/anniversaries"), api("/api/todos"), api("/api/messages"),
      ]);
      setData({ me, dashboard, moments, anniversaries, todos, messages });
      setError("");
    } catch (requestError) {
      setError(requestError.message);
      if (/登录状态/.test(requestError.message)) {
        authStore.clear();
        setToken(null);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (token) load(); }, [token, load]);
  useEffect(() => {
    if (!token) return undefined;
    const socket = connectRealtime(
      (update) => {
        load(true);
        if (update?.resource === "comments") setCommentVersion((current) => current + 1);
      },
      (message) => setData((current) => ({ ...current, messages: current.messages.some((item) => item.id === message.id) ? current.messages : [...current.messages, message] })),
    );
    return () => socket?.disconnect();
  }, [token, load]);

  const handleAuth = (payload) => {
    authStore.set(payload.token);
    setLoading(true);
    setToken(payload.token);
  };
  const logout = () => {
    authStore.clear();
    setToken(null);
    setData(emptyData);
  };
  const handlePasswordChanged = (nextToken) => {
    authStore.set(nextToken);
    setToken(nextToken);
    setModal(null);
    setSettingsOpen(false);
  };
  const navigate = (nextView) => {
    setView(nextView);
    window.history.replaceState(null, "", `#${nextView}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!token) return <AuthScreen onAuth={handleAuth} />;
  if (loading) return <LoadingScreen />;
  if (error && !data.me) return <ErrorScreen message={error} onRetry={() => load()} onLogout={logout} />;

  const contentProps = { data, reload: () => load(true), setModal };
  const modalType = typeof modal === "string" ? modal : modal?.type;
  const modalItem = modal && typeof modal === "object" ? modal.item : null;
  const views = {
    home: <HomeView {...contentProps} />,
    timeline: <TimelineView {...contentProps} />,
    gallery: <GalleryView {...contentProps} />,
    todos: <TodoView {...contentProps} />,
    anniversaries: <AnniversaryView {...contentProps} />,
    chat: <ChatView {...contentProps} />,
    planner: <PlannerView {...contentProps} />,
  };

  return (
    <div className="app-shell">
      <AmbientPattern />
      <Sidebar items={navItems} active={view} onChange={navigate} members={data.me?.members || []} />
      <main className="main-stage">
        <Topbar
          data={data}
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          onLogout={logout}
          onSaved={() => load(true)}
          onChangePassword={() => { setSettingsOpen(false); setModal({ type: "change-password" }); }}
          onDeleteSpace={() => { setSettingsOpen(false); setModal({ type: "delete-space" }); }}
        />
        {error && <div className="inline-alert">{error}</div>}
        <div className="view-stage" key={view}>{views[view]}</div>
      </main>
      <MobileNav items={navItems} active={view} onChange={navigate} />
      {modalType === "moment" && <MomentModal item={modalItem} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(true); }} />}
      {modalType === "anniversary" && <AnniversaryModal item={modalItem} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(true); }} />}
      {modalType === "todo" && <TodoModal item={modalItem} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(true); }} />}
      {modalType === "lightbox" && <Lightbox item={modalItem} onClose={() => setModal(null)} />}
      {modalType === "comments" && <CommentsModal item={modalItem} me={data.me} refreshKey={commentVersion} onClose={() => setModal(null)} onChanged={() => load(true)} />}
      {modalType === "ai-settings" && <AISettingsModal onClose={() => setModal(null)} onSaved={() => { modal?.onSaved?.(); setModal(null); }} />}
      {modalType === "change-password" && <ChangePasswordModal onClose={() => setModal(null)} onChanged={handlePasswordChanged} />}
      {modalType === "delete-space" && <DeleteSpaceModal onClose={() => setModal(null)} onDeleted={logout} />}
    </div>
  );
}

function AmbientPattern() {
  return (
    <div className="ambient-pattern" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => <Heart key={index} weight="fill" style={{ "--x": `${(index * 37) % 96}%`, "--y": `${(index * 23) % 92}%`, "--r": `${(index % 5) * 11 - 18}deg`, "--s": `${10 + (index % 4) * 5}px` }} />)}
    </div>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", inviteCode: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serverOpen, setServerOpen] = useState(() => API_SETTINGS_ENABLED && !apiOriginStore.get());
  const [serverAddress, setServerAddress] = useState(() => apiOriginStore.get());
  const [serverBusy, setServerBusy] = useState(false);
  const [serverStatus, setServerStatus] = useState("");
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify(form) });
      onAuth(payload);
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };
  const saveServer = async (event) => {
    event.preventDefault(); setServerBusy(true); setServerStatus("");
    try {
      const normalized = apiOriginStore.set(serverAddress);
      setServerAddress(normalized);
      const health = await api("/health");
      if (!health.ok) throw new Error("服务器健康检查没有通过");
      setServerStatus("连接成功，可以登录了");
      setServerOpen(false);
    } catch (requestError) { setServerStatus(requestError.message); } finally { setServerBusy(false); }
  };
  return (
    <div className="auth-page">
      <section className="auth-visual">
        <img src="/images/couple-lakeside.png" alt="一对情侣在湖边散步" />
        <div className="auth-brand"><BrandMark /><span>Lumi</span><small>ONLY FOR TWO</small></div>
        <div className="auth-copy">
          <span className="eyebrow light">PRIVATE, SOFT & OURS</span>
          <h1>把寻常日子，<br />慢慢写成我们的故事。</h1>
          <p>照片、约定、纪念日与想说的话，都安静地留在两个人的空间里。</p>
          <div className="auth-trust"><span><LockKey />只属于两个人</span><span><Sparkle />每一刻都有回声</span></div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">WELCOME HOME</span>
          <h2>{mode === "login" ? "回到我们的空间" : "接受 TA 的邀请"}</h2>
          <p>{mode === "login" ? "登录后继续收藏两个人的日常。" : "只有收到一次性邀请码，才能注册加入这间双人小屋。"}</p>
          <div className="segmented">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button>
          </div>
          <form onSubmit={submit} className="auth-form">
            {mode === "register" && <Field label="昵称"><input name="name" value={form.name} onChange={update} placeholder="希望对方怎么叫你" required /></Field>}
            <Field label="邮箱"><input name="email" type="email" value={form.email} onChange={update} placeholder="name@example.com" required /></Field>
            <Field label="密码"><input name="password" type="password" value={form.password} onChange={update} placeholder="至少 6 位" minLength={6} required /></Field>
            {mode === "register" && <Field label="一次性邀请码"><input name="inviteCode" value={form.inviteCode} onChange={update} placeholder="输入 TA 发给你的邀请码" minLength={8} maxLength={20} autoComplete="off" required /></Field>}
            {error && <div className="form-error">{error}</div>}
            <button className="primary-button full" disabled={busy}>{busy ? "正在打开…" : mode === "login" ? "进入双人空间" : "加入双人空间"}<ArrowRight weight="bold" /></button>
          </form>
          <small className="privacy-note"><LockKey /> 你的记录只通过自己的服务端保存，不会公开展示。</small>
          {API_SETTINGS_ENABLED && <div className="native-server-wrap">
            <button type="button" className="server-toggle" onClick={() => setServerOpen((current) => !current)}><GearSix />服务器设置</button>
            {serverOpen && <form className="server-settings" onSubmit={saveServer}>
              <Field label="后端服务器地址"><input type="url" value={serverAddress} onChange={(event) => setServerAddress(event.target.value)} placeholder="https://你的后端地址" autoCapitalize="none" autoCorrect="off" required /></Field>
              <p>地址只保存在这台手机。正式使用请填写 HTTPS 地址。</p>
              {serverStatus && <div className={serverStatus.startsWith("连接成功") ? "form-success" : "form-error"}>{serverStatus}</div>}
              <button className="quiet-button full" disabled={serverBusy}>{serverBusy ? "正在检测…" : "保存并检测连接"}</button>
            </form>}
          </div>}
        </div>
      </section>
    </div>
  );
}

function BrandMark() { return <span className="brand-mark"><Heart weight="fill" /></span>; }

function LoadingScreen() {
  return <div className="loading-screen"><BrandMark /><div className="loading-line" /><p>正在打开两个人的小屋…</p></div>;
}

function ErrorScreen({ message, onRetry, onLogout }) {
  return <div className="loading-screen"><BrandMark /><h2>暂时没有连上空间</h2><p>{message}</p><div className="button-row"><button className="primary-button" onClick={onRetry}>重新连接</button><button className="quiet-button" onClick={onLogout}>返回登录</button></div></div>;
}

function Sidebar({ items, active, onChange, members }) {
  return (
    <aside className="sidebar">
      <button className="couple-avatar" onClick={() => onChange("home")} aria-label="回到首页">
        {members.slice(0, 2).map((member, index) => <span key={member.id} style={{ background: member.avatarColor, zIndex: 2 - index }}>{member.name.slice(0, 1)}</span>)}
      </button>
      <nav>{items.map(({ id: itemId, label, icon: Icon }) => <button key={itemId} data-view={itemId} className={active === itemId ? "active" : ""} onClick={() => onChange(itemId)}><Icon weight={active === itemId ? "fill" : "regular"} /><span>{label}</span></button>)}</nav>
      <span className="secure-dot"><LockKey weight="fill" />私密空间</span>
    </aside>
  );
}

function MobileNav({ items, active, onChange }) {
  return <nav className="mobile-nav">{items.map(({ id: itemId, label, icon: Icon }) => <button key={itemId} data-view={itemId} className={active === itemId ? "active" : ""} onClick={() => onChange(itemId)}><Icon weight={active === itemId ? "fill" : "regular"} /><span>{label}</span></button>)}</nav>;
}

function Topbar({ data, settingsOpen, setSettingsOpen, onLogout, onSaved, onChangePassword, onDeleteSpace }) {
  const me = data.me;
  const copyCode = async () => navigator.clipboard?.writeText(me.space.inviteCode);
  const regenerateCode = async () => {
    if (!window.confirm("旧邀请码会立即失效，确定重新生成吗？")) return;
    await api("/api/space/invite", { method: "POST" });
    await onSaved();
  };
  return (
    <header className="topbar">
      <div><span className="today">{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span><h1>{me.space.title}</h1></div>
      <div className="top-actions">
        <span className="sync-pill"><span />实时同步</span>
        <button className="icon-button" aria-label="设置" onClick={() => setSettingsOpen((value) => !value)}><GearSix /></button>
      </div>
      {settingsOpen && (
        <div className="settings-popover">
          <div className="settings-title"><div><span className="eyebrow">OUR ACCOUNT</span><h3>双人空间</h3></div><button className="icon-button small" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X /></button></div>
          <div className="member-grid">{me.members.map((member) => <div className="member-chip" key={member.id}><Avatar member={member} /><span><b>{member.name}</b><small>{member.email}</small></span></div>)}</div>
          <form className="settings-form" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await api("/api/space", { method: "PATCH", body: JSON.stringify({ title: form.get("title"), togetherSince: form.get("date") }) }); onSaved(); setSettingsOpen(false); }}>
            <Field label="空间名字"><input name="title" defaultValue={me.space.title} /></Field>
            <Field label="在一起的日期"><input name="date" type="date" defaultValue={me.space.togetherSince} /></Field>
            <button className="primary-button compact"><Check />保存设置</button>
          </form>
          {me.space.paired ? <div className="invite-card paired"><span>情侣账号</span><b>已完成双人配对</b></div> : <div className="invite-card"><span>邀请 TA 加入 · 使用一次后失效</span><b>{me.space.inviteCode}</b><button onClick={copyCode}><Copy />复制邀请码</button><button onClick={regenerateCode}>重新生成邀请码</button></div>}
          <button className="logout-button" onClick={onChangePassword}><LockKey />修改登录密码</button>
          <button className="logout-button" onClick={onLogout}><SignOut />退出当前账号</button>
          <button className="danger-link" onClick={onDeleteSpace}><Trash />永久删除账号与全部空间数据</button>
        </div>
      )}
    </header>
  );
}

function HomeView({ data, setModal }) {
  const since = data.dashboard.space.togetherSince;
  const elapsed = useClock(since);
  const latest = data.dashboard.latestMoment;
  const coverMoment = data.moments.find((moment) => moment.image_url);
  const partner = data.me.members.find((member) => member.id !== data.me.user.id);
  return (
    <section className="page home-page">
      <div className="hero-grid">
        <div className="together-card">
          <span className="soft-label"><Heart weight="fill" />我们在一起</span>
          <div className="day-count"><strong>{elapsed.days}</strong><span>天</span></div>
          <div className="time-row"><TimeBox value={elapsed.hours} label="时" /><TimeBox value={elapsed.minutes} label="分" /><TimeBox value={elapsed.seconds} label="秒" accent /></div>
          <p>从 {toDateText(since)} 开始，每一天都有了共同的名字。</p>
          <button className="primary-button" onClick={() => setModal("moment")}><Plus weight="bold" />记录此刻</button>
        </div>
        <div className="cover-card">
          {coverMoment ? <><img src={imageUrl(coverMoment.image_url)} alt={coverMoment.title} />{coverMoment.video_url && <MotionBadge />}</> : <div className="cover-empty"><ImageSquare /><b>还没有共同照片</b><span>上传的第一张照片会出现在这里</span></div>}
          <div className="cover-vignette" />
          <div className="cover-meta"><span>{coverMoment ? "最近收藏" : "OUR FIRST PHOTO"}</span><h3>{coverMoment?.title || latest?.title || "等一张属于你们的照片"}</h3><p><MapPin />我们的共同相册</p></div>
          <button className="cover-action" onClick={() => setModal("moment")}><Camera />添加新照片</button>
        </div>
      </div>
      <div className="quote-card"><span className="quote-icon"><Heart weight="fill" /></span><div><small>TODAY'S NOTE</small><h2>{partner ? `想把平常的温柔都留给 ${partner.name}，往后的每一天都算数。` : "先把这间小屋的邀请码发给 TA 吧。"}</h2></div><Sparkle className="quote-spark" /></div>
      <div className="overview-grid">
        <OverviewCard icon={ImageSquare} label="共同回忆" value={data.dashboard.counts.moments} suffix="个瞬间" tone="lilac" />
        <OverviewCard icon={ListChecks} label="未完成心愿" value={data.dashboard.counts.todos} suffix="件小事" tone="peach" />
        <OverviewCard icon={CalendarBlank} label="重要日子" value={data.dashboard.counts.anniversaries} suffix="个纪念" tone="blue" />
        <div className="mail-card"><span className="soft-label">OUR PRIVATE MAILBOX</span><h3>只属于你们的情话</h3><p>{data.dashboard.latestMessage?.body || "给对方留下一句晚安。"}</p><button className="text-button">今晚也要好好说话 <ArrowRight /></button></div>
      </div>
    </section>
  );
}

function TimeBox({ value, label, accent }) { return <div className={accent ? "accent" : ""}><strong>{pad(value)}</strong><span>{label}</span></div>; }
function OverviewCard({ icon: Icon, label, value, suffix, tone }) { return <div className={`overview-card ${tone}`}><span className="overview-icon"><Icon /></span><div><span>{label}</span><strong>{value}</strong><small>{suffix}</small></div></div>; }

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function DateRangeFilter({ range, setRange, total, visible }) {
  const update = (field, value) => setRange((current) => {
    const next = { ...current, [field]: value };
    if (next.start && next.end && next.start > next.end) {
      if (field === "start") next.end = value;
      else next.start = value;
    }
    return next;
  });
  const active = Boolean(range.start || range.end);
  return <div className="date-range-filter">
    <div className="date-range-summary"><span className="date-range-icon"><CalendarBlank weight="duotone" /></span><span><b>按日期查看</b><small>{active ? `筛选出 ${visible} / ${total} 条记录` : `共 ${total} 条记录`}</small></span></div>
    <div className="date-range-fields">
      <label><span>开始日期</span><input type="date" value={range.start} max={range.end || undefined} onChange={(event) => update("start", event.target.value)} aria-label="开始日期" /></label>
      <ArrowRight className="date-range-arrow" />
      <label><span>结束日期</span><input type="date" value={range.end} min={range.start || undefined} onChange={(event) => update("end", event.target.value)} aria-label="结束日期" /></label>
      {active && <button type="button" className="date-range-clear" onClick={() => setRange({ start: "", end: "" })}><X />清空</button>}
    </div>
  </div>;
}

function TimelineView({ data, setModal, reload }) {
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const visibleMoments = filterByDateRange(data.moments, dateRange);
  const dayGroups = groupByMomentDate(visibleMoments);
  const remove = async (moment) => {
    if (!window.confirm(`确定删除“${moment.title}”吗？相关照片也会一起删除。`)) return;
    await api(`/api/moments/${moment.id}`, { method: "DELETE" });
    reload();
  };
  return (
    <section className="page">
      <PageHeading eyebrow="OUR TIMELINE" title="我们的时光" description="不用轰轰烈烈，普通日子也值得被好好保存。" action={<button className="primary-button" onClick={() => setModal("moment")}><Plus />记录此刻</button>} />
      <DateRangeFilter range={dateRange} setRange={setDateRange} total={data.moments.length} visible={visibleMoments.length} />
      {!data.moments.length && <EmptyState icon={ClockCounterClockwise} title="还没有时光记录" description="写下第一件只属于你们的小事吧。" />}
      {data.moments.length > 0 && !visibleMoments.length && <EmptyState icon={CalendarBlank} title="这个日期范围还没有时光" description="换一段日期看看，或者清空筛选查看全部记录。" />}
      <div className="timeline-days">{dayGroups.map((group, dayIndex) => <section className={`timeline-day day-tone-${dayIndex % 3}`} key={group.date}>
        <header className="day-section-header"><span className="day-section-icon"><CalendarBlank weight="fill" /></span><div><h3>{toSlashDate(group.date)}</h3><p>{toWeekdayText(group.date)} · {group.moments.length} 个瞬间</p></div></header>
        <div className="timeline-list">{group.moments.map((moment) => <article className="timeline-item" key={moment.id}>
          <div className="timeline-date"><strong>{new Date(`${moment.happened_at}T12:00:00`).getDate()}</strong><span>{new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(new Date(`${moment.happened_at}T12:00:00`))}</span></div>
          <div className="timeline-line"><span /></div>
          {moment.image_url ? <button className="memory-image-button" onClick={() => setModal({ type: "lightbox", item: moment })} aria-label={moment.video_url ? `播放动态照片 ${moment.title}` : `放大查看 ${moment.title}`}><img src={imageUrl(moment.image_url)} alt={moment.title} />{moment.video_url && <MotionBadge />}<span className="image-hover-action">{moment.video_url ? <><Play weight="fill" />播放动态照片</> : <><ArrowsOutSimple />查看大图</>}</span></button> : <div className="memory-no-photo"><ImageSquare /><span>这条记录没有照片</span></div>}
          <div className="timeline-copy"><span>{moment.author_name} 添加</span><h3>{moment.title}</h3><p>{moment.note || "这一刻，被我们一起记住了。"}</p><small>{toDateText(moment.happened_at)}</small><div className="item-actions"><button onClick={() => setModal({ type: "comments", item: moment })}><ChatCircleDots />评论{Number(moment.comment_count) > 0 ? ` ${moment.comment_count}` : ""}</button><button onClick={() => setModal({ type: "moment", item: moment })}><PencilSimple />编辑</button><button className="danger" onClick={() => remove(moment)}><Trash />删除</button></div></div>
        </article>)}</div>
      </section>)}</div>
    </section>
  );
}

function GalleryView({ data, setModal, reload }) {
  const [filter, setFilter] = useState("全部");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const photos = data.moments.filter((moment) => moment.image_url);
  const thisYearPhotos = photos.filter((moment) => new Date(`${moment.happened_at}T12:00:00`).getFullYear() === new Date().getFullYear());
  const periodPhotos = filter === "今年" ? thisYearPhotos : photos;
  const visiblePhotos = filterByDateRange(periodPhotos, dateRange);
  const dayGroups = groupByMomentDate(visiblePhotos);
  const remove = async (moment) => {
    if (!window.confirm(`确定删除“${moment.title}”和这张照片吗？`)) return;
    await api(`/api/moments/${moment.id}`, { method: "DELETE" });
    reload();
  };
  return (
    <section className="page">
      <PageHeading eyebrow="OUR GALLERY" title="双人相册" description="所有一起看过的风景，都留在这里。" action={<button className="primary-button" onClick={() => setModal("moment")}><UploadSimple />上传照片</button>} />
      <div className="filter-tabs">{["全部", "今年"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item} <small>{item === "全部" ? photos.length : thisYearPhotos.length}</small></button>)}</div>
      <DateRangeFilter range={dateRange} setRange={setDateRange} total={periodPhotos.length} visible={visiblePhotos.length} />
      {!visiblePhotos.length && <EmptyState icon={ImageSquare} title={photos.length ? "这个日期范围没有照片" : "这里还没有照片"} description={photos.length ? "换一段日期看看，或者清空筛选查看全部照片。" : "不上传照片的时光只会留在时光页，不会用示例图填充相册。"} />}
      <div className="gallery-days">{dayGroups.map((group, dayIndex) => <section className={`gallery-day day-tone-${dayIndex % 3}`} key={group.date}>
        <header className="day-section-header gallery-day-header"><span className="day-section-icon"><Camera weight="fill" /></span><div><h3>{toSlashDate(group.date)}</h3><p>{toWeekdayText(group.date)} · 当天 {group.moments.length} 张照片</p></div><span className="gallery-day-count">{pad(group.moments.length)}</span></header>
        <div className="gallery-grid">{group.moments.map((moment, index) => <article className={`gallery-card card-${index % 3}`} key={moment.id}>
          <button className="gallery-zoom" onClick={() => setModal({ type: "lightbox", item: moment })} aria-label={moment.video_url ? `播放动态照片 ${moment.title}` : `放大查看 ${moment.title}`}><img src={imageUrl(moment.image_url)} alt={moment.title} />{moment.video_url && <MotionBadge />}</button>
          <div className="gallery-overlay"><span><CalendarBlank />{moment.happened_at}</span><h3>{moment.title}</h3><p>{moment.note}</p><div className="item-actions light"><button onClick={() => setModal({ type: "comments", item: moment })}><ChatCircleDots />评论{Number(moment.comment_count) > 0 ? ` ${moment.comment_count}` : ""}</button><button onClick={() => setModal({ type: "moment", item: moment })}><PencilSimple />编辑</button><button onClick={() => remove(moment)}><Trash />删除</button></div></div>
        </article>)}</div>
      </section>)}</div>
    </section>
  );
}

function TodoView({ data, reload, setModal }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("想一起做");
  const add = async (event) => { event.preventDefault(); if (!title.trim()) return; await api("/api/todos", { method: "POST", body: JSON.stringify({ title, category }) }); setTitle(""); reload(); };
  const toggle = async (item) => { await api(`/api/todos/${item.id}`, { method: "PATCH", body: JSON.stringify({ completed: !item.completed }) }); reload(); };
  const remove = async (item) => { if (!window.confirm(`确定删除“${item.title}”吗？`)) return; await api(`/api/todos/${item.id}`, { method: "DELETE" }); reload(); };
  const completed = data.todos.filter((item) => item.completed).length;
  return (
    <section className="page">
      <PageHeading eyebrow="OUR LITTLE WISHES" title="一起完成的清单" description="把“以后想做”变成一个个真的发生。" />
      <div className="todo-layout">
        <form className="todo-composer" onSubmit={add}><span className="soft-label"><Sparkle />ADD A WISH</span><h3>下一件想一起做的小事</h3><textarea value={title} onChange={(event) => setTitle(event.target.value)} placeholder="比如：找一个晴天去海边看日出…" /><select value={category} onChange={(event) => setCategory(event.target.value)}><option>想一起做</option><option>温柔日常</option><option>旅行地图</option><option>今年完成</option></select><button className="primary-button"><Plus />加入我们的清单</button></form>
        <div className="todo-board"><div className="progress-head"><div><span>完成进度</span><strong>{completed}/{data.todos.length}</strong></div><div className="progress-track"><span style={{ width: `${data.todos.length ? completed / data.todos.length * 100 : 0}%` }} /></div></div>{data.todos.map((item) => <article className={`todo-item ${item.completed ? "done" : ""}`} key={item.id}><button className="todo-toggle" onClick={() => toggle(item)} aria-label={item.completed ? `标记 ${item.title} 为未完成` : `完成 ${item.title}`}><span className="todo-check">{Boolean(item.completed) && <Check weight="bold" />}</span></button><span><b>{item.title}</b><small>{item.category} · {item.creator_name || "我们"} 添加</small></span><div className="row-actions"><button onClick={() => setModal({ type: "todo", item })} aria-label={`编辑 ${item.title}`}><PencilSimple /></button><button onClick={() => remove(item)} aria-label={`删除 ${item.title}`}><Trash /></button></div></article>)}</div>
      </div>
    </section>
  );
}

function AnniversaryView({ data, setModal, reload }) {
  const elapsed = useClock(data.dashboard.space.togetherSince);
  const sorted = useMemo(() => [...data.anniversaries].sort((a, b) => daysUntil(a.event_date, Boolean(a.repeat_yearly)) - daysUntil(b.event_date, Boolean(b.repeat_yearly))), [data.anniversaries]);
  const remove = async (item) => { if (!window.confirm(`确定删除纪念日“${item.title}”吗？`)) return; await api(`/api/anniversaries/${item.id}`, { method: "DELETE" }); reload(); };
  return (
    <section className="page">
      <PageHeading eyebrow="SPECIAL DAYS" title="我们的纪念日" description="记住重要的日子，也期待下一次共同庆祝。" action={<button className="primary-button" onClick={() => setModal("anniversary")}><Plus />添加纪念日</button>} />
      <div className="anniversary-hero"><div><span className="soft-label"><Heart weight="fill" />我们在一起</span><div className="countdown-grid"><TimeBox value={elapsed.days} label="天" /><TimeBox value={elapsed.hours} label="时" /><TimeBox value={elapsed.minutes} label="分" /><TimeBox value={elapsed.seconds} label="秒" accent /></div><p>从 {toDateText(data.dashboard.space.togetherSince)} 开始，每分每秒都在继续。</p></div><div className="orbit-heart"><Heart weight="fill" /></div></div>
      <h3 className="section-title">即将到来 <small>按照离今天的时间排列</small></h3>
      {!sorted.length && <EmptyState icon={CalendarBlank} title="还没有纪念日" description="添加生日、相识日或第一次旅行吧。" />}
      <div className="anniversary-list">{sorted.map((item) => { const date = new Date(`${item.event_date}T12:00:00`); const days = daysUntil(item.event_date, Boolean(item.repeat_yearly)); return <article key={item.id}><div className="date-tile"><span>{pad(date.getMonth() + 1)}</span><strong>{pad(date.getDate())}</strong></div><span className="anniversary-icon"><CalendarBlank /></span><div><h3>{item.title}{item.repeat_yearly ? <small>每年</small> : null}</h3><p>{item.note || "值得认真庆祝的一天"}</p><span>{toDateText(item.event_date)}</span></div><b className="days-away">{days === 0 ? "今天" : days > 0 ? `${days} 天后` : `已过去 ${Math.abs(days)} 天`}</b><div className="row-actions"><button onClick={() => setModal({ type: "anniversary", item })} aria-label={`编辑 ${item.title}`}><PencilSimple /></button><button onClick={() => remove(item)} aria-label={`删除 ${item.title}`}><Trash /></button></div></article>; })}</div>
    </section>
  );
}

function ChatView({ data }) {
  const [body, setBody] = useState("");
  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [data.messages.length]);
  const send = async (event) => { event.preventDefault(); if (!body.trim()) return; const value = body; setBody(""); try { await api("/api/messages", { method: "POST", body: JSON.stringify({ body: value }) }); } catch { setBody(value); } };
  const partner = data.me.members.find((member) => member.id !== data.me.user.id);
  return (
    <section className="chat-page">
      <div className="chat-header"><div className="chat-person"><Avatar member={partner || data.me.user} /><div><h3>{partner?.name || "等待 TA 加入"}</h3><span><i />只属于你们的情侣话</span></div></div><span className="sync-pill"><span />双人私密空间 · 实时同步</span></div>
      <div className="message-list" ref={scrollRef}><div className="day-divider"><span>今天</span></div>{data.messages.map((message) => { const mine = message.sender_id === data.me.user.id; const member = data.me.members.find((item) => item.id === message.sender_id) || { name: message.sender_name, avatarColor: message.avatar_color }; return <div className={`message-row ${mine ? "mine" : ""}`} key={message.id}>{!mine && <Avatar member={member} />}<div><small>{mine ? `我 · ${data.me.user.name}` : member.name}</small><p>{message.body}</p><time>{toTime(message.created_at)}{mine && <Check weight="bold" />}</time></div>{mine && <Avatar member={data.me.user} />}</div>; })}</div>
      <form className="chat-composer" onSubmit={send}><input value={body} onChange={(event) => setBody(event.target.value)} placeholder={`写给 ${partner?.name || "TA"}…`} /><button aria-label="发送"><PaperPlaneTilt weight="fill" /></button></form>
    </section>
  );
}

function PlannerView({ setModal }) {
  const [form, setForm] = useState({ city: "上海", budget: "600", mood: "轻松、浪漫、可以拍照", date: "" });
  const [plan, setPlan] = useState(null);
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadSettings = useCallback(() => api("/api/settings/ai").then(setSettings).catch(() => setSettings({ configured: false, model: "deepseek-v4-flash" })), []);
  useEffect(() => { loadSettings(); }, [loadSettings]);
  const generate = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api("/api/ai/date-plan", { method: "POST", body: JSON.stringify(form) });
      setPlan(result.plan);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  return (
    <section className="page">
      <PageHeading eyebrow="DATE INSPIRATION" title="约会灵感" description="由你自己的 DeepSeek API 生成，密钥不会写进前端代码。" action={<button className="quiet-button" onClick={() => setModal({ type: "ai-settings", onSaved: loadSettings })}><GearSix />API 设置</button>} />
      <div className="ai-status"><span className={settings?.configured ? "ready" : ""} />{settings?.configured ? `DeepSeek 已连接 · ${settings.model}` : "尚未设置 DeepSeek API Key"}</div>
      <div className="planner-layout"><form className="planner-form" onSubmit={generate}><span className="soft-label"><MagicWand />PLAN A LITTLE DATE</span><h3>安排一次值得期待的约会</h3><Field label="城市"><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} required /></Field><Field label="预算（元）"><input value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} required /></Field><Field label="约会日期（可选）"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="想要的感觉"><textarea value={form.mood} onChange={(event) => setForm({ ...form, mood: event.target.value })} required /></Field>{error && <div className="form-error">{error}</div>}<button className="primary-button full" disabled={busy}>{busy ? "DeepSeek 正在构思…" : <><Sparkle />生成约会计划</>}</button></form><div className="plan-result"><span className="eyebrow">DEEPSEEK DRAFT</span><h3>{plan?.title || "生成结果"}</h3>{plan ? <><p className="plan-summary">{plan.summary}</p><div className="plan-meta"><span>预计花费 {plan.estimatedCost}</span><span>{form.city}</span></div><ol>{plan.steps.map((step, index) => <li key={`${step.time}-${index}`}><b>{step.time} · {step.title}</b><span>{step.detail}</span><small>预计 {step.cost}</small></li>)}</ol>{plan.tips?.length ? <div className="plan-note"><b>贴心提醒</b>{plan.tips.map((tip) => <p key={tip}>{tip}</p>)}</div> : null}</> : <div className="plan-empty"><MagicWand /><p>{settings?.configured ? "填好左边的偏好，DeepSeek 会在这里生成一份约会草案。" : "先点右上角“API 设置”，保存你的 DeepSeek API Key。"}</p></div>}</div></div>
    </section>
  );
}

function MomentModal({ item, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(item);
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const form = new FormData(event.currentTarget); form.set("removeImage", String(form.get("removeImage") === "on")); await api(editing ? `/api/moments/${item.id}` : "/api/moments", { method: editing ? "PATCH" : "POST", body: form }); onSaved(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  return <Modal title={editing ? "编辑这段时光" : "记录此刻"} eyebrow={editing ? "EDIT MEMORY" : "A NEW MEMORY"} onClose={onClose}><form className="modal-form" onSubmit={submit}><Field label="这一刻的名字"><input name="title" defaultValue={item?.title || ""} placeholder="比如：下班后的晚风" required /></Field><Field label="发生日期"><input name="happenedAt" type="date" defaultValue={item?.happened_at || new Date().toISOString().slice(0, 10)} required /></Field><Field label="想留下的话"><textarea name="note" defaultValue={item?.note || ""} placeholder="写一点只有你们懂的细节…" /></Field>{item?.image_url && <div className="current-photo"><img src={imageUrl(item.image_url)} alt={item.title} /><label>{item?.video_url && <b className="current-motion"><Play weight="fill" />动态照片</b>}<span><input name="removeImage" type="checkbox" />保存时移除这张照片</span></label></div>}<label className="upload-field"><Camera /><span><b>{item?.image_url ? "替换照片（可选）" : "选择一张照片（可选）"}</b><small>支持 JPG（含动态照片）、PNG、WebP，最大 8MB</small></span><input name="image" type="file" accept="image/*" /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button full" disabled={busy}>{busy ? "正在保存…" : editing ? "保存修改" : "收藏进我们的时光"}</button></form></Modal>;
}

function CommentRow({ comment, me, editing, setEditing, onReply, onSave, onDelete, busy }) {
  const mine = comment.author_id === me?.user?.id;
  const deleted = Boolean(comment.deleted_at);
  const edited = !deleted && comment.updated_at !== comment.created_at;
  return <article className={`comment-row ${comment.parent_id ? "reply" : "root"} ${deleted ? "deleted" : ""}`}>
    <span className="comment-avatar" style={{ background: comment.avatar_color || "#b86ad9" }}>{comment.author_name?.slice(0, 1) || "?"}</span>
    <div className="comment-bubble">
      <div className="comment-meta"><b>{comment.author_name}{mine ? <small>我</small> : null}</b><time>{toCommentTime(comment.created_at)}{edited ? " · 已编辑" : ""}</time></div>
      {editing?.id === comment.id ? <form className="comment-edit" onSubmit={(event) => onSave(event, comment)}>
        <textarea value={editing.body} onChange={(event) => setEditing({ id: comment.id, body: event.target.value })} maxLength={500} autoFocus />
        <div><button type="button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" disabled={busy || !editing.body.trim()}>保存</button></div>
      </form> : <p className={deleted ? "deleted-copy" : ""}>{deleted ? "这条评论已删除" : <>{comment.reply_to_name && <span className="reply-target">回复 {comment.reply_to_name}：</span>}{comment.body}</>}</p>}
      {!deleted && editing?.id !== comment.id && <div className="comment-actions">
        <button type="button" onClick={() => onReply(comment)}>回复</button>
        {mine && <button type="button" onClick={() => setEditing({ id: comment.id, body: comment.body })}>编辑</button>}
        {mine && <button type="button" className="danger" onClick={() => onDelete(comment)}>删除</button>}
      </div>}
    </div>
  </article>;
}

function CommentsModal({ item, me, refreshKey, onClose, onChanged }) {
  const [comments, setComments] = useState([]);
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadComments = useCallback(async () => {
    if (!item?.id) return;
    try {
      const rows = await api(`/api/moments/${item.id}/comments`);
      setComments(rows);
      setError("");
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [item?.id]);
  useEffect(() => { loadComments(); }, [loadComments, refreshKey]);
  const roots = useMemo(() => comments.filter((comment) => !comment.parent_id), [comments]);
  const replies = useMemo(() => {
    const grouped = new Map();
    comments.filter((comment) => comment.parent_id).forEach((comment) => {
      const current = grouped.get(comment.parent_id) || [];
      current.push(comment);
      grouped.set(comment.parent_id, current);
    });
    return grouped;
  }, [comments]);
  const activeCount = comments.filter((comment) => !comment.deleted_at).length;
  const submit = async (event) => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setError("");
    try {
      await api(`/api/moments/${item.id}/comments`, { method: "POST", body: JSON.stringify({ body, parentId: replyingTo?.id || null }) });
      setBody(""); setReplyingTo(null);
      await loadComments(); onChanged();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const saveEdit = async (event, comment) => {
    event.preventDefault();
    if (!editing?.body.trim()) return;
    setBusy(true); setError("");
    try {
      await api(`/api/comments/${comment.id}`, { method: "PATCH", body: JSON.stringify({ body: editing.body }) });
      setEditing(null); await loadComments(); onChanged();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const remove = async (comment) => {
    if (!window.confirm("确定删除这条评论吗？已有回复会继续保留。")) return;
    setBusy(true); setError("");
    try {
      await api(`/api/comments/${comment.id}`, { method: "DELETE" });
      if (replyingTo?.id === comment.id) setReplyingTo(null);
      if (editing?.id === comment.id) setEditing(null);
      await loadComments(); onChanged();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const rowProps = { me, editing, setEditing, onReply: (comment) => { setReplyingTo(comment); setError(""); }, onSave: saveEdit, onDelete: remove, busy };
  return <Modal title={item?.title || "评论"} eyebrow={`${activeCount} COMMENTS`} onClose={onClose} className="comments-modal">
    <div className="comments-summary"><ChatCircleDots weight="duotone" /><div><b>只属于你们的评论区</b><span>说说这一刻，也可以回复对方。</span></div></div>
    <div className="comments-list">
      {loading && <div className="comments-loading">正在加载评论…</div>}
      {!loading && !roots.length && <div className="comments-empty"><ChatCircleDots /><b>还没有评论</b><span>留下第一句话吧。</span></div>}
      {roots.map((root) => <section className="comment-thread" key={root.id}>
        <CommentRow comment={root} {...rowProps} />
        {(replies.get(root.id) || []).length > 0 && <div className="comment-replies">{(replies.get(root.id) || []).map((reply) => <CommentRow comment={reply} key={reply.id} {...rowProps} />)}</div>}
      </section>)}
    </div>
    {error && <div className="form-error">{error}</div>}
    <form className="comment-composer" onSubmit={submit}>
      {replyingTo && <div className="replying-banner"><span>回复 {replyingTo.author_name}</span><button type="button" onClick={() => setReplyingTo(null)} aria-label="取消回复"><X /></button></div>}
      <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={500} placeholder={replyingTo ? `回复 ${replyingTo.author_name}…` : "写下想对 TA 说的话…"} />
      <div className="comment-composer-foot"><small>{body.length}/500</small><button className="primary-button" disabled={busy || !body.trim()}>{busy ? "发送中…" : <><PaperPlaneTilt weight="fill" />发送</>}</button></div>
    </form>
  </Modal>;
}

function AnniversaryModal({ item, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(item);
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const form = new FormData(event.currentTarget); await api(editing ? `/api/anniversaries/${item.id}` : "/api/anniversaries", { method: editing ? "PATCH" : "POST", body: JSON.stringify({ title: form.get("title"), eventDate: form.get("eventDate"), note: form.get("note"), repeatYearly: form.get("repeatYearly") === "on" }) }); onSaved(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  return <Modal title={editing ? "编辑纪念日" : "添加纪念日"} eyebrow="A DAY TO REMEMBER" onClose={onClose}><form className="modal-form" onSubmit={submit}><Field label="纪念日名称"><input name="title" defaultValue={item?.title || ""} placeholder="比如：第一次一起旅行" required /></Field><Field label="日期"><input name="eventDate" type="date" defaultValue={item?.event_date || ""} required /></Field><Field label="备注"><textarea name="note" defaultValue={item?.note || ""} placeholder="这一天为什么特别？" /></Field><label className="switch-row"><input name="repeatYearly" type="checkbox" defaultChecked={item ? Boolean(item.repeat_yearly) : true} /><span>每年提醒我们</span></label>{error && <div className="form-error">{error}</div>}<button className="primary-button full" disabled={busy}>{busy ? "正在保存…" : editing ? "保存修改" : "保存这个日子"}</button></form></Modal>;
}

function TodoModal({ item, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const form = new FormData(event.currentTarget); await api(`/api/todos/${item.id}`, { method: "PATCH", body: JSON.stringify({ title: form.get("title"), category: form.get("category") }) }); onSaved(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  return <Modal title="编辑清单" eyebrow="EDIT OUR WISH" onClose={onClose}><form onSubmit={submit}><Field label="想一起做的事"><textarea name="title" defaultValue={item.title} required /></Field><Field label="分类"><select name="category" defaultValue={item.category}><option>想一起做</option><option>温柔日常</option><option>旅行地图</option><option>今年完成</option></select></Field>{error && <div className="form-error">{error}</div>}<button className="primary-button full" disabled={busy}>{busy ? "正在保存…" : "保存修改"}</button></form></Modal>;
}

function AISettingsModal({ onClose, onSaved }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api("/api/settings/ai").then(setSettings).catch((requestError) => setError(requestError.message)); }, []);
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const form = new FormData(event.currentTarget); await api("/api/settings/ai", { method: "PUT", body: JSON.stringify({ apiKey: form.get("apiKey") || "", model: form.get("model") }) }); onSaved(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  const clear = async () => { if (!window.confirm("确定清除本地保存的 DeepSeek API Key 吗？")) return; setBusy(true); try { await api("/api/settings/ai", { method: "PUT", body: JSON.stringify({ model: settings?.model || "deepseek-v4-flash", clearApiKey: true }) }); onSaved(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  return <Modal title="DeepSeek API 设置" eyebrow="PRIVATE AI CONNECTION" onClose={onClose}><div className="settings-explain"><LockKey />API Key 会先加密，再保存到你自己的 SQLite 数据库；页面不会回显完整密钥。</div><form onSubmit={submit}><Field label={`API Key${settings?.maskedKey ? `（当前 ${settings.maskedKey}）` : ""}`}><input name="apiKey" type="password" autoComplete="off" placeholder={settings?.configured ? "留空表示继续使用现有密钥" : "sk-..."} disabled={settings?.managedByEnv} /></Field>{settings?.managedByEnv && <p className="field-hint">当前由后端环境变量 DEEPSEEK_API_KEY 管理，请在后端配置中修改。</p>}<Field label="模型"><select name="model" defaultValue={settings?.model || "deepseek-v4-flash"} key={settings?.model}><option value="deepseek-v4-flash">DeepSeek V4 Flash（推荐，响应更快）</option><option value="deepseek-v4-pro">DeepSeek V4 Pro（更强，费用更高）</option></select></Field>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button className="primary-button" disabled={busy}>{busy ? "正在保存…" : "保存并连接"}</button>{settings?.configured && !settings.managedByEnv && <button type="button" className="danger-button" onClick={clear} disabled={busy}><Trash />清除密钥</button>}</div></form></Modal>;
}

function ChangePasswordModal({ onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const currentPassword = String(form.get("currentPassword") || "");
      const newPassword = String(form.get("newPassword") || "");
      const confirmation = String(form.get("confirmation") || "");
      if (newPassword !== confirmation) throw new Error("两次输入的新密码不一致");
      const payload = await api("/api/account/password", { method: "PUT", body: JSON.stringify({ currentPassword, newPassword, confirmation }) });
      onChanged(payload.token);
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };
  return <Modal title="修改登录密码" eyebrow="ACCOUNT SECURITY" onClose={onClose}><div className="settings-explain"><LockKey />修改成功后，这个账号在其他设备上的旧登录状态会失效。</div><form className="modal-form" onSubmit={submit}><Field label="当前密码"><input name="currentPassword" type="password" autoComplete="current-password" required minLength={6} maxLength={72} /></Field><Field label="新密码"><input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} placeholder="至少 8 位，包含字母和数字" /></Field><Field label="再次输入新密码"><input name="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></Field>{error && <div className="form-error">{error}</div>}<button className="primary-button full" disabled={busy}>{busy ? "正在更新…" : "确认修改密码"}</button></form></Modal>;
}

function DeleteSpaceModal({ onClose, onDeleted }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await api("/api/account/space", { method: "DELETE", body: JSON.stringify({ password, confirmation }) }); authStore.clear(); onDeleted(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  return <Modal title="永久删除双人空间" eyebrow="DANGER ZONE" onClose={onClose}><div className="danger-notice"><Trash /><div><b>这会同时删除两个人的账号</b><p>账号、密码哈希、时光、照片、评论与回复、纪念日、清单、聊天记录和 DeepSeek 设置都会从本地数据库永久删除，无法恢复。</p></div></div><form onSubmit={submit}><Field label="输入你的登录密码"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} /></Field><Field label="输入“永久删除”进行确认"><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="永久删除" required /></Field>{error && <div className="form-error">{error}</div>}<button className="danger-button full" disabled={busy || confirmation !== "永久删除"}>{busy ? "正在删除…" : "永久删除全部账号与数据"}</button></form></Modal>;
}

function Lightbox({ item, onClose }) {
  if (!item?.image_url) return null;
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><button className="lightbox-close" onClick={onClose} aria-label="关闭大图"><X /></button><figure className={item.video_url ? "motion-figure" : ""}>{item.video_url ? <video src={imageUrl(item.video_url)} poster={imageUrl(item.image_url)} controls autoPlay muted loop playsInline preload="metadata" /> : <img src={imageUrl(item.image_url)} alt={item.title} />}<figcaption><b>{item.title}</b><span>{item.video_url ? "动态照片 · 可在播放器中开启声音" : toDateText(item.happened_at)}</span>{item.video_url && <span>{toDateText(item.happened_at)}</span>}{item.note && <p>{item.note}</p>}</figcaption></figure></div>;
}

function MotionBadge() { return <span className="motion-badge"><Play weight="fill" />动态</span>; }

function EmptyState({ icon: Icon, title, description }) { return <div className="empty-state"><Icon /><h3>{title}</h3><p>{description}</p></div>; }

function Modal({ title, eyebrow, onClose, children, className = "" }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="icon-button small" aria-label="关闭弹窗" onClick={onClose}><X /></button></div>{children}</div></div>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Avatar({ member }) { return <span className="avatar" style={{ background: member?.avatarColor || "#b86ad9" }}>{member?.name?.slice(0, 1) || "?"}</span>; }
