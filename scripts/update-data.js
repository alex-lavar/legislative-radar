/**
 * update-data.js
 * 
 * Runs on a schedule via GitHub Actions.
 * 1. Fetches recent + upcoming bills from Congress.gov API
 * 2. Fetches real vote data for recently voted bills
 * 3. Fetches stock price moves around vote dates from Yahoo Finance
 * 4. Calls Claude API to generate summaries, pass likelihood, stock analysis
 * 5. Merges with existing bills.json (preserves manual data, updates stale data)
 * 6. Writes updated bills.json
 * 
 * Required env vars (set as GitHub Actions secrets):
 *   CONGRESS_API_KEY    — from api.congress.gov/sign-up/
 *   ANTHROPIC_API_KEY   — from console.anthropic.com
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_PATH = path.join(__dirname, '../data/bills.json')

const CONGRESS_KEY = process.env.CONGRESS_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const CONGRESS = 119  // Current congress number
const BASE_URL = 'https://api.congress.gov/v3'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.json()
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function weeksAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n * 7)
  return d.toISOString().split('T')[0]
}

// ─── CONGRESS.GOV API ────────────────────────────────────────────────────────

/**
 * Get bills that have had floor action in the past N weeks
 * Uses the /bill endpoint filtered by updateDate to find recently active bills
 */
async function fetchRecentlyActiveBills(weeksBack = 4) {
  const fromDate = weeksAgo(weeksBack)
  const url = `${BASE_URL}/bill/${CONGRESS}?fromDateTime=${fromDate}T00:00:00Z&sort=updateDate+desc&limit=50&api_key=${CONGRESS_KEY}`
  
  console.log(`Fetching bills updated since ${fromDate}...`)
  const data = await fetchJSON(url)
  return data.bills || []
}

/**
 * Get full detail for a specific bill
 */
async function fetchBillDetail(congress, type, number) {
  const url = `${BASE_URL}/bill/${congress}/${type}/${number}?api_key=${CONGRESS_KEY}`
  const data = await fetchJSON(url)
  return data.bill || null
}

/**
 * Get actions for a bill (includes floor scheduling, votes)
 */
async function fetchBillActions(congress, type, number) {
  const url = `${BASE_URL}/bill/${congress}/${type}/${number}/actions?limit=20&api_key=${CONGRESS_KEY}`
  const data = await fetchJSON(url)
  return data.actions || []
}

/**
 * Get CRS summary for a bill
 */
async function fetchBillSummary(congress, type, number) {
  const url = `${BASE_URL}/bill/${congress}/${type}/${number}/summaries?api_key=${CONGRESS_KEY}`
  const data = await fetchJSON(url)
  const summaries = data.summaries || []
  // Return the most recent summary
  return summaries.length > 0 ? summaries[summaries.length - 1].text : null
}

/**
 * Parse bill type and number from a congressBillId like "119/hr/2289"
 */
function parseBillId(congressBillId) {
  if (!congressBillId) return null
  const parts = congressBillId.split('/')
  if (parts.length !== 3) return null
  return { congress: parts[0], type: parts[1], number: parts[2] }
}

/**
 * Determine if a bill has been scheduled for floor action based on its actions
 */
function hasFloorAction(actions) {
  const floorKeywords = ['Placed on the Union Calendar', 'Scheduled for floor', 'Rule providing', 'Suspension of the Rules']
  return actions.some(a => floorKeywords.some(kw => a.text && a.text.includes(kw)))
}

/**
 * Extract vote result from bill actions if available
 */
function extractVoteFromActions(actions) {
  const passedAction = actions.find(a => 
    a.type === 'Floor' && a.text && 
    (a.text.includes('Passed') || a.text.includes('Failed') || a.text.includes('Agreed to'))
  )
  if (!passedAction) return null
  
  const passed = passedAction.text.includes('Passed') || passedAction.text.includes('Agreed to')
  // Try to extract vote counts like "Passed by the Yeas and Nays: 220 - 207"
  const match = passedAction.text.match(/(\d+)\s*[-–]\s*(\d+)/)
  if (match) {
    return {
      yea: parseInt(match[1]),
      nay: parseInt(match[2]),
      notVoting: 0,
      result: passed ? 'PASSED' : 'FAILED'
    }
  }
  return { yea: '—', nay: '—', notVoting: '—', result: passed ? 'PASSED' : 'FAILED' }
}

// ─── YAHOO FINANCE (stock price moves) ───────────────────────────────────────

/**
 * Get % price change for a stock around a specific date
 * Uses Yahoo Finance's unofficial chart API (no key needed)
 * Looks at 2-day window after vote date
 */
async function fetchStockMove(ticker, voteDateStr) {
  try {
    const voteDate = new Date(voteDateStr)
    const from = Math.floor(voteDate.getTime() / 1000) - 86400  // 1 day before
    const to = Math.floor(voteDate.getTime() / 1000) + (86400 * 3)  // 3 days after

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${from}&period2=${to}&interval=1d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    if (!res.ok) return null

    const data = await res.json()
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    if (!closes || closes.length < 2) return null

    // Calculate % change from day before vote to day after
    const before = closes[0]
    const after = closes[closes.length - 1]
    if (!before || !after) return null

    const pct = ((after - before) / before) * 100
    return Math.round(pct * 10) / 10
  } catch (e) {
    console.warn(`Could not fetch stock data for ${ticker}: ${e.message}`)
    return null
  }
}

