import { useState, useEffect } from "react"

type Match = {
  timestamp: number
  result: string
  outcome: string
  opponent: string
}

type ApiPlayer = {
  discord_display_name: string
  profile_name: string
  roblox_username: string
  roblox_avatar_url: string | null
  region: string
  country: string
  top_position: number | string
  rank: string
  wl: string
  elo: number
  recent_matches: Match[]
  profile_verified: boolean
}

type LeaderboardEntry = {
  position: number
  profile_name: string
  roblox_username: string
  discord_display_name: string
  region: string
  country: string
  roblox_avatar_url: string
}

type ApiData = {
  registered_players: ApiPlayer[]
  leaderboard: LeaderboardEntry[]
  leaderboard_updated_at: number
  refreshed_at: number
  cache_ttl_seconds: number
}

type NewsItem = {
  id: number
  title: string
  date: string
  text: string
  imageUrl?: string
}

type ParsedRank = { phase: number; tier: string; subTier: string; value: number } | null

const C = {
  bg: "#0a0a0a",
  surface: "#161616",
  elevated: "#1f1f1f",
  border: "#2a2a2a",
  borderLight: "#333",
  text: "#e8e8e8",
  textDim: "#999",
  textMuted: "#666",
  accent: "#5c6cff",
  accentSoft: "#1a2240",
  win: "#4ade80",
  loss: "#f87171",
  winBg: "#0f2818",
  lossBg: "#2a1212",
}

const initialNews: NewsItem[] = []

const FLAG_FILES: Record<string, string> = {
  AR: "AR", BR: "BR", CL: "CL", CU: "CU", EC: "EC",
  MX: "MX", US: "US", UY: "UY", VE: "VE",
}

function parseWl(wl: string) {
  const m = wl.match(/(\d+)W\s*\/\s*(\d+)L\s*\(([\d.]+)\)/)
  if (!m) return { wins: 0, losses: 0, winrate: "0.00" }
  return { wins: Number(m[1]), losses: Number(m[2]), winrate: m[3] }
}

function posToInt(p: number | string) {
  return typeof p === "number" ? p : 9999
}

function parseRank(rank: string): ParsedRank {
  if (!rank || rank === "N/A") return null
  const m = rank.match(/Phase\s+(\d+)\s+(High|Mid|Low)\s+(Strong|Stable|Weak)/i)
  if (!m) return null
  const phase = Number(m[1])
  const tier = m[2].toLowerCase()
  const subTier = m[3].toLowerCase()
  const tierIdx = tier === "high" ? 0 : tier === "mid" ? 1 : 2
  const subIdx = subTier === "strong" ? 0 : subTier === "stable" ? 1 : 2
  const value = phase * 100 + tierIdx * 10 + subIdx
  return { phase, tier, subTier, value }
}

function rankValue(rank: string): number {
  const r = parseRank(rank)
  return r ? r.value : 99999
}

function detectCountry(region: string): { code: string; name: string } {
  const r = (region || "").toLowerCase().trim()

  // Specific region → flag mapping
  if (r === "miami, florida") return { code: "US", name: "USA" }
  if (r === "dallas, texas") return { code: "MX", name: "Mexico" }
  if (r === "los angeles, california") return { code: "MX", name: "Mexico" }
  if (r === "são paulo, brasil" || r === "sao paulo, brasil") return { code: "BR", name: "Brazil" }

  // LATAM countries by name
  const map: { keys: string[]; code: string; name: string }[] = [
    { keys: ["brasil", "brazil"], code: "BR", name: "Brazil" },
    { keys: ["argentin"], code: "AR", name: "Argentina" },
    { keys: ["chile"], code: "CL", name: "Chile" },
    { keys: ["uruguay"], code: "UY", name: "Uruguay" },
    { keys: ["cuba"], code: "CU", name: "Cuba" },
    { keys: ["ecuador"], code: "EC", name: "Ecuador" },
    { keys: ["venezuela"], code: "VE", name: "Venezuela" },
    { keys: ["mexico", "méxico"], code: "MX", name: "Mexico" },
  ]
  for (const c of map) {
    if (c.keys.some(k => r.includes(k))) return { code: c.code, name: c.name }
  }

  // Any other USA region or unknown → USA
  return { code: "US", name: "USA" }
}

