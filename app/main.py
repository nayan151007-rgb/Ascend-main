"""Ascend — FastAPI Backend (arXiv + Semantic Scholar + Anthropic Claude + SQLite)."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import httpx
from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "ascend.db"))
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
RATE_LIMIT_PER_MIN = max(1, int(os.getenv("RATE_LIMIT_PER_MIN", "8")))
MAX_LIBRARY_ITEMS = 40
MAX_LIBRARY_BYTES = 2 * 1024 * 1024  # 2 MB

app = FastAPI(title="Ascend Research API", version="1.0.0")


# ---------------------------------------------------------------------------
# SQLite Setup (`lib(cid TEXT PRIMARY KEY, data TEXT)`)
# ---------------------------------------------------------------------------
def _get_conn() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.execute("CREATE TABLE IF NOT EXISTS lib (cid TEXT PRIMARY KEY, data TEXT)")
    return conn


with _get_conn() as _boot_conn:
    _boot_conn.commit()


# ---------------------------------------------------------------------------
# Per-IP Sliding Window Rate Limiter
# ---------------------------------------------------------------------------
_ip_hits: dict[str, list[float]] = {}


def _extract_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _enforce_rate_limit(ip: str) -> None:
    now = time.monotonic()
    cutoff = now - 60.0
    hits = [t for t in _ip_hits.get(ip, []) if t > cutoff]
    if len(hits) >= RATE_LIMIT_PER_MIN:
        _ip_hits[ip] = hits
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded ({RATE_LIMIT_PER_MIN} requests/minute). Please wait briefly and try again.",
        )
    hits.append(now)
    _ip_hits[ip] = hits


def _validate_cid(cid: str | None) -> str:
    if not cid:
        raise HTTPException(status_code=400, detail="Missing X-Client-Id header.")
    cleaned = cid.strip()
    if not (1 <= len(cleaned) <= 64) or not re.fullmatch(r"[A-Za-z0-9_.:-]+", cleaned):
        raise HTTPException(status_code=400, detail="Invalid X-Client-Id header (1–64 safe characters required).")
    return cleaned


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(_req: Request, exc: RequestValidationError) -> JSONResponse:
    msg = exc.errors()[0].get("msg", "Invalid request input.") if exc.errors() else "Invalid request input."
    return JSONResponse(status_code=422, content={"detail": msg})


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=3, max_length=200)


# ---------------------------------------------------------------------------
# Scholarly Paper Discovery (Parallel arXiv + Semantic Scholar, 15s timeout)
# ---------------------------------------------------------------------------
def _norm_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())


async def _fetch_arxiv(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    terms = [w for w in re.sub(r"[^\w\s-]", " ", query).split() if len(w) > 1][:8]
    search_expr = " AND ".join(f"all:{t}" for t in terms) if terms else f"all:{query}"
    resp = await client.get(
        "https://export.arxiv.org/api/query",
        params={
            "search_query": search_expr,
            "start": 0,
            "max_results": 8,
            "sortBy": "relevance",
            "sortOrder": "descending",
        },
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.text)
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    results: list[dict[str, Any]] = []

    for entry in root.findall("atom:entry", ns):
        title = re.sub(r"\s+", " ", (entry.findtext("atom:title", "", ns) or "")).strip()
        raw_id = (entry.findtext("atom:id", "", ns) or "").strip()
        url = re.sub(r"^http://", "https://", raw_id, flags=re.IGNORECASE)
        if not title or not url.startswith("https://"):
            continue
        abstract = re.sub(r"\s+", " ", (entry.findtext("atom:summary", "", ns) or "")).strip()[:440]
        published = (entry.findtext("atom:published", "", ns) or "")[:4]
        year = int(published) if published.isdigit() else None
        names = [
            (a.findtext("atom:name", "", ns) or "").strip()
            for a in entry.findall("atom:author", ns)
            if (a.findtext("atom:name", "", ns) or "").strip()
        ]
        authors = f"{', '.join(names[:3])} et al." if len(names) > 3 else (", ".join(names) or "arXiv Authors")
        results.append(
            {
                "title": title,
                "authors": authors,
                "year": year,
                "url": url,
                "source": "arXiv",
                "abstract": abstract,
            }
        )
    return results


async def _fetch_semantic_scholar(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    headers: dict[str, str] = {"Accept": "application/json"}
    s2_key = os.getenv("S2_API_KEY", "").strip()
    if s2_key:
        headers["x-api-key"] = s2_key

    resp = await client.get(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params={
            "query": query,
            "limit": 8,
            "fields": "title,authors,year,abstract,url,externalIds",
        },
        headers=headers,
    )
    resp.raise_for_status()
    payload = resp.json()
    results: list[dict[str, Any]] = []

    for item in payload.get("data") or []:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        ext = item.get("externalIds") or {}
        url = (item.get("url") or "").strip()
        if not url and ext.get("DOI"):
            url = f"https://doi.org/{ext['DOI']}"
        elif not url and ext.get("ArXiv"):
            url = f"https://arxiv.org/abs/{ext['ArXiv']}"
        elif not url and item.get("paperId"):
            url = f"https://www.semanticscholar.org/paper/{item['paperId']}"
        if not url.startswith("http"):
            continue
        names = [(a.get("name") or "").strip() for a in (item.get("authors") or []) if (a.get("name") or "").strip()]
        authors = f"{', '.join(names[:3])} et al." if len(names) > 3 else (", ".join(names) or "Unknown Authors")
        abstract = re.sub(r"\s+", " ", (item.get("abstract") or "")).strip()[:440]
        results.append(
            {
                "title": title,
                "authors": authors,
                "year": item.get("year") if isinstance(item.get("year"), int) else None,
                "url": url,
                "source": "Semantic Scholar",
                "abstract": abstract,
            }
        )
    return results


async def discover_papers(query: str) -> list[dict[str, Any]]:
    timeout = httpx.Timeout(15.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        arxiv_res, s2_res = await asyncio.gather(
            _fetch_arxiv(client, query),
            _fetch_semantic_scholar(client, query),
            return_exceptions=True,
        )

    arxiv_list = arxiv_res if isinstance(arxiv_res, list) else []
    s2_list = s2_res if isinstance(s2_res, list) else []

    interleaved: list[dict[str, Any]] = []
    for i in range(max(len(s2_list), len(arxiv_list))):
        if i < len(s2_list):
            interleaved.append(s2_list[i])
        if i < len(arxiv_list):
            interleaved.append(arxiv_list[i])

    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for p in interleaved:
        nt = _norm_title(p["title"])
        if not nt or nt in seen:
            continue
        seen.add(nt)
        deduped.append(p)
        if len(deduped) >= 10:
            break
    return deduped


# ---------------------------------------------------------------------------
# Claude Synthesis
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are Ascend, a scientific research synthesis assistant.
Return ONLY valid JSON matching this exact schema (no markdown code fences, no prose outside JSON):
{
  "summary": "2-3 sentence overview of the topic",
  "sections": [
    {"title": "Background", "body": "2-4 sentences"},
    {"title": "Key methods", "body": "2-4 sentences"},
    {"title": "Recent findings", "body": "2-4 sentences"},
    {"title": "Open questions", "body": "2-4 sentences"}
  ],
  "selected_sources": [
    {"index": 0, "why": "One-line reason why this retrieved paper is directly relevant"}
  ],
  "graph": {
    "nodes": ["Topic", "Concept 2", "Concept 3", "Concept 4", "Concept 5", "Concept 6", "Concept 7", "Concept 8", "Concept 9"],
    "edges": [["Topic", "Concept 2", "relation"]]
  }
}
Rules:
- Pick up to 6 most relevant papers ONLY by integer index from the RETRIEVED PAPERS list. Never invent papers.
- graph.nodes must contain 9 to 10 strings (first node = the research topic).
- graph.edges must contain 10 to 14 [from, to, relation] triples using strings from graph.nodes.
"""


