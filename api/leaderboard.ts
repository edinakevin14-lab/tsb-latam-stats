export default async function handler(_req: any, res: any) {
  const apiKey = process.env.METEORITE_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: "METEORITE_API_KEY not configured" })
    return
  }
  try {
    const r = await fetch("https://api.meteoritebot.com/v1/leaderboard", {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    res.status(r.status).json(await r.json())
  } catch {
    res.status(502).json({ error: "Failed to reach Meteorite API" })
  }
}
