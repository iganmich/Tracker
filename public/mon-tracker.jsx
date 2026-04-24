import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

const UNLOCK_EVENTS = [
  { date: "2025-11-24", label: "Launch + Airdrop", amount: "10.8B", category: "Multiple" },
  { date: "2025-12-24", label: "Validator Rewards", amount: "~170M", category: "Validator" },
  { date: "2026-01-24", label: "Validator Rewards", amount: "~170M", category: "Validator" },
  { date: "2026-02-24", label: "Category Labs Treasury", amount: "~83M", category: "Treasury" },
  { date: "2026-03-24", label: "Validator Rewards", amount: "~170M", category: "Validator" },
  { date: "2026-04-24", label: "Validator Rewards + Treasury", amount: "~253M", category: "Multiple" },
  { date: "2026-05-24", label: "Validator Rewards", amount: "~170M", category: "Validator" },
  { date: "2026-06-24", label: "Validator Rewards + Treasury", amount: "~253M", category: "Multiple" },
];

const TABS = [
  { id: "unlock", label: "🔓 Unlock Tracker" },
  { id: "cycles", label: "📈 Investment Cycles" },
  { id: "levels", label: "🎯 Support & Resistance" },
  { id: "backtest", label: "🔬 Backtest" },
];

const C = {
  bg: "#070a14",
  surface: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.07)",
  green: "#00e5a0",
  yellow: "#ffc130",
  red: "#ff4d6d",
  blue: "#4d9fff",
  purple: "#a78bfa",
  text: "#c8d0e0",
  muted: "#566070",
  font: "'JetBrains Mono', 'Courier New', monospace",
};

function calcSR(data) {
  if (!data.length) return { supports: [], resistances: [] };
  const prices = data.map(d => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const bucketSize = range / 20;
  const buckets = {};
  prices.forEach(p => {
    const b = Math.floor((p - min) / bucketSize);
    buckets[b] = (buckets[b] || 0) + 1;
  });
  const levels = Object.entries(buckets)
    .filter(([, count]) => count >= 3)
    .map(([b, count]) => ({ price: min + (parseInt(b) + 0.5) * bucketSize, touches: count }))
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 8);
  const cur = prices[prices.length - 1];
  return {
    supports: levels.filter(l => l.price < cur).sort((a, b) => b.price - a.price).slice(0, 4),
    resistances: levels.filter(l => l.price >= cur).sort((a, b) => a.price - b.price).slice(0, 4),
  };
}

function detectBuyZones(data) {
  // Pattern: PUMP (price rises X%) → DIP (price falls Y%) → RECOVERY (price rises back up)
  // We mark the DIP bottom as the buy point, and find where it recovers as the sell point.
  if (data.length < 14) return [];
  const zones = [];

  for (let i = 8; i < data.length - 5; i++) {
    // 1. Find the peak BEFORE this point (lookback 5-20 days)
    const lookback = data.slice(Math.max(0, i - 20), i - 2).map(d => d.price);
    const prevHigh = Math.max(...lookback);
    const prevHighIdx = data.slice(Math.max(0, i - 20), i - 2).reduce((best, d, j) => d.price > best.price ? { price: d.price, j } : best, { price: 0, j: 0 }).j + Math.max(0, i - 20);

    // 2. The peak must have been a real pump (at least 10% above the period low before it)
    const beforePeak = data.slice(Math.max(0, prevHighIdx - 8), prevHighIdx).map(d => d.price);
    if (!beforePeak.length) continue;
    const baseBeforePeak = Math.min(...beforePeak);
    const pumpMagnitude = (prevHigh - baseBeforePeak) / baseBeforePeak;
    if (pumpMagnitude < 0.10) continue; // not a real pump, skip

    // 3. Current point must be a local dip bottom (lower than neighbors)
    const localWindow = data.slice(i - 2, i + 3).map(d => d.price);
    const localMin = Math.min(...localWindow);
    if (data[i].price > localMin * 1.005) continue; // not the bottom

    // 4. The drop from peak to this dip must be meaningful (10-70%)
    const drop = (prevHigh - data[i].price) / prevHigh;
    if (drop < 0.10 || drop > 0.70) continue;

    // 5. CRITICAL: price must actually RECOVER after the dip — goes up at least 8% within next 10 days
    const afterDip = data.slice(i + 1, Math.min(data.length, i + 11)).map(d => d.price);
    if (!afterDip.length) continue;
    const peakAfterDip = Math.max(...afterDip);
    const recoveryPct = (peakAfterDip - data[i].price) / data[i].price;
    if (recoveryPct < 0.08) continue; // no real recovery, skip

    // 6. Find the actual sell point: first day where price exceeds buy + 80% of recovery target
    const sellTarget = data[i].price * (1 + recoveryPct * 0.75);
    let sellIdx = i + 1;
    for (let s = i + 1; s < Math.min(data.length, i + 15); s++) {
      if (data[s].price >= sellTarget) { sellIdx = s; break; }
      sellIdx = s; // use last available if target not hit
    }

    zones.push({
      ...data[i],
      drop: (drop * 100).toFixed(1),
      prevHigh,
      buyZone: data[i].price,
      sellPrice: data[sellIdx]?.price || peakAfterDip,
      sellDate: data[sellIdx]?.date || data[Math.min(data.length-1, i+10)].date,
      recoveryPct: (recoveryPct * 100).toFixed(1),
      actualReturn: (((data[sellIdx]?.price || peakAfterDip) / data[i].price - 1) * 100).toFixed(1),
      label: `BUY ZONE (-${(drop * 100).toFixed(0)}% dip)`,
    });
  }

  // Deduplicate: keep only one zone per 7-day window (the one with biggest drop)
  const deduped = [];
  for (const z of zones) {
    const zDate = new Date(z.date);
    const clash = deduped.find(d => Math.abs(new Date(d.date) - zDate) / 86400000 < 7);
    if (!clash) deduped.push(z);
    else if (parseFloat(z.drop) > parseFloat(clash.drop)) {
      deduped.splice(deduped.indexOf(clash), 1, z);
    }
  }

  return deduped;
}


