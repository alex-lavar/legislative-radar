import { useState, useEffect } from "react";
import billsDataStatic from "../data/bills.json";

// ─── ACCURACY ENGINE ──────────────────────────────────────────────────────────

function computeAccuracy(pastBills) {
  const billResults = pastBills.map((b) => {
    const predictedPass = b.predictedOutcome === "PASS";
    const actualPass = b.status === "PASSED";
    const correct = predictedPass === actualPass;
    const outcome = actualPass ? 1 : 0;
    const prob = b.predictedLikelihood / 100;
    const brier = Math.pow(prob - outcome, 2);
    return { id: b.id, title: b.title, correct, predictedLikelihood: b.predictedLikelihood, actualPass, brier };
  });

  const billCorrect = billResults.filter((r) => r.correct).length;
  const billTotal = billResults.length;
  const billAccPct = billTotal > 0 ? Math.round((billCorrect / billTotal) * 100) : 0;
  const avgBrier = billTotal > 0 ? billResults.reduce((s, r) => s + r.brier, 0) / billTotal : 0.25;
  const calibrationScore = Math.round((1 - avgBrier) * 100);

  const stockResults = [];
  pastBills.forEach((bill) => {
    (bill.stocks || []).forEach((s) => {
      if (!s.projectedDir || !s.actualDir) return;
      const dirCorrect = s.projectedDir === s.actualDir;
      const magExpected = s.projectedMag === "Strong" ? "Strong" : "Slight";
      const magActual = Math.abs(s.actualPct) > 1.5 ? "Strong" : Math.abs(s.actualPct) > 0.1 ? "Slight" : "Flat";
      const magCorrect = magExpected === magActual || (magExpected === "Slight" && magActual !== "Flat");
      stockResults.push({ ticker: s.ticker, name: s.name, bill: bill.id, projectedDir: s.projectedDir, actualDir: s.actualDir, projectedMag: s.projectedMag, actualPct: s.actualPct, dirCorrect, magCorrect });
    });
  });

  const stockDirCorrect = stockResults.filter((r) => r.dirCorrect).length;
  const stockTotal = stockResults.length;
  const stockDirPct = stockTotal > 0 ? Math.round((stockDirCorrect / stockTotal) * 100) : 0;
  const stockMagCorrect = stockResults.filter((r) => r.magCorrect).length;
  const stockMagPct = stockTotal > 0 ? Math.round((stockMagCorrect / stockTotal) * 100) : 0;

  return { billResults, billCorrect, billTotal, billAccPct, calibrationScore, avgBrier, stockResults, stockDirCorrect, stockTotal, stockDirPct, stockMagCorrect, stockMagPct };
}

// ─── THEME ────────────────────────────────────────────────────────────────────

const CAT_COLORS = {
  "Telecom / Infrastructure": "#3b82f6",
  "Environment / Land Use": "#22c55e",
  "Environment / Mining": "#10b981",
  "National Security / Tech": "#6366f1",
  "Appropriations / Immigration": "#f59e0b",
  "Public Safety / Telecom": "#f97316",
  "Healthcare / Technology": "#ec4899",
  "Energy / Resources": "#84cc16",
  "Finance / Banking": "#06b6d4",
  "Defense": "#8b5cf6",
  "Other": "#94a3b8",
};

const statusMeta = {
  PASSED: { bg: "#052e16", border: "#22c55e", text: "#4ade80", label: "✓ PASSED" },
  FAILED: { bg: "#2d0a0a", border: "#ef4444", text: "#f87171", label: "✗ FAILED" },
  "FLOOR THIS WEEK": { bg: "#0c1a3d", border: "#6366f1", text: "#a5b4fc", label: "⬥ THIS WEEK" },
  "IMMINENT — Expires Apr 30": { bg: "#2d1b00", border: "#f59e0b", text: "#fbbf24", label: "⚠ EXPIRES SOON" },
  "Upcoming": { bg: "#0c1a3d", border: "#6366f1", text: "#a5b4fc", label: "◌ UPCOMING" },
};

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────

const CatTag = ({ cat }) => {
  const c = CAT_COLORS[cat] || "#94a3b8";
  return <span style={{ fontSize: 10, background: c + "18", color: c, padding: "2px 7px", borderRadius: 10, fontFamily: "monospace" }}>{cat}</span>;
};