@app.get("/api/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/library")
async def get_library(x_client_id: str | None = Header(default=None)) -> list[Any]:
    cid = _validate_cid(x_client_id)
    with _get_conn() as conn:
        row = conn.execute("SELECT data FROM lib WHERE cid = ?", (cid,)).fetchone()
    if not row:
        return []
    try:
        parsed = json.loads(row[0])
        return parsed[:MAX_LIBRARY_ITEMS] if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


@app.put("/api/library")
async def put_library(request: Request, x_client_id: str | None = Header(default=None)) -> list[Any]:
    cid = _validate_cid(x_client_id)
    raw_bytes = await request.body()
    if len(raw_bytes) > MAX_LIBRARY_BYTES:
        raise HTTPException(status_code=413, detail="Library payload exceeds 2 MB limit.")
    try:
        items = json.loads(raw_bytes.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload.") from exc

    if not isinstance(items, list) or len(items) > MAX_LIBRARY_ITEMS:
        raise HTTPException(status_code=400, detail=f"Library must be an array of at most {MAX_LIBRARY_ITEMS} items.")

    serialized = json.dumps(items, ensure_ascii=False)
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO lib (cid, data) VALUES (?, ?) ON CONFLICT(cid) DO UPDATE SET data = excluded.data",
            (cid, serialized),
        )
        conn.commit()
    return items


