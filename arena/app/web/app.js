// Tasklight SPA — vanilla ES modules, no build. Talks to the /api backend.
const root = document.getElementById("app");

const ICON = {
  home: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  plug: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  gear: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
};
const icon = (n, cls = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${ICON[n] || ""}</svg>`;

const state = {
  token: localStorage.getItem("tl_token") || null,
  user: null,
  workspaces: [],
  ws: null,
  members: [],
  projects: [],
  project: null,
  tasks: [],
  billing: null,
  integrations: [],
  admins: [],
  view: "home",
  task: null,
  comments: [],
  searchResults: null,
  error: "",
};

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(data?.error || `request failed (${r.status})`);
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initials = (n) => (n || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const prChip = (p) => `<span class="chip ${p === "high" ? "red" : p === "low" ? "blue" : "amber"}">${esc(p)}</span>`;
const STATUSES = [["todo", "To do"], ["in_progress", "In progress"], ["done", "Done"]];

let toastTimer;
function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

// ---------- data ----------
async function boot() {
  if (!state.token) return render();
  try {
    state.user = (await api("/auth/me")).user;
    state.workspaces = (await api("/workspaces")).workspaces;
    if (state.workspaces[0]) await selectWorkspace(state.workspaces[0].id);
    else render();
  } catch {
    logout();
  }
}
async function selectWorkspace(id) {
  state.ws = state.workspaces.find((w) => w.id === id) || null;
  state.projects = (await api(`/workspaces/${id}/projects`)).projects;
  state.project = state.projects[0] || null;
  await loadView();
}
async function loadView() {
  try {
    if (state.view === "home" || state.view === "projects") {
      if (state.project) state.tasks = (await api(`/tasks?projectId=${state.project.id}`)).tasks;
      else state.tasks = [];
    } else if (state.view === "members") {
      state.members = (await api(`/workspaces/${state.ws.id}/members`)).members;
    } else if (state.view === "billing") {
      state.billing = (await api(`/billing/${state.ws.id}`)).billing;
    } else if (state.view === "integrations") {
      state.integrations = (await api(`/integrations/${state.ws.id}`)).integrations;
    } else if (state.view === "admin") {
      state.admins = (await api(`/admin/users`)).users;
    }
  } catch (e) {
    toast(e.message);
  }
  render();
}
function go(view) { state.view = view; state.searchResults = null; loadView(); }

function login(email, password) {
  return api("/auth/login", { method: "POST", body: { email, password } }).then((r) => {
    state.token = r.token;
    localStorage.setItem("tl_token", r.token);
    return boot();
  });
}
function logout() {
  state.token = null;
  localStorage.removeItem("tl_token");
  state.user = null;
  state.view = "home";
  render();
}

// ---------- views ----------
function loginView() {
  root.innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <div class="brand"><span class="logo">${icon("check")}</span> Tasklight</div>
      <p class="muted" style="margin:10px 0 4px">Sign in to your workspace.</p>
      <label>Work email</label><input id="email" value="maya@acme.test" autocomplete="username" />
      <label>Password</label><input id="password" type="password" autocomplete="current-password" placeholder="••••••••" />
      <div style="margin-top:18px"><button class="btn" id="login" style="width:100%;justify-content:center">Sign in</button></div>
      <div class="error" id="err">${esc(state.error)}</div>
      <p class="muted" style="font-size:12px;margin-top:6px">Single sign-on and password reset available.</p>
    </div></div>`;
  const submit = async () => {
    state.error = "";
    try { await login(email.value, password.value); }
    catch (e) { state.error = e.message; render(); document.getElementById("password")?.focus(); }
  };
  const email = document.getElementById("email");
  const password = document.getElementById("password");
  document.getElementById("login").onclick = submit;
  password.onkeydown = (e) => { if (e.key === "Enter") submit(); };
}

const NAV = [
  ["home", "Home", "home"],
  ["projects", "Projects", "folder"],
  ["members", "Members", "users"],
  ["billing", "Billing", "card"],
  ["integrations", "Integrations", "plug"],
  ["admin", "Admin", "shield"],
  ["settings", "Settings", "gear"],
];