const StatusBadge = ({ status }) => {
  const m = statusMeta[status] || statusMeta["Upcoming"];
  return <span style={{ fontSize: 10, background: m.bg, color: m.text, border: `1px solid ${m.border}`, padding: "2px 8px", borderRadius: 10, fontFamily: "monospace", whiteSpace: "nowrap" }}>{m.label}</span>;
};

const MeterBar = ({ value, color, height = 6 }) => (
  <div style={{ height, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
    <div style={{ height: "100%", width: `${Math.min(value, 100)}%`, background: color, borderRadius: 4, transition: "width 0.6s ease" }} />
  </div>
);

const Section = ({ label, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 10, color: "#334155", fontFamily: "monospace", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8, borderBottom: "1px solid #0f172a", paddingBottom: 4 }}>{label}</div>
    {children}
  </div>
);

const Disclaimer = () => (
  <div style={{ fontSize: 10, color: "#1e293b", marginTop: 10, padding: "6px 10px", background: "#0a0f1e", borderRadius: 5, border: "1px solid #0f172a" }}>
    ⚠ Not financial advice. Stock impacts are analytical. Consult a financial advisor.
  </div>
);

function ScoreRing({ pct, size = 64, stroke = 6, color }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.8s ease" }} />
    </svg>
  );
}

function ScoreTile({ label, value, subLabel, color }) {
  return (
    <div style={{ background: "#0c1220", border: `1px solid ${color}22`, borderRadius: 10, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center", flex: "1 1 160px", minWidth: 140 }}>
      <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
        <ScoreRing pct={value} size={64} color={color} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "monospace" }}>{value}%</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0", marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 10, color: "#475569", lineHeight: 1.5 }}>{subLabel}</div>
      </div>
    </div>
  );
}

// ─── VOTE DISPLAY ─────────────────────────────────────────────────────────────

function VoteDisplay({ actualVote }) {
  if (!actualVote) return null;
  const { yea, nay, notVoting, result } = actualVote;
  if (typeof yea === "string") {
    return (
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", marginBottom: 4 }}>ACTUAL VOTE</div>
        <div style={{ fontSize: 13, color: "#4ade80", fontWeight: 600 }}>{yea}</div>
      </div>
    );
  }
  const total = yea + nay + (notVoting || 0);
  const yeaPct = Math.round((yea / total) * 100);
  const nayPct = Math.round((nay / total) * 100);
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", marginBottom: 8 }}>ACTUAL VOTE BREAKDOWN</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#4ade80", fontFamily: "monospace" }}>{yea}</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>YEA ({yeaPct}%)</div>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#f87171", fontFamily: "monospace" }}>{nay}</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>NAY ({nayPct}%)</div>
        </div>
        {notVoting ? <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#64748b", fontFamily: "monospace" }}>{notVoting}</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>ABSENT</div>
        </div> : null}
      </div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
        <div style={{ flex: yea, background: "#22c55e" }} />
        <div style={{ flex: nay, background: "#ef4444" }} />
        {notVoting ? <div style={{ flex: notVoting, background: "#334155" }} /> : null}
      </div>
    </div>
  );
}

// ─── DETAIL PANELS ────────────────────────────────────────────────────────────

