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

  // más nuevo primero (si la key es timestamp/num)
  items.sort((a, b) => String(b.key).localeCompare(String(a.key)));
  return { ok: true, path, count: items.length, items };
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

// ---------- NUEVO: /view (HTML para WebView) ----------
// /view?path=History/Id123&title=P2P%20Exitoso&sub=Cantidad%20del%20trato&unit=ORN
app.get("/view", async (req, res) => {
  const path = String(req.query.path || "").trim();
  if (!path) return res.status(400).send("Falta ?path=");

  const titleDefault = req.query.title ? String(req.query.title) : "P2P Exitoso";
  const subDefault   = req.query.sub ? String(req.query.sub)     : "Cantidad del trato";
  const unit         = req.query.unit ? String(req.query.unit)    : "";       // ej.: ORN
  const amountKey    = req.query.amountKey ? String(req.query.amountKey) : ""; // si tienes una key específica

  try {
    const data = await readHistory(path);
    if (!data.ok) return res.status(500).send("Error leyendo Firebase");

    // función para elegir una “cantidad” a mostrar por item
    const pickAmount = (children) => {
      if (amountKey) {
        const f = children.find(c => c.key.toLowerCase() === amountKey.toLowerCase());
        if (f && (typeof f.data === "number" || typeof f.data === "string")) return String(f.data);
      }
      // 1) primer valor numérico
      for (const c of children) {
        const val = (typeof c.data === "object") ? JSON.stringify(c.data) : String(c.data ?? "");
        if (/^-?\d+(\.\d+)?$/.test(val)) return val;
      }
      // 2) si no hay, usa el total de nietos
      return String(children.length);
    };

    // crea tarjetas tipo “pastilla”
    const cards = data.items.map(item => {
      const amount = pickAmount(item.children);
      const amountText = unit ? `${amount} ${unit}` : amount;

      // subtítulo: si existe un nieto, muestra "clave: valor", si no, usa el default
      let subtitle = subDefault;
      if (item.children.length > 0) {
        const c0 = item.children[0];
        const val0 = (typeof c0.data === "object") ? JSON.stringify(c0.data) : String(c0.data ?? "");
        subtitle = `${c0.key}: ${val0}`;
      }

      return `
      <div class="pill">
        <div class="left">
          <div class="icon">
            <!-- SVG apretón de manos -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.6 12.4l2.1 2.1c.5.5 1.3.5 1.8 0l3.6-3.6c.7-.7.7-1.8 0-2.5s-1.8-.7-2.5 0l-.6.6-.9-.9c-.9-.9-2.4-.9-3.3 0L6 10.8c-.7.7-.7 1.8 0 2.5.7.7 1.8.7 2.6-.9z" />
              <path d="M3 11l4.9-4.9a3.9 3.9 0 015.5 0l.2.2.4-.4a3.5 3.5 0 014.9 0 3.5 3.5 0 010 4.9l-3.6 3.6a3.9 3.9 0 01-5.5 0l-1.4-1.4-.2.2A3.5 3.5 0 013 11z" />
            </svg>
          </div>
          <div class="text">
            <div class="title">${titleDefault}</div>
            <div class="subtitle">${subtitle}</div>
          </div>
        </div>
        <div class="amount">${amountText}</div>
      </div>`;
    }).join("");

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vista • ${path}</title>
<style>
  :root{
    --bg:#0b0f0d;
    --card:#0f1513;
    --ring:#1a2320;
    --muted:#8aa39b;
    --text:#e6f2ee;
    --accent:#b9f3dd;  /* mint suave (icono) */
    --amount:#87d3a6;  /* verde suave para cifra */
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Inter, Arial;
  }
  .wrap{ max-width:780px; margin:32px auto; padding:0 16px; }
  .pill{
    background:var(--card);
    border:1px solid var(--ring);
    border-radius:20px;
    padding:18px 20px;
    display:flex; align-items:center; justify-content:space-between;
    gap:16px; margin:12px 0;
  }
  .left{ display:flex; align-items:center; gap:14px; }
  .icon{
    width:44px; height:44px; border-radius:50%;
    background:rgba(185,243,221,0.06);
    display:grid; place-items:center;
  }
  .icon svg{ width:24px; height:24px; fill:var(--accent); opacity:.95 }
  .text .title{ font-weight:700; font-size:20px; line-height:1.1 }
  .text .subtitle{ color:var(--muted); margin-top:6px; font-size:16px }
  .amount{
    margin-left:auto; font-weight:800; font-size:22px; white-space:nowrap;
    color:var(--amount); opacity:.95
  }
  /* responsive */
  @media (max-width:460px){
    .pill{ padding:16px; }
    .text .title{ font-size:18px }
    .amount{ font-size:20px }
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