function shell(content) {
  const navItems = NAV.map(
    ([v, label, ic]) => `<div class="nav ${state.view === v ? "active" : ""}" data-go="${v}">${icon(ic)} ${label}</div>`
  ).join("");
  root.innerHTML = `
    <div class="shell">
      <nav class="side">
        <div class="brand"><span class="logo" style="width:26px;height:26px">${icon("check")}</span> Tasklight</div>
        <div class="ws-switch" data-go="home">
          <span class="sq violet" style="width:30px;height:30px;border-radius:9px">${icon("folder")}</span>
          <div><div class="name">${esc(state.ws?.name || "Workspace")}</div><div class="muted" style="font-size:11px">${esc(state.ws?.plan || "")} plan</div></div>
        </div>
        <div class="navlabel">Workspace</div>
        ${navItems}
        <div class="spacer"></div>
        <div class="me">
          <span class="avatar">${esc(initials(state.user?.name))}</span>
          <div class="who">${esc(state.user?.name || "")}<small>${esc(state.user?.email || "")}</small></div>
        </div>
        <div class="nav" data-logout="1">${icon("logout")} Sign out</div>
      </nav>
      <div class="main">
        <div class="topbar">
          <div class="search">${icon("search")}<input id="globalSearch" placeholder="Search tasks..." value="${esc(state.searchTerm || "")}" /></div>
          <button class="btn ghost sm" data-go="settings">${icon("gear")} Settings</button>
          <button class="btn sm" data-newtask="1">${icon("plus")} New task</button>
        </div>
        <div class="content">${content}</div>
      </div>
    </div>
    ${state.task ? drawer() : ""}`;
  wireShell();
}

function homeView() {
  const open = state.tasks.filter((t) => t.status === "todo").length;
  const prog = state.tasks.filter((t) => t.status === "in_progress").length;
  const done = state.tasks.filter((t) => t.status === "done").length;
  const cards = [
    ["To do", open, "violet", "folder"],
    ["In progress", prog, "blue", "bolt"],
    ["Completed", done, "green", "check"],
    ["Projects", state.projects.length, "amber", "home"],
  ]
    .map(
      ([l, n, c, ic]) => `<div class="card stat"><div class="row"><div><div class="label">${l}</div><div class="num tnum">${n}</div></div><span class="sq ${c}">${icon(ic)}</span></div></div>`
    )
    .join("");
  const recent = state.tasks
    .slice(0, 6)
    .map(
      (t) => `<div class="tcard" data-task="${t.id}"><div class="title">${esc(t.title)}</div><div class="meta"><span class="chip ${t.status === "done" ? "green" : t.status === "in_progress" ? "blue" : ""}">${esc(t.status.replace("_", " "))}</span>${prChip(t.priority)}</div></div>`
    )
    .join("");
  return `
    <div class="pagehead"><div><h1>Good to see you, ${esc((state.user?.name || "").split(" ")[0])}</h1><div class="sub">Here's what's happening in ${esc(state.ws?.name || "")}.</div></div></div>
    <div class="grid stats" style="margin-bottom:22px">${cards}</div>
    <h3 style="margin-bottom:12px">Recent tasks</h3>
    <div class="grid" style="grid-template-columns:repeat(3,1fr)">${recent || emptyState("No tasks yet", "Create your first task to get started.")}</div>`;
}

function boardView() {
  const tabs = state.projects
    .map((p) => `<button class="btn ${state.project && state.project.id === p.id ? "" : "ghost"} sm" data-proj="${p.id}">${esc(p.name)}</button>`)
    .join(" ");
  const cols = STATUSES.map(([key, label]) => {
    const items = state.tasks.filter((t) => t.status === key);
    const cards = items
      .map(
        (t) => `<div class="tcard" data-task="${t.id}"><div class="title">${esc(t.title)}</div><div class="meta"><span class="key">${esc(state.project?.key || "")}-${t.id}</span>${prChip(t.priority)}</div></div>`
      )
      .join("");
    return `<div class="col"><div class="colhead"><span>${label}</span><span class="count tnum">${items.length}</span></div>${cards || `<div class="muted" style="padding:8px 6px;font-size:13px">Nothing here.</div>`}</div>`;
  }).join("");
  return `
    <div class="pagehead"><div><h1>Projects</h1><div class="sub">${esc(state.project?.name || "")}</div></div><button class="btn" data-newtask="1">${icon("plus")} New task</button></div>
    <div class="rowflex" style="margin-bottom:18px;flex-wrap:wrap">${tabs}</div>
    <div class="board">${cols}</div>`;
}

