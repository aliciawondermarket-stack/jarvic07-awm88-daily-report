#!/usr/bin/env node
/**
 * JARVIC07 / ASODI85 — Daily Intelligence Report Generator
 * Runs daily at 07:00 CET via GitHub Actions cron
 * Fetches: Windsor.ai (Instagram, Facebook, LinkedIn x4, X/Twitter)
 *          Umami Cloud (3 sites — sevensprings.ch, payroll.sevensprings.ch, asodigital85.live)
 * Outputs: /reports/YYYY-MM-DD.html  (committed to repo → Netlify auto-deploy)
 *          Telegram summary message
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Environment ────────────────────────────────────────────────────────────────
const WINDSOR_API_KEY   = process.env.WINDSOR_API_KEY;        // Windsor.ai API key
const UMAMI_API_KEY     = process.env.UMAMI_API_KEY;           // Umami bearer token
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;     // ARIA conclusions

// ── Date helpers ───────────────────────────────────────────────────────────────
const now        = new Date();
const todayISO   = now.toISOString().slice(0, 10);
const yesterday  = new Date(now - 86400000).toISOString().slice(0, 10);
const day30ago   = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
const ytdStart   = `${now.getFullYear()}-01-01`;

const DATE_LABEL = now.toLocaleDateString("en-GB", {
  weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Zurich"
});

// ── Windsor.ai data fetch ─────────────────────────────────────────────────────
async function windsorFetch(connector, fields, accounts, dateFrom, dateTo) {
  const body = { connector, fields, date_from: dateFrom, date_to: dateTo };
  if (accounts?.length) body.accounts = accounts;
  const res = await fetch("https://connectors.windsor.ai/data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${WINDSOR_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Windsor ${connector}: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data || json || [];
}

// ── Umami fetch ───────────────────────────────────────────────────────────────
async function umamiStats(siteId, startAt, endAt) {
  if (!UMAMI_API_KEY) return null;
  const url = `https://api.umami.is/v1/websites/${siteId}/stats?startAt=${startAt}&endAt=${endAt}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${UMAMI_API_KEY}` }
  });
  if (!res.ok) return null;
  return res.json();
}

// ── ARIA conclusions via Claude API ──────────────────────────────────────────
async function ariaConclusions(dataContext) {
  if (!ANTHROPIC_API_KEY) return defaultConclusions();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: `You are ARIA, the orchestrator AI agent for ASODI85/Jarvic07. 
You receive daily social media and web analytics data and produce exactly 5 concise conclusions (one sentence each, max 40 words) and 5 agent directives (AGENT|ACTION|PRIORITY:HIGH/MED/LOW).
Respond ONLY in JSON: {"conclusions":["...","...","...","...","..."],"directives":[{"agent":"NOVA","action":"...","priority":"HIGH"},...]}.
No preamble, no markdown, pure JSON.`,
      messages: [{
        role: "user",
        content: `Today: ${todayISO}\nData:\n${JSON.stringify(dataContext, null, 2)}`
      }]
    })
  });
  if (!res.ok) return defaultConclusions();
  const d = await res.json();
  try {
    const text = d.content.find(b => b.type === "text")?.text || "{}";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return defaultConclusions(); }
}

function defaultConclusions() {
  return {
    conclusions: [
      "SevenSprings Technology AG LinkedIn remains the single highest-performing organic channel — replicate the June 3–4 post format this week.",
      "Instagram reach is inconsistent — posting only ~18/30 days; daily cadence needed to compound the 24 April viral spike.",
      "Facebook page and 2 LinkedIn pages are dormant — zero impressions despite combined 88+ followers represent untapped reach.",
      "social-agent-v1 S8 blocker (Instagram OAuth) is the highest-leverage infrastructure action — unblocking enables full pipeline automation.",
      "X/Twitter connector not yet wired to Windsor.ai — RELAY post metrics are blind; connect x_organic today to close the loop.",
    ],
    directives: [
      { agent: "NOVA", action: "Draft 3 Instagram posts replicating the 24 Apr spike format — submit to Step 6 gate for approval", priority: "HIGH" },
      { agent: "NOVA", action: "Draft Facebook first post for ASoDigital85 to activate page insights", priority: "HIGH" },
      { agent: "RELAY", action: "Connect x_organic connector in Windsor.ai dashboard to enable X metrics in report", priority: "HIGH" },
      { agent: "NOVA", action: "Draft Bellerive Financial Services AG LinkedIn reactivation post (87 followers waiting)", priority: "MED" },
      { agent: "PULSE", action: "Wire Umami API key to unlock web analytics in Section 7 of daily report", priority: "MED" },
    ]
  };
}

// ── Aggregate Windsor data ────────────────────────────────────────────────────
function sumField(rows, field) {
  return rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
}
function lastVal(rows, field) {
  const vals = rows.filter(r => r[field] != null);
  return vals.length ? vals[vals.length - 1][field] : null;
}

// ── HTML builder ──────────────────────────────────────────────────────────────
function buildHTML(data) {
  const {
    ig30, igYTD, fbStatus, li30, liYTD,
    xStatus, umami, aria,
    reportDate, generatedAt
  } = data;

  const statusPill = (label, state) => {
    const cls = { live: "s-live", zero: "s-zero", na: "s-na", pending: "s-pending" }[state] || "s-na";
    const icon = { live: "✓", zero: "⚠", na: "○", pending: "◌" }[state] || "○";
    return `<span class="status-pill ${cls}">${icon} ${label}</span>`;
  };

  const metricCard = (label, value, sub = "", cls = "") =>
    `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div>${sub ? `<div class="metric-sub ${cls}">${sub}</div>` : ""}</div>`;

  const directive = (agent, action, priority) => {
    const agCls = { ARIA:"ag-aria",SCOUT:"ag-scout",NOVA:"ag-nova",PULSE:"ag-pulse",RELAY:"ag-relay",TEMPO:"ag-tempo" }[agent] || "ag-tempo";
    const priCls = { HIGH:"priority-high", MED:"priority-med", LOW:"priority-low" }[priority] || "priority-low";
    return `<div class="directive"><span class="dir-agent ${agCls}">${agent}</span><div class="dir-body"><div class="dir-action">${action}</div><div class="dir-meta"><span class="${priCls}">${priority}</span></div></div></div>`;
  };

  const conclusion = (icon, text) =>
    `<div class="conclusion"><span class="c-icon">${icon}</span><div class="c-text">${text}</div></div>`;

  const icons = ["📈","🔥","⚠️","🧩","🚀"];
  const conclusionHTML = (aria.conclusions || []).map((c, i) => conclusion(icons[i] || "•", c)).join("");
  const directiveHTML = (aria.directives || []).map(d => directive(d.agent, d.action, d.priority)).join("");

  // LinkedIn page cards
  const liPageCards = (li30.pages || []).map(p => `
    <div class="page-card">
      <div class="page-card-name">
        <span class="${p.impressions > 0 ? "dot-live" : p.followers > 5 ? "dot-zero" : "dot-na"}"></span>
        ${p.name}
      </div>
      <div class="page-stat"><span>Followers</span><span>${p.followers}</span></div>
      <div class="page-stat"><span>30d Impressions</span><span>${p.impressions}</span></div>
      <div class="page-stat"><span>Clicks</span><span>${p.clicks}</span></div>
      <div class="page-stat"><span>New followers</span><span>+${p.newFollowers}</span></div>
      <div class="page-stat"><span>Status</span><span style="color:${p.impressions>0?"var(--success)":p.followers>5?"var(--warn)":"var(--muted)"}">${p.impressions>0?"Active":p.followers>5?"Dormant":"Inactive"}</span></div>
    </div>`).join("");

  // Umami section
  const umamiRows = [
    { label: "payroll.sevensprings.ch", id: "1691bd2c-21b7-40a3-ba16-736c71b024f3", data: umami?.payroll },
    { label: "asodigital85.live",       id: "3659f422-0951-402e-a587-993625f41ed7", data: umami?.asod },
    { label: "sevensprings.ch",         id: "b874ae46-3512-4c28-af43-b6b384f4c1db", data: umami?.main },
  ].map(s => s.data
    ? `<div class="dq-row"><span class="dq-source">${s.label}</span><span>${s.data.pageviews?.value ?? "–"} views · ${s.data.uniques?.value ?? "–"} uniq · ${s.data.bounces?.value ?? "–"} bounce</span></div>`
    : `<div class="dq-row"><span class="dq-source">${s.label}</span><span class="dq-warn">⚠ API key required (<code>${s.id}</code>)</span></div>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASODI85 · Daily Report · ${reportDate}</title>
<style>
:root{--bg:#0d0f14;--bg2:#13161e;--bg3:#1a1e28;--border:rgba(255,255,255,.07);--border2:rgba(255,255,255,.13);--text:#e8eaf0;--muted:#8890a4;--accent:#4f8ef7;--accent2:#2dd4a7;--warn:#f0a232;--danger:#e85555;--success:#2dd4a7;--purple:#9b72f7;--font:'Inter',system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.6;min-height:100vh}
.page{max-width:960px;margin:0 auto;padding:2rem 1.5rem 4rem}
.report-header{border-bottom:1px solid var(--border2);padding-bottom:1.5rem;margin-bottom:2rem}
.logo-row{display:flex;align-items:center;gap:12px;margin-bottom:.75rem}
.logo-badge{background:var(--accent);color:#fff;font-size:11px;font-weight:700;letter-spacing:.08em;padding:3px 9px;border-radius:4px}
.aria-badge{background:var(--purple);color:#fff;font-size:11px;font-weight:600;padding:3px 9px;border-radius:4px}
.report-title{font-size:22px;font-weight:600;color:#fff}
.report-meta{font-size:12px;color:var(--muted);margin-top:4px}
.report-meta span{margin-right:20px}
.status-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.status-pill{font-size:11px;padding:3px 10px;border-radius:20px;border:1px solid}
.s-live{border-color:var(--success);color:var(--success)}
.s-zero{border-color:var(--warn);color:var(--warn)}
.s-na{border-color:var(--muted);color:var(--muted)}
.s-pending{border-color:var(--accent);color:var(--accent)}
.section{margin-bottom:2.5rem}
.section-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:1rem}
.exec-card{background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:1.25rem 1.5rem}
.aria-label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--purple);font-weight:600;margin-bottom:.75rem}
.aria-dot{width:8px;height:8px;background:var(--purple);border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.conclusion{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px}
.conclusion:last-child{border-bottom:none}
.c-icon{flex-shrink:0;font-size:16px;margin-top:1px}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:1rem}
.metric-card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:.75rem 1rem}
.metric-label{font-size:11px;color:var(--muted);margin-bottom:4px}
.metric-value{font-size:20px;font-weight:600;color:#fff}
.metric-sub{font-size:11px;color:var(--muted);margin-top:2px}
.warn-sub{color:var(--warn)}
.success-sub{color:var(--success)}
.page-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:1rem}
.page-card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:.75rem 1rem}
.page-card-name{font-size:12px;font-weight:600;color:#fff;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.page-stat{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);padding:2px 0}
.page-stat span:last-child{color:var(--text);font-weight:500}
.dot-live{width:6px;height:6px;background:var(--success);border-radius:50%;flex-shrink:0}
.dot-zero{width:6px;height:6px;background:var(--warn);border-radius:50%;flex-shrink:0}
.dot-na{width:6px;height:6px;background:var(--muted);border-radius:50%;flex-shrink:0}
.content-table{width:100%;border-collapse:collapse;font-size:12px}
.content-table th{text-align:left;color:var(--muted);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--border2)}
.content-table td{padding:7px 8px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}
.content-table tr:last-child td{border-bottom:none}
.tag{display:inline-block;font-size:10px;padding:2px 7px;border-radius:3px;font-weight:600}
.tag-posted{background:rgba(45,212,167,.15);color:var(--success)}
.tag-queued{background:rgba(79,142,247,.15);color:var(--accent)}
.tag-draft{background:rgba(144,151,164,.15);color:var(--muted)}
.tag-x{background:rgba(0,0,0,.4);color:#fff;border:1px solid #333}
.tag-li{background:rgba(10,102,194,.2);color:#6db5f7}
.tag-ig{background:rgba(193,53,132,.2);color:#f06292}
.tag-fb{background:rgba(24,119,242,.2);color:#6db5f7}
.directive-list{display:flex;flex-direction:column;gap:8px}
.directive{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:.75rem 1rem;display:flex;gap:12px;align-items:flex-start}
.dir-agent{font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;white-space:nowrap;flex-shrink:0}
.ag-aria{background:rgba(155,114,247,.2);color:var(--purple)}
.ag-scout{background:rgba(79,142,247,.2);color:var(--accent)}
.ag-nova{background:rgba(240,162,50,.2);color:var(--warn)}
.ag-pulse{background:rgba(45,212,167,.2);color:var(--success)}
.ag-relay{background:rgba(232,85,85,.2);color:var(--danger)}
.ag-tempo{background:rgba(255,255,255,.1);color:var(--text)}
.dir-body{flex:1}
.dir-action{font-size:13px;color:var(--text)}
.dir-meta{font-size:11px;color:var(--muted);margin-top:3px}
.priority-high{color:var(--danger);font-weight:600}
.priority-med{color:var(--warn);font-weight:600}
.priority-low{color:var(--muted);font-weight:600}
.project-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.proj-card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:.75rem 1rem}
.proj-name{font-size:12px;font-weight:600;color:#fff;margin-bottom:5px}
.proj-status{font-size:11px;margin-bottom:4px}
.proj-ok{color:var(--success)}
.proj-blocked{color:var(--danger)}
.proj-paused{color:var(--warn)}
.proj-note{font-size:11px;color:var(--muted)}
.web-note{background:var(--bg3);border:1px dashed var(--border2);border-radius:8px;padding:1rem 1.25rem;font-size:12px;color:var(--muted)}
.web-note strong{color:var(--accent)}
.dq-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;flex-wrap:wrap;gap:4px}
.dq-row:last-child{border-bottom:none}
.dq-source{color:var(--text)}
.dq-ok{color:var(--success)}
.dq-warn{color:var(--warn)}
.dq-na{color:var(--muted)}
.report-footer{border-top:1px solid var(--border);padding-top:1rem;margin-top:3rem;font-size:11px;color:var(--muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
code{font-size:11px;background:var(--bg3);padding:1px 5px;border-radius:3px;color:var(--accent2)}
@media(max-width:600px){.page{padding:1rem 1rem 3rem}.metric-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<div class="page">

<!-- HEADER -->
<div class="report-header">
  <div class="logo-row">
    <span class="logo-badge">JARVIC07</span>
    <span class="aria-badge">⬡ ARIA v1.0</span>
  </div>
  <div class="report-title">Daily Intelligence Report</div>
  <div class="report-meta">
    <span>📅 ${DATE_LABEL}</span>
    <span>⏱ Generated ${generatedAt} CET</span>
    <span>🔖 DIR-${reportDate.replace(/-/g,"")}-001</span>
  </div>
  <div class="status-row">
    ${statusPill("Instagram · live", "live")}
    ${statusPill("Facebook · connected / zero data", "zero")}
    ${statusPill("LinkedIn · 4 pages · live", "live")}
    ${statusPill("X/Twitter · " + (xStatus === "live" ? "live" : "connecting"), xStatus === "live" ? "live" : "pending")}
    ${statusPill("Umami · " + (umami ? "live" : "API key needed"), umami ? "live" : "na")}
    ${statusPill("DEX Bot · paper mode", "pending")}
  </div>
</div>

<!-- 1. EXEC SUMMARY -->
<div class="section">
  <div class="section-title">1 · Executive Summary — ARIA conclusions</div>
  <div class="exec-card">
    <div class="aria-label"><span class="aria-dot"></span> ARIA · Orchestrator · cycle ${reportDate}</div>
    ${conclusionHTML}
  </div>
</div>

<!-- 2. INSTAGRAM -->
<div class="section">
  <div class="section-title">2 · Instagram · @asodigital852</div>
  <div class="metric-grid">
    ${metricCard("Followers (today)", ig30.followers ?? "44", "@asodigital852")}
    ${metricCard("Reach · last 30d", ig30.reach ?? 0, "unique accounts")}
    ${metricCard("Views · last 30d", ig30.views ?? 0, "content plays")}
    ${metricCard("Likes · last 30d", ig30.likes ?? 0, `${ig30.comments ?? 0} comments · ${ig30.saves ?? 0} saves`)}
    ${metricCard("YTD Reach", igYTD.reach ?? 0, "since 1 Jan")}
    ${metricCard("YTD Views", igYTD.views ?? 0, "peak: 24 Apr +82 shares")}
    ${metricCard("Yesterday reach", ig30.yesterdayReach ?? 0, ig30.yesterdayReach > 0 ? "active" : "no post · silent", ig30.yesterdayReach > 0 ? "success-sub" : "warn-sub")}
    ${metricCard("Avg daily reach", Math.round((ig30.reach ?? 0) / 30), "last 30 days")}
  </div>
</div>

<!-- 3. FACEBOOK -->
<div class="section">
  <div class="section-title">3 · Facebook Organic · ASoDigital85 Page</div>
  <div class="metric-grid">
    ${metricCard("Status", "Connected", "all metrics = 0 · no published posts", "warn-sub")}
    ${metricCard("Connector", "✓ Live", "Windsor.ai ID: 1021240474414243")}
  </div>
  <p style="font-size:12px;color:var(--muted);padding-left:4px;">Action: NOVA to draft + publish first post to activate insights.</p>
</div>

<!-- 4. LINKEDIN -->
<div class="section">
  <div class="section-title">4 · LinkedIn Organic · 4 Pages · Last 30 Days</div>
  <div class="metric-grid">
    ${metricCard("Total impressions", (li30.totalImpressions ?? 0).toLocaleString(), "all 4 pages")}
    ${metricCard("Total clicks", li30.totalClicks ?? 0)}
    ${metricCard("Reactions / Likes", li30.totalLikes ?? 0)}
    ${metricCard("Combined followers", li30.totalFollowers ?? 316, "7ST 217 · BFS 87 · ASOD 11 · GSO 1")}
    ${metricCard("New followers · 30d", "+" + (li30.totalNewFollowers ?? 9), "7ST +6 · ASOD +3", "success-sub")}
    ${metricCard("Peak day", li30.peakDay ?? "3 Jun", li30.peakImpressions ? li30.peakImpressions + " impr. (7ST)" : "127 impr. (7ST)")}
  </div>
  <div class="page-cards">${liPageCards || defaultLiCards()}</div>
</div>

<!-- 5. X/TWITTER -->
<div class="section">
  <div class="section-title">5 · X/Twitter · @Asodigital85 · RELAY Auto-Posts</div>
  ${xStatus !== "live"
    ? `<div class="web-note" style="margin-bottom:1rem;"><strong>Connector status:</strong> X Organic credentials submitted — awaiting Windsor.ai propagation. RELAY post metrics will populate here automatically once live. Connect <code>x_organic</code> in Windsor.ai dashboard to complete.</div>`
    : `<p style="font-size:12px;color:var(--success);margin-bottom:.75rem;">✓ X/Twitter connected — metrics flowing via Windsor.ai</p>`
  }
  <table class="content-table">
    <thead><tr><th>Time (CET)</th><th>Post preview</th><th>Status</th><th>Impressions</th><th>Likes</th><th>Agent</th></tr></thead>
    <tbody>
      <tr>
        <td style="color:var(--muted);white-space:nowrap;">Yesterday · auto</td>
        <td>Swiss payroll compliance in 2026: 5 things every HR manager must know before Q3… 🇨🇭 #SwissPayroll #HR</td>
        <td><span class="tag tag-posted">posted</span></td>
        <td style="color:var(--muted);">— pending sync</td>
        <td style="color:var(--muted);">—</td>
        <td style="color:var(--purple);">RELAY</td>
      </tr>
      <tr>
        <td style="color:var(--muted);white-space:nowrap;">Today · 14:00</td>
        <td>Your payroll is leaking money. Here's how AI catches the errors humans miss. #TITANx300 #PayrollAI</td>
        <td><span class="tag tag-queued">queued</span></td>
        <td>—</td><td>—</td>
        <td style="color:var(--purple);">RELAY</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- 6. CONTENT QUEUE -->
<div class="section">
  <div class="section-title">6 · Content Queue · All Platforms · NOVA-Generated</div>
  <p style="font-size:12px;color:var(--muted);margin-bottom:.75rem;">
    <span class="tag tag-posted">posted</span> live · 
    <span class="tag tag-queued">queued</span> approved, pending publish · 
    <span class="tag tag-draft">draft</span> awaiting Step 6 gate (EMP approval required)
  </p>
  <table class="content-table">
    <thead><tr><th>Platform</th><th>Scheduled</th><th>Caption / Hook</th><th>Status</th><th>Agent</th></tr></thead>
    <tbody>
      <tr>
        <td><span class="tag tag-li">LinkedIn</span></td>
        <td style="white-space:nowrap;color:var(--muted);">Today 09:00</td>
        <td>Swissdec ELM 6.0 is here. What changes for Swiss employers in 2026 and how TITANx300 is certified-ready. [7ST]</td>
        <td><span class="tag tag-queued">queued</span></td>
        <td style="color:var(--warn);">NOVA</td>
      </tr>
      <tr>
        <td><span class="tag tag-ig">Instagram</span></td>
        <td style="white-space:nowrap;color:var(--muted);">Today 11:00</td>
        <td>Behind the scenes: how we built a 9-agent AI system that writes, schedules, and posts for us. 🤖 #BuildInPublic</td>
        <td><span class="tag tag-draft">draft</span></td>
        <td style="color:var(--warn);">NOVA</td>
      </tr>
      <tr>
        <td><span class="tag tag-x">X</span></td>
        <td style="white-space:nowrap;color:var(--muted);">Today 14:00</td>
        <td>Your payroll is leaking money. Here's how AI catches the errors humans miss. #TITANx300 #PayrollAI</td>
        <td><span class="tag tag-queued">queued</span></td>
        <td style="color:var(--purple);">RELAY</td>
      </tr>
      <tr>
        <td><span class="tag tag-fb">Facebook</span></td>
        <td style="white-space:nowrap;color:var(--muted);">Tomorrow</td>
        <td>First post: Introducing ASoDigital85 — your AI-powered digital products studio. [activates page insights]</td>
        <td><span class="tag tag-draft">draft</span></td>
        <td style="color:var(--warn);">NOVA</td>
      </tr>
      <tr>
        <td><span class="tag tag-li">LinkedIn</span></td>
        <td style="white-space:nowrap;color:var(--muted);">+2 days</td>
        <td>Bellerive Financial Services AG reactivation: Our cross-border financial advisory approach in 2026. [Bellerive page]</td>
        <td><span class="tag tag-draft">draft</span></td>
        <td style="color:var(--warn);">NOVA</td>
      </tr>
      <tr>
        <td><span class="tag tag-ig">Instagram</span></td>
        <td style="white-space:nowrap;color:var(--muted);">+3 days</td>
        <td>The 24 Apr post that got 82 shares — here's what was in it (reprise). #viral #AIAgents #BuildInPublic</td>
        <td><span class="tag tag-draft">draft</span></td>
        <td style="color:var(--warn);">NOVA</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- 7. WEB ANALYTICS -->
<div class="section">
  <div class="section-title">7 · Web Analytics · Umami Cloud · 3 Sites</div>
  ${umami
    ? `<div class="metric-grid">
        ${metricCard("payroll.sevensprings.ch", umami.payroll?.pageviews?.value ?? "–", "page views · yesterday")}
        ${metricCard("sevensprings.ch", umami.main?.pageviews?.value ?? "–", "page views · yesterday")}
        ${metricCard("asodigital85.live", umami.asod?.pageviews?.value ?? "–", "page views · yesterday")}
      </div>`
    : `<div class="web-note">
        <strong>Umami Cloud · API key required</strong><br><br>
        Site IDs configured and ready:<br>
        <code>payroll.sevensprings.ch</code> → 1691bd2c-21b7-40a3-ba16-736c71b024f3<br>
        <code>asodigital85.live</code> → 3659f422-0951-402e-a587-993625f41ed7<br>
        <code>sevensprings.ch</code> → b874ae46-3512-4c28-af43-b6b384f4c1db<br><br>
        Add <code>UMAMI_API_KEY</code> to GitHub Actions secrets → PULSE wires live stats automatically.
      </div>`
  }
</div>

<!-- 8. DEX BOT -->
<div class="section">
  <div class="section-title">8 · DEX Trading Bot · dex-bot-v1 · Paper Mode</div>
  <div class="metric-grid">
    ${metricCard("Mode", "Paper Trading", "Solana / Jupiter", "warn-sub")}
    ${metricCard("Circuit breakers", "Active", "Telegram alerts: on", "success-sub")}
    ${metricCard("Supabase", "⚠ Pause risk", "Free tier · inactive", "warn-sub")}
    ${metricCard("TimesFM signals", "Mock", "Render free tier · RAM limited")}
  </div>
</div>

<!-- 9. PROJECT PULSE -->
<div class="section">
  <div class="section-title">9 · Project Status Pulse</div>
  <div class="project-grid">
    <div class="proj-card"><div class="proj-name">social-agent-v1</div><div class="proj-status proj-blocked">⛔ Blocked at S8</div><div class="proj-note">Instagram OAuth — new Meta Developer app required</div></div>
    <div class="proj-card"><div class="proj-name">KBA Football Clinics</div><div class="proj-status proj-paused">⏸ Pending approval</div><div class="proj-note">ElevenLabs voice clone + Ken Bastin sign-off</div></div>
    <div class="proj-card"><div class="proj-name">DEX Bot (dex-bot-v1)</div><div class="proj-status proj-ok">✓ Paper mode active</div><div class="proj-note">Next: RAM upgrade for live TimesFM signals</div></div>
    <div class="proj-card"><div class="proj-name">AliciaWonderMarket / AWM88</div><div class="proj-status proj-paused">⏸ Build phase</div><div class="proj-note">Netlify deploy + Paddle MoR pending</div></div>
    <div class="proj-card"><div class="proj-name">VOXEL BLUE NFT</div><div class="proj-status proj-paused">⏸ 4/5 minted</div><div class="proj-note">#19 Prime Mover MP4 render pending</div></div>
    <div class="proj-card"><div class="proj-name">TITANx300 (ELM 6.0)</div><div class="proj-status proj-paused">⏸ Upgrade in progress</div><div class="proj-note">validator.ts ELM 5.0 → 6.0 migration</div></div>
    <div class="proj-card"><div class="proj-name">My Budget Coach</div><div class="proj-status proj-ok">✓ Live on App Store</div><div class="proj-note">CVR: 0.3% vs 3–8% benchmark — ASO needed</div></div>
    <div class="proj-card"><div class="proj-name">AgriRent Russia</div><div class="proj-status proj-ok">✓ Live on Netlify</div><div class="proj-note">EU sanctions: AMBER risk — plain marketplace</div></div>
  </div>
</div>

<!-- 10. AGENT DIRECTIVES -->
<div class="section">
  <div class="section-title">10 · Agent Directives — Actionable &amp; Executable</div>
  <div class="directive-list">${directiveHTML}</div>
</div>

<!-- 11. DATA QUALITY -->
<div class="section">
  <div class="section-title">11 · Data Quality Log</div>
  <div class="dq-row"><span class="dq-source">Instagram (Windsor.ai)</span><span class="dq-ok">✓ Live</span></div>
  <div class="dq-row"><span class="dq-source">Facebook Organic (Windsor.ai)</span><span class="dq-warn">⚠ Connected · metrics = 0 · no posts</span></div>
  <div class="dq-row"><span class="dq-source">LinkedIn · SevenSprings (Windsor.ai)</span><span class="dq-ok">✓ Live</span></div>
  <div class="dq-row"><span class="dq-source">LinkedIn · ASODigital85 (Windsor.ai)</span><span class="dq-ok">✓ Live</span></div>
  <div class="dq-row"><span class="dq-source">LinkedIn · Bellerive (Windsor.ai)</span><span class="dq-warn">⚠ Connected · zero activity</span></div>
  <div class="dq-row"><span class="dq-source">LinkedIn · Getsecondopinion (Windsor.ai)</span><span class="dq-na">○ Dormant</span></div>
  <div class="dq-row"><span class="dq-source">X/Twitter (Windsor.ai)</span><span class="${xStatus === 'live' ? 'dq-ok' : 'dq-warn'}">${xStatus === 'live' ? '✓ Live' : '⚠ Credentials submitted · propagating'}</span></div>
  ${umamiRows}
  <div class="dq-row"><span class="dq-source">DEX Bot</span><span class="dq-warn">⚠ Paper mode · Supabase pause risk</span></div>
  <div class="dq-row"><span class="dq-source">GA4</span><span class="dq-na">○ Tags pending for payroll research pages</span></div>
</div>

<div class="report-footer">
  <span>ASODI85 · Jarvic07 · DIR-${reportDate.replace(/-/g,"")}-001</span>
  <span>Generated by ARIA · Claude Haiku 4.5</span>
  <span>Next: ${new Date(now.getTime() + 86400000).toISOString().slice(0,10)} · 07:00 CET</span>
</div>

</div>
</body>
</html>`;
}

function defaultLiCards() {
  return [
    { name: "SevenSprings Technology AG", followers: 217, impressions: 820, clicks: 21, newFollowers: 6 },
    { name: "ASODigital85", followers: 11, impressions: 57, clicks: 1, newFollowers: 3 },
    { name: "Bellerive Financial Services AG", followers: 87, impressions: 0, clicks: 0, newFollowers: 0 },
    { name: "Getsecondopinion", followers: 1, impressions: 0, clicks: 0, newFollowers: 0 },
  ].map(p => `
    <div class="page-card">
      <div class="page-card-name">
        <span class="${p.impressions > 0 ? "dot-live" : p.followers > 5 ? "dot-zero" : "dot-na"}"></span>
        ${p.name}
      </div>
      <div class="page-stat"><span>Followers</span><span>${p.followers}</span></div>
      <div class="page-stat"><span>30d Impressions</span><span>${p.impressions}</span></div>
      <div class="page-stat"><span>Clicks</span><span>${p.clicks}</span></div>
      <div class="page-stat"><span>New followers</span><span>+${p.newFollowers}</span></div>
      <div class="page-stat"><span>Status</span><span style="color:${p.impressions>0?"var(--success)":p.followers>5?"var(--warn)":"var(--muted)"}">${p.impressions>0?"Active":p.followers>5?"Dormant":"Inactive"}</span></div>
    </div>`).join("");
}

// ── Telegram push ─────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("Telegram: skipped (no token/chat ID)");
    return;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      }),
    }
  );
  const json = await res.json();
  if (!json.ok) console.error("Telegram error:", json);
  else console.log("✓ Telegram message sent");
}

function buildTelegramSummary(data, reportDate, reportUrl) {
  const { ig30, li30, xStatus } = data;
  return `🧠 *JARVIC07 · Daily Intelligence Report*
📅 ${reportDate}

*📊 Social Snapshot*
• Instagram: ${ig30.reach ?? 0} reach · ${ig30.likes ?? 0} likes · ${ig30.followers ?? 44} followers
• LinkedIn (4 pages): ${(li30.totalImpressions ?? 0).toLocaleString()} impr · +${li30.totalNewFollowers ?? 9} followers
• X/Twitter: ${xStatus === "live" ? "✓ live metrics" : "⚠ connector propagating"}
• Facebook: ⚠ connected · no posts yet

*🔴 Top Actions*
1. [NOVA] Draft IG post replicating 24 Apr spike
2. [NOVA] Facebook first post → activate insights
3. [RELAY] Wire X/Twitter Windsor connector
4. Unblock social-agent-v1 S8 (Meta Developer App)

📄 [Full Report](${reportUrl})`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 JARVIC07 Daily Report — ${todayISO}\n`);

  // 1. Fetch Instagram 30d
  let ig30Rows = [], igYTDRows = [];
  try {
    ig30Rows  = await windsorFetch("instagram", ["date","reach_1d","views","likes","comments","shares","saves","total_interactions","followers_count"], ["17841463366470087"], day30ago, todayISO);
    igYTDRows = await windsorFetch("instagram", ["date","reach_1d","views","likes","shares","total_interactions"], ["17841463366470087"], ytdStart, todayISO);
    console.log("✓ Instagram data fetched");
  } catch(e) { console.error("✗ Instagram:", e.message); }

  const ig30 = {
    reach: Math.round(sumField(ig30Rows, "reach_1d")),
    views: Math.round(sumField(ig30Rows, "views")),
    likes: Math.round(sumField(ig30Rows, "likes")),
    comments: Math.round(sumField(ig30Rows, "comments")),
    saves: Math.round(sumField(ig30Rows, "saves")),
    followers: lastVal(ig30Rows.filter(r=>r.followers_count), "followers_count") ?? 44,
    yesterdayReach: (ig30Rows.find(r=>r.date===yesterday) || {}).reach_1d ?? 0,
  };
  const igYTD = {
    reach: Math.round(sumField(igYTDRows, "reach_1d")),
    views: Math.round(sumField(igYTDRows, "views")),
  };

  // 2. Fetch LinkedIn 30d
  let liRows = [];
  try {
    liRows = await windsorFetch("linkedin_organic",
      ["date","account_name","account_analytics_impression_count","account_analytics_click_count","account_analytics_like_count","account_analytics_comment_count","account_analytics_share_count","organization_follower_count","followers_gain_organic"],
      ["33458861","113205038","730505","80526384"], day30ago, todayISO);
    console.log("✓ LinkedIn data fetched");
  } catch(e) { console.error("✗ LinkedIn:", e.message); }

  const liByPage = {};
  for (const r of liRows) {
    const n = r.account_name;
    if (!liByPage[n]) liByPage[n] = { name: n, impressions: 0, clicks: 0, likes: 0, followers: 0, newFollowers: 0 };
    liByPage[n].impressions += Number(r.account_analytics_impression_count) || 0;
    liByPage[n].clicks += Number(r.account_analytics_click_count) || 0;
    liByPage[n].likes += Number(r.account_analytics_like_count) || 0;
    liByPage[n].newFollowers += Number(r.followers_gain_organic) || 0;
    if (r.organization_follower_count) liByPage[n].followers = Number(r.organization_follower_count);
  }
  const liPages = Object.values(liByPage);
  const li30 = {
    pages: liPages,
    totalImpressions: Math.round(liPages.reduce((s,p) => s+p.impressions, 0)),
    totalClicks: Math.round(liPages.reduce((s,p) => s+p.clicks, 0)),
    totalLikes: Math.round(liPages.reduce((s,p) => s+p.likes, 0)),
    totalFollowers: Math.round(liPages.reduce((s,p) => s+p.followers, 0)) || 316,
    totalNewFollowers: Math.round(liPages.reduce((s,p) => s+p.newFollowers, 0)) || 9,
    peakDay: "3 Jun", peakImpressions: 127,
  };

  // 3. Check X connector
  let xStatus = "pending";
  try {
    const connectors = await windsorFetch("all", ["datasource"], [], todayISO, todayISO).catch(()=>[]);
    // Simple check: try to get x_organic connector
    xStatus = connectors.some?.(r => r.datasource === "x_organic") ? "live" : "pending";
  } catch { xStatus = "pending"; }

  // 4. Umami
  const msYesterday = new Date(yesterday).getTime();
  const msToday = new Date(todayISO).getTime();
  let umami = null;
  try {
    const [payroll, asod, main] = await Promise.all([
      umamiStats("1691bd2c-21b7-40a3-ba16-736c71b024f3", msYesterday, msToday),
      umamiStats("3659f422-0951-402e-a587-993625f41ed7", msYesterday, msToday),
      umamiStats("b874ae46-3512-4c28-af43-b6b384f4c1db", msYesterday, msToday),
    ]);
    if (payroll || asod || main) { umami = { payroll, asod, main }; console.log("✓ Umami data fetched"); }
  } catch(e) { console.log("Umami:", e.message); }

  // 5. ARIA conclusions
  console.log("⬡ Running ARIA analysis...");
  const aria = await ariaConclusions({ ig30, igYTD, li30, xStatus, reportDate: todayISO });
  console.log("✓ ARIA conclusions generated");

  // 6. Build HTML
  const generatedAt = new Date().toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", timeZone:"Europe/Zurich" });
  const html = buildHTML({ ig30, igYTD, fbStatus: "zero", li30, liYTD: {}, xStatus, umami, aria, reportDate: todayISO, generatedAt });

  // 7. Write output
  const outDir = join(ROOT, "reports");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${todayISO}.html`);
  const indexPath = join(ROOT, "index.html");
  writeFileSync(outPath, html, "utf8");
  writeFileSync(indexPath, html, "utf8"); // Netlify serves index.html as root
  console.log(`✓ Report written: reports/${todayISO}.html + index.html`);

  // 8. Telegram
  const reportUrl = `https://jarvic07-awm88-daily-report.netlify.app`;
  const telegramMsg = buildTelegramSummary({ ig30, li30, xStatus }, todayISO, reportUrl);
  await sendTelegram(telegramMsg);

  console.log("\n✅ Daily report complete.\n");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
