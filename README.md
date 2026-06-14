# JARVIC07 · ASODI85 — Daily Intelligence Report

Auto-generated daily briefing for ARIA and all AI agents.  
Live at: **https://jarvic07-awm88-daily-report.netlify.app**

## Architecture

```
GitHub Actions (cron 06:00 UTC = 07:00 CET)
  └── scripts/generate-report.js
        ├── Windsor.ai API  → Instagram, Facebook, LinkedIn ×4, X/Twitter
        ├── Umami Cloud API → sevensprings.ch, payroll.sevensprings.ch, asodigital85.live
        ├── Claude Haiku    → ARIA conclusions + agent directives
        ├── writes index.html + reports/YYYY-MM-DD.html
        └── Telegram push   → condensed summary to agent channel
  └── git commit + push
        └── Netlify auto-deploy (publish = ".")
```

## Setup — GitHub Secrets Required

| Secret | Description |
|---|---|
| `WINDSOR_API_KEY` | Windsor.ai API key (from dashboard → API) |
| `UMAMI_API_KEY` | Umami Cloud bearer token (from umami.is → profile → API keys) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (from @BotFather) |
| `TELEGRAM_CHAT_ID` | Telegram chat/channel ID for agent notifications |
| `ANTHROPIC_API_KEY` | Claude API key for ARIA conclusions (Haiku model) |

Add these at:  
`https://github.com/aliciawondermarket-stack/jarvic07-awm88-daily-report/settings/secrets/actions`

## Netlify — Password Protection

Enable at:  
Netlify dashboard → Site settings → Access control → Password protection  
(Set under the `aliciawondermarket` team account)

## Umami Site IDs

| Site | ID |
|---|---|
| payroll.sevensprings.ch | `1691bd2c-21b7-40a3-ba16-736c71b024f3` |
| asodigital85.live       | `3659f422-0951-402e-a587-993625f41ed7` |
| sevensprings.ch         | `b874ae46-3512-4c28-af43-b6b384f4c1db` |

## Windsor.ai Connectors

| Connector | Account | Status |
|---|---|---|
| instagram | ASO Digital852 (17841463366470087) | ✅ Live |
| facebook_organic | ASoDigital85 (1021240474414243) | ⚠ Connected · zero data |
| linkedin_organic | SevenSprings (33458861) | ✅ Live |
| linkedin_organic | ASODigital85 (113205038) | ✅ Live |
| linkedin_organic | Bellerive (730505) | ⚠ Dormant |
| linkedin_organic | Getsecondopinion (80526384) | ○ Inactive |
| x_organic | asodigital85 | ⏳ Credentials submitted |

## Manual trigger

```bash
WINDSOR_API_KEY=xxx ANTHROPIC_API_KEY=xxx node scripts/generate-report.js
```

Or trigger via GitHub Actions → "Daily Intelligence Report" → "Run workflow".

## Report sections

1. Executive Summary (ARIA conclusions)
2. Instagram performance
3. Facebook Organic status
4. LinkedIn · 4 pages
5. X/Twitter · RELAY auto-posts
6. Content Queue (all platforms · NOVA drafts)
7. Web Analytics (Umami)
8. DEX Bot status
9. Project Status Pulse
10. Agent Directives (actionable, per-agent)
11. Data Quality Log
