const GUILD_ID = "1241243439283048470"

let channelCache: Map<string, string> | null = null
let roleCache: Map<string, string> | null = null
let roleColorCache: Map<string, number> | null = null
let memberCache: Map<string, string | null> | null = null
let newsCache: { data: any[]; ts: number } | null = null

function resolveMentions(text: string, channels: Map<string, string>, roles: Map<string, string>) {
  return text
    .replace(/<#(\d+)>/g, (_, id) => `\uE001${channels.get(id) || "channel"}\uE002`)
    .replace(/<@&(\d+)>/g, (_, id) => `\uE003${roles.get(id) || "role"}\uE004`)
    .replace(/<@!?(\d+)>/g, () => `\uE003user\uE004`)
}

export default async function handler(req: any, res: any) {
  res.setHeader("Allow", "GET")
  res.setHeader("X-Content-Type-Options", "nosniff")

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  if (newsCache && Date.now() - newsCache.ts < 15000) {
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=300")
    res.status(200).json(newsCache.data)
    return
  }
  const token = process.env.DISCORD_BOT_TOKEN
  const channelId = process.env.DISCORD_NEWS_CHANNEL_ID
  if (!token || !channelId) {
    res.status(500).json({ error: "DISCORD_BOT_TOKEN or DISCORD_NEWS_CHANNEL_ID not configured" })
    return
  }
  try {
    const headers = { Authorization: `Bot ${token}` }

    if (!channelCache || !roleCache || !roleColorCache) {
      channelCache = new Map()
      roleCache = new Map()
      roleColorCache = new Map()
      const [chRes, rlRes] = await Promise.all([
        fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`, { headers }),
        fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, { headers }),
      ])
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
    }

    if (!memberCache) memberCache = new Map()

    async function getMemberColor(userId: string): Promise<string | null> {
      if (memberCache!.has(userId)) return memberCache!.get(userId)!
      memberCache!.set(userId, null)
      try {
        const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, { headers })
        if (r.ok) {
          const member = await r.json() as any
          let topColor: number | null = null
          for (const roleId of (member.roles || [])) {
            const c = roleColorCache!.get(roleId)
            if (c && (topColor === null || c > topColor)) topColor = c
          }
          const hex = topColor !== null ? "#" + topColor.toString(16).padStart(6, "0") : null
          memberCache!.set(userId, hex)
          return hex
        }
      } catch {}
      return null
    }

    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=20`, { headers })
    if (!r.ok) {
      res.status(r.status).json({ error: `Discord API ${r.status}` })
      return
    }

    const messages = await r.json() as any[]
    const today = new Date().toISOString().slice(0, 10)
    const stripMd = (s: string) => s.replace(/^#+\s*/, "").replace(/[*_~>`]/g, "").trim()

    const todayMsgs = messages
      .filter(m => new Date(m.timestamp).toISOString().slice(0, 10) >= today)
      .reverse()

    const grouped: any[] = []
    for (const m of todayMsgs) {
      const last = grouped[grouped.length - 1]
      if (last && last.author === m.author.id && Math.abs(new Date(m.timestamp).getTime() - last.timestamp) < 10 * 60 * 1000) {
        if (m.content && m.content.trim()) last.contents.push(m.content)
        if (m.attachments?.[0]?.content_type?.startsWith("image/") && !last.imageUrl) {
          last.imageUrl = m.attachments[0].url
        }
        if (m.embeds?.[0]) last.embeds.push(m.embeds[0])
        last.timestamp = new Date(m.timestamp).getTime()
      } else {
        grouped.push({
          id: m.id,
          author: m.author,
          timestamp: new Date(m.timestamp).getTime(),
          contents: m.content && m.content.trim() ? [m.content] : [],
          embeds: m.embeds || [],
          imageUrl: m.attachments?.[0]?.content_type?.startsWith("image/") ? m.attachments[0].url : undefined,
        })
      }
    }

    const news: any[] = []
    for (const g of grouped) {
      let title = "Announcement"
      let description = ""
      let imageUrl = g.imageUrl

      const allContent = g.contents.join("\n\n")
      if (allContent.trim()) {
        const lines = allContent.split("\n")
        title = stripMd(resolveMentions(lines[0], channelCache, roleCache)) || "Announcement"
        description = resolveMentions(lines.slice(1).join("\n").trim(), channelCache, roleCache)
      }

      for (const e of g.embeds) {
        if (e.title && !allContent.trim()) title = stripMd(resolveMentions(e.title, channelCache, roleCache))
        if (e.description) {
          const desc = resolveMentions(e.description, channelCache, roleCache)
          description = description ? description + "\n\n" + desc : desc
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
        authorColor: await getMemberColor(g.author?.id || ""),
        date: new Date(g.timestamp).toISOString().slice(0, 10),
        imageUrl,
      })
    }
    news.reverse()
    newsCache = { data: news, ts: Date.now() }
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=300")
    res.status(200).json(news)
  } catch {
    res.status(502).json({ error: "Failed to reach Discord API" })
  }
}