// ─── CLAUDE API ──────────────────────────────────────────────────────────────

/**
 * Call Claude to generate enriched bill data:
 * - Plain-English summary
 * - Pass likelihood % + reasoning
 * - Relevant stocks + projected impact
 */
async function enrichBillWithClaude(billInfo) {
  const prompt = `You are a nonpartisan legislative analyst. Given this US Congressional bill data, provide a structured JSON analysis.

Bill data:
- Title: ${billInfo.title}
- Sponsor: ${billInfo.sponsor || 'Unknown'}
- Committee: ${billInfo.committee || 'Unknown'}
- Congress: ${billInfo.congress}
- Raw CRS Summary: ${billInfo.crsSummary || 'Not available'}
- Recent Actions: ${billInfo.recentActions?.slice(0, 5).map(a => a.text).join(' | ') || 'None'}
- Policy area: ${billInfo.policyArea || 'Unknown'}

Respond ONLY with valid JSON (no markdown, no backticks) in this exact structure:
{
  "summary": "2-3 sentence plain English summary of what this bill does and why it matters",
  "passLikelihood": <integer 0-100>,
  "passLabel": "Short label like 'Likely — Bipartisan' or 'Uncertain — Party Line Vote'",
  "passReasoning": "2-3 sentence analysis of why it will or won't pass based on current political dynamics",
  "category": "One of: Telecom/Infrastructure | Environment/Land Use | Healthcare/Technology | National Security/Tech | Appropriations/Immigration | Energy/Resources | Finance/Banking | Defense | Other",
  "stocks": [
    {
      "ticker": "TICKER",
      "name": "Full company name",
      "impact": "▲ Positive | ▼ Negative | → Neutral",
      "reason": "1 sentence explanation of market impact"
    }
  ]
}

Include 2-6 stocks or ETFs most directly impacted. Be specific — only include tickers with a clear, direct connection to the bill's provisions.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error: ${res.status} — ${err}`)
  }

  const data = await res.json()
  const text = data.content[0].text.trim()

  try {
    return JSON.parse(text)
  } catch {
    // Strip any accidental markdown
    const cleaned = text.replace(/```json|```/g, '').trim()
    return JSON.parse(cleaned)
  }
}

/**
 * Call Claude to generate actual stock impact notes for a past bill
 * given known actual price moves
 */
async function generateStockOutcomeNotes(billTitle, stocks, voteDate) {
  const stockList = stocks.map(s => 
    `${s.ticker} (${s.name}): projected ${s.projectedDir} ${s.projectedMag}, actual move ${s.actualPct > 0 ? '+' : ''}${s.actualPct}%`
  ).join('\n')

  const prompt = `You are a financial analyst. For each stock below, write a 1-sentence explanation of why the stock moved the way it did following the congressional vote on "${billTitle}" on ${voteDate}.

Stocks:
${stockList}

Respond ONLY with valid JSON array (no markdown):
[
  { "ticker": "TICKER", "actualNote": "One sentence explaining the actual market reaction" }
]`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) return []
  const data = await res.json()
  try {
    const text = data.content[0].text.trim().replace(/```json|```/g, '')
    return JSON.parse(text)
  } catch {
    return []
  }
}

// ─── MAIN UPDATE LOGIC ────────────────────────────────────────────────────────