function PastDetail({ bill, onClose }) {
  const pct = bill.predictedLikelihood;
  const predColor = pct >= 70 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ padding: "20px 22px", overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: CAT_COLORS[bill.category] || "#6366f1", fontFamily: "monospace", letterSpacing: 1, marginBottom: 3 }}>{bill.category} · {bill.id} · {bill.voteDate}</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "#f8fafc", lineHeight: 1.35 }}>{bill.title}</h2>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>{bill.sponsor}</div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #1e293b", color: "#64748b", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 13, flexShrink: 0, marginLeft: 12 }}>✕</button>
      </div>
      <Section label="Bill Summary">
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>{bill.summary}</p>
      </Section>
      <Section label="Predicted vs. Actual Outcome">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 7, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", marginBottom: 6 }}>PREDICTED</div>
            <MeterBar value={pct} color={predColor} />
            <div style={{ fontSize: 20, fontWeight: 700, color: predColor, fontFamily: "monospace", marginTop: 4 }}>{pct}%</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{bill.predictedLabel}</div>
          </div>
          <div style={{ background: "#0f172a", border: `1px solid ${bill.status === "PASSED" ? "#22c55e" : "#ef4444"}44`, borderRadius: 7, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", marginBottom: 6 }}>RESULT</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: bill.status === "PASSED" ? "#4ade80" : "#f87171", fontFamily: "monospace" }}>{bill.status}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Voted {bill.voteDate}</div>
          </div>
        </div>
        <VoteDisplay actualVote={bill.actualVote} />
        {bill.voteNote && <div style={{ fontSize: 12, color: "#64748b", fontStyle: "italic", padding: "8px 10px", background: "#0f172a", borderRadius: 6, border: "1px solid #1e293b" }}>📌 {bill.voteNote}</div>}
      </Section>
      <Section label="Projected vs. Actual Stock Impact">
        {(bill.stocks || []).map((s) => {
          const actualColor = s.actualDir === "UP" ? "#22c55e" : s.actualDir === "DOWN" ? "#ef4444" : "#94a3b8";
          const projColor = s.projectedDir === "UP" ? "#22c55e" : s.projectedDir === "DOWN" ? "#ef4444" : "#94a3b8";
          const dirOk = s.projectedDir === s.actualDir;
          return (
            <div key={s.ticker} style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 7, padding: "10px 12px", marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 4 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>{s.ticker}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: projColor, background: projColor + "15", padding: "1px 6px", borderRadius: 4 }}>Proj: {s.projectedDir}</span>
                  <span style={{ fontSize: 10, color: actualColor, background: actualColor + "15", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>
                    Actual: {s.actualDir} {s.actualPct !== 0 ? `${s.actualPct > 0 ? "+" : ""}${Number(s.actualPct).toFixed(1)}%` : ""}
                  </span>
                  <span style={{ fontSize: 10, color: dirOk ? "#4ade80" : "#f87171", fontFamily: "monospace" }}>{dirOk ? "✓" : "✗"}</span>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}><span style={{ color: "#475569" }}>Thesis: </span>{s.projectedReason}</div>
              <div style={{ fontSize: 11, color: "#cbd5e1" }}><span style={{ color: "#475569" }}>Outcome: </span>{s.actualNote}</div>
            </div>
          );
        })}
        <Disclaimer />
      </Section>
    </div>
  );
}

function UpcomingDetail({ bill, onClose }) {
  const pct = bill.passLikelihood;
  const barColor = pct >= 75 ? "#22c55e" : pct >= 55 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ padding: "20px 22px", overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: CAT_COLORS[bill.category] || "#6366f1", fontFamily: "monospace", letterSpacing: 1, marginBottom: 3 }}>{bill.category} · {bill.id}</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "#f8fafc", lineHeight: 1.35 }}>{bill.title}</h2>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>{bill.sponsor} · {bill.committee} Committee · {bill.voteWeek}</div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #1e293b", color: "#64748b", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 13, flexShrink: 0, marginLeft: 12 }}>✕</button>
      </div>
      <Section label="Bill Summary">
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>{bill.summary}</p>
      </Section>
      <Section label="Pass Likelihood Analysis">
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 10, color: "#475569", fontFamily: "monospace" }}>ESTIMATED PASS LIKELIHOOD</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: barColor, fontFamily: "monospace" }}>{pct}%</span>
          </div>
          <MeterBar value={pct} color={barColor} height={8} />
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 5 }}>{bill.passLabel}</div>
          <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, marginTop: 10 }}>{bill.passReasoning}</div>
        </div>
      </Section>
      <Section label="Projected Stock Impact (If Passed)">
        {(bill.stocks || []).map((s) => {
          const isPos = s.impact?.startsWith("▲");
          const isNeg = s.impact?.startsWith("▼");
          const c = isPos ? "#22c55e" : isNeg ? "#ef4444" : "#f59e0b";
          return (
            <div key={s.ticker} style={{ background: "#0a0f1e", border: `1px solid ${c}22`, borderLeft: `3px solid ${c}`, borderRadius: 6, padding: "8px 12px", marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>{s.ticker}</span>
                <span style={{ fontSize: 11, color: c, fontWeight: 600 }}>{s.impact}</span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{s.reason}</div>
            </div>
          );
        })}
        <Disclaimer />
      </Section>
    </div>
  );
}

// ─── ACCURACY TAB ─────────────────────────────────────────────────────────────

