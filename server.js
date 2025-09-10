import express from "express";
import cors from "cors";
import admin from "firebase-admin";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// -------- Firebase Admin init ----------
const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}";
let svc;
try {
  svc = JSON.parse(raw);
} catch (e) {
  console.error("GOOGLE_SERVICE_ACCOUNT_JSON inválido:", e.message);
  svc = {};
}
const privateKey = (svc.private_key || "").replace(/\\n/g, "\n");

if (!admin.apps.length && svc.client_email && privateKey) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: svc.project_id,
      clientEmail: svc.client_email,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DB_URL,
  });
  console.log("Firebase Admin inicializado.");
} else {
  console.warn("Firebase Admin NO inicializado. Revisa variables de entorno.");
}

const db = () => admin.database();

// -------- Basicos ----------
app.get("/", (_req, res) => res.send("Bridge base OK"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

/**
 * GET /history?path=History/Id123
 * Lee hijos (nivel 1) y nietos (nivel 2) del nodo que recibas.
 * Respuesta: { ok, path, count, items: [ {key, children:[{key, data}] } ] }
 */
app.get("/history", async (req, res) => {
  try {
    const path = String(req.query.path || "").trim();

    // Validación sencilla para evitar paths raros
    if (!path || !/^[A-Za-z0-9/_-]+$/.test(path)) {
      return res.status(400).json({ ok: false, error: "path inválido" });
    }
    if (!admin.apps.length) {
      return res.status(500).json({ ok: false, error: "Firebase no inicializado" });
    }

    const snap = await db().ref(path).get();
    if (!snap.exists()) {
      return res.json({ ok: true, path, count: 0, items: [] });
    }

    // Nivel 1 (hijos)
    const items = [];
    snap.forEach(child => {
      const childKey = child.key;
      const grandchildren = [];

      // Nivel 2 (nietos)
      child.forEach(grand => {
        const grandKey = grand.key;
        const data = grand.val(); // puede ser objeto o valor primitivo
        grandchildren.push({ key: grandKey, data });
      });

      items.push({
        key: childKey,
        children: grandchildren
      });
    });

    // Orden opcional por key descendente (ej.: más reciente primero)
    items.sort((a, b) => String(b.key).localeCompare(String(a.key)));

    res.json({
      ok: true,
      path,
      count: items.length,
      items
    });
  } catch (err) {
    console.error("Error /history:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Bridge escuchando en puerto ${PORT}`);
});
