import { KV } from "@upstash/redis"

const KEY = "page_visits"

let cache: { total: number; ts: number } | null = null

function cacheHit(ttlMs: number) {
  return cache && Date.now() - cache.ts < ttlMs
}

export default async function handler(req: any, res: any) {
  res.setHeader("Allow", "GET, POST")
  res.setHeader("X-Content-Type-Options", "nosniff")

  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    res.status(500).json({ error: "KV_REST_API_URL or KV_REST_API_TOKEN not configured" })
    return
  }

  const kv = new KV({ url, token })

  try {
    if (req.method === "POST") {
      // Increment once per client session (frontend guards with sessionStorage)
      const total = await kv.incr(KEY)
      cache = { total, ts: Date.now() }
      res.setHeader("Content-Type", "application/json")
      res.setHeader("Cache-Control", "no-store")
      res.status(200).json({ total })
      return
    }

    if (req.method === "GET") {
      let total: number
      if (cacheHit(3000)) {
        total = cache!.total
      } else {
        total = (await kv.get<number>(KEY)) ?? 0
        cache = { total, ts: Date.now() }
      }
      res.setHeader("Content-Type", "application/json")
      res.setHeader("Cache-Control", "public, s-maxage=3, stale-while-revalidate=60")
      res.status(200).json({ total })
      return
    }

    res.status(405).json({ error: "Method not allowed" })
  } catch {
    res.status(502).json({ error: "Failed to read visits" })
  }
}