function Flag({ code, size = 24 }: { code: string; size?: number }) {
  const file = FLAG_FILES[code]
  if (file) {
    return (
      <img
        src={`/flags/${file}.png`}
        alt={code}
        width={Math.round(size * 1.5)}
        height={size}
        style={{ borderRadius: 2, objectFit: "cover", flexShrink: 0, border: `1px solid ${C.border}` }}
      />
    )
  }
  return (
    <span style={{
      width: Math.round(size * 1.5), height: size, display: "inline-flex",
      alignItems: "center", justifyContent: "center", background: C.elevated,
      borderRadius: 2, fontSize: size * 0.4, fontWeight: 700, color: C.textDim,
      border: `1px solid ${C.border}`, flexShrink: 0,
    }}>
      {code}
    </span>
  )
}

function Avatar({ url, name, size = 40 }: { url: string | null; name: string; size?: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: `1px solid ${C.border}` }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: C.elevated,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.4, color: C.textDim, fontWeight: 700, flexShrink: 0,
    }}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let remaining = text
  let key = 0
  const push = (n: React.ReactNode) => { nodes.push(<span key={key++}>{n}</span>) }
  const mentionStyle = {
    background: C.accentSoft,
    color: C.accent,
    borderRadius: 3,
    padding: "0 4px",
    fontSize: 12.5,
    fontWeight: 600,
  }
  const patterns: { re: RegExp; render: (m: RegExpMatchArray) => React.ReactNode }[] = [
    { re: /\uE001(.+?)\uE002/, render: m => <span style={mentionStyle}>#{m[1]}</span> },
    { re: /\uE003(.+?)\uE004/, render: m => <span style={mentionStyle}>@{m[1]}</span> },
    { re: /\*\*(.+?)\*\*/, render: m => <strong>{m[1]}</strong> },
    { re: /__(.+?)__/, render: m => <u>{m[1]}</u> },
    { re: /~~(.+?)~~/, render: m => <s>{m[1]}</s> },
    { re: /\*(.+?)\*/, render: m => <em>{m[1]}</em> },
    { re: /_(.+?)_/, render: m => <em>{m[1]}</em> },
    { re: /`(.+?)`/, render: m => <code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3, fontSize: 12 }}>{m[1]}</code> },
  ]
  while (remaining.length > 0) {
    let earliest: { idx: number; match: RegExpMatchArray; render: (m: RegExpMatchArray) => React.ReactNode } | null = null
    for (const p of patterns) {
      const m = remaining.match(p.re)
      if (m && m.index !== undefined) {
        if (!earliest || m.index < earliest.idx) {
          earliest = { idx: m.index, match: m, render: p.render }
        }
      }
    }
    if (!earliest) {
      nodes.push(remaining)
      break
    }
    if (earliest.idx > 0) push(remaining.slice(0, earliest.idx))
    push(earliest.render(earliest.match))
    remaining = remaining.slice(earliest.idx + earliest.match[0].length)
  }
  return nodes
}

function DiscordMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let key = 0
  const flushList = () => {
    if (listItems.length === 0) return
    elements.push(
      <ul key={key++} style={{ margin: "4px 0", paddingLeft: 20, listStyle: "none" }}>
        {listItems.map((item, i) => (
          <li key={i} style={{ display: "flex", gap: 6, marginBottom: 2 }}>
            <span style={{ color: C.textMuted }}>•</span>
            <span>{parseInline(item)}</span>
          </li>
        ))}
      </ul>
    )
    listItems = []
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') { flushList(); continue }
    if (/^###\s+/.test(trimmed)) {
      flushList()
      elements.push(<div key={key++} style={{ fontSize: 15, fontWeight: 700, margin: "8px 0 4px", color: C.text }}>{parseInline(trimmed.replace(/^###\s*/, ''))}</div>)
    } else if (/^##\s+/.test(trimmed)) {
      flushList()
      elements.push(<div key={key++} style={{ fontSize: 16, fontWeight: 800, margin: "10px 0 4px", color: C.text }}>{parseInline(trimmed.replace(/^##\s*/, ''))}</div>)
    } else if (/^#\s+/.test(trimmed)) {
      flushList()
      elements.push(<div key={key++} style={{ fontSize: 18, fontWeight: 900, margin: "10px 0 6px", color: C.text }}>{parseInline(trimmed.replace(/^#\s*/, ''))}</div>)
    } else if (/^>\s?/.test(trimmed)) {
      flushList()
      elements.push(<div key={key++} style={{ borderLeft: `3px solid ${C.borderLight}`, paddingLeft: 12, margin: "4px 0", color: C.textDim }}>{parseInline(trimmed.replace(/^>\s?/, ''))}</div>)
    } else if (/^[-*]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s+/, ''))
    } else {
      flushList()
      elements.push(<div key={key++} style={{ margin: "3px 0", color: C.textDim }}>{parseInline(trimmed)}</div>)
    }
  }
  flushList()
  return <div style={{ fontSize: 13, lineHeight: 1.6 }}>{elements}</div>
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: "5px 8px", border: `1px solid ${C.borderLight}`, borderRadius: 3, fontSize: 12,
        background: C.elevated, color: C.text, outline: "none", cursor: "pointer",
      }}
      aria-label={label}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

const PHASE_OPTS = [
  { value: "all", label: "All phases" },
  { value: "0", label: "Phase 0" },
  { value: "1", label: "Phase 1" },
  { value: "2", label: "Phase 2" },
  { value: "3", label: "Phase 3" },
]
const TIER_OPTS = [
  { value: "all", label: "All tiers" },
  { value: "high", label: "High" },
  { value: "mid", label: "Mid" },
  { value: "low", label: "Low" },
]
const SUBTIER_OPTS = [
  { value: "all", label: "All sub-tiers" },
  { value: "strong", label: "Strong" },
  { value: "stable", label: "Stable" },
  { value: "weak", label: "Weak" },
]

type View = "home" | "rankings" | "countries"

export default function App() {
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [view, setView] = useState<View>("home")
  const [selected, setSelected] = useState<ApiPlayer | null>(null)
  const [search, setSearch] = useState("")

  const [phaseFilter, setPhaseFilter] = useState("all")
  const [tierFilter, setTierFilter] = useState("all")
  const [subTierFilter, setSubTierFilter] = useState("all")

  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)

  const [filtersOpen, setFiltersOpen] = useState(false)

  const [news, setNews] = useState<NewsItem[]>(initialNews)

  const [newsModal, setNewsModal] = useState<NewsItem | null>(null)

  useEffect(() => {
    fetch("/api/leaderboard")
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status)
        return r.json()
      })
      .then((d: ApiData) => {
        setData(d)
        const regions = [...new Set(d.registered_players.map(p => p.region === "N/A" ? "Unknown" : p.region))].sort()
        setSelectedRegion(regions[0] ?? null)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    const fetchNews = () =>
      fetch("/api/discord-news")
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json() })
        .then((items: NewsItem[]) => { if (items.length > 0) setNews(items) })
        .catch(() => {})
    fetchNews()
    const interval = setInterval(fetchNews, 3000)
    return () => clearInterval(interval)
  }, [])

  const sortedPlayers = data
    ? [...data.registered_players].sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
    : []

  function matchesFilter(p: ApiPlayer): boolean {
    const r = parseRank(p.rank)
    if (phaseFilter !== "all" && (!r || r.phase !== Number(phaseFilter))) return false
    if (tierFilter !== "all" && (!r || r.tier !== tierFilter)) return false
    if (subTierFilter !== "all" && (!r || r.subTier !== subTierFilter)) return false
    return true
  }

  const filteredByRank = sortedPlayers.filter(matchesFilter)

  const filtered = filteredByRank.filter(p =>
    p.profile_name.toLowerCase().includes(search.toLowerCase())
  )

  const filtersActive = phaseFilter !== "all" || tierFilter !== "all" || subTierFilter !== "all"

  function resetFilters() {
    setPhaseFilter("all"); setTierFilter("all"); setSubTierFilter("all")
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 16, color: C.textDim }}>Loading leaderboard…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, color: C.loss, marginBottom: 8 }}>Error: {error}</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Make sure the server and API key are configured.</div>
        </div>
      </div>
    )
  }

  const SA_WEST_REGIONS = ["Miami, Florida", "Dallas, Texas", "Los Angeles, California"]
  const SA_EAST_REGIONS = ["São Paulo, Brasil"]
  const categorizeRegion = (region: string) =>
    SA_WEST_REGIONS.includes(region) ? "SA West" : SA_EAST_REGIONS.includes(region) ? "SA East" : null

  const regionMap = new Map<string, ApiPlayer[]>()
  for (const p of sortedPlayers) {
    const cat = categorizeRegion(p.region)
    if (!cat) continue
    if (!regionMap.has(p.region)) regionMap.set(p.region, [])
    regionMap.get(p.region)!.push(p)
  }

  const countP1Verified = (players: ApiPlayer[]) =>
    players.filter(p => { const r = parseRank(p.rank); return r && r.phase === 1 && p.profile_verified }).length

  const regionCategories: {
    category: string; categoryM1: number;
    regions: { region: string; players: ApiPlayer[]; m1: number }[]
  }[] = (() => {
    const cats = new Map<string, { region: string; players: ApiPlayer[]; m1: number }[]>()
    for (const [region, players] of regionMap) {
      const cat = categorizeRegion(region)!
      if (!cats.has(cat)) cats.set(cat, [])
      cats.get(cat)!.push({ region, players, m1: countP1Verified(players) })
    }
    return Array.from(cats.entries())
      .map(([category, regions]) => ({
        category,
        categoryM1: regions.reduce((s, r) => s + r.m1, 0),
        regions: regions.sort((a, b) => b.m1 - a.m1 || b.players.length - a.players.length),
      }))
      .sort((a, b) => b.categoryM1 - a.categoryM1 || b.regions.reduce((s, r) => s + r.players.length, 0) - a.regions.reduce((s, r) => s + r.players.length, 0))
  })()

  const selectedCatData = (() => {
    if (!selectedRegion) return null
    for (const cat of regionCategories) {
      if (cat.category === selectedRegion) {
        return { type: "category" as const, category: cat.category, players: cat.regions.flatMap(r => r.players) }
      }
      for (const reg of cat.regions) {
        if (reg.region === selectedRegion) {
          return { type: "region" as const, region: reg.region, category: cat.category, players: reg.players }
        }
      }
    }
    return null
  })()

  const topCategory = regionCategories.reduce((best, c) => c.categoryM1 > (best?.categoryM1 ?? 0) ? c : best, regionCategories[0])

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "sans-serif", fontSize: 14, color: C.text }}>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>

      {/* Title bar */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        maxWidth: 1100, margin: "0 auto", boxSizing: "border-box", width: "100%",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, cursor: "pointer", color: C.text, display: "flex", alignItems: "center", gap: 10 }} onClick={() => { setView("home"); setSelected(null) }}>
            <img src="/tsb-logo.webp" alt="TSB Latam" width={32} height={32} style={{ borderRadius: "50%" }} />
            TSB Latam
          </h2>
          <nav style={{ display: "flex", gap: 16 }}>
            <button onClick={() => { setView("home"); setSelected(null) }} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: view === "home" ? 700 : 400, color: view === "home" ? C.accent : C.textDim, fontSize: 14 }}>Home</button>
            <button onClick={() => setView("rankings")} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: view === "rankings" ? 700 : 400, color: view === "rankings" ? C.accent : C.textDim, fontSize: 14 }}>Player Ranking</button>
            <button onClick={() => setView("countries")} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: view === "countries" ? 700 : 400, color: view === "countries" ? C.accent : C.textDim, fontSize: 14 }}>Region Ranking</button>
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, color: C.textDim }}>▾</span>
        </div>
      </div>

      {/* Home — Dashboard (no player selected) */}
      {view === "home" && !selected && data && (
        <div style={{
          maxWidth: 1100, margin: "0 auto", background: C.surface,
          border: "none", borderTop: "none", minHeight: "calc(100vh - 140px)",
        }}>
          {/* Hero stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, padding: 0, background: C.surface, borderBottom: `1px solid ${C.border}` }}>
            {(() => {
              const total = data.registered_players.length
              const p1 = countP1Verified(data.registered_players)
              const regions = new Set(data.registered_players.map(p => p.region).filter(r => r !== "N/A")).size
              const top = [...data.registered_players].sort((a, b) => posToInt(a.top_position) - posToInt(b.top_position))[0]
              return [
                { label: "Registered", value: total },
                { label: "P1 Verified", value: p1 },
                { label: "Regions", value: regions },
                { label: "#1 Player", value: top ? top.profile_name : "-" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "20px 18px", display: "flex", flexDirection: "column", gap: 4, borderRight: i < 3 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: s.label === "#1 Player" ? C.win : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.value}</span>
                </div>
              ))
            })()}
          </div>

          {/* Search bar */}
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ position: "relative", maxWidth: 500, margin: "0 auto" }}>
              <input
                type="text" placeholder="Search players..." value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", border: `1px solid ${C.borderLight}`, borderRadius: 4, fontSize: 14, outline: "none", boxSizing: "border-box", color: C.text, background: C.elevated }}
              />
            </div>
          </div>

          {/* Content: recently registered + news */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px" }}>
            <div style={{ padding: "20px 24px" }}>
              <h4 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {search ? `Results (${filtered.length})` : "Recently Registered"}
              </h4>
              {filtered.length === 0 ? (
                <div style={{ padding: 20, color: C.textMuted, fontSize: 13, textAlign: "center" }}>No players found.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {(search ? filtered : sortedPlayers.slice().reverse()).slice(0, 24).map((p, i) => {
                    const r = parseRank(p.rank)
                    return (
                      <button
                        key={p.discord_display_name + i}
                        onClick={() => setSelected(p)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                          background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 4,
                          cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <Avatar url={p.roblox_avatar_url} name={p.profile_name} size={32} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div title={p.profile_verified ? "Rank verified" : undefined} style={{ fontWeight: 700, fontSize: 13, color: p.profile_verified ? C.win : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.profile_name}</div>
                          <div style={{ fontSize: 11, color: C.textMuted }}>{p.rank === "N/A" ? "Unranked" : p.rank}{r && ` · P${r.phase}`}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* News column */}
            <div style={{ overflowY: "auto", background: C.elevated, padding: "20px 20px" }}>
              <h4 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#ef4444",
                  display: "inline-block", animation: "blink 1.5s ease-in-out infinite",
                }} />
                News
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {news.length === 0 ? (
                  <div style={{ color: C.textMuted, fontSize: 13, padding: "20px 0", textAlign: "center" }}>No news yet.</div>
                ) : news.map((n) => (
                  <div key={n.id} style={{
                    padding: "14px 16px", background: C.surface, borderRadius: 6, cursor: "pointer",
                  }} onClick={() => setNewsModal(n)}>
                    {n.imageUrl && (
                      <div style={{ marginBottom: 10, borderRadius: 4, overflow: "hidden" }}>
                        <img src={n.imageUrl} alt={n.title} style={{ width: "100%", display: "block", objectFit: "cover", maxHeight: 140 }} />
                      </div>
                    )}
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: C.text }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{n.date}</div>
                    {n.text && <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, maxHeight: 66, overflow: "hidden" }}><DiscordMarkdown text={n.text} /></div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Home — Player detail */}
      {view === "home" && selected && (
        <div style={{
          maxWidth: 1100, margin: "0 auto", display: "grid",
          gridTemplateColumns: "1fr 340px", background: C.surface,
          border: "none", borderTop: "none", minHeight: "calc(100vh - 140px)",
        }}>
          {/* Player detail */}
          <div style={{ padding: "28px 32px" }}>
            <button
              onClick={() => setSelected(null)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13, color: C.textDim, fontWeight: 700, marginBottom: 24 }}
            >
              ← Back
            </button>

            {/* Player header */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
              <Avatar url={selected.roblox_avatar_url} name={selected.profile_name} size={64} />
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span title={selected.profile_verified ? "Rank verified" : undefined} style={{ fontSize: 24, fontWeight: 800, color: selected.profile_verified ? C.win : C.text }}>
                    {selected.profile_name}
                  </span>
                  {selected.top_position !== "N/A" && (
                    <span style={{ fontSize: 13, color: C.textMuted }}>#{selected.top_position}</span>
                  )}
                </div>
                {selected.roblox_username !== "N/A" && (
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Roblox: {selected.roblox_username}</div>
                )}
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              {[
                { label: "Rank", value: selected.rank === "N/A" ? "Unranked" : selected.rank },
                { label: "Region", value: selected.region === "N/A" ? "N/A" : selected.region },
                { label: "ELO", value: String(selected.elo) },
              ].map((s, idx) => (
                <div key={idx} style={{ background: C.elevated, padding: "14px 16px", borderRadius: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{s.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Winrate", value: `${parseWl(selected.wl).winrate}%` },
                { label: "Record", value: (() => { const w = parseWl(selected.wl); return `${w.wins}W / ${w.losses}L` })() },
              ].map((s, idx) => (
                <div key={idx} style={{ background: C.elevated, padding: "14px 16px", borderRadius: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Recent matches */}
            {selected.recent_matches.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>Recent matches</h4>
                {selected.recent_matches.map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                    <span style={{
                      fontWeight: 700, padding: "1px 7px", fontSize: 11,
                      color: m.outcome === "W" ? C.win : C.loss,
                    }}>
                      {m.outcome === "W" ? "W" : "L"}
                    </span>
                    <span style={{ color: C.textDim, flex: 1 }}>vs {m.opponent}</span>
                    <span style={{ color: C.textMuted, fontSize: 12 }}>{m.result}</span>
                    <span style={{ color: C.textMuted, fontSize: 11 }}>{new Date(m.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* News column */}
          <div style={{ overflowY: "auto", background: C.elevated, padding: "20px 20px" }}>
            <h4 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "#ef4444",
                display: "inline-block", animation: "blink 1.5s ease-in-out infinite",
              }} />
              News
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {news.map((n) => (
                <div key={n.id} style={{
                  padding: "14px 16px", background: C.surface, borderRadius: 6, cursor: "pointer",
                }} onClick={() => setNewsModal(n)}>
                  {n.imageUrl && (
                    <div style={{ marginBottom: 10, borderRadius: 4, overflow: "hidden" }}>
                      <img src={n.imageUrl} alt={n.title} style={{ width: "100%", display: "block", objectFit: "cover", maxHeight: 140 }} />
                    </div>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: C.text }}>{n.title}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{n.date}</div>
                  <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, maxHeight: 66, overflow: "hidden" }}><DiscordMarkdown text={n.text} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {view === "rankings" && data && (
        <div style={{
          maxWidth: 1100, margin: "0 auto", display: "grid",
          gridTemplateColumns: "1fr 340px", background: C.surface,
          border: "none", borderTop: "none", minHeight: "calc(100vh - 140px)",
        }}>
          <div style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Player Ranking — Top {data.leaderboard.length}</h3>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => setFiltersOpen(f => !f)}
                  style={{
                    padding: "5px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 3,
                    cursor: "pointer", fontSize: 12, background: filtersOpen ? C.accentSoft : C.elevated,
                    color: filtersOpen ? C.accent : C.textDim,
                  }}
                >Filters</button>
                {filtersOpen && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <Select value={phaseFilter} onChange={setPhaseFilter} options={PHASE_OPTS} label="Phase" />
                    <Select value={tierFilter} onChange={setTierFilter} options={TIER_OPTS} label="Tier" />
                    <Select value={subTierFilter} onChange={setSubTierFilter} options={SUBTIER_OPTS} label="Sub-tier" />
                    {filtersActive && (
                      <button onClick={resetFilters} style={{ padding: "5px 8px", border: `1px solid ${C.borderLight}`, borderRadius: 3, cursor: "pointer", background: "none", color: C.textDim, fontSize: 12 }}>Clear</button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.elevated }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: C.textDim }}>#</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: C.textDim }}>Player</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: C.textDim }}>Rank</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: C.textDim }}>Roblox</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: C.textDim }}>Region</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard
                  .map(p => ({ p, detail: data.registered_players.find(pl => pl.profile_name === p.profile_name) }))
                  .filter(({ detail }) => !filtersActive || (detail ? matchesFilter(detail) : false))
                  .map(({ p, detail }) => (
                    <tr
                      key={p.position}
                      style={{ cursor: detail ? "pointer" : "default" }}
                      onClick={() => { if (detail) { setSelected(detail); setView("home") } }}
                    >
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: p.position <= 3 ? C.accent : C.text, fontSize: 14 }}>#{p.position}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Avatar url={p.roblox_avatar_url} name={p.profile_name} size={28} />
                          <span title={detail?.profile_verified ? "Rank verified" : undefined} style={{ fontWeight: 700, color: detail?.profile_verified ? C.win : C.text }}>{p.profile_name}</span>
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", color: C.textDim }}>{detail ? (detail.rank === "N/A" ? "Unranked" : detail.rank) : "-"}</td>
                      <td style={{ padding: "10px 12px", color: C.textDim }}>{p.roblox_username !== "N/A" ? p.roblox_username : "-"}</td>
                      <td style={{ padding: "10px 12px", color: C.textDim }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Flag code={detectCountry(p.region).code} size={16} />
                          {p.region}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* News column */}
          <div style={{ overflowY: "auto", background: C.elevated, padding: "20px 20px" }}>
            <h4 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "#ef4444",
                display: "inline-block", animation: "blink 1.5s ease-in-out infinite",
              }} />
              News
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {news.map((n) => (
                <div key={n.id} style={{
                  padding: "14px 16px", background: C.surface, borderRadius: 6, cursor: "pointer",
                }} onClick={() => setNewsModal(n)}>
                  {n.imageUrl && (
                    <div style={{ marginBottom: 10, borderRadius: 4, overflow: "hidden" }}>
                      <img src={n.imageUrl} alt={n.title} style={{ width: "100%", display: "block", objectFit: "cover", maxHeight: 140 }} />
                    </div>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: C.text }}>{n.title}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{n.date}</div>
                  <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, maxHeight: 66, overflow: "hidden" }}><DiscordMarkdown text={n.text} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Latam Side view */}
      {view === "countries" && (
        <div style={{
          maxWidth: 1100, margin: "0 auto", display: "grid",
          gridTemplateColumns: "220px 1fr 340px", background: C.surface,
          border: "none", borderTop: "none", minHeight: "calc(100vh - 140px)",
        }}>
          {/* Left — region list */}
          <div style={{ borderRight: "none" }}>
            <div style={{ padding: "10px 10px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>Region Ranking</h3>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setFiltersOpen(f => !f)}
                  style={{
                    padding: "5px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 3,
                    cursor: "pointer", fontSize: 12, background: filtersOpen ? C.accentSoft : C.elevated,
                    color: filtersOpen ? C.accent : C.textDim, flex: 1,
                  }}
                >Filters</button>
              </div>
              {filtersOpen && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Select value={phaseFilter} onChange={setPhaseFilter} options={PHASE_OPTS} label="Phase" />
                  <Select value={tierFilter} onChange={setTierFilter} options={TIER_OPTS} label="Tier" />
                  <Select value={subTierFilter} onChange={setSubTierFilter} options={SUBTIER_OPTS} label="Sub-tier" />
                  {filtersActive && (
                    <button onClick={resetFilters} style={{ padding: "5px 8px", border: `1px solid ${C.borderLight}`, borderRadius: 3, cursor: "pointer", background: "none", color: C.textDim, fontSize: 12 }}>Clear</button>
                  )}
                </div>
              )}
            </div>

            <div style={{ overflowY: "auto", maxHeight: 480 }}>
              {regionCategories.map(cat => {
                const isTop = topCategory && topCategory.category === cat.category && cat.categoryM1 > 0
                return (
                <div key={cat.category}>
                  <button
                    onClick={() => setSelectedRegion(cat.category)}
                    style={{
                      width: "100%", background: selectedRegion === cat.category ? C.accentSoft : "transparent",
                      border: "none", padding: "8px 12px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontSize: 13,
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <span style={{
                      fontWeight: 700, color: selectedRegion === cat.category ? C.accent : C.textMuted,
                      fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, flex: 1,
                    }}>
                      {isTop && <span style={{ marginRight: 4 }}>#1</span>}
                      {cat.category}
                    </span>
                    {cat.categoryM1 > 0 && (
                      <span style={{ fontSize: 10, color: C.text, fontWeight: 700 }}>P1 Verified: {cat.categoryM1}</span>
                    )}
                  </button>
                  {cat.regions.map(reg => {
                    const count = reg.players.filter(matchesFilter).length
                    return (
                      <button
                        key={reg.region}
                        onClick={() => setSelectedRegion(reg.region)}
                        style={{
                          width: "100%", background: selectedRegion === reg.region ? C.accentSoft : "transparent",
                          border: "none", padding: "6px 12px 6px 22px", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 8, textAlign: "left", fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: selectedRegion === reg.region ? 700 : 400, color: selectedRegion === reg.region ? C.accent : C.text, flex: 1 }}>
                          {reg.region}
                        </span>
                        {reg.m1 > 0 && (
                          <span style={{ fontSize: 10, color: C.text, fontWeight: 700, marginRight: 4 }}>P1 Verified: {reg.m1}</span>
                        )}
                        <span style={{
                          fontSize: 11, color: C.textMuted, background: C.bg,
                          padding: "1px 7px", borderRadius: 8,
                        }}>{count}</span>
                      </button>
                    )
                  })}
                </div>
                )
              })}
            </div>
          </div>

          {/* Right — players of selected region/category */}
          <div style={{ padding: "16px 20px" }}>
            {selectedCatData && (() => {
              const players = selectedCatData.players.filter(matchesFilter)
              const m1Count = countP1Verified(players)
              const title = selectedCatData.type === "category" ? selectedCatData.category : selectedCatData.region
              const subtitle = selectedCatData.type === "category"
                ? `${selectedCatData.players.length} players across ${regionCategories.find(c => c.category === selectedCatData.category)?.regions.length ?? 0} regions`
                : selectedCatData.category
              return (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{title}</span>
                    <span style={{ fontSize: 13, color: C.textMuted, marginLeft: 10 }}>{players.length} player{players.length !== 1 ? "s" : ""}</span>
                    {m1Count > 0 && (
                      <span style={{ fontSize: 13, color: C.text, fontWeight: 700, marginLeft: 10 }}>· P1 Verified: {m1Count}</span>
                    )}
                    {selectedCatData.type === "category" && (
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{subtitle}</div>
                    )}
                  </div>
                  {players.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.textMuted, padding: "20px 0" }}>No players match the current filters.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {players.map((p, i) => {
                        const wl = parseWl(p.wl)
                        return (
                          <div
                            key={p.discord_display_name + i}
                            style={{
                              display: "flex", alignItems: "center", gap: 12,
                              padding: "10px 12px", borderRadius: 4, cursor: "pointer",
                            }}
                            onClick={() => { setSelected(p); setView("home") }}
                          >
                            <span style={{ fontWeight: 700, color: C.accent, width: 28, flexShrink: 0, fontSize: 13, textAlign: "right" }}>{i + 1}</span>
                            <Avatar url={p.roblox_avatar_url} name={p.profile_name} size={30} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div title={p.profile_verified ? "Rank verified" : undefined} style={{ fontWeight: 700, color: p.profile_verified ? C.win : C.text, fontSize: 14 }}>{p.profile_name}</div>
                              {p.roblox_username !== "N/A" && (
                                <div style={{ fontSize: 11, color: C.textMuted }}>{p.roblox_username}</div>
                              )}
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 12, color: C.textDim, fontWeight: 500 }}>{p.rank === "N/A" ? "Unranked" : p.rank}</div>
                              <div style={{ fontSize: 11, color: C.textMuted }}>{wl.winrate}% · {wl.wins}W / {wl.losses}L</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )
            })()}
            {!selectedCatData && (
              <div style={{ fontSize: 13, color: C.textMuted, padding: "20px 0" }}>Select a region or category to view players.</div>
            )}
          </div>

          {/* News column */}
          <div style={{ overflowY: "auto", background: C.elevated, padding: "20px 20px" }}>
            <h4 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "#ef4444",
                display: "inline-block", animation: "blink 1.5s ease-in-out infinite",
              }} />
              News
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {news.map((n) => (
                <div key={n.id} style={{
                  padding: "14px 16px", background: C.surface, borderRadius: 6, cursor: "pointer",
                }} onClick={() => setNewsModal(n)}>
                  {n.imageUrl && (
                    <div style={{ marginBottom: 10, borderRadius: 4, overflow: "hidden" }}>
                      <img src={n.imageUrl} alt={n.title} style={{ width: "100%", display: "block", objectFit: "cover", maxHeight: 140 }} />
                    </div>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: C.text }}>{n.title}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{n.date}</div>
                  <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, maxHeight: 66, overflow: "hidden" }}><DiscordMarkdown text={n.text} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      {data && (
        <div style={{
          maxWidth: 1100, margin: "0 auto", background: C.surface, border: `1px solid ${C.border}`,
          borderTop: "none", padding: "16px 24px", display: "flex", alignItems: "center",
          justifyContent: "space-between", boxSizing: "border-box", width: "100%",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: C.textDim, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: C.text }}>LB LATAM — Meteorite API</span>
            <span>Discord: <a href="#" style={{ color: C.accent, textDecoration: "none" }}>discord.gg/tsbl</a></span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.win, display: "inline-block" }} />
              {data.registered_players.length} players
            </span>
            <span style={{ color: C.textMuted }}>Updated: {new Date(data.refreshed_at * 1000).toLocaleString()}</span>
          </div>
          <span style={{ fontSize: 11, color: C.textMuted }}>© 2026 LB LATAM</span>
        </div>
      )}

      {/* News modal */}
      {newsModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }} onClick={() => setNewsModal(null)}>
          <div style={{ background: C.surface, borderRadius: 8, padding: 28, width: 540, maxWidth: "90vw", maxHeight: "80vh", overflowY: "auto", boxSizing: "border-box" }} onClick={e => e.stopPropagation()}>
            {newsModal.imageUrl && (
              <div style={{ marginBottom: 16, borderRadius: 6, overflow: "hidden" }}>
                <img src={newsModal.imageUrl} alt={newsModal.title} style={{ width: "100%", display: "block", objectFit: "cover", maxHeight: 280 }} />
              </div>
            )}
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, color: C.text }}>{newsModal.title}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16 }}>{newsModal.date}</div>
            {newsModal.text && <div style={{ fontSize: 14, color: C.textDim, lineHeight: 1.7 }}><DiscordMarkdown text={newsModal.text} /></div>}
            <button onClick={() => setNewsModal(null)} style={{ marginTop: 20, padding: "8px 16px", background: C.elevated, border: `1px solid ${C.borderLight}`, borderRadius: 4, cursor: "pointer", color: C.textDim, fontSize: 13 }}>Close</button>
          </div>
        </div>
      )}

    </div>
  )
}
