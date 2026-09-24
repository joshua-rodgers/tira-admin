const { url: base, key } = window.TIRA_CONFIG;
const $ = (id) => document.getElementById(id);
let token = "";
let currentReport = null;

function message(text, target = "status") { $(target).textContent = text; }
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      apikey: key,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error_description || result.msg || result.error || `Request failed (${response.status})`);
  return result;
}
async function adminAction(action, values = {}) {
  return request("/functions/v1/tira-admin", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...values }),
  });
}
function show(view) {
  $("login").hidden = view !== "login";
  $("reports-view").hidden = view !== "reports";
  $("users-view").hidden = view !== "users";
  $("admin-nav").hidden = view === "login";
  message("");
  if (view === "reports") loadReports();
  if (view === "users") loadUsers();
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  message("", "login-error");
  try {
    const session = await request("/auth/v1/token?grant_type=password", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value }),
    });
    token = session.access_token;
    const profile = await request("/auth/v1/user");
    const roles = await request(`/rest/v1/admin_users?user_id=eq.${profile.id}&select=user_id`);
    if (!roles.length) throw new Error("Admin access required.");
    $("password").value = "";
    show("reports");
  } catch (error) {
    token = "";
    message(error.message, "login-error");
  } finally { button.disabled = false; }
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => show(button.dataset.view));
});
$("signout").addEventListener("click", async () => {
  try { await request("/auth/v1/logout", { method: "POST" }); } catch { /* local session still ends */ }
  token = "";
  currentReport = null;
  show("login");
});

async function loadReports() {
  const list = $("reports-list");
  list.replaceChildren(node("p", "Loading…", "muted"));
  try {
    const reports = await request("/rest/v1/reports?select=id,reason,status,created_at&order=created_at.desc&limit=50");
    list.replaceChildren();
    if (!reports.length) list.append(node("p", "No reports.", "muted"));
    for (const report of reports) {
      const button = node("button", undefined, "item");
      button.setAttribute("aria-current", String(report.id === currentReport));
      button.append(node("strong", report.reason), node("small", `${report.status} · ${new Date(report.created_at).toLocaleString()}`));
      button.addEventListener("click", () => openReport(report.id));
      list.append(button);
    }
  } catch (error) { list.replaceChildren(); message(error.message); }
}

async function openReport(id) {
  currentReport = id;
  const detail = $("report-detail");
  detail.replaceChildren(node("p", "Loading…", "muted"));
  try {
    const { report, messages } = await adminAction("report-context", { id });
    detail.replaceChildren();
    detail.append(node("h2", report.reason));
    if (report.ai_summary) detail.append(node("p", report.ai_summary));
    const controls = node("div", undefined, "row");
    const status = document.createElement("select");
    status.setAttribute("aria-label", "Report status");
    for (const value of ["open", "reviewing", "closed"]) {
      const option = node("option", value);
      option.value = value;
      status.append(option);
    }
    status.value = report.status;
    const save = node("button", "Save status");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try { await adminAction("report-status", { id, status: status.value }); message("Status saved."); await loadReports(); }
      catch (error) { message(error.message); }
      finally { save.disabled = false; }
    });
    controls.append(status, save);
    detail.append(controls);
    const chat = node("div", undefined, "chat");
    for (const item of messages) {
      const line = node("p");
      line.append(node("small", `${item.sender_id.slice(0, 8)} · ${new Date(item.created_at).toLocaleString()}`));
      line.append(node("span", item.body || item.transcript || `[${item.kind}]`));
      chat.append(line);
    }
    detail.append(chat);
  } catch (error) { detail.replaceChildren(); message(error.message); }
}

async function loadUsers() {
  const list = $("users-list");
  list.replaceChildren(node("p", "Loading…", "muted"));
  try {
    const users = await request("/rest/v1/profiles?select=id,username,display_name,suspended_at&order=created_at.desc&limit=100");
    list.replaceChildren();
    if (!users.length) list.append(node("p", "No users.", "muted"));
    for (const user of users) {
      const row = node("div", undefined, "user");
      const label = node("div");
      label.append(node("strong", user.display_name), node("small", ` @${user.username}${user.suspended_at ? " · Suspended" : ""}`));
      const button = node("button", user.suspended_at ? "Restore" : "Suspend", user.suspended_at ? "secondary" : "danger");
      button.addEventListener("click", async () => {
        const suspended = !user.suspended_at;
        if (!confirm(`${suspended ? "Suspend" : "Restore"} @${user.username}?`)) return;
        button.disabled = true;
        try { await adminAction("suspend", { id: user.id, suspended }); await loadUsers(); message("Account updated."); }
        catch (error) { message(error.message); button.disabled = false; }
      });
      const remove = node("button", "Delete", "danger");
      remove.addEventListener("click", async () => {
        if (prompt(`Type @${user.username} to permanently delete this account.`) !== `@${user.username}`) return;
        remove.disabled = true;
        try { await adminAction("delete-user", { id: user.id }); await loadUsers(); message("Account deleted."); }
        catch (error) { message(error.message); remove.disabled = false; }
      });
      const controls = node("div", undefined, "row");
      controls.append(button, remove);
      row.append(label, controls);
      list.append(row);
    }
  } catch (error) { list.replaceChildren(); message(error.message); }
}

for (const [buttonID, inputID, action, success] of [
  ["invite", "invite-email", "invite", "Invitation sent."],
  ["reset", "reset-email", "reset-password", "Reset link sent."],
]) {
  $(buttonID).addEventListener("click", async () => {
    const button = $(buttonID);
    button.disabled = true;
    try {
      await adminAction(action, { email: $(inputID).value.trim() });
      $(inputID).value = "";
      message(success);
    } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  });
}