async function main() {
  console.log('=== Legislative Radar: Data Update ===')
  console.log(`Running at: ${new Date().toISOString()}`)

  if (!CONGRESS_KEY) throw new Error('CONGRESS_API_KEY environment variable not set')
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY environment variable not set')

  // Load existing data
  let existing = { upcomingBills: [], pastBills: [] }
  if (fs.existsSync(DATA_PATH)) {
    existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
    console.log(`Loaded existing data: ${existing.upcomingBills.length} upcoming, ${existing.pastBills.length} past bills`)
  }

  const existingIds = new Set([
    ...existing.upcomingBills.map(b => b.id),
    ...existing.pastBills.map(b => b.id)
  ])

  // ── Step 1: Fetch recently active bills from Congress.gov ──
  let recentBills = []
  try {
    recentBills = await fetchRecentlyActiveBills(4)
    console.log(`Fetched ${recentBills.length} recently active bills from Congress.gov`)
  } catch (e) {
    console.error('Failed to fetch from Congress.gov:', e.message)
  }

  // ── Step 2: Check if any upcoming bills have now been voted on ──
  const updatedUpcoming = []
  const newlyPast = []

  for (const bill of existing.upcomingBills) {
    const parsed = parseBillId(bill.congressBillId)
    if (!parsed) {
      updatedUpcoming.push(bill)
      continue
    }

    try {
      const actions = await fetchBillActions(parsed.congress, parsed.type, parsed.number)
      await sleep(300) // Respect rate limits

      const voteResult = extractVoteFromActions(actions)
      
      if (voteResult) {
        // Bill has been voted on — move to past
        console.log(`✓ Bill ${bill.id} has been voted on: ${voteResult.result}`)
        
        // Fetch actual stock moves
        const stocksWithActuals = await Promise.all(
          bill.stocks.map(async (s) => {
            const pct = await fetchStockMove(s.ticker, today())
            const dir = pct === null ? 'FLAT' : pct > 0.1 ? 'UP' : pct < -0.1 ? 'DOWN' : 'FLAT'
            return {
              ticker: s.ticker,
              name: s.name,
              projectedDir: s.impact?.startsWith('▲') ? 'UP' : s.impact?.startsWith('▼') ? 'DOWN' : 'FLAT',
              projectedMag: 'Slight',
              projectedReason: s.reason,
              actualDir: dir,
              actualPct: pct ?? 0,
              actualNote: `Post-vote move: ${pct !== null ? (pct > 0 ? '+' : '') + pct + '%' : 'data unavailable'}`
            }
          })
        )

        // Generate outcome notes via Claude
        try {
          const notes = await generateStockOutcomeNotes(bill.title, stocksWithActuals, today())
          notes.forEach(n => {
            const s = stocksWithActuals.find(s => s.ticker === n.ticker)
            if (s) s.actualNote = n.actualNote
          })
        } catch (e) {
          console.warn('Could not generate outcome notes:', e.message)
        }

        newlyPast.push({
          ...bill,
          status: voteResult.result,
          voteDate: today(),
          predictedOutcome: bill.passLikelihood >= 50 ? 'PASS' : 'FAIL',
          actualVote: voteResult,
          voteNote: '',
          stocks: stocksWithActuals
        })
      } else {
        updatedUpcoming.push(bill)
      }
    } catch (e) {
      console.warn(`Could not check status for ${bill.id}:`, e.message)
      updatedUpcoming.push(bill)
    }
  }

  // ── Step 3: Find new bills not already tracked ──
  const newBills = recentBills.filter(b => {
    const id = `${b.type?.toUpperCase()}-${b.number}`
    return !existingIds.has(id) && b.number
  }).slice(0, 5) // Cap at 5 new bills per run to control API costs

  console.log(`Found ${newBills.length} new bills to enrich`)

  const newlyEnriched = []
  for (const bill of newBills) {
    try {
      const type = bill.type?.toLowerCase()
      const number = bill.number
      
      const [detail, actions, summary] = await Promise.all([
        fetchBillDetail(CONGRESS, type, number),
        fetchBillActions(CONGRESS, type, number),
        fetchBillSummary(CONGRESS, type, number)
      ])
      await sleep(500)

      // Only include bills with floor action
      if (!hasFloorAction(actions)) {
        console.log(`Skipping ${bill.type}-${bill.number} — no floor action yet`)
        continue
      }

      console.log(`Enriching ${bill.type}-${bill.number}: ${bill.title}`)

      const enriched = await enrichBillWithClaude({
        title: bill.title,
        sponsor: detail?.sponsors?.[0] ? `${detail.sponsors[0].fullName} (${detail.sponsors[0].party})` : 'Unknown',
        committee: detail?.committees?.count > 0 ? 'See Congress.gov' : 'Unknown',
        congress: CONGRESS,
        crsSummary: summary,
        recentActions: actions,
        policyArea: detail?.policyArea?.name || 'Unknown'
      })
      await sleep(1000)

      newlyEnriched.push({
        id: `${bill.type?.toUpperCase()}-${bill.number}`,
        congressBillId: `${CONGRESS}/${type}/${number}`,
        title: bill.title,
        chamber: bill.originChamber || 'House',
        sponsor: enriched.passReasoning ? (detail?.sponsors?.[0]?.fullName || 'Unknown') : 'Unknown',
        committee: detail?.committees?.count > 0 ? 'Multiple Committees' : 'Unknown',
        category: enriched.category || 'Other',
        voteWeek: 'Upcoming',
        status: 'FLOOR THIS WEEK',
        summary: enriched.summary,
        passLikelihood: enriched.passLikelihood,
        passLabel: enriched.passLabel,
        passReasoning: enriched.passReasoning,
        stocks: enriched.stocks || []
      })
    } catch (e) {
      console.error(`Failed to enrich bill ${bill.type}-${bill.number}:`, e.message)
    }
  }

  // ── Step 4: Assemble final data ──
  const finalData = {
    lastUpdated: new Date().toISOString(),
    upcomingBills: [...newlyEnriched, ...updatedUpcoming],
    pastBills: [...newlyPast, ...existing.pastBills]
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(finalData, null, 2))

  console.log('\n=== Update Complete ===')
  console.log(`Upcoming bills: ${finalData.upcomingBills.length}`)
  console.log(`Past bills: ${finalData.pastBills.length}`)
  console.log(`New bills discovered: ${newlyEnriched.length}`)
  console.log(`Bills moved to past: ${newlyPast.length}`)
}

main().catch(err => {
  console.error('Update script failed:', err)
  process.exit(1)
})
