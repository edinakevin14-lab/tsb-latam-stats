let leaderboardCache: { data: any; ts: number } | null = null

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
    const r = await fetch("https://api.meteoritebot.com/v1/leaderboard", {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const data = await r.json()
    leaderboardCache = { data, ts: Date.now() }
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300")
    res.status(r.status).json(data)
  } catch {
    res.status(502).json({ error: "Failed to reach Meteorite API" })
  }
}
