import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    build: {
      minify: true,
    },
    plugins: [
      react(),
      tailwindcss(),
      meteoriteProxy(env),
      discordNewsProxy(env),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
      strictPort: true,
    },
    preview: {
      host: '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
    },
  }
})

/** Proxies /api/leaderboard to the Meteorite API, injecting the secret key server-side. */
function meteoriteProxy(env: Record<string, string>): Plugin {
  const apiKey = env.METEORITE_API_KEY || process.env.METEORITE_API_KEY
  return {
    name: 'meteorite-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/leaderboard', async (_req, res) => {
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'METEORITE_API_KEY not configured' }))
          return
        }
        try {
          const upstream = await fetch('https://api.meteoritebot.com/v1/leaderboard', {
            headers: { Authorization: `Bearer ${apiKey}` },
          })
          res.setHeader('Content-Type', 'application/json')
          res.statusCode = upstream.status
          res.end(await upstream.text())
        } catch {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Failed to reach Meteorite API' }))
        }
      })
    },
  }
}

/** Fetches messages from a Discord announcement channel. */
function discordNewsProxy(env: Record<string, string>): Plugin {
  const token = env.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN
  const channelId = env.DISCORD_NEWS_CHANNEL_ID || process.env.DISCORD_NEWS_CHANNEL_ID
  const guildId = "1241243439283048470"

  let channelCache: Map<string, string> | null = null
  let roleCache: Map<string, string> | null = null
  let roleColorCache: Map<string, number> | null = null
  let memberCache: Map<string, string | null> | null = null

  async function getMentionMaps() {
    if (channelCache && roleCache && roleColorCache) return { channels: channelCache, roles: roleCache, roleColors: roleColorCache }
    const headers = { Authorization: `Bot ${token}` }
    try {
      const [chRes, rlRes] = await Promise.all([
        fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
        fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers }),
      ])
      channelCache = new Map<string, string>()
      roleCache = new Map<string, string>()
      roleColorCache = new Map<string, number>()
      if (chRes.ok) {
        const channels = await chRes.json() as any[]
        for (const c of channels) channelCache.set(c.id, c.name)
      }
      if (rlRes.ok) {
        const roles = await rlRes.json() as any[]
        for (const r of roles) {
          roleCache.set(r.id, r.name)
          if (r.color) roleColorCache.set(r.id, r.color)
        }
      }
    } catch {}
    return { channels: channelCache!, roles: roleCache!, roleColors: roleColorCache! }
  }

  async function getMemberColor(userId: string, roleColors: Map<string, number>): Promise<string | null> {
    if (!memberCache) memberCache = new Map()
    if (memberCache.has(userId)) return memberCache.get(userId)!
    memberCache.set(userId, null)
    try {
      const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
        headers: { Authorization: `Bot ${token}` },
      })
      if (r.ok) {
        const member = await r.json() as any
        let topColor: number | null = null
        for (const roleId of (member.roles || [])) {
          const c = roleColors.get(roleId)
          if (c && (topColor === null || c > topColor)) topColor = c
        }
        const hex = topColor !== null ? '#' + topColor.toString(16).padStart(6, '0') : null
        memberCache.set(userId, hex)
        return hex
      }
    } catch {}
    return null
  }

  function resolveMentions(text: string, channels: Map<string, string>, roles: Map<string, string>) {
    return text
      .replace(/<#(\d+)>/g, (_, id) => `\uE001${channels.get(id) || "channel"}\uE002`)
      .replace(/<@&(\d+)>/g, (_, id) => `\uE003${roles.get(id) || "role"}\uE004`)
      .replace(/<@!?(\d+)>/g, () => `\uE003user\uE004`)
  }

  return {
    name: 'discord-news-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/discord-news', async (_req, res) => {
        if (!token || !channelId) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'DISCORD_BOT_TOKEN or DISCORD_NEWS_CHANNEL_ID not configured' }))
          return
        }
        try {
          const { channels, roles, roleColors } = await getMentionMaps()
          const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=20`, {
            headers: { Authorization: `Bot ${token}` },
          })
          if (!r.ok) {
            res.statusCode = r.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `Discord API ${r.status}` }))
            return
          }
          const messages = await r.json() as any[]
          const today = new Date().toISOString().slice(0, 10)
          const stripMd = (s: string) => s.replace(/^#+\s*/, '').replace(/[*_~>`]/g, '').trim()

          const todayMsgs = messages
            .filter(m => new Date(m.timestamp).toISOString().slice(0, 10) >= today)
            .reverse()

          const grouped: any[] = []
          for (const m of todayMsgs) {
            const last = grouped[grouped.length - 1]
            if (last && last.author === m.author && Math.abs(new Date(m.timestamp).getTime() - last.timestamp) < 10 * 60 * 1000) {
              if (m.content && m.content.trim()) last.contents.push(m.content)
              if (m.attachments?.[0]?.content_type?.startsWith('image/') && !last.imageUrl) {
                last.imageUrl = m.attachments[0].url
              }
              if (m.embeds?.[0]) {
                last.embeds.push(m.embeds[0])
              }
              last.timestamp = new Date(m.timestamp).getTime()
            } else {
              grouped.push({
                id: m.id,
                author: m.author,
                timestamp: new Date(m.timestamp).getTime(),
                contents: m.content && m.content.trim() ? [m.content] : [],
                embeds: m.embeds || [],
                attachments: m.attachments || [],
                imageUrl: m.attachments?.[0]?.content_type?.startsWith('image/') ? m.attachments[0].url : undefined,
              })
            }
          }

          const news: any[] = []
          for (const g of grouped) {
            let title = "Announcement"
            let description = ""
            let imageUrl = g.imageUrl

            const allContent = g.contents.join('\n\n')
            if (allContent.trim()) {
              const lines = allContent.split('\n')
              title = stripMd(resolveMentions(lines[0], channels, roles)) || "Announcement"
              description = resolveMentions(lines.slice(1).join('\n').trim(), channels, roles)
            }

            for (const e of g.embeds) {
              if (e.title && !allContent.trim()) title = stripMd(resolveMentions(e.title, channels, roles))
              if (e.description) {
                const desc = resolveMentions(e.description, channels, roles)
                description = description ? description + '\n\n' + desc : desc
              }
              if (e.image?.url) imageUrl = e.image.url
              if (e.thumbnail?.url && !imageUrl) imageUrl = e.thumbnail.url
            }

            if (!title && !description && !imageUrl) continue
            news.push({
              id: g.id,
              title,
              text: description,
              author: g.author?.display_name || g.author?.username || g.author?.global_name || "Unknown",
              authorAvatar: g.author?.avatar ? `https://cdn.discordapp.com/avatars/${g.author.id}/${g.author.avatar}.png?size=64` : undefined,
              authorColor: await getMemberColor(g.author?.id || "", roleColors),
              date: new Date(g.timestamp).toISOString().slice(0, 10),
              imageUrl,
            })
          }
          news.reverse()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(news))
        } catch {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Failed to reach Discord API' }))
        }
      })
    },
  }
}
