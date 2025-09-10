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

  // más nuevo primero (si la key es numérica/timestamp en texto)
  items.sort((a, b) => String(b.key).localeCompare(String(a.key)));
  return { ok: true, path, count: items.length, items };
}

// helpers para obtener valores por key, case-insensitive
function getVal(children, name) {
  const n = String(name).toLowerCase();
  const f = children.find(c => String(c.key).toLowerCase() === n);
  if (!f) return "";
  return typeof f.data === "object" ? JSON.stringify(f.data) : String(f.data ?? "");
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

// ---------- /view (HTML para WebView) ----------
// /view?path=History/ID234569
app.get("/view", async (req, res) => {
  const path = String(req.query.path || "").trim();
  if (!path) return res.status(400).send("Falta ?path=");

  // textos por defecto (puedes cambiar aquí si lo deseas)
  const subtitleFixed = "Cantidad del trato";

  try {
    const data = await readHistory(path);
    if (!data.ok) return res.status(500).send("Error leyendo Firebase");

    // construye tarjetas sin icono
    const cards = data.items.map(item => {
      const title = getVal(item.children, "Ttrato") || "P2P";
      const amount = getVal(item.children, "CantTrato") || "";
      // si quieres, también puedes mostrar la hora debajo del título:
      // const time = getVal(item.children, "Time");

      return `
      <div class="pill">
        <div class="text">
          <div class="title">${title}</div>
          <div class="subtitle">${subtitleFixed}</div>
        </div>
        <div class="amount">${amount}</div>
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
  .text .title{ font-weight:700; font-size:20px; line-height:1.1 }
  .text .subtitle{ color:var(--muted); margin-top:6px; font-size:16px }
  .amount{
    margin-left:auto; font-weight:800; font-size:22px; white-space:nowrap;
    color:var(--amount); opacity:.95
  }
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