function membersView() {
  const rows = state.members
    .map(
      (m) => `<tr><td><div class="uline"><span class="avatar" style="width:30px;height:30px;font-size:12px">${esc(initials(m.name))}</span><span class="name">${esc(m.name)}</span></div></td>
        <td class="muted">${esc(m.email)}</td>
        <td><select data-role="${m.user_id}" style="width:140px;padding:7px 10px">${["guest", "member", "admin", "owner"].map((r) => `<option ${m.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td></tr>`
    )
    .join("");
  return `
    <div class="pagehead"><div><h1>Members</h1><div class="sub">${state.members.length} people in ${esc(state.ws?.name || "")}</div></div></div>
    <div class="card" style="padding:8px 6px 6px"><table class="tbl"><thead><tr><th>Member</th><th>Email</th><th>Role</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="card" style="margin-top:18px;max-width:480px"><h3>Invite a teammate</h3>
      <label>Email</label><input id="invEmail" placeholder="teammate@company.com"/>
      <label>Role</label><select id="invRole"><option>member</option><option>admin</option><option>guest</option></select>
      <div style="margin-top:14px"><button class="btn" data-invite="1">${icon("plus")} Send invite</button></div></div>`;
}

function billingView() {
  const b = state.billing || {};
  return `
    <div class="pagehead"><div><h1>Billing</h1><div class="sub">Plan, seats, and account credit</div></div></div>
    <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:22px">
      <div class="card stat"><div class="label">Current plan</div><div class="num" style="font-size:24px;text-transform:capitalize">${esc(b.plan || "free")}</div></div>
      <div class="card stat"><div class="label">Seats</div><div class="num tnum">${b.seats ?? 0}</div></div>
      <div class="card stat"><div class="label">Account credit</div><div class="num tnum">$${((b.balance_cents || 0) / 100).toFixed(2)}</div></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card"><h3>Change plan</h3>
        <label>Plan</label><select id="planSel">${["free", "pro", "business", "enterprise"].map((p) => `<option ${b.plan === p ? "selected" : ""}>${p}</option>`).join("")}</select>
        <label>Seats</label><input id="seats" type="number" value="${b.seats ?? 3}"/>
        <label>Amount (USD cents)</label><input id="price" type="number" value="2900"/>
        <div style="margin-top:14px"><button class="btn" data-upgrade="1">Update plan</button></div></div>
      <div class="card"><h3>Redeem a promo code</h3><p class="muted" style="font-size:13px;margin:4px 0 0">Have a launch code? Apply it for account credit.</p>
        <label>Code</label><input id="coupon" placeholder="LAUNCH50"/>
        <div style="margin-top:14px"><button class="btn ghost" data-redeem="1">Apply code</button></div></div>
    </div>`;
}

function integrationsView() {
  const rows = state.integrations
    .map(
      (i) => `<div class="card between" style="margin-bottom:12px"><div class="uline"><span class="sq blue">${icon("plug")}</span><div><div class="name">${esc(i.name)}</div><div class="muted" style="font-size:13px">${esc(i.webhook_url)}</div></div></div><button class="btn ghost sm" data-test="${esc(i.webhook_url)}">Send test</button></div>`
    )
    .join("");
  return `
    <div class="pagehead"><div><h1>Integrations</h1><div class="sub">Connect Tasklight to your other tools via webhooks</div></div></div>
    ${rows || emptyState("No integrations yet", "Add a webhook to get started.")}
    <div class="card" style="margin-top:18px;max-width:520px"><h3>Add a webhook</h3>
      <label>Name</label><input id="intName" placeholder="Slack alerts"/>
      <label>Webhook URL</label><input id="intUrl" placeholder="https://hooks.example.com/..."/>
      <div class="rowflex" style="margin-top:14px"><button class="btn" data-addint="1">${icon("plus")} Add</button>
      <button class="btn ghost" data-testfield="1">${icon("bolt")} Test URL</button></div></div>`;
}

function settingsView() {
  const u = state.user || {};
  return `
    <div class="pagehead"><div><h1>Settings</h1><div class="sub">Your profile and account</div></div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card"><h3>Profile</h3>
        <div class="uline" style="margin:12px 0"><span class="avatar" style="width:48px;height:48px;font-size:18px">${esc(initials(u.name))}</span><div><div class="name">${esc(u.name)}</div><div class="muted" style="font-size:13px">${esc(u.email)}</div></div></div>
        <label>Display name</label><input id="pName" value="${esc(u.name)}"/>
        <label>Email</label><input id="pEmail" value="${esc(u.email)}"/>
        <div style="margin-top:14px"><button class="btn" data-saveprofile="1">Save changes</button></div></div>
      <div class="card"><h3>Profile picture</h3><p class="muted" style="font-size:13px;margin:4px 0 0">Import an avatar from a URL (e.g. your company CDN).</p>
        <label>Image URL</label><input id="avatarUrl" placeholder="https://cdn.company.com/me.png"/>
        <div style="margin-top:14px"><button class="btn ghost" data-avatar="1">Import image</button></div>
        <hr class="sep"/><div class="kvs"><span class="k">Role</span><span>${esc(u.role)}</span><span class="k">Member since</span><span>${u.created_at ? new Date(u.created_at * 1000).toLocaleDateString() : "—"}</span></div></div>
    </div>`;
}

function adminView() {
  const rows = state.admins
    .map(
      (u) => `<tr><td><div class="uline"><span class="avatar" style="width:30px;height:30px;font-size:12px">${esc(initials(u.name))}</span><span class="name">${esc(u.name)}</span></div></td><td class="muted">${esc(u.email)}</td><td><span class="chip ${u.role === "admin" ? "violet" : ""}">${esc(u.role)}</span></td></tr>`
    )
    .join("");
  return `
    <div class="pagehead"><div><h1>Admin</h1><div class="sub">All users on this Tasklight instance</div></div></div>
    <div class="card" style="padding:8px 6px 6px"><table class="tbl"><thead><tr><th>User</th><th>Email</th><th>Role</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function searchView() {
  const r = state.searchResults || [];
  const rows = r.map((t) => `<div class="tcard" data-task="${t.id}"><div class="title">${esc(t.title)}</div></div>`).join("");
  return `
    <div class="pagehead"><div><h1>Search</h1><div class="sub">Results for "${esc(state.searchTerm || "")}"</div></div></div>
    <div class="grid" style="grid-template-columns:repeat(3,1fr)">${rows || emptyState("No matches", "Try a different search term.")}</div>`;
}

function emptyState(title, sub) {
  return `<div class="empty" style="grid-column:1/-1"><span class="sq violet">${icon("folder")}</span><div style="color:var(--ink);font-weight:600">${esc(title)}</div><div style="font-size:13px;margin-top:4px">${esc(sub)}</div></div>`;
}

function drawer() {
  const t = state.task;
  const comments = state.comments
    .map((c) => `<div class="comment"><span class="avatar" style="width:28px;height:28px;font-size:11px;flex:none">${esc(initials(c.author))}</span><div><div class="who">${esc(c.author)}</div><div>${c.body}</div></div></div>`)
    .join("");
  return `
    <div class="scrim" id="scrim"></div>
    <div class="drawer">
      <div class="between"><span class="key muted" style="font-weight:600">${esc(state.project?.key || "TASK")}-${t.id}</span>
        <div class="rowflex"><a class="btn ghost sm" href="/api/tasks/${t.id}/export.html" target="_blank">${icon("export")} Export</a><button class="iconbtn" id="closeDrawer">${icon("x")}</button></div></div>
      <h1 style="font-size:22px;margin:14px 0 8px">${esc(t.title)}</h1>
      <div class="rowflex" style="margin-bottom:14px"><span class="chip ${t.status === "done" ? "green" : t.status === "in_progress" ? "blue" : ""}">${esc((t.status || "").replace("_", " "))}</span>${prChip(t.priority)}</div>
      <div class="desc">${t.description || "<span class='muted'>No description.</span>"}</div>
      <h3 style="margin:18px 0 4px">Activity</h3>
      <div>${comments || "<div class='muted' style='padding:12px 0'>No comments yet.</div>"}</div>
      <label>Add a comment</label><textarea id="commentBody" rows="2" placeholder="Leave a comment..."></textarea>
      <div style="margin-top:10px"><button class="btn sm" id="postComment">Comment</button></div>
    </div>`;
}

// ---------- actions ----------
async function openTask(id) {
  try {
    const r = await api(`/tasks/${id}`);
    state.task = r.task;
    state.comments = r.comments;
    render();
  } catch (e) { toast(e.message); }
}
async function doSearch(term) {
  state.searchTerm = term;
  if (!term) return;
  state.view = "search";
  try { state.searchResults = (await api(`/search?q=${encodeURIComponent(term)}`)).results; }
  catch (e) { toast(e.message); state.searchResults = []; }
  render();
}

function wireShell() {
  root.querySelectorAll("[data-go]").forEach((el) => (el.onclick = () => go(el.dataset.go)));
  root.querySelector("[data-logout]") && (root.querySelector("[data-logout]").onclick = logout);
  root.querySelectorAll("[data-task]").forEach((el) => (el.onclick = () => openTask(Number(el.dataset.task))));
  root.querySelectorAll("[data-proj]").forEach((el) => (el.onclick = async () => { state.project = state.projects.find((p) => p.id === Number(el.dataset.proj)); state.tasks = (await api(`/tasks?projectId=${state.project.id}`)).tasks; render(); }));
  const gs = document.getElementById("globalSearch");
  if (gs) gs.onkeydown = (e) => { if (e.key === "Enter") doSearch(gs.value.trim()); };
  root.querySelectorAll("[data-newtask]").forEach((el) => (el.onclick = newTask));

  // members
  root.querySelectorAll("[data-role]").forEach((sel) => (sel.onchange = async () => {
    try { await api(`/workspaces/${state.ws.id}/members/${sel.dataset.role}/role`, { method: "POST", body: { role: sel.value } }); toast("Role updated"); }
    catch (e) { toast(e.message); }
  }));
  root.querySelector("[data-invite]") && (root.querySelector("[data-invite]").onclick = async () => {
    try { await api(`/workspaces/${state.ws.id}/invites`, { method: "POST", body: { email: invEmail.value, inviteRole: invRole.value } }); toast("Invite sent"); }
    catch (e) { toast(e.message); }
  });
  // billing
  root.querySelector("[data-upgrade]") && (root.querySelector("[data-upgrade]").onclick = async () => {
    try { state.billing = (await api(`/billing/${state.ws.id}/upgrade`, { method: "POST", body: { plan: planSel.value, seats: Number(seats.value), priceCents: Number(price.value) } })).billing; toast("Plan updated"); render(); }
    catch (e) { toast(e.message); }
  });
  root.querySelector("[data-redeem]") && (root.querySelector("[data-redeem]").onclick = async () => {
    try { const r = await api(`/billing/${state.ws.id}/redeem`, { method: "POST", body: { code: coupon.value } }); state.billing = r.billing; toast(`Credited $${(r.credited / 100).toFixed(2)}`); render(); }
    catch (e) { toast(e.message); }
  });
  // integrations
  root.querySelectorAll("[data-test]").forEach((el) => (el.onclick = async () => {
    try { const r = await api(`/integrations/${state.ws.id}/test`, { method: "POST", body: { url: el.dataset.test } }); toast(`Webhook responded ${r.status}`); }
    catch (e) { toast(e.message); }
  }));
  root.querySelector("[data-addint]") && (root.querySelector("[data-addint]").onclick = async () => {
    try { await api(`/integrations/${state.ws.id}`, { method: "POST", body: { name: intName.value, webhookUrl: intUrl.value } }); toast("Integration added"); loadView(); }
    catch (e) { toast(e.message); }
  });
  root.querySelector("[data-testfield]") && (root.querySelector("[data-testfield]").onclick = async () => {
    try { const r = await api(`/integrations/${state.ws.id}/test`, { method: "POST", body: { url: document.getElementById("intUrl").value } }); toast(`Webhook responded ${r.status}`); }
    catch (e) { toast(e.message); }
  });
  // settings
  root.querySelector("[data-saveprofile]") && (root.querySelector("[data-saveprofile]").onclick = async () => {
    try { state.user = (await api(`/users/me`, { method: "PATCH", body: { name: pName.value, email: pEmail.value } })).user; toast("Profile saved"); render(); }
    catch (e) { toast(e.message); }
  });
  root.querySelector("[data-avatar]") && (root.querySelector("[data-avatar]").onclick = async () => {
    try { await api(`/users/me/avatar`, { method: "POST", body: { url: avatarUrl.value } }); toast("Avatar imported"); }
    catch (e) { toast(e.message); }
  });

  // drawer
  if (state.task) {
    document.getElementById("closeDrawer").onclick = () => { state.task = null; render(); };
    document.getElementById("scrim").onclick = () => { state.task = null; render(); };
    document.getElementById("postComment").onclick = async () => {
      const v = document.getElementById("commentBody").value.trim();
      if (!v) return;
      try { await api(`/tasks/${state.task.id}/comments`, { method: "POST", body: { body: v } }); await openTask(state.task.id); toast("Comment added"); }
      catch (e) { toast(e.message); }
    };
  }
}

async function newTask() {
  const title = prompt("Task title");
  if (!title || !state.project) return;
  try { await api("/tasks", { method: "POST", body: { projectId: state.project.id, title } }); toast("Task created"); await selectWorkspace(state.ws.id); }
  catch (e) { toast(e.message); }
}

function render() {
  if (!state.token || !state.user) return loginView();
  const views = { home: homeView, projects: boardView, members: membersView, billing: billingView, integrations: integrationsView, settings: settingsView, admin: adminView, search: searchView };
  shell((views[state.view] || homeView)());
}

boot().catch(() => render());
render();
