# Legislative Radar

A self-updating congressional bill tracker with pass likelihood scoring, stock market impact projections, and accuracy tracking. Powered by Congress.gov API, Yahoo Finance, and Claude AI. Deploys automatically to GitHub Pages every night.

---

## What it does

- **Fetches** upcoming and recently voted bills from Congress.gov's official API nightly
- **Enriches** each bill with Claude AI: plain-English summaries, pass likelihood %, reasoning, and projected stock impacts
- **Tracks** actual vote results and post-vote stock price moves via Yahoo Finance
- **Scores** its own accuracy over time (binary pass/fail + Brier calibration + stock direction/magnitude)
- **Deploys** automatically to GitHub Pages after every nightly update

---

## Setup Guide (one time, ~15 minutes)

### Step 1 — Get your API keys

**Congress.gov API key (free, instant)**
1. Go to https://api.congress.gov/sign-up/
2. Fill out the form — you'll get a key emailed to you immediately
3. Save it somewhere — you'll need it in Step 4

**Anthropic API key**
1. Go to https://console.anthropic.com
2. Sign in or create an account
3. Click **"API Keys"** in the left sidebar
4. Click **"Create Key"** — name it "legislative-radar"
5. Copy the key (starts with `sk-ant-...`) — you only see it once
6. Add a credit card if prompted — usage for this app is ~$3–8/month at nightly runs
   - Go to **"Billing"** → **"Add payment method"**
   - You can set a monthly spend limit under **"Usage limits"** (recommend $20/month cap)

---

### Step 2 — Create your GitHub repository

1. Go to https://github.com/new
2. Name it `legislative-radar` (or anything you like — just update `vite.config.js` to match)
3. Set it to **Public** (required for free GitHub Pages)
4. **Don't** initialize with README (you already have files)
5. Click **Create repository**

---

### Step 3 — Push this code to GitHub

Open your terminal in the project folder:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/legislative-radar.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

---

### Step 4 — Add your API keys as GitHub Secrets

This keeps your keys private — they're never in the code.

1. Go to your repo on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"** and add these two:

| Secret Name | Value |
|---|---|
| `CONGRESS_API_KEY` | Your Congress.gov API key from Step 1 |
| `ANTHROPIC_API_KEY` | Your Anthropic API key from Step 1 |

---

### Step 5 — Enable GitHub Pages

1. In your repo, go to **Settings** → **Pages**
2. Under **Source**, select **"GitHub Actions"**
3. Click Save

---

### Step 6 — Update the repo name in vite.config.js

Open `vite.config.js` and change `legislative-radar` to match your actual repo name:

```js
base: '/YOUR-REPO-NAME/',
```

Commit and push this change:

```bash
git add vite.config.js
git commit -m "fix: update base path for GitHub Pages"
git push
```

---

### Step 7 — Trigger the first deploy

1. Go to your repo → **Actions** tab
2. Click **"Update Data + Deploy"** in the left sidebar
3. Click **"Run workflow"** → **"Run workflow"**
4. Watch it run (takes ~2–3 minutes)
5. When it's green, your site is live at:
   `https://YOUR_USERNAME.github.io/legislative-radar/`

---

## Custom Domain (optional)

1. Buy a domain from Namecheap, Cloudflare, etc.
2. In your domain's DNS settings, add a CNAME record:
   - Name: `www`
   - Value: `YOUR_USERNAME.github.io`
3. In your repo → **Settings** → **Pages** → enter your domain under "Custom domain"
4. Check "Enforce HTTPS"

---

## How the nightly update works

Every night at 2am ET, GitHub Actions:

1. Runs `scripts/update-data.js`
2. Fetches bills with recent activity from Congress.gov
3. Checks if any upcoming bills have been voted on
4. If voted: fetches actual stock moves from Yahoo Finance, generates outcome notes via Claude
5. Finds new floor-scheduled bills and enriches them with Claude
6. Writes the updated `data/bills.json` back to the repo
7. Builds the React app
8. Deploys to GitHub Pages

The whole thing runs in your GitHub account's free Actions minutes (2,000 min/month free — this uses ~3 min/day).

---

## Manually adding bills

The `data/bills.json` file is the source of truth. You can edit it directly to:
- Add a bill the automation missed
- Fix a vote count
- Add actual stock move data manually
- Correct a Claude-generated analysis

After editing, commit and push — the site will redeploy automatically.

---

## Cost estimate

| Service | Cost |
|---|---|
| Congress.gov API | Free |
| Yahoo Finance (unofficial) | Free |
| GitHub Pages + Actions | Free |
| Anthropic API (nightly, ~5 bills) | ~$3–8/month |
| **Total** | **~$3–8/month** |

---

## Troubleshooting

**Build failing?**
Check the Actions tab for error logs. Most common issue: missing secrets. Double-check Step 4.

**Data not updating?**
The update script logs everything. In Actions → click the failed run → expand "Run data update script" to see what went wrong.

**Bills showing wrong data?**
Edit `data/bills.json` directly and push. Your manual changes are preserved — the script only adds new bills and updates status for existing ones.

**Want to add more past weeks of bills?**
Edit `data/bills.json` and add entries to `pastBills` following the existing format.
