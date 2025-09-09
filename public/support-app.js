(() => {
  const API = "https://support-proxy.onrender.com";
  const el = document.getElementById("support-app");
  if (!el) return;

  const state = { user: null, tickets: [], selected: null, page: 1, q: "" };

  function h(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") e.className = v;
      else if (k === "style" && typeof v === "object")
        e.setAttribute("style", Object.entries(v).map(([kk, vv]) => `${kk}:${vv}`).join(";"));
      else e.setAttribute(k, v);
    });
    children.flat().forEach(c => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  }

  async function api(path, opts = {}) {
    const r = await fetch(API + path, { credentials: "include", ...opts });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }

  function applyStyles() {
    const css = `
      .support-wrap{display:grid;grid-template-columns: 1fr 2fr;gap:16px}
      .support-row{display:grid;grid-template-columns: 1fr auto auto;gap:8px;padding:10px;border:1px solid #eee;border-radius:10px;margin-bottom:8px;cursor:pointer}
      .support-row:hover{background:#fafafa}
      .support-pane{border:1px solid #eee;border-radius:10px;padding:12px;min-height:300px}
      .msg{border:1px solid #f0f0f0;border-radius:10px;padding:8px;margin:8px 0}
      .msg.agent{background:#fafcff}
      .msg.you{background:#f7fff7}
      .msg .meta{font-size:12px;opacity:.7;margin-bottom:6px}
      .reply textarea{width:100%;height:100px;margin:8px 0}
      .support-modal{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999}
      .support-modal form{background:#fff;padding:16px;border-radius:12px;min-width:360px;max-width:90vw}
      .support-hdr{display:flex;align-items:center;gap:12px;margin-bottom:8px}
      .support-hdr button{padding:8px 12px;border:1px solid #ddd;border-radius:8px;cursor:pointer;background:#fff}
      .support-hdr button:hover{background:#fafafa}
    `;
    if (!document.getElementById("support-css")) {
      const s = document.createElement("style");
      s.id = "support-css";
      s.textContent = css;
      document.head.append(s);
    }
  }

  function statusText(s) {
    const map = { 2: "Открыт", 3: "В ожидании", 4: "Решён", 5: "Закрыт" };
    return map[s] || String(s);
  }
  function fromHTML(html) {
    const t = document.createElement("template");
    t.innerHTML = html || "";
    return Array.from(t.content.childNodes);
  }

  async function loadTickets() {
    const data = await api(`/tickets?page=${state.page}&query=${encodeURIComponent(state.q || "")}`);
    state.tickets = data.items || [];
    render();
  }
  async function openTicket(id) {
    state.selected = await api(`/tickets/${id}`);
    render();
  }
  async function createTicket(fd) {
    const form = new FormData();
    form.append("subject", fd.subject.value);
    form.append("description", fd.description.value);
    if (fd.priority.value) form.append("priority", fd.priority.value);
    for (const f of fd.attach.files) form.append("attachments", f, f.name);
    await fetch(API + "/tickets", { method: "POST", body: form, credentials: "include" });
    await loadTickets();
  }
  async function replyTicket(id, fd) {
    const form = new FormData();
    form.append("message", fd.message.value);
    for (const f of fd.attach.files) form.append("attachments", f, f.name);
    await fetch(`${API}/tickets/${id}/reply`, { method: "POST", body: form, credentials: "include" });
    await openTicket(id);
  }

  function renderAuth() {
    el.innerHTML = "";
    const email = localStorage.getItem("support_email") || "";
    const input = h("input", { type: "email", placeholder: "Ваш e‑mail", value: email, style: { padding: "8px", width: "280px" } });
    const btn = h("button", {}, "Войти");
    btn.onclick = async () => {
      const val = input.value.trim();
      if (!val) return alert("Укажите e‑mail");
      localStorage.setItem("support_email", val);
      await api("/auth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: val }) });
      state.user = await api("/auth/me");
      await loadTickets();
      render();
    };
    el.append(h("div", {}, h("h3", {}, "Поддержка"), h("div", {}, input, btn)));
  }

  function render() {
    applyStyles();
    if (!state.user) return renderAuth();
    el.innerHTML = "";

    const hdr = h("div", { class: "support-hdr" },
      h("strong", {}, state.user.email),
      h("button", {}, "Новая заявка")
    );
    hdr.querySelector("button").onclick = () => {
      const modal = h("div", { class: "support-modal" });
      const form = h("form", {},
        h("input", { name: "subject", placeholder: "Тема", required: true, style: "display:block;margin:6px 0;padding:8px;width:100%" }),
        h("textarea", { name: "description", placeholder: "Опишите проблему", required: true, style: "display:block;margin:6px 0;padding:8px;width:100%;height:120px" }),
        h("select", { name: "priority", style: "padding:6px;margin:6px 0" },
          h("option", { value: "1" }, "Low"),
          h("option", { value: "2" }, "Medium"),
          h("option", { value: "3" }, "High")
        ),
        h("input", { name: "attach", type: "file", multiple: true, style: "margin:6px 0" }),
        h("div", {},
          h("button", { type: "submit" }, "Отправить"),
          h("button", { type: "button", style: "margin-left:8px" }, "Отмена")
        )
      );
      form.onsubmit = async e => { e.preventDefault(); await createTicket(form); modal.remove(); };
      form.querySelector('button[type="button"]').onclick = () => modal.remove();
      modal.append(form);
      document.body.append(modal);
    };

    const list = h("div", { class: "support-list" });
    state.tickets.forEach(t => {
      const row = h("div", { class: "support-row" },
        h("div", {}, `#${t.id} `, h("strong", {}, t.subject)),
        h("div", {}, statusText(t.status)),
        h("div", {}, new Date(t.updated_at).toLocaleString())
      );
      row.onclick = () => openTicket(t.id);
      list.append(row);
    });

    const pane = h("div", { class: "support-pane" });
    if (!state.selected) {
      pane.append(h("div", { style: "opacity:.6" }, "Выберите заявку из списка"));
    } else {
      pane.append(
        h("h4", {}, `#${state.selected.id} — ${state.selected.subject} (${statusText(state.selected.status)})`)
      );
      state.selected.messages.forEach(m => {
        pane.append(h("div", { class: "msg " + m.from },
          h("div", { class: "meta" }, `${m.from} • ${new Date(m.created_at).toLocaleString()}`),
          h("div", { class: "body" }, ...fromHTML(m.body_html || "")),
          ...(m.attachments || []).map(a => h("div", {}, h("a", { href: a.url, target: "_blank" }, a.name)))
        ));
      });
      const rf = h("form", { class: "reply" },
        h("textarea", { name: "message", placeholder: "Ваш ответ...", required: true }),
        h("input", { name: "attach", type: "file", multiple: true }),
        h("button", { type: "submit" }, "Отправить")
      );
      rf.onsubmit = async e => { e.preventDefault(); await replyTicket(state.selected.id, rf); };
      pane.append(rf);
    }

    const search = h("div", { style: "margin:8px 0" },
      h("input", { placeholder: "Поиск по теме", value: state.q, style: "padding:6px;width:240px" }),
      h("button", { style: "margin-left:8px" }, "Найти")
    );
    search.querySelector("button").onclick = async () => {
      state.q = search.querySelector("input").value;
      await loadTickets();
    };

    const cont = h("div", { class: "support-wrap" }, list, pane);
    el.append(hdr, search, cont);
  }

  (async function init() {
    try {
      state.user = await api("/auth/me");
      render();
      await loadTickets();
    } catch {
      renderAuth();
    }
  })();
})();
