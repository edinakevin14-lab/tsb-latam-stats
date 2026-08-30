let leaderboardCache: { data: any; ts: number } | null = null

/** Picks the active leaderboard: the first one (by slot) that has entries. */
function pickLeaderboard(leaderboards: any[]) {
  const withEntries = [...leaderboards]
    .filter((lb) => lb && Array.isArray(lb.entries) && lb.entries.length > 0)
    .sort((a, b) => (a.slot || 0) - (b.slot || 0))
  return withEntries[0] || leaderboards[0] || null
}

function mapRegisteredPlayers(players: any[]): any[] {
  return players.map((p) => {
    const memberships: { slot?: number; position?: number }[] = Array.isArray(p.leaderboard_memberships)
      ? p.leaderboard_memberships
      : []
    const positions = memberships
      .map((m) => m.position)
      .filter((p2): p2 is number => typeof p2 === "number" && p2 > 0)
    const topPosition = positions.length ? Math.min(...positions) : "N/A"
    return { ...p, top_position: topPosition }
  })
}

/** Transforms the new /v2/leaderboards response into the shape the frontend expects. */
function transform(data: any): any {
  const leaderboards = Array.isArray(data.leaderboards) ? data.leaderboards : []
  const lb = pickLeaderboard(leaderboards)
  const leaderboard = lb && Array.isArray(lb.entries) ? lb.entries : []
  return {
    registered_players: Array.isArray(data.registered_players)
      ? mapRegisteredPlayers(data.registered_players as any[])
      : [],
    leaderboard,
    leaderboard_updated_at: lb && lb.updated_at != null ? lb.updated_at : Date.now(),
    refreshed_at: data.refreshed_at,
    cache_ttl_seconds: data.cache_ttl_seconds,
    server: data.server,
    leaderboards: leaderboards.map((l) => ({
      slot: l.slot,
      name: l.name,
      updated_at: l.updated_at,
      appearance: l.appearance,
      entries: l.entries,
    })),
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Allow", "GET")
  res.setHeader("X-Content-Type-Options", "nosniff")

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  if (leaderboardCache && Date.now() - leaderboardCache.ts < 30000) {
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300")
    res.status(200).json(leaderboardCache.data)
    return
  }

  const apiKey = process.env.METEORITE_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: "METEORITE_API_KEY not configured" })
    return
  }
  try {
    const r = await fetch("https://api.meteoritebot.com/v2/leaderboards", {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const raw = await r.json()
    if (!r.ok) {
      res.status(r.status).json(raw)
      return
    }
    const data = transform(raw)
    leaderboardCache = { data, ts: Date.now() }
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300")
    res.status(200).json(data)
  } catch {
    res.status(502).json({ error: "Failed to reach Meteorite API" })
  }
}
