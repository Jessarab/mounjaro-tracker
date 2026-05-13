import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qyxdyzmdssmczxajfzsv.supabase.co";
const SUPABASE_KEY = "sb_publishable_RBnoc_GGpN-XICYoZw4ffw_Yb_HcBuN";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const FARMACIAS = ["San Pablo", "Guadalajara"];
const DOSIS = ["2.5mg", "5mg", "7.5mg", "10mg"];

const PRECIOS_BASE = {
  "2.5mg": 2578,
  "5mg": 2578,
  "7.5mg": 6800,
  "10mg": 6800,
};

function getDescuento(dosis, usos) {
  if (dosis === "2.5mg") return 40;
  const nivel = Math.min(usos, 4);
  return { 1: 20, 2: 25, 3: 30, 4: 35 }[nivel] || 20;
}

function getProximoDescuento(dosis, usos) {
  if (dosis === "2.5mg") return 40;
  const siguiente = Math.min(usos + 1, 4);
  return { 1: 20, 2: 25, 3: 30, 4: 35 }[siguiente] || 35;
}

function formatCurrency(n) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

function PillBadge({ children, color = "purple" }) {
  const colors = {
    purple: "bg-purple-900/60 text-purple-200 border border-purple-700/40",
    red: "bg-red-900/60 text-red-200 border border-red-700/40",
    green: "bg-emerald-900/60 text-emerald-200 border border-emerald-700/40",
    amber: "bg-amber-900/60 text-amber-200 border border-amber-700/40",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide ${colors[color]}`}>
      {children}
    </span>
  );
}

function ProgressBar({ usos, dosis }) {
  if (dosis === "2.5mg") {
    return (
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
          <div className="h-full bg-red-400 rounded-full w-full" />
        </div>
        <span className="text-xs text-red-300 font-bold">40% fijo</span>
      </div>
    );
  }
  const pct = Math.min((Math.min(usos, 4) / 4) * 100, 100);
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-purple-300 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-purple-300 font-bold">{Math.min(usos, 4)}/4</span>
    </div>
  );
}

async function analizarTicketConIA(base64Image) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: base64Image },
              },
              {
                type: "text",
                text: `Eres un experto extrayendo datos de tickets de farmacia mexicana de compras de Mounjaro (tirzepatida de Eli Lilly).

Analiza esta imagen con mucho cuidado y extrae:

1. FARMACIA: Logo o nombre en encabezado. Opciones: "San Pablo" o "Guadalajara".

2. DOSIS DE MOUNJARO: Busca "MOUNJARO KWIKPEN SOL Xmg". La dosis CON DESCUENTO es la principal. Opciones: "2.5mg", "5mg", "7.5mg", "10mg".

3. TARJETA ELI LILLY (CRÍTICO): En tickets San Pablo aparece como:
   "- TARJETA   Eli Lilly: XXXXXXXXXXXXXXXXX"
   Es un número de 13-16 dígitos. Extráelo completo sin espacios.

4. FECHA: Línea "Fecha" al final. Formato DD.MM.YY → convertir a YYYY-MM-DD.

5. MONTO: "Total" en pesos. El total final pagado (no el descuento negativo).

6. DETALLE: Lista breve de productos en el ticket (ej: "5mg con 20% desc + 2.5mg gratis").

Responde ÚNICAMENTE con JSON sin backticks:
{"dosis":"5mg","farmacia":"San Pablo","numeroTarjeta":"5019303062542","fecha":"2026-05-12","precio":5151.50,"detalle":"5mg con 20% descuento + 2.5mg sin costo","confianza":"alta","notas":"breve descripción"}`,
              },
            ],
          },
        ],
      }),
    });
    const data = await response.json();
    const text = data.content?.map((i) => i.text || "").join("") || "{}";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { dosis: null, farmacia: null, numeroTarjeta: null, fecha: null, precio: null, confianza: "baja", notas: "No se pudo analizar" };
  }
}

export default function App() {
  const [tarjetas, setTarjetas] = useState([]);
  const [compras, setCompras] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [view, setView] = useState("dashboard");
  const [analizando, setAnalizando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [modalTarjeta, setModalTarjeta] = useState(null);
  const [preview, setPreview] = useState(null);
  const [iaResult, setIaResult] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    dosis: "5mg",
    farmacia: "San Pablo",
    numeroTarjeta: "",
    fecha: new Date().toISOString().slice(0, 10),
    precio: "",
    detalle: "",
    notas: "",
  });
  const fileRef = useRef();

  // Cargar datos de Supabase
  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    setCargando(true);
    try {
      const [{ data: t }, { data: c }] = await Promise.all([
        supabase.from("tarjetas").select("*").order("creada_en", { ascending: false }),
        supabase.from("compras").select("*").order("fecha", { ascending: false }),
      ]);
      setTarjetas(t || []);
      setCompras(c || []);
    } catch (e) {
      setError("Error conectando con la base de datos");
    }
    setCargando(false);
  }

  const handleFoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      setPreview(ev.target.result);
      setAnalizando(true);
      setIaResult(null);
      const result = await analizarTicketConIA(base64);
      setIaResult(result);
      setForm((f) => ({
        ...f,
        dosis: result.dosis || f.dosis,
        farmacia: result.farmacia || f.farmacia,
        numeroTarjeta: result.numeroTarjeta || f.numeroTarjeta,
        fecha: result.fecha || f.fecha,
        precio: result.precio || f.precio,
        detalle: result.detalle || f.detalle,
      }));
      setAnalizando(false);
    };
    reader.readAsDataURL(file);
  };

  const guardarCompra = async () => {
    if (!form.numeroTarjeta || !form.dosis || !form.farmacia) return;
    setGuardando(true);

    try {
      // Buscar tarjeta existente
      const tarjetaExistente = tarjetas.find(
        (t) => t.numero === form.numeroTarjeta && t.farmacia === form.farmacia
      );

      let tarjetaId;

      if (tarjetaExistente) {
        // Actualizar usos
        const { data: updated } = await supabase
          .from("tarjetas")
          .update({ usos: tarjetaExistente.usos + 1, ultimo_uso: form.fecha, dosis: form.dosis })
          .eq("id", tarjetaExistente.id)
          .select()
          .single();
        tarjetaId = tarjetaExistente.id;
        setTarjetas((prev) => prev.map((t) => (t.id === tarjetaExistente.id ? updated : t)));
      } else {
        // Crear tarjeta nueva
        const { data: nueva } = await supabase
          .from("tarjetas")
          .insert({ numero: form.numeroTarjeta, farmacia: form.farmacia, dosis: form.dosis, usos: 1, ultimo_uso: form.fecha })
          .select()
          .single();
        tarjetaId = nueva.id;
        setTarjetas((prev) => [nueva, ...prev]);
      }

      const usosActuales = tarjetaExistente ? tarjetaExistente.usos + 1 : 1;
      const descuento = getDescuento(form.dosis, usosActuales);

      // Registrar compra
      const { data: nuevaCompra } = await supabase
        .from("compras")
        .insert({
          tarjeta_id: tarjetaId,
          fecha: form.fecha,
          monto: form.precio ? parseFloat(form.precio) : null,
          descuento_porcentaje: descuento,
          detalle: form.detalle,
          notas: form.notas,
          farmacia: form.farmacia,
          dosis: form.dosis,
        })
        .select()
        .single();

      setCompras((prev) => [nuevaCompra, ...prev]);
      setGuardado(true);
      setForm({ dosis: "5mg", farmacia: "San Pablo", numeroTarjeta: "", fecha: new Date().toISOString().slice(0, 10), precio: "", detalle: "", notas: "" });
      setPreview(null);
      setIaResult(null);
      setTimeout(() => { setGuardado(false); setView("dashboard"); }, 1500);
    } catch (e) {
      setError("Error al guardar. Intenta de nuevo.");
    }
    setGuardando(false);
  };

  const eliminarTarjeta = async (id) => {
    await supabase.from("compras").delete().eq("tarjeta_id", id);
    await supabase.from("tarjetas").delete().eq("id", id);
    setTarjetas((prev) => prev.filter((t) => t.id !== id));
    setCompras((prev) => prev.filter((c) => c.tarjeta_id !== id));
    setModalTarjeta(null);
  };

  const ahorroTotal = compras
    .filter((c) => c.monto && c.descuento_porcentaje)
    .reduce((sum, c) => sum + Math.round((c.monto * c.descuento_porcentaje) / (100 - c.descuento_porcentaje)), 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-white" style={{ fontFamily: "system-ui, sans-serif" }}>
      <style>{`
        .glass { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
        .glow-purple { box-shadow: 0 0 20px rgba(147,51,234,0.25); }
        .glow-red { box-shadow: 0 0 20px rgba(239,68,68,0.25); }
        input, select, textarea { background: rgba(255,255,255,0.06) !important; color: white !important; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: rgba(147,51,234,0.6) !important; }
        select option { background: #18181b; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(9,9,11,0.95)", backdropFilter: "blur(12px)", zIndex: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>
            <span style={{ color: "#a855f7" }}>Mounjaro</span>
            <span style={{ color: "#d4d4d8" }}> Tracker</span>
          </div>
          <div style={{ fontSize: 11, color: "#71717a", marginTop: 2 }}>
            {tarjetas.length} tarjeta{tarjetas.length !== 1 ? "s" : ""} · {compras.length} compra{compras.length !== 1 ? "s" : ""}
          </div>
        </div>
        <button
          onClick={() => setView("nueva")}
          style={{ background: "#9333ea", color: "white", border: "none", borderRadius: 12, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          + Registrar
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: "12px 16px 0" }}>
        {[["dashboard", "📊 Resumen"], ["tarjetas", "💳 Tarjetas"], ["historial", "📋 Historial"]].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              flex: 1, fontSize: 12, padding: "8px 4px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 600,
              background: view === v ? "#7e22ce" : "transparent",
              color: view === v ? "white" : "#71717a",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: "16px", maxWidth: 500, margin: "0 auto", paddingBottom: 80 }}>

        {/* Error */}
        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13, color: "#fca5a5", display: "flex", justifyContent: "space-between" }}>
            {error}
            <span style={{ cursor: "pointer" }} onClick={() => setError(null)}>✕</span>
          </div>
        )}

        {/* Cargando */}
        {cargando && (
          <div style={{ textAlign: "center", padding: 40, color: "#71717a" }}>
            <div style={{ width: 24, height: 24, border: "2px solid #9333ea", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
            Cargando datos...
          </div>
        )}

        {/* ── DASHBOARD ── */}
        {!cargando && view === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {tarjetas.length === 0 ? (
              <div className="glass" style={{ borderRadius: 20, padding: 40, textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>💉</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#d4d4d8" }}>Sin registros aún</div>
                <div style={{ fontSize: 13, color: "#71717a", marginTop: 4 }}>Registra tu primera compra para comenzar</div>
                <button onClick={() => setView("nueva")} style={{ marginTop: 16, background: "#9333ea", color: "white", border: "none", borderRadius: 12, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  + Primera compra
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: 2 }}>Próxima compra</div>
                {FARMACIAS.map((farm) => {
                  const tf = tarjetas.filter((t) => t.farmacia === farm);
                  if (tf.length === 0) return null;
                  const mejor = tf.reduce((a, b) => (b.usos > a.usos ? b : a));
                  const proxDesc = getProximoDescuento(mejor.dosis, mejor.usos);
                  const ahorro = Math.round((PRECIOS_BASE[mejor.dosis] || 2578) * proxDesc / 100);
                  const diasDesde = mejor.ultimo_uso ? Math.floor((Date.now() - new Date(mejor.ultimo_uso)) / 86400000) : null;
                  const diasRestantes = diasDesde !== null ? 35 - diasDesde : null;
                  return (
                    <div key={farm} className={`glass ${farm === "San Pablo" ? "glow-purple" : "glow-red"}`} style={{ borderRadius: 20, padding: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#a1a1aa" }}>{farm === "San Pablo" ? "🏪" : "🏥"} Farmacia {farm}</div>
                          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>
                            <span style={{ color: farm === "San Pablo" ? "#c084fc" : "#f87171" }}>{proxDesc}%</span>
                            <span style={{ fontSize: 13, fontWeight: 400, color: "#71717a", marginLeft: 4 }}>descuento</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#71717a", marginTop: 2 }}>
                            Ahorro est.: <span style={{ color: "#34d399", fontWeight: 600 }}>{formatCurrency(ahorro)}</span>
                          </div>
                          {diasRestantes !== null && diasRestantes <= 10 && (
                            <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 4 }}>
                              ⚠️ {diasRestantes > 0 ? `${diasRestantes} días para no perder nivel` : "¡Tarjeta posiblemente vencida!"}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <PillBadge color={farm === "San Pablo" ? "purple" : "red"}>{mejor.dosis}</PillBadge>
                          <div style={{ fontSize: 11, color: "#71717a", marginTop: 8 }}>Tarjeta</div>
                          <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: "#e4e4e7" }}>{mejor.numero}</div>
                          <div style={{ fontSize: 11, color: "#71717a" }}>{mejor.usos} uso{mejor.usos !== 1 ? "s" : ""}</div>
                        </div>
                      </div>
                      <ProgressBar usos={mejor.usos} dosis={mejor.dosis} />
                    </div>
                  );
                })}

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {[
                    { label: "Compras", valor: compras.length, color: "#c084fc" },
                    { label: "Ahorrado", valor: ahorroTotal > 0 ? formatCurrency(ahorroTotal) : "–", color: "#34d399" },
                    { label: "Tarjetas", valor: tarjetas.length, color: "#fbbf24" },
                  ].map((s) => (
                    <div key={s.label} className="glass" style={{ borderRadius: 14, padding: 12, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.valor}</div>
                      <div style={{ fontSize: 11, color: "#71717a", marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── NUEVA COMPRA ── */}
        {view === "nueva" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: 2 }}>Registrar compra</div>

            {/* Foto */}
            <div className="glass" style={{ borderRadius: 20, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#d4d4d8", marginBottom: 12 }}>📸 Foto del ticket</div>
              {preview ? (
                <div style={{ position: "relative" }}>
                  <img src={preview} alt="ticket" style={{ width: "100%", borderRadius: 12, maxHeight: 220, objectFit: "cover" }} />
                  <button onClick={() => { setPreview(null); setIaResult(null); }} style={{ position: "absolute", top: 8, right: 8, background: "rgba(9,9,11,0.8)", border: "none", color: "#d4d4d8", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 13 }}>✕</button>
                  {analizando && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(9,9,11,0.6)", borderRadius: 12 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ width: 24, height: 24, border: "2px solid #a855f7", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
                        <div style={{ fontSize: 12, color: "#c084fc", marginTop: 8 }}>Analizando con IA…</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()} style={{ width: "100%", border: "2px dashed #3f3f46", background: "transparent", borderRadius: 14, padding: "32px 0", cursor: "pointer", color: "#71717a" }}>
                  <div style={{ fontSize: 32 }}>📷</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>Toca para subir foto del ticket</div>
                  <div style={{ fontSize: 11, marginTop: 4, color: "#52525b" }}>La IA extrae los datos automáticamente</div>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFoto} />
              {iaResult && (
                <div style={{ marginTop: 10, borderRadius: 12, padding: 10, fontSize: 12, background: iaResult.confianza === "alta" ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)", border: `1px solid ${iaResult.confianza === "alta" ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`, color: iaResult.confianza === "alta" ? "#6ee7b7" : "#fcd34d" }}>
                  <strong>IA:</strong> {iaResult.notas || "Datos extraídos. Verifica antes de guardar."}
                </div>
              )}
            </div>

            {/* Formulario */}
            <div className="glass" style={{ borderRadius: 20, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#d4d4d8" }}>Datos de la compra</div>

              {/* Farmacia */}
              <div>
                <div style={{ fontSize: 12, color: "#71717a", marginBottom: 6 }}>Farmacia *</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {FARMACIAS.map((f) => (
                    <button key={f} onClick={() => setForm((x) => ({ ...x, farmacia: f }))}
                      style={{ flex: 1, padding: "8px 4px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: form.farmacia === f ? (f === "San Pablo" ? "#7e22ce" : "#991b1b") : "rgba(255,255,255,0.05)", color: form.farmacia === f ? "white" : "#71717a" }}>
                      {f === "San Pablo" ? "🏪" : "🏥"} {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dosis */}
              <div>
                <div style={{ fontSize: 12, color: "#71717a", marginBottom: 6 }}>Dosis *</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                  {DOSIS.map((d) => (
                    <button key={d} onClick={() => setForm((x) => ({ ...x, dosis: d }))}
                      style={{ padding: "8px 4px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: form.dosis === d ? "#7e22ce" : "rgba(255,255,255,0.05)", color: form.dosis === d ? "white" : "#71717a" }}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Número tarjeta */}
              <div>
                <div style={{ fontSize: 12, color: "#71717a", marginBottom: 6 }}>Número de tarjeta Lilly *</div>
                <input type="text" placeholder="Ej. 5019303062542" value={form.numeroTarjeta}
                  onChange={(e) => setForm((x) => ({ ...x, numeroTarjeta: e.target.value }))}
                  style={{ width: "100%", borderRadius: 12, padding: "10px 12px", fontSize: 14, border: "1px solid #3f3f46", fontFamily: "monospace", boxSizing: "border-box" }} />
              </div>

              {/* Fecha y monto */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#71717a", marginBottom: 6 }}>Fecha</div>
                  <input type="date" value={form.fecha} onChange={(e) => setForm((x) => ({ ...x, fecha: e.target.value }))}
                    style={{ width: "100%", borderRadius: 12, padding: "10px 12px", fontSize: 13, border: "1px solid #3f3f46", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#71717a", marginBottom: 6 }}>Monto pagado</div>
                  <input type="number" placeholder="$0" value={form.precio} onChange={(e) => setForm((x) => ({ ...x, precio: e.target.value }))}
                    style={{ width: "100%", borderRadius: 12, padding: "10px 12px", fontSize: 13, border: "1px solid #3f3f46", boxSizing: "border-box" }} />
                </div>
              </div>

              {/* Detalle */}
              <div>
                <div style={{ fontSize: 12, color: "#71717a", marginBottom: 6 }}>Detalle del ticket</div>
                <input type="text" placeholder="Ej: 5mg con 20% desc + 2.5mg gratis" value={form.detalle}
                  onChange={(e) => setForm((x) => ({ ...x, detalle: e.target.value }))}
                  style={{ width: "100%", borderRadius: 12, padding: "10px 12px", fontSize: 13, border: "1px solid #3f3f46", boxSizing: "border-box" }} />
              </div>

              {/* Notas */}
              <div>
                <div style={{ fontSize: 12, color: "#71717a", marginBottom: 6 }}>Notas</div>
                <textarea rows={2} placeholder="Observaciones opcionales…" value={form.notas}
                  onChange={(e) => setForm((x) => ({ ...x, notas: e.target.value }))}
                  style={{ width: "100%", borderRadius: 12, padding: "10px 12px", fontSize: 13, border: "1px solid #3f3f46", resize: "none", boxSizing: "border-box" }} />
              </div>

              {/* Preview descuento */}
              {form.numeroTarjeta && (
                <div style={{ background: "rgba(147,51,234,0.1)", border: "1px solid rgba(147,51,234,0.3)", borderRadius: 12, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "#c084fc" }}>
                    {(() => {
                      const t = tarjetas.find((t) => t.numero === form.numeroTarjeta && t.farmacia === form.farmacia);
                      return t ? `Uso #${t.usos + 1} en esta tarjeta` : "Primera vez con esta tarjeta";
                    })()}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#e9d5ff" }}>
                    {getDescuento(form.dosis, (tarjetas.find((t) => t.numero === form.numeroTarjeta && t.farmacia === form.farmacia)?.usos || 0) + 1)}% desc.
                  </div>
                </div>
              )}
            </div>

            <button onClick={guardarCompra} disabled={!form.numeroTarjeta || !form.dosis || !form.farmacia || guardando || guardado}
              style={{ width: "100%", padding: "14px 0", borderRadius: 14, border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700, background: guardado ? "#059669" : "#9333ea", color: "white", opacity: (!form.numeroTarjeta || guardando) ? 0.5 : 1 }}>
              {guardado ? "✓ Guardado" : guardando ? "Guardando…" : "Guardar compra"}
            </button>
          </div>
        )}

        {/* ── TARJETAS ── */}
        {!cargando && view === "tarjetas" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: 2 }}>Mis tarjetas</div>
            {tarjetas.length === 0 && <div className="glass" style={{ borderRadius: 20, padding: 40, textAlign: "center", color: "#71717a", fontSize: 13 }}>Sin tarjetas registradas</div>}
            {FARMACIAS.map((farm) => {
              const tf = tarjetas.filter((t) => t.farmacia === farm);
              if (tf.length === 0) return null;
              return (
                <div key={farm}>
                  <div style={{ fontSize: 11, color: "#71717a", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>{farm === "San Pablo" ? "🏪" : "🏥"} {farm}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {tf.map((t) => {
                      const diasDesde = t.ultimo_uso ? Math.floor((Date.now() - new Date(t.ultimo_uso)) / 86400000) : null;
                      const vencida = diasDesde !== null && diasDesde > 35;
                      return (
                        <div key={t.id} className="glass" onClick={() => setModalTarjeta(t)} style={{ borderRadius: 20, padding: 16, cursor: "pointer", borderColor: vencida ? "rgba(239,68,68,0.4)" : undefined }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                              <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#e4e4e7" }}>{t.numero}</div>
                              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                <PillBadge color={farm === "San Pablo" ? "purple" : "red"}>{t.dosis}</PillBadge>
                                {vencida && <PillBadge color="red">⚠ Vencida</PillBadge>}
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 26, fontWeight: 800, color: "#c084fc" }}>{getDescuento(t.dosis, t.usos)}%</div>
                              <div style={{ fontSize: 11, color: "#71717a" }}>desc. actual</div>
                              {t.dosis !== "2.5mg" && t.usos < 4 && (
                                <div style={{ fontSize: 11, color: "#34d399", marginTop: 2 }}>→ {getProximoDescuento(t.dosis, t.usos)}% próx.</div>
                              )}
                            </div>
                          </div>
                          <ProgressBar usos={t.usos} dosis={t.dosis} />
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "#52525b" }}>
                            <span>{t.usos} uso{t.usos !== 1 ? "s" : ""}</span>
                            {diasDesde !== null && <span>Último: hace {diasDesde}d {diasDesde <= 35 ? `· ${35 - diasDesde}d restantes` : ""}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── HISTORIAL ── */}
        {!cargando && view === "historial" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: 2 }}>Historial de compras</div>
            {compras.length === 0 && <div className="glass" style={{ borderRadius: 20, padding: 40, textAlign: "center", color: "#71717a", fontSize: 13 }}>Sin compras registradas</div>}
            {compras.map((c) => (
              <div key={c.id} className="glass" style={{ borderRadius: 20, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e4e4e7" }}>{c.farmacia === "San Pablo" ? "🏪" : "🏥"} {c.farmacia}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <PillBadge color={c.farmacia === "San Pablo" ? "purple" : "red"}>{c.dosis}</PillBadge>
                      <PillBadge color="green">{c.descuento_porcentaje}% desc.</PillBadge>
                    </div>
                    {c.detalle && <div style={{ fontSize: 11, color: "#71717a", marginTop: 6 }}>{c.detalle}</div>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "#71717a" }}>{c.fecha}</div>
                    {c.monto && <div style={{ fontSize: 15, fontWeight: 600, color: "#34d399", marginTop: 4 }}>{formatCurrency(c.monto)}</div>}
                  </div>
                </div>
                {c.notas && <div style={{ fontSize: 11, color: "#52525b", marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>{c.notas}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal tarjeta */}
      {modalTarjeta && (
        <div onClick={() => setModalTarjeta(null)} style={{ position: "fixed", inset: 0, background: "rgba(9,9,11,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-end", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} className="glass" style={{ width: "100%", maxWidth: 500, margin: "0 auto", borderRadius: "24px 24px 0 0", padding: 24, paddingBottom: 40 }}>
            <div style={{ width: 40, height: 4, background: "#3f3f46", borderRadius: 2, margin: "0 auto 20px" }} />
            <div style={{ fontSize: 18, fontWeight: 800, color: "#e4e4e7", marginBottom: 4 }}>Tarjeta {modalTarjeta.farmacia}</div>
            <div style={{ fontFamily: "monospace", color: "#c084fc", fontSize: 14, marginBottom: 20 }}>{modalTarjeta.numero}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
              {[
                ["Dosis", modalTarjeta.dosis],
                ["Usos registrados", modalTarjeta.usos],
                ["Descuento actual", `${getDescuento(modalTarjeta.dosis, modalTarjeta.usos)}%`],
                modalTarjeta.dosis !== "2.5mg" && modalTarjeta.usos < 4 ? ["Próximo descuento", `${getProximoDescuento(modalTarjeta.dosis, modalTarjeta.usos)}%`] : null,
                ["Último uso", modalTarjeta.ultimo_uso || "—"],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#71717a" }}>{k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
            <button onClick={() => eliminarTarjeta(modalTarjeta.id)}
              style={{ width: "100%", marginTop: 24, padding: "12px 0", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Eliminar tarjeta y sus compras
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
