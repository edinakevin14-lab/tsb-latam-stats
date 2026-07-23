# TSB Latam — Stats Viewer

Web app that displays player stats, rankings, and Discord announcements for the TSB Latam community.

## Tech Stack

- React 19 + Vite 8 + Tailwind CSS v4
- Vercel (hosting + serverless functions)
- Discord Bot API (for news)
- Meteorite Bot API (for player data)

## Development

```bash
npm install
npm run dev    # Dev server on http://localhost:8443
npm run build  # Production build to dist/
```

## Environment Variables (.env)

Create a `.env` file with:

```
METEORITE_API_KEY=<key from meteoritebot.com>
DISCORD_BOT_TOKEN=<bot token from Discord Developer Portal>
DISCORD_NEWS_CHANNEL_ID=<announcement channel ID>
```

These are NOT in the repo (gitignored). If starting from scratch, ask the user for these values.

## Project Structure

- `src/App.tsx` — Main component (~1000 lines): Dashboard, Player Ranking, Region Ranking, news modal, Discord markdown renderer
- `api/leaderboard.ts` — Vercel serverless function: proxies Meteorite API (GET only, cached 30s)
- `api/discord-news.ts` — Vercel serverless function: fetches Discord announcements (GET only, cached 15s, resolves mentions, groups messages, shows author role color)
- `vite.config.ts` — Dev server config with same proxies for local dev
- `vercel.json` — Vercel config with security headers (CSP, X-Frame-Options, etc.)
- `public/flags/` — Country flag PNGs (AR, BR, CL, CU, EC, MX, US, UY, VE)
- `public/tsb-logo.webp` — Server logo

## Features

### Home (Dashboard)
- 4 stat cards: Registered, P1 Verified, Regions, #1 Player
- Search bar
- Recently Registered player grid (click to see detail)
- News column (Discord announcements)

### Player Ranking
- Leaderboard table with position, player, rank, region (with flag)
- Filters: Phase, Tier, Sub-tier
- News column

### Region Ranking
- Regions grouped into SA West (Dallas, LA, Miami) and SA East (São Paulo)
- #1 badge on the category with most P1 verified players
- P1 Verified count per region and category
- Players list when selecting a region/category
- News column

### News
- Fetched from Discord announcement channel (today's messages only)
- Grouped by author (10 min window)
- Discord markdown rendered (headers, bold, italic, lists, blockquotes, code)
- Mentions shown as pills (#channel, @role, @user)
- Author avatar + name with role color
- Click to open modal with full content
- Polls every 15 seconds

### Player Detail
- Avatar, name (green if verified), position
- Stats: Rank, Region, ELO, Winrate, Record
- Recent matches (W/L vs opponent)

## Design

Dark theme: #0a0a0a bg, #161616 surface, #1f1f1f elevated, #5c6cff accent, #4ade80 verified.
Minimalist, no emojis as icons, no gradients, no shadows.

## Deployment

Deployed on Vercel. Push to `master` triggers automatic rebuild.
Set env vars in Vercel project settings.

## Git

```bash
git add -A
git -c user.email="dev@tsblatam.com" -c user.name="TSB Latam" commit -m "message"
git push origin master
```

## Discord Bot Setup

1. Create app at discord.com/developers/applications
2. Get bot token from Bot tab
3. Invite bot to server with View Channels + Read Message History permissions
4. Channel ID: enable Developer Mode in Discord, right-click channel → Copy ID
5. The announcement channel must be type "Anuncio" (GUILD_ANNOUNCEMENT)