@app.post("/api/research")
async def research(payload: ResearchRequest, request: Request) -> dict[str, Any]:
    _enforce_rate_limit(_extract_ip(request))

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Missing ANTHROPIC_API_KEY on server. Set it in your .env file or hosting environment.",
        )

    query = re.sub(r"\s+", " ", payload.query).strip()
    if not (3 <= len(query) <= 200):
        raise HTTPException(status_code=422, detail="Query must be between 3 and 200 characters.")

    candidates = await discover_papers(query)
    papers_text = (
        "\n\n".join(
            f"[{idx}] {p['title']} ({p['year'] or 'n.d.'}, {p['source']}) — {p['authors']}\nAbstract: {p['abstract']}"
            for idx, p in enumerate(candidates)
        )
        if candidates
        else "No candidate papers retrieved."
    )

    try:
        client = AsyncAnthropic(api_key=api_key, timeout=45.0)
        msg = await client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=2500,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"TOPIC: {query}\n\nRETRIEVED PAPERS:\n{papers_text}",
                }
            ],
        )
        raw_text = "".join(block.text for block in msg.content if getattr(block, "type", "") == "text")
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("Model output did not contain a JSON object.")
        parsed = json.loads(raw_text[start : end + 1])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Model synthesis error: {str(exc)[:180]}") from exc

    sources: list[dict[str, Any]] = []
    seen_idx: set[int] = set()
    for sel in parsed.get("selected_sources") or []:
        if not isinstance(sel, dict):
            continue
        idx = sel.get("index")
        if isinstance(idx, int) and 0 <= idx < len(candidates) and idx not in seen_idx:
            seen_idx.add(idx)
            paper = candidates[idx]
            sources.append(
                {
                    "title": paper["title"],
                    "authors": paper["authors"],
                    "year": paper["year"],
                    "url": paper["url"],
                    "source": paper["source"],
                    "why": str(sel.get("why") or f"Directly relevant study on {query}.").strip(),
                }
            )
            if len(sources) >= 6:
                break

    graph_raw = parsed.get("graph") or {}
    nodes = [str(n).strip() for n in (graph_raw.get("nodes") or []) if str(n).strip()][:10]
    if not nodes:
        nodes = [query]
    edges = [
        [str(e[0]).strip(), str(e[1]).strip(), str(e[2] if len(e) > 2 else "relates to").strip()]
        for e in (graph_raw.get("edges") or [])
        if isinstance(e, list) and len(e) >= 2
    ][:14]

    return {
        "summary": str(parsed.get("summary") or "").strip(),
        "sections": parsed.get("sections") or [],
        "sources": sources,
        "graph": {"nodes": nodes, "edges": edges},
    }


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    async def serve_index() -> FileResponse:
        return FileResponse(str(STATIC_DIR / "index.html"))
