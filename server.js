import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Comprobación rápida
app.get("/", (req, res) => {
  res.send("Bridge base OK");
});

// Para health checks de Render
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Aquí luego agregamos /history?path=History/Id123
// que leerá Firebase y devolverá la lista ya formateada.

app.listen(PORT, () => {
  console.log(`Bridge escuchando en puerto ${PORT}`);
});
