# ▲ Ascend — AI Research & Knowledge Discovery

**Ascend** is a full-stack AI research synthesis and knowledge-discovery platform wrapped in an immersive 3D deep-space experience. Enter any technical topic to synthesize a structured four-part research briefing, strictly grounded citations retrieved live from **arXiv** and **Semantic Scholar**, an interactive SVG concept graph where clicking any node runs a follow-up search, a SQLite-backed personal research library, and a one-click Markdown report exporter.

---

## Core Capabilities

1. **AI Research Assistant:** Produces a concise 2–3 sentence executive summary plus four structured sections: *Background*, *Key methods*, *Recent findings*, and *Open questions*.
2. **Smart Source Discovery (Zero Hallucinated Links):** Queries the **arXiv Atom API** and **Semantic Scholar Graph API** in parallel (with 15s timeouts and fault-tolerant deduplication by normalized title). Passes retrieved manuscripts to the LLM and maps selected citations strictly back to verified upstream paper URLs, plus outbound deep-search links to arXiv, Semantic Scholar, and Google Scholar.
3. **Interactive Knowledge Graph:** Maps 9–10 domain concepts and 10–14 labeled semantic edges onto an interactive SVG orbit. Clicking any concept node launches a new research synthesis on that concept.
4. **SQLite Research Library:** Automatically persists up to 40 briefings per anonymous client vault (`X-Client-Id` UUID in `localStorage`) inside SQLite (`lib(cid TEXT PRIMARY KEY, data TEXT)`), supporting star/save, reopen, delete, and All/Saved filtering.
5. **Markdown Dossier Generator:** Exports either the active topic or your saved collection as a structured `ascend-research-report.md` report complete with clickable source links, concept edges, and an AI-synthesis disclaimer.
6. **Procedural 3D Earth & Scroll Choreography:** Full-viewport Three.js WebGL scene featuring a procedurally shaded Earth (FBM continents, bathymetric ocean glint, night-side city lights, Rayleigh rim glow), dual drifting cloud shells, additive blue atmosphere corona, 1,400 twinkling stars, 60 golden radar-ping markers, damped scroll choreography, and `prefers-reduced-motion` support.

---

## Quickstart — Option A: Python 3.12 + FastAPI (`app/main.py` + `static/index.html`)

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000`.

## Quickstart — Option B: Node 22 + Express + Vite (`server.ts` + `src/`)

```bash
npm install
cp .env.example .env
# Set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env
npm run dev
```

Open `http://localhost:3000`.

---

## VS Code Debugging (`F5`)

1. Open `ascend.code-workspace` (or the repository folder) in VS Code.
2. Ensure `.env` exists in the project root with your API key configured.
3. Press **`F5`** and select either **"Ascend: FastAPI (Uvicorn)"** or **"Ascend: Full-Stack Node/Express (Port 3000)"** from the Run & Debug dropdown.

---

## API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/health` | `GET` | Health probe returning `{ "ok": true }`. |
| `/api/research` | `POST` | Body `{ "query": string (3–200 chars) }` → returns `{ summary, sections, sources, graph }`. Rate-limited per IP (`RATE_LIMIT_PER_MIN`, default `8`, honours `X-Forwarded-For`). |
| `/api/library` | `GET` | Header `X-Client-Id` → returns saved research array (`<= 40` items). |
| `/api/library` | `PUT` | Header `X-Client-Id` + JSON array (`<= 40` items, `<= 2 MB`) → replaces stored vault in SQLite. |

---

## Production Deployment

### Primary: Render Blueprint (`render.yaml`)
1. Push this repository to GitHub (verify `.env` and `*.db` are excluded via `.gitignore`).
2. In the Render Dashboard, click **New → Blueprint** and connect your GitHub repository.
3. Render automatically reads `render.yaml` (`Dockerfile`, health check `/api/health`, `DB_PATH=/tmp/ascend.db`).
4. Enter your `ANTHROPIC_API_KEY` when prompted (`sync: false`) and click **Apply / Deploy**.

### Docker Anywhere (Railway, Fly.io, Cloud Run)
```bash
docker build -t ascend-research .
docker run -p 8000:8000 -e ANTHROPIC_API_KEY="sk-ant-..." ascend-research
```

### Ephemeral Disk & Durability Notes
- **Free Tier Restarts:** Free-tier container hosts spin down on idle and wipe ephemeral filesystems (`/tmp/ascend.db`) on cold restarts or redeployments.
- **Making the Library Durable:** Attach a persistent volume/disk (e.g., Render Persistent Disk mounted at `/var/data`) and set `DB_PATH=/var/data/ascend.db`, or swap the `sqlite3` table `lib(cid TEXT PRIMARY KEY, data TEXT)` for managed Postgres (`DATABASE_URL`).
- **API Spend Cap:** Always configure a monthly usage/spend cap in your Anthropic Console (or Google Cloud / AI Studio billing settings) before sharing a public URL.
