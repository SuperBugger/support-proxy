import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import axios from "axios";
import cors from "cors";
import FormData from "form-data";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());
app.use(cookieParser());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/static", express.static(path.join(__dirname, "public")));

const upload = multer();

const FD_DOMAIN = process.env.FD_DOMAIN;   // <--- ТВОЙ субдомен без https
const FD_KEY    = process.env.FD_API_KEY;  // <--- ТВОЙ API Key агента
const ORIGINS   = (process.env.ALLOWED_ORIGINS || "").split(",").map(s=>s.trim()).filter(Boolean);

app.use(cors({
  origin: (o, cb) => {
    if (!o || ORIGINS.includes(o)) return cb(null, true);
    cb(new Error("CORS blocked"));
  },
  credentials: true
}));

const AX = axios.create({
  baseURL: `https://${FD_DOMAIN}.freshdesk.com/api/v2`,
  auth: { username: FD_KEY, password: "X" }
});

function requireUser(req, res, next) {
  const u = req.cookies["fd_user"];
  if (!u) return res.status(401).json({ error: "not_authenticated" });
  try { req.user = JSON.parse(u); next(); } catch { return res.status(401).json({ error: "bad_session" }); }
}

async function ensureContact(email) {
  try {
    const r = await AX.get(`/search/contacts?query=${encodeURIComponent(`"email:'${email}'"`)}&page=1`);
    if (r.data?.length) return r.data[0];
  } catch (e) { /* ignore 404 */ }
  const c = await AX.post("/contacts", { email, name: email.split("@")[0] });
  return c.data;
}

app.post("/auth/start", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email_required" });
    const contact = await ensureContact(email);
    res.cookie("fd_user", JSON.stringify({ id: contact.id, email: contact.email }), {
      httpOnly: true, sameSite: "None", secure: true
    });
    return res.json({ contact_id: contact.id, email: contact.email, name: contact.name });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "auth_failed" });
  }
});

app.get("/auth/me", requireUser, (req, res) => res.json(req.user));

app.get("/tickets", requireUser, async (req, res) => {
  const { page = 1, page_size = 20, query = "" } = req.query;
  const contact_id = req.user.id;
  const srch = query ? ` AND subject:'${query}'` : "";
  const q = `"requester_id:${contact_id}"${srch}`;
  const r = await AX.get(`/search/tickets?query=${encodeURIComponent(q)}&page=${page}`);
  const items = (r.data.results || []).map(t => ({
    id: t.id, subject: t.subject, status: t.status, priority: t.priority, updated_at: t.updated_at
  }));
  res.json({ items, total: r.data.total ?? items.length, page: Number(page), page_size: Number(page_size) });
});

app.post("/tickets", requireUser, upload.array("attachments"), async (req, res) => {
  try {
    const { subject, description, priority = 1 } = req.body;
    const email = req.user.email;
    const created = await AX.post(`/tickets`, {
      email, subject, description, priority: Number(priority), status: 2
    });

    if (req.files?.length) {
      const form = new FormData();
      form.append("body", "Attachments");
      for (const f of req.files) form.append("attachments[]", f.buffer, { filename: f.originalname });
      await axios.post(
        `https://${FD_DOMAIN}.freshdesk.com/api/v2/tickets/${created.data.id}/reply`,
        form,
        { auth: { username: FD_KEY, password: "X" }, headers: form.getHeaders() }
      );
    }
    res.json({ id: created.data.id, subject: created.data.subject, status: created.data.status });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "create_failed" });
  }
});

app.get("/tickets/:id", requireUser, async (req, res) => {
  const { id } = req.params;
  const [t, conv] = await Promise.all([
    AX.get(`/tickets/${id}`),
    AX.get(`/tickets/${id}/conversations`)
  ]);
  const messages = conv.data.map(m => ({
    id: m.id,
    from: m.private ? "agent" : (m.user_id ? "agent" : "you"),
    body_html: m.body,
    created_at: m.created_at,
    attachments: (m.attachments||[]).map(a=>({name:a.name, url:a.attachment_url, size:a.size}))
  }));
  res.json({
    id: t.data.id, subject: t.data.subject, status: t.data.status,
    created_at: t.data.created_at, updated_at: t.data.updated_at, messages
  });
});

app.post("/tickets/:id/reply", requireUser, upload.array("attachments"), async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const form = new FormData();
  form.append("body", message || "");
  for (const f of req.files || []) form.append("attachments[]", f.buffer, { filename: f.originalname });
  await axios.post(
    `https://${FD_DOMAIN}.freshdesk.com/api/v2/tickets/${id}/reply`,
    form,
    { auth: { username: FD_KEY, password: "X" }, headers: form.getHeaders() }
  );
  res.json({ ok: true });
});

app.get("/health", (_, res) => res.send("ok"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("proxy on :" + PORT));