function AccuracyTab({ acc, pastBills }) {
  const oc = (v) => v >= 75 ? "#22c55e" : v >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ padding: "22px", overflowY: "auto", maxHeight: "calc(100vh - 160px)" }}>
      <Section label="Overall Accuracy Scorecard">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          <ScoreTile label="Bill Pass Accuracy" value={acc.billAccPct} subLabel={`${acc.billCorrect} of ${acc.billTotal} correctly predicted`} color={oc(acc.billAccPct)} />
          <ScoreTile label="Calibration Score" value={acc.calibrationScore} subLabel="Brier-based: how close % was to reality" color={oc(acc.calibrationScore)} />
          <ScoreTile label="Stock Direction" value={acc.stockDirPct} subLabel={`${acc.stockDirCorrect} of ${acc.stockTotal} moved correctly`} color={oc(acc.stockDirPct)} />
          <ScoreTile label="Stock Magnitude" value={acc.stockMagPct} subLabel={`${acc.stockMagCorrect} of ${acc.stockTotal} in right size band`} color={oc(acc.stockMagPct)} />
        </div>
        {acc.billTotal < 5 && (
          <div style={{ fontSize: 11, color: "#475569", padding: "8px 10px", background: "#0a0f1e", borderRadius: 6, border: "1px solid #0f172a" }}>
            📊 Sample size is small ({acc.billTotal} bills). Accuracy scores will become more meaningful as more bills are tracked over time.
          </div>
        )}
      </Section>

      <Section label="Bill Prediction Breakdown">
        {acc.billResults.map((r) => {
          const errPct = Math.round(Math.abs(r.predictedLikelihood - (r.actualPass ? 100 : 0)));
          return (
            <div key={r.id} style={{ background: "#0c1220", border: `1px solid ${r.correct ? "#22c55e22" : "#f59e0b22"}`, borderLeft: `3px solid ${r.correct ? "#22c55e" : "#f59e0b"}`, borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#e2e8f0" }}>{r.title}</span>
                <span style={{ fontSize: 11, color: r.correct ? "#4ade80" : "#fbbf24", fontFamily: "monospace", background: r.correct ? "#052e16" : "#2d1b00", padding: "2px 8px", borderRadius: 6 }}>
                  {r.correct ? "✓ Correct" : "~ Missed"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                {[
                  ["Predicted", `${r.predictedLikelihood}% → ${r.predictedLikelihood >= 50 ? "PASS" : "FAIL"}`, null],
                  ["Actual", r.actualPass ? "PASSED" : "FAILED", r.actualPass ? "#4ade80" : "#f87171"],
                  ["Error from certainty", `${errPct}pp`, null],
                  ["Brier Score", r.brier.toFixed(3), r.brier < 0.2 ? "#4ade80" : r.brier < 0.4 ? "#fbbf24" : "#f87171"],
                ].map(([label, val, c]) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, color: "#334155", fontFamily: "monospace", marginBottom: 1 }}>{label}</div>
                    <div style={{ fontSize: 12, color: c || "#94a3b8", fontWeight: 500 }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      <Section label="Stock Projection Breakdown">
        {pastBills.map((bill) => (
          <div key={bill.id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#475569", fontFamily: "monospace", marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid #0f172a" }}>
              {bill.id} — {bill.title}
            </div>
            {(bill.stocks || []).filter(s => s.projectedDir).map((s) => {
              const res = acc.stockResults.find(r => r.ticker === s.ticker && r.bill === bill.id);
              if (!res) return null;
              const actualColor = s.actualDir === "UP" ? "#4ade80" : s.actualDir === "DOWN" ? "#f87171" : "#94a3b8";
              const projColor = s.projectedDir === "UP" ? "#4ade80" : s.projectedDir === "DOWN" ? "#f87171" : "#94a3b8";
              return (
                <div key={s.ticker} style={{ background: "#0a0f1e", border: `1px solid ${res.dirCorrect ? "#22c55e22" : "#ef444422"}`, borderLeft: `3px solid ${res.dirCorrect ? "#22c55e" : "#ef4444"}`, borderRadius: 6, padding: "8px 12px", marginBottom: 5, display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: "#f1f5f9", marginRight: 6 }}>{s.ticker}</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>{s.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {[
                      ["Proj", s.projectedDir, projColor],
                      ["Actual", s.actualDir, actualColor],
                      ["Move", `${s.actualPct > 0 ? "+" : ""}${Number(s.actualPct).toFixed(1)}%`, actualColor],
                    ].map(([lbl, val, c]) => (
                      <div key={lbl} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>{lbl}</div>
                        <div style={{ fontSize: 11, color: c, fontWeight: 600 }}>{val}</div>
                      </div>
                    ))}
                    <span style={{ fontSize: 10, color: res.dirCorrect ? "#4ade80" : "#f87171", fontFamily: "monospace", background: res.dirCorrect ? "#052e16" : "#2d0a0a", padding: "2px 6px", borderRadius: 4 }}>Dir: {res.dirCorrect ? "✓" : "✗"}</span>
                    <span style={{ fontSize: 10, color: res.magCorrect ? "#4ade80" : "#f59e0b", fontFamily: "monospace", background: res.magCorrect ? "#052e16" : "#2d1b00", padding: "2px 6px", borderRadius: 4 }}>Mag: {res.magCorrect ? "✓" : "~"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <Disclaimer />
      </Section>

      <Section label="Methodology">
        <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.8, padding: "10px 14px", background: "#0a0f1e", borderRadius: 8, border: "1px solid #0f172a" }}>
          <p style={{ margin: "0 0 8px" }}><strong style={{ color: "#64748b" }}>Bill accuracy</strong> is binary — did the predicted outcome (pass/fail) match the actual result? Calibration uses Brier Score (0 = perfect, 1 = maximally wrong; 0.25 = baseline for a 50/50 guess).</p>
          <p style={{ margin: "0 0 8px" }}><strong style={{ color: "#64748b" }}>Stock direction</strong> is correct if the projected move (UP/DOWN/FLAT) matches the 1-2 day post-vote price movement.</p>
          <p style={{ margin: 0 }}><strong style={{ color: "#64748b" }}>Stock magnitude</strong> bands: Slight = 0.1–1.5% move; Strong = &gt;1.5%. Data updated nightly via Congress.gov API + Yahoo Finance.</p>
        </div>
      </Section>
    </div>
  );
}

// ─── BILL LIST CARDS ──────────────────────────────────────────────────────────

function PastCard({ bill, isActive, onClick }) {
  const pct = bill.predictedLikelihood;
  const predColor = pct >= 70 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  const correct = (pct >= 50) === (bill.status === "PASSED");
  return (
    <div onClick={onClick} style={{ padding: "14px 18px", borderBottom: "1px solid #070d1a", cursor: "pointer", background: isActive ? "#0c1220" : "transparent", borderLeft: isActive ? "3px solid #22c55e" : "3px solid transparent", transition: "all 0.15s" }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#080e1a"; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
        <CatTag cat={bill.category} />
        <StatusBadge status={bill.status} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "#e2e8f0", marginBottom: 3, lineHeight: 1.4 }}>{bill.title}</div>
      <div style={{ fontSize: 10, color: "#475569", marginBottom: 7 }}>{bill.id} · {bill.voteDate}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1 }}><MeterBar value={pct} color={predColor} height={4} /></div>
        <span style={{ fontSize: 11, color: predColor, fontFamily: "monospace", minWidth: 30 }}>{pct}%</span>
        <span style={{ fontSize: 13, color: bill.status === "PASSED" ? "#22c55e" : "#ef4444", fontWeight: 700, fontFamily: "monospace" }}>→ {bill.status === "PASSED" ? "PASS" : "FAIL"}</span>
        <span style={{ fontSize: 10, color: correct ? "#4ade80" : "#f59e0b", fontFamily: "monospace" }}>{correct ? "✓" : "~"}</span>
      </div>
    </div>
  );
}

function UpcomingCard({ bill, isActive, onClick }) {
  const pct = bill.passLikelihood;
  const barColor = pct >= 75 ? "#22c55e" : pct >= 55 ? "#f59e0b" : "#ef4444";
  return (
    <div onClick={onClick} style={{ padding: "14px 18px", borderBottom: "1px solid #070d1a", cursor: "pointer", background: isActive ? "#0c1220" : "transparent", borderLeft: isActive ? "3px solid #6366f1" : "3px solid transparent", transition: "all 0.15s" }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#080e1a"; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
        <CatTag cat={bill.category} />
        <StatusBadge status={bill.status} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "#e2e8f0", marginBottom: 3, lineHeight: 1.4 }}>{bill.title}</div>
      <div style={{ fontSize: 10, color: "#475569", marginBottom: 7 }}>{bill.id} · {bill.voteWeek}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1 }}><MeterBar value={pct} color={barColor} height={4} /></div>
        <span style={{ fontSize: 11, color: barColor, fontFamily: "monospace", minWidth: 30 }}>{pct}%</span>
        <span style={{ fontSize: 10, color: "#334155" }}>· {(bill.stocks || []).length} stocks</span>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("upcoming");
  const [selectedId, setSelectedId] = useState(null);
  const [data, setData] = useState(billsDataStatic);

  // Try to load fresh data from the repo's data/bills.json at runtime
  useEffect(() => {
    // The base path is set in vite.config.js
    fetch(`${import.meta.env.BASE_URL}bills.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {}) // Fall back to static import silently
  }, [])

  const acc = computeAccuracy(data.pastBills || []);
  const oc = (v) => v >= 75 ? "#22c55e" : v >= 50 ? "#f59e0b" : "#ef4444";

  const bills = tab === "upcoming" ? (data.upcomingBills || []) : tab === "past" ? (data.pastBills || []) : [];
  const activeBill = selectedId ? bills.find((b) => b.id === selectedId) : null;
  const handleSelect = (id) => setSelectedId(selectedId === id ? null : id);
  const handleTab = (t) => { setTab(t); setSelectedId(null); };

  const lastUpdated = data.lastUpdated
    ? new Date(data.lastUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Unknown";

  return (
    <div style={{ minHeight: "100vh", background: "#020817", color: "#e2e8f0", fontFamily: "'IBM Plex Sans', sans-serif", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #060d1f 0%, #0e1440 100%)", borderBottom: "1px solid #0f172a", padding: "18px 24px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "#6366f1", fontFamily: "monospace", letterSpacing: 2, marginBottom: 3 }}>119TH CONGRESS · LIVE TRACKER</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: "#f8fafc", letterSpacing: -0.5 }}>Legislative Radar</h1>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Updated {lastUpdated} · Upcoming votes · Historical results · Accuracy tracking</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Bill Acc", val: acc.billAccPct },
              { label: "Calibration", val: acc.calibrationScore },
              { label: "Stock Dir", val: acc.stockDirPct },
              { label: "Stock Mag", val: acc.stockMagPct },
            ].map(({ label, val }) => (
              <div key={label} onClick={() => handleTab("accuracy")} style={{ background: "#0f172a", border: `1px solid ${oc(val)}33`, borderRadius: 7, padding: "5px 10px", cursor: "pointer", textAlign: "center", minWidth: 58 }}>
                <div style={{ fontSize: 9, color: "#475569", fontFamily: "monospace" }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: oc(val), fontFamily: "monospace" }}>{val}%</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex" }}>
          {[
            { key: "upcoming", label: "⬥ Upcoming" },
            { key: "past", label: "✓ Historical" },
            { key: "accuracy", label: "◎ Accuracy" },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => handleTab(key)} style={{ padding: "9px 16px", fontSize: 12, fontFamily: "monospace", background: "transparent", border: "none", borderBottom: tab === key ? `2px solid ${key === "accuracy" ? "#f59e0b" : "#6366f1"}` : "2px solid transparent", color: tab === key ? (key === "accuracy" ? "#fbbf24" : "#a5b4fc") : "#475569", cursor: "pointer", letterSpacing: 0.5 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {tab === "accuracy" ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <AccuracyTab acc={acc} pastBills={data.pastBills || []} />
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: activeBill ? "38%" : "100%", overflowY: "auto", borderRight: activeBill ? "1px solid #0f172a" : "none", transition: "width 0.25s ease" }}>
            {bills.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "#334155", fontSize: 13 }}>No bills to display yet.</div>
            )}
            {bills.map((bill) =>
              tab === "upcoming"
                ? <UpcomingCard key={bill.id} bill={bill} isActive={selectedId === bill.id} onClick={() => handleSelect(bill.id)} />
                : <PastCard key={bill.id} bill={bill} isActive={selectedId === bill.id} onClick={() => handleSelect(bill.id)} />
            )}
          </div>
          {activeBill && (
            <div style={{ flex: 1, overflowY: "auto", background: "#07101f" }}>
              {tab === "upcoming"
                ? <UpcomingDetail bill={activeBill} onClose={() => setSelectedId(null)} />
                : <PastDetail bill={activeBill} onClose={() => setSelectedId(null)} />}
            </div>
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid #0f172a", padding: "6px 24px", background: "#020817" }}>
        <div style={{ fontSize: 10, color: "#1e293b", textAlign: "center" }}>
          Data: Congress.gov API · Yahoo Finance · Claude AI · Updated nightly via GitHub Actions
        </div>
      </div>
    </div>
  );
}