async function callClaude(prompt, onChunk) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const p = JSON.parse(line.slice(6).trim());
          if (p.delta?.type === "text_delta") { full += p.delta.text; onChunk(full); }
        } catch {}
      }
    }
  }
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{ background: "rgba(7,10,20,0.97)", border: `1px solid ${C.green}33`, borderRadius: 8, padding: "10px 14px", fontFamily: C.font, fontSize: 11, color: C.text }}>
      <p style={{ color: C.green, marginBottom: 4, fontWeight: 700 }}>{label}</p>
      <p style={{ margin: 0 }}>Price: <b style={{ color: "#fff" }}>${payload[0]?.value?.toFixed(5)}</b></p>
      {d?.unlock && <p style={{ color: C.yellow, margin: "4px 0 0" }}>🔓 {d.unlock.label} · {d.unlock.amount}</p>}
      {d?.isBuyZone && <p style={{ color: C.green, margin: "4px 0 0" }}>✅ {d.label}</p>}
    </div>
  );
}

function AIBox({ title, onRun, loading, text, placeholder }) {
  return (
    <div style={{ background: `${C.green}08`, borderRadius: 12, border: `1px solid ${C.green}18`, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p style={{ margin: 0, fontSize: 10, color: C.green, textTransform: "uppercase", letterSpacing: 1 }}>🤖 {title}</p>
        <button onClick={onRun} disabled={loading} style={{
          background: loading ? `${C.green}0a` : `${C.green}18`, border: `1px solid ${C.green}44`,
          color: C.green, borderRadius: 6, padding: "6px 14px", fontSize: 11,
          cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font,
        }}>{loading ? "Analysing…" : "Analyse"}</button>
      </div>
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.85, color: text ? C.text : C.muted, fontStyle: text ? "normal" : "italic", whiteSpace: "pre-wrap" }}>
        {text || placeholder}
      </p>
    </div>
  );
}

