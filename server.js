import express from "express";
import cors from "cors";
import admin from "firebase-admin";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// ---------- Firebase init seguro ----------
let db = null;
try {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}";
  const svc = JSON.parse(raw);
  const privateKey = (svc.private_key || "").replace(/\\n/g, "\n");

  if (svc.client_email && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: svc.project_id,
        clientEmail: svc.client_email,
        privateKey
      }),
      databaseURL: process.env.FIREBASE_DB_URL
    });
    db = admin.database();
    console.log("Firebase Admin inicializado ✔");
  } else {
    console.warn("⚠️ Falta configuración Firebase.");
  }
} catch (e) {
  console.error("Error al inicializar Firebase:", e.message);
}

// ---------- Util: leer hijos + nietos ----------
async function readHistory(path) {
  if (!db) return { ok: false, error: "Firebase no inicializado" };

  const snap = await db.ref(path).get();
  if (!snap.exists()) return { ok: true, path, count: 0, items: [] };

  const items = [];
  snap.forEach(child => {
    const children = [];
    child.forEach(grand => {
      children.push({ key: grand.key, data: grand.val() });
    });
    items.push({ key: child.key, children });
  });

  // más nuevo primero
  items.sort((a, b) => String(b.key).localeCompare(String(a.key)));
  return { ok: true, path, count: items.length, items };
}

// helpers
function getVal(children, name) {
  const n = String(name).toLowerCase();
  const f = children.find(c => String(c.key).toLowerCase() === n);
  if (!f) return "";
  return typeof f.data === "object" ? JSON.stringify(f.data) : String(f.data ?? "");
}
function amountClass(amountText) {
  return String(amountText).trim().startsWith("-") ? "neg" : "pos";
}

// ---------- Rutas básicas ----------
app.get("/", (_req, res) => res.send("Bridge base OK"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// JSON crudo
app.get("/history", async (req, res) => {
  const path = String(req.query.path || "").trim();
  if (!path) return res.status(400).json({ ok: false, error: "path requerido" });
  try {
    const data = await readHistory(path);
    res.json(data);
  } catch (err) {
    console.error("Error /history:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ---------- /view (HTML compacto para WebView) ----------
// Ej: /view?path=History/ID234569&compact=1
app.get("/view", async (req, res) => {
  const path = String(req.query.path || "").trim();
  if (!path) return res.status(400).send("Falta ?path=");

  const subtitleFixed = "Cantidad del trato";
  const compact = String(req.query.compact || "0") === "1";

  try {
    const data = await readHistory(path);
    if (!data.ok) return res.status(500).send("Error leyendo Firebase");

    const cards = data.items.map(item => {
      const title = getVal(item.children, "Ttrato") || "P2P";
      const amount = getVal(item.children, "CantTrato") || "";
      const cls = amountClass(amount);

      return `
      <div class="pill ${compact ? "pill-compact" : ""}">
        <div class="text">
          <div class="title ${compact ? "t-compact" : ""}">${title}</div>
          <div class="subtitle ${compact ? "s-compact" : ""}">${subtitleFixed}</div>
        </div>
        <div class="amount ${cls} ${compact ? "a-compact" : ""}">${amount}</div>
      </div>`;
    }).join("");

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=0"/>
<title>Vista • ${path}</title>
<style>
  :root{
    --bg:#0b0f0d;
    --card:#0f1513;
    --ring:#1a2320;
    --muted:#8aa39b;
    --text:#e6f2ee;
    --green:#87d3a6;
    --red:#ef7d7d;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Inter, Arial;
  }
  .wrap{
    max-width:560px; /* más estrecho para móvil */
    margin:0 auto; padding:12px 12px 28px;
  }
  .pill{
    background:var(--card);
    border:1px solid var(--ring);
    border-radius:16px;
    padding:14px 14px;
    display:flex; align-items:center; justify-content:space-between;
    gap:12px; margin:10px 0;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.05) inset;
  }
  .pill-compact{ padding:10px 12px; border-radius:14px; margin:8px 0; }

  .text .title{ font-weight:800; font-size:18px; line-height:1.05 }
  .text .subtitle{ color:var(--muted); margin-top:4px; font-size:14px }
  .t-compact{ font-size:16px }
  .s-compact{ font-size:13px }

  .amount{
    margin-left:auto; font-weight:900; font-size:18px; white-space:nowrap;
    letter-spacing:.2px; opacity:.96
  }
  .a-compact{ font-size:16px }
  .amount.pos{ color:var(--green) }
  .amount.neg{ color:var(--red) }

  /* asegura buen fit en pantallas pequeñas */
  @media (max-width:380px){
    .wrap{ padding:8px }
    .pill{ padding:10px 12px }
    .text .title{ font-size:16px }
    .text .subtitle{ font-size:13px }
    .amount{ font-size:16px }
  }
</style>
</head>
<body>
  <div class="wrap">
    ${cards || `<div style="opacity:.7">No hay datos en <code>${path}</code>.</div>`}
  </div>
</body>
</html>`;
    res.setHeader("content-type","text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Error /view:", err);
    res.status(500).send("Error generando vista");
  }
});

app.listen(PORT, () => console.log("Bridge escuchando en puerto", PORT));