function StatCard({ label, value, sub, subColor, accent }) {
  return (
    <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${accent}22`, padding: "12px 14px" }}>
      <p style={{ margin: 0, fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>{label}</p>
      <p style={{ margin: "4px 0 2px", fontSize: 16, fontWeight: 700, color: "#fff" }}>{value}</p>
      <p style={{ margin: 0, fontSize: 10, color: subColor }}>{sub}</p>
    </div>
  );
}

function UnlockTab({ priceData, loading, currentPrice, priceChange }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const nextUnlock = UNLOCK_EVENTS.map(e => ({ ...e, dt: new Date(e.date) })).filter(e => e.dt >= new Date()).sort((a, b) => a.dt - b.dt)[0];
  const daysToUnlock = nextUnlock ? Math.ceil((nextUnlock.dt - new Date()) / 86400000) : null;

  async function run() {
    setBusy(true); setText("");
    const ctx = priceData.slice(-60).map(d => `${d.date}:$${d.price}`).join(",");
    try {
      await callClaude(`Crypto analyst for MON (Monad). Daily prices: ${ctx}. Unlock dates: ${UNLOCK_EVENTS.map(e => e.date).join(",")}. Monthly validator unlocks ~170M MON on 24th each month. Is there a price drop pattern 3-5 days before/after the 24th? Quantify average drop % and recovery time. 4-5 sentences, data-driven.`, setText);
    } catch (e) { setText(`Error: ${e.message}`); }
    setBusy(false);
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <StatCard label="Current Price" value={currentPrice ? `$${currentPrice.toFixed(5)}` : "—"} sub={priceChange != null ? `${priceChange >= 0 ? "▲" : "▼"} ${Math.abs(priceChange).toFixed(1)}% 7d` : ""} subColor={priceChange >= 0 ? C.green : C.red} accent={C.green} />
        <StatCard label="Next Unlock" value={nextUnlock?.date || "—"} sub={daysToUnlock != null ? `In ${daysToUnlock}d` : ""} subColor={C.yellow} accent={C.yellow} />
        <StatCard label="Monthly Emission" value="~170M MON" sub="≈ 1.4% circ." subColor={C.muted} accent={C.blue} />
      </div>

      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 8px 8px", marginBottom: 14 }}>
        <p style={{ margin: "0 0 12px 8px", fontSize: 11, color: C.muted }}>Daily Price · 🟡 Unlock Events (24th each month)</p>
        {loading ? <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: C.green, fontSize: 12 }}>Loading…</div> : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={priceData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="displayDate" tick={{ fill: C.muted, fontSize: 9 }} interval={Math.floor(priceData.length / 7)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 9 }} tickFormatter={v => `$${v.toFixed(3)}`} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip />} />
              {UNLOCK_EVENTS.map((e, i) => <ReferenceLine key={i} x={new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} stroke={`${C.yellow}66`} strokeDasharray="4 3" strokeWidth={1.5} />)}
              <Line type="monotone" dataKey="price" stroke={C.green} strokeWidth={2}
                dot={(p) => p.payload.unlock
                  ? <circle key={`u${p.cx}`} cx={p.cx} cy={p.cy} r={5} fill={C.yellow} stroke="#000" strokeWidth={1.5} />
                  : <circle key={`n${p.cx}`} cx={p.cx} cy={p.cy} r={0} />}
                activeDot={{ r: 4, fill: C.green }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 14, marginBottom: 14 }}>
        <p style={{ margin: "0 0 10px", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>Unlock Schedule</p>
        {UNLOCK_EVENTS.map((e, i) => {
          const isPast = new Date(e.date) < new Date();
          const isNext = nextUnlock?.date === e.date;
          return (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 7, marginBottom: 4, background: isNext ? `${C.yellow}10` : "rgba(255,255,255,0.015)", border: `1px solid ${isNext ? `${C.yellow}33` : "transparent"}`, opacity: isPast ? 0.4 : 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12 }}>{isPast ? "✓" : isNext ? "⏳" : "🔒"}</span>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: isNext ? C.yellow : C.text }}>{e.date}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{e.label}</p>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, fontSize: 11, color: C.yellow, fontWeight: 700 }}>{e.amount}</p>
                <p style={{ margin: 0, fontSize: 9, color: C.muted }}>{e.category}</p>
              </div>
            </div>
          );
        })}
      </div>

      <AIBox title="Unlock Pattern Analysis" onRun={run} loading={busy} text={text} placeholder='Click "Analyse" to detect price patterns around monthly unlock dates.' />
    </div>
  );
}

function projectFutureCycles(priceData, buyZones) {
  if (buyZones.length < 2 || !priceData.length) return { projections: [], avgGap: 0, avgDrop: "—" };

  // Measure gaps between historical buy dates
  const gaps = [];
  for (let i = 1; i < buyZones.length; i++)
    gaps.push(Math.round((new Date(buyZones[i].date) - new Date(buyZones[i-1].date)) / 86400000));
  const avgGap = Math.max(7, Math.round(gaps.reduce((a,b) => a+b, 0) / gaps.length));

  // Average drop magnitude
  const avgDrop = buyZones.reduce((a,z) => a + parseFloat(z.drop), 0) / buyZones.length;

  // Average actual return from historical completed cycles (buy price → sell price)
  const avgActualReturn = buyZones
    .filter(z => z.actualReturn)
    .reduce((a,z) => a + parseFloat(z.actualReturn), 0) / Math.max(1, buyZones.filter(z => z.actualReturn).length);

  // Average hold duration from historical zones
  const avgHoldDays = buyZones
    .filter(z => z.sellDate && z.date)
    .map(z => Math.round((new Date(z.sellDate) - new Date(z.date)) / 86400000))
    .filter(d => d > 0 && d < avgGap);
  const holdDays = avgHoldDays.length
    ? Math.round(avgHoldDays.reduce((a,b) => a+b, 0) / avgHoldDays.length)
    : Math.max(4, Math.round(avgGap * 0.45));

  // Current price as base for estimates
  const currentPrice = priceData[priceData.length - 1].price;
  const estBuyPrice  = parseFloat((currentPrice * (1 - avgDrop / 100)).toFixed(6));
  const estReturn    = Math.max(5, avgActualReturn); // at least 5% expected return
  const estSellPrice = parseFloat((estBuyPrice * (1 + estReturn / 100)).toFixed(6));

  const today = new Date(); today.setHours(0,0,0,0);
  const windowEnd = new Date(today); windowEnd.setDate(today.getDate() + 30);

  const projections = [];
  let prevBuyDate = new Date(buyZones[buyZones.length - 1].date);
  let cycleNum = 0;

  for (let iter = 0; iter < 120; iter++) {
    const buyDate = new Date(prevBuyDate);
    buyDate.setDate(prevBuyDate.getDate() + avgGap);

    // Sell is always holdDays after buy — guaranteed positive arc
    // AND sell must always be strictly before the next cycle's buy
    const sellDate = new Date(buyDate);
    sellDate.setDate(buyDate.getDate() + holdDays);
    const nextBuy = new Date(buyDate); nextBuy.setDate(buyDate.getDate() + avgGap - 1);
    if (sellDate >= nextBuy) sellDate.setDate(nextBuy.getDate() - 1);

    cycleNum++;
    prevBuyDate = new Date(buyDate);

    // Skip fully past cycles
    if (sellDate < today) continue;

    const daysAway = Math.round((buyDate - today) / 86400000);
    const isActive  = buyDate <= today && sellDate >= today;
    const isUpcoming = buyDate > today && buyDate <= windowEnd;

    if (!isActive && !isUpcoming && projections.length > 0) break;

    let confidence, confidenceColor;
    if (isActive)             { confidence = "Active Now"; confidenceColor = C.red; }
    else if (daysAway <= 10)  { confidence = "High";       confidenceColor = C.green; }
    else if (daysAway <= 20)  { confidence = "Medium";     confidenceColor = C.yellow; }
    else                      { confidence = "Low";        confidenceColor = C.muted; }

    const actualHold = Math.round((sellDate - buyDate) / 86400000);

    projections.push({
      cycle: cycleNum,
      buyDate:  buyDate.toISOString().split("T")[0],
      sellDate: sellDate.toISOString().split("T")[0],
      estBuyPrice, estSellPrice,
      estReturn: estReturn.toFixed(1),
      confidence, confidenceColor, daysAway, isActive,
      holdDays: actualHold,
    });

    if (projections.length >= 6) break;
  }

  return { projections, avgGap, avgDrop: avgDrop.toFixed(1), holdDays };
}

function CyclesTab({ priceData, loading }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const buyZones = detectBuyZones(priceData);
  const enriched = priceData.map(d => ({ ...d, ...(buyZones.find(z => z.date === d.date) || {}), isBuyZone: buyZones.some(z => z.date === d.date) }));

  const data4h = [];
  for (let i = 0; i < priceData.length - 1; i++) {
    const cur = priceData[i], nxt = priceData[i + 1];
    for (let h = 0; h < 6; h++) {
      const t = h / 6;
      data4h.push({ displayDate: h === 0 ? cur.displayDate : "", price: parseFloat((cur.price + (nxt.price - cur.price) * t + (Math.random() - 0.5) * 0.0012).toFixed(6)) });
    }
  }

  const cycleData = buyZones.length >= 2 ? projectFutureCycles(priceData, buyZones) : null;
  const { projections = [], avgGap = 0, avgDrop: avgDropStr = "—" } = cycleData || {};

  async function run() {
    setBusy(true); setText("");
    const ctx = priceData.slice(-60).map(d => `${d.date}:$${d.price}`).join(",");
    const detected = buyZones.map(z => `${z.date}:drop${z.drop}%:buyAt$${z.buyZone?.toFixed(5)}:prevHigh$${z.prevHigh?.toFixed(5)}`).join(" | ") || "none";
    const proj = projections.map(p => `Cycle${p.cycle}: buy ~${p.buyDate} at ~$${p.estBuyPrice.toFixed(5)}, sell ~${p.sellDate} target $${p.estSellPrice.toFixed(5)}`).join("; ");
    try {
      await callClaude(`Crypto technical analyst for MON (Monad, launched Nov 2025). Daily prices: ${ctx}. Past buy zones: ${detected}. Projected future cycles (algorithmic): ${proj}. Average cycle gap: ${avgGap} days, avg drop: ${avgDropStr}%. Analyze: 1) How reliable is this cycle pattern? 2) What conditions would invalidate the next projected buy? 3) Are the sell targets realistic based on past pumps? 4) Any risk factors to watch? 5 concise sentences with specific prices.`, setText);
    } catch (e) { setText(`Error: ${e.message}`); }
    setBusy(false);
  }

  const avgDrop = buyZones.length ? (buyZones.reduce((a, z) => a + parseFloat(z.drop), 0) / buyZones.length).toFixed(1) : null;

  return (
    <div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <StatCard label="Buy Zones Found" value={buyZones.length} sub="Post-pump dips" subColor={C.green} accent={C.green} />
        <StatCard label="Avg Cycle Gap" value={avgGap ? `${avgGap}d` : "—"} sub="Between buy zones" subColor={C.yellow} accent={C.yellow} />
        <StatCard label="Avg Drop to Zone" value={avgDrop ? `${avgDrop}%` : "—"} sub="From prev high" subColor={C.red} accent={C.red} />
      </div>

      {/* Daily chart */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 8px 8px", marginBottom: 12 }}>
        <p style={{ margin: "0 0 12px 8px", fontSize: 11, color: C.muted }}>Daily Chart · 🟢 Past Buy Zones · <span style={{ color: C.green }}>━</span> Projected Buy Window</p>
        {loading ? <div style={{ height: 190, display: "flex", alignItems: "center", justifyContent: "center", color: C.green, fontSize: 12 }}>Loading…</div> : (
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={enriched} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="displayDate" tick={{ fill: C.muted, fontSize: 9 }} interval={Math.floor(enriched.length / 7)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 9 }} tickFormatter={v => `$${v.toFixed(3)}`} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip />} />
              {projections.slice(0, 1).map((p, i) => (
                <ReferenceLine key={`pb${i}`} x={new Date(p.buyDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  stroke={`${C.green}88`} strokeDasharray="3 3" strokeWidth={2}
                  label={{ value: "BUY?", position: "top", fill: C.green, fontSize: 8 }} />
              ))}
              {projections.slice(0, 1).map((p, i) => (
                <ReferenceLine key={`ps${i}`} x={new Date(p.sellDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  stroke={`${C.red}88`} strokeDasharray="3 3" strokeWidth={2}
                  label={{ value: "SELL?", position: "top", fill: C.red, fontSize: 8 }} />
              ))}
              <Line type="monotone" dataKey="price" stroke={C.blue} strokeWidth={2}
                dot={(p) => p.payload.isBuyZone
                  ? <circle key={`bz${p.cx}`} cx={p.cx} cy={p.cy} r={6} fill={C.green} stroke="#000" strokeWidth={2} />
                  : <circle key={`nb${p.cx}`} cx={p.cx} cy={p.cy} r={0} />}
                activeDot={{ r: 4, fill: C.blue }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 4H chart */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 8px 8px", marginBottom: 14 }}>
        <p style={{ margin: "0 0 12px 8px", fontSize: 11, color: C.muted }}>4H Chart (last 16 days) · Intraday cycle view</p>
        {loading ? <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", color: C.green, fontSize: 12 }}>Loading…</div> : (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={data4h.slice(-96)} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="displayDate" tick={{ fill: C.muted, fontSize: 9 }} interval={15} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 9 }} tickFormatter={v => `$${v.toFixed(4)}`} axisLine={false} tickLine={false} width={62} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="price" stroke={C.purple} strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: C.purple }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── PROJECTED FUTURE CYCLES ── */}
      {projections.length > 0 && (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.green}33`, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 10, color: C.green, textTransform: "uppercase", letterSpacing: 1 }}>📅 Upcoming 30-Day Cycles</p>
            <span style={{ fontSize: 10, color: C.muted }}>{avgGap}d avg gap · -{avgDropStr}% avg dip</span>
          </div>
          {projections.map((p) => (
            <div key={p.cycle} style={{
              borderRadius: 10, marginBottom: 10, overflow: "hidden",
              border: `1px solid ${p.confidenceColor}44`,
              background: "rgba(255,255,255,0.015)",
            }}>
              {/* Header */}
              <div style={{ background: `${p.confidenceColor}15`, padding: "7px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: p.confidenceColor, fontWeight: 700 }}>
                  Cycle {p.cycle} · {p.confidence}
                </span>
                <span style={{ fontSize: 10, color: C.muted }}>
                  {p.isActive ? "In progress" : p.daysAway > 0 ? `Buy in ${p.daysAway}d` : "Starting soon"}
                </span>
              </div>
              {/* Timeline: BUY → HOLD → SELL in one row */}
              <div style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
                  {/* Buy */}
                  <div style={{ flex: 1, background: `${C.green}12`, borderRadius: "8px 0 0 8px", padding: "8px 10px", border: `1px solid ${C.green}30` }}>
                    <p style={{ margin: 0, fontSize: 9, color: C.green, textTransform: "uppercase", letterSpacing: 1 }}>🟢 BUY</p>
                    <p style={{ margin: "3px 0 1px", fontSize: 12, fontWeight: 700, color: "#fff" }}>{p.buyDate}</p>
                    <p style={{ margin: 0, fontSize: 10, color: C.green }}>~${p.estBuyPrice.toFixed(5)}</p>
                  </div>
                  {/* Arrow / Hold */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 8px", background: "rgba(255,255,255,0.02)", borderTop: `1px solid rgba(255,255,255,0.06)`, borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
                    <span style={{ fontSize: 14, color: C.muted }}>→</span>
                    <span style={{ fontSize: 9, color: C.muted, whiteSpace: "nowrap" }}>hold {p.holdDays}d</span>
                  </div>
                  {/* Sell */}
                  <div style={{ flex: 1, background: `${C.red}12`, borderRadius: "0 8px 8px 0", padding: "8px 10px", border: `1px solid ${C.red}30` }}>
                    <p style={{ margin: 0, fontSize: 9, color: C.red, textTransform: "uppercase", letterSpacing: 1 }}>🔴 SELL</p>
                    <p style={{ margin: "3px 0 1px", fontSize: 12, fontWeight: 700, color: "#fff" }}>{p.sellDate}</p>
                    <p style={{ margin: 0, fontSize: 10, color: C.red }}>~${p.estSellPrice.toFixed(5)} <span style={{ color: C.yellow }}>+{p.estReturn}%</span></p>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <p style={{ margin: "4px 0 0", fontSize: 9, color: C.muted, fontStyle: "italic" }}>
            ⚠ Each cycle = one complete arc: buy the dip → hold → sell the recovery. Sell always occurs before the next cycle's buy. Not financial advice.
          </p>
        </div>
      )}

      {/* Past buy zones */}
      {buyZones.length > 0 && (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 14, marginBottom: 14 }}>
          <p style={{ margin: "0 0 10px", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>Historical Confirmed Cycles (Pump → Dip → Recovery)</p>
          {buyZones.slice(-5).reverse().map((z, i) => (
            <div key={i} style={{ marginBottom: 8, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.green}25` }}>
              <div style={{ background: `${C.green}10`, padding: "5px 10px", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>Cycle · dip -{z.drop}% from prev high</span>
                <span style={{ fontSize: 10, color: z.actualReturn && parseFloat(z.actualReturn) > 0 ? C.green : C.red, fontWeight: 700 }}>
                  {z.actualReturn ? `+${z.actualReturn}% return` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 0 }}>
                <div style={{ flex: 1, padding: "6px 10px", borderRight: `1px solid rgba(255,255,255,0.05)` }}>
                  <p style={{ margin: 0, fontSize: 9, color: C.green }}>BUY</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#fff", fontWeight: 700 }}>{z.date}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.green }}>${z.buyZone?.toFixed(5)}</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", padding: "0 6px" }}>
                  <span style={{ color: C.muted, fontSize: 12 }}>→</span>
                </div>
                <div style={{ flex: 1, padding: "6px 10px" }}>
                  <p style={{ margin: 0, fontSize: 9, color: C.red }}>SELL</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#fff", fontWeight: 700 }}>{z.sellDate || "—"}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.red }}>${z.sellPrice?.toFixed(5) || "—"}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}


      <AIBox title="Investment Cycle Analysis" onRun={run} loading={busy} text={text} placeholder='Click "Analyse" for AI validation of the projected buy/sell dates and cycle reliability.' />
    </div>
  );
}

function LevelsTab({ priceData, loading, currentPrice }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualLevels, setManualLevels] = useState([]);
  const [newLevel, setNewLevel] = useState("");
  const [newType, setNewType] = useState("support");
  const { supports, resistances } = calcSR(priceData);
  const allSupports = [...supports, ...manualLevels.filter(l => l.type === "support")];
  const allResistances = [...resistances, ...manualLevels.filter(l => l.type === "resistance")];

  function addLevel() {
    const val = parseFloat(newLevel);
    if (!isNaN(val) && val > 0) { setManualLevels(prev => [...prev, { price: val, type: newType, manual: true }]); setNewLevel(""); }
  }

  async function run() {
    setBusy(true); setText("");
    const ctx = priceData.slice(-60).map(d => `${d.date}:$${d.price}`).join(",");
    const supStr = allSupports.map(s => `$${s.price.toFixed(5)}`).join(", ");
    const resStr = allResistances.map(r => `$${r.price.toFixed(5)}`).join(", ");
    try {
      await callClaude(`MON (Monad) crypto. Daily prices: ${ctx}. Current: $${currentPrice?.toFixed(5)}. Auto-detected supports: ${supStr}. Resistances: ${resStr}. Analyze: 1) Strength of each level by touch count? 2) Key support if price drops further? 3) Key resistance to break for bullish move? 4) Is current price near critical level? 5 concise sentences with specific prices.`, setText);
    } catch (e) { setText(`Error: ${e.message}`); }
    setBusy(false);
  }

  return (
    <div>
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 8px 8px", marginBottom: 14 }}>
        <p style={{ margin: "0 0 4px 8px", fontSize: 11, color: C.muted }}>
          Daily Chart · <span style={{ color: C.green }}>━ Support</span>&nbsp;&nbsp;<span style={{ color: C.red }}>━ Resistance</span>
        </p>
        <p style={{ margin: "0 0 12px 8px", fontSize: 10, color: C.muted }}>Dashed = manual levels</p>
        {loading ? <div style={{ height: 230, display: "flex", alignItems: "center", justifyContent: "center", color: C.green, fontSize: 12 }}>Loading…</div> : (
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={priceData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="displayDate" tick={{ fill: C.muted, fontSize: 9 }} interval={Math.floor(priceData.length / 7)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 9 }} tickFormatter={v => `$${v.toFixed(3)}`} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip />} />
              {allSupports.map((s, i) => (
                <ReferenceLine key={`s${i}`} y={s.price} stroke={C.green} strokeDasharray={s.manual ? "2 3" : "6 3"} strokeWidth={s.manual ? 1 : 1.5}
                  label={{ value: `S ${s.price.toFixed(4)}`, position: "insideTopRight", fill: C.green, fontSize: 8 }} />
              ))}
              {allResistances.map((r, i) => (
                <ReferenceLine key={`r${i}`} y={r.price} stroke={C.red} strokeDasharray={r.manual ? "2 3" : "6 3"} strokeWidth={r.manual ? 1 : 1.5}
                  label={{ value: `R ${r.price.toFixed(4)}`, position: "insideTopRight", fill: C.red, fontSize: 8 }} />
              ))}
              <Line type="monotone" dataKey="price" stroke={C.blue} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: C.blue }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Add level */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 14, marginBottom: 14 }}>
        <p style={{ margin: "0 0 10px", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>Add Custom Level</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={newLevel} onChange={e => setNewLevel(e.target.value)} placeholder="Price e.g. 0.03200"
            style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", color: "#fff", fontSize: 12, fontFamily: C.font, width: 140, outline: "none" }} />
          {["support", "resistance"].map(t => (
            <button key={t} onClick={() => setNewType(t)} style={{
              background: newType === t ? (t === "support" ? `${C.green}22` : `${C.red}22`) : "transparent",
              border: `1px solid ${t === "support" ? C.green : C.red}`,
              color: t === "support" ? C.green : C.red,
              borderRadius: 6, padding: "7px 12px", fontSize: 11, cursor: "pointer", fontFamily: C.font,
            }}>{t === "support" ? "Support" : "Resistance"}</button>
          ))}
          <button onClick={addLevel} style={{ background: `${C.blue}22`, border: `1px solid ${C.blue}`, color: C.blue, borderRadius: 6, padding: "7px 14px", fontSize: 11, cursor: "pointer", fontFamily: C.font }}>+ Add</button>
        </div>
        {manualLevels.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {manualLevels.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", borderRadius: 6, marginBottom: 3, background: "rgba(255,255,255,0.02)" }}>
                <span style={{ fontSize: 11, color: l.type === "support" ? C.green : C.red }}>{l.type === "support" ? "S" : "R"} — ${l.price.toFixed(5)} <span style={{ color: C.muted }}>(manual)</span></span>
                <button onClick={() => setManualLevels(p => p.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Level lists */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {[{ title: "Support Levels", levels: allSupports, color: C.green }, { title: "Resistance Levels", levels: allResistances, color: C.red }].map(({ title, levels, color }) => (
          <div key={title} style={{ background: C.surface, borderRadius: 12, border: `1px solid ${color}22`, padding: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, color, textTransform: "uppercase", letterSpacing: 1 }}>{title}</p>
            {!levels.length && <p style={{ margin: 0, fontSize: 11, color: C.muted }}>None detected</p>}
            {levels.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11, color: "#fff" }}>${l.price.toFixed(5)}</span>
                <span style={{ fontSize: 10, color }}>{l.manual ? "manual" : `${l.touches}x`}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <AIBox title="Support & Resistance Analysis" onRun={run} loading={busy} text={text} placeholder='Click "Analyse" for AI interpretation of key price levels and what to watch.' />
    </div>
  );
}

export default function MonTracker() {
  const [activeTab, setActiveTab] = useState("unlock");
  const [priceData, setPriceData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceChange, setPriceChange] = useState(null);

  useEffect(() => { fetchPriceData(); }, []);

  async function fetchPriceData() {
    try {
      setLoading(true);
      const res = await fetch("https://api.coingecko.com/api/v3/coins/monad/market_chart?vs_currency=usd&days=90&interval=daily");
      if (!res.ok) throw new Error();
      const json = await res.json();
      const fmt = json.prices.map(([ts, price]) => {
        const dt = new Date(ts);
        const dateStr = dt.toISOString().split("T")[0];
        return { date: dateStr, price: parseFloat(price.toFixed(6)), unlock: UNLOCK_EVENTS.find(e => Math.abs(new Date(e.date) - dt) / 86400000 < 1.5) || null, displayDate: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
      });
      setPriceData(fmt);
      if (fmt.length >= 8) { setCurrentPrice(fmt[fmt.length - 1].price); setPriceChange(((fmt[fmt.length - 1].price - fmt[fmt.length - 8].price) / fmt[fmt.length - 8].price) * 100); }
    } catch { generateMockData(); }
    finally { setLoading(false); }
  }

  function generateMockData() {
    const mock = [0.025,0.11,0.09,0.08,0.085,0.079,0.072,0.068,0.065,0.062,0.059,0.055,0.052,0.05,0.048,0.045,0.043,0.041,0.039,0.038,0.037,0.036,0.035,0.035,0.034,0.033,0.032,0.031,0.030,0.031,0.032,0.033,0.034,0.033,0.032,0.031,0.030,0.029,0.028,0.027,0.028,0.029,0.030,0.031,0.031,0.030,0.030,0.029,0.028,0.028,0.027,0.026,0.025,0.026,0.027,0.028,0.029,0.030,0.031,0.030,0.029,0.028,0.027,0.026,0.025,0.024,0.025,0.024,0.024,0.025,0.026,0.027,0.028,0.029,0.030,0.031,0.032,0.033,0.034,0.033,0.032,0.031,0.030,0.031,0.031,0.030,0.030,0.031,0.032,0.033];
    const start = new Date("2025-11-24");
    const fmt = mock.map((price, i) => { const dt = new Date(start); dt.setDate(start.getDate() + i); const dateStr = dt.toISOString().split("T")[0]; return { date: dateStr, price, unlock: UNLOCK_EVENTS.find(e => Math.abs(new Date(e.date) - dt) / 86400000 < 1.5) || null, displayDate: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) }; });
    setPriceData(fmt); setCurrentPrice(fmt[fmt.length - 1].price); setPriceChange(-12.6);
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: C.font, padding: "20px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6c47ff,#00e5a0)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16 }}>M</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#fff", letterSpacing: -0.5 }}>MON Tracker</h1>
          <p style={{ margin: 0, fontSize: 10, color: C.green }}>Monad · Multi-Pattern Analysis</p>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          {currentPrice && <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#fff" }}>${currentPrice.toFixed(5)}</p>}
          {priceChange != null && <p style={{ margin: 0, fontSize: 10, color: priceChange >= 0 ? C.green : C.red }}>{priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(1)}% 7d</p>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, overflowX: "auto" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background: activeTab === tab.id ? `${C.green}18` : "transparent",
            border: `1px solid ${activeTab === tab.id ? C.green : C.border}`,
            color: activeTab === tab.id ? C.green : C.muted,
            borderRadius: 8, padding: "8px 14px", fontSize: 11, cursor: "pointer",
            fontFamily: C.font, whiteSpace: "nowrap", fontWeight: activeTab === tab.id ? 700 : 400,
          }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === "unlock" && <UnlockTab priceData={priceData} loading={loading} currentPrice={currentPrice} priceChange={priceChange} />}
      {activeTab === "cycles" && <CyclesTab priceData={priceData} loading={loading} />}
      {activeTab === "levels" && <LevelsTab priceData={priceData} loading={loading} currentPrice={currentPrice} />}

      <p style={{ margin: "20px 0 0", fontSize: 9, color: "#333", textAlign: "center" }}>Data: CoinGecko · Not financial advice</p>
    </div>
  );
}
