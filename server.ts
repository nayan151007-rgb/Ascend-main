import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, ThinkingLevel, type LiveServerMessage } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CandidatePaper {
  title: string;
  authors: string;
  year: number | null;
  url: string;
  source: string;
  abstract: string;
}

interface ResearchSection {
  title: string;
  body: string;
}

interface ResearchSource {
  title: string;
  authors: string;
  year: number | null;
  url: string;
  source: string;
  why: string;
}

interface ResearchGraph {
  nodes: string[];
  edges: [string, string, string][];
}

interface ResearchResponse {
  summary: string;
  sections: ResearchSection[];
  sources: ResearchSource[];
  graph: ResearchGraph;
}

// ---------------------------------------------------------------------------
// Shared Server-Side Gemini Client Helper
// ---------------------------------------------------------------------------
function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return key;
}

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiUpstreamError(err: unknown, modelLabel?: string): { status: number; detail: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (/UNAVAILABLE|"code":\s*503|high demand|overloaded/i.test(raw)) {
    return {
      status: 503,
      detail: `${modelLabel || 'Gemini'} is experiencing temporary high demand upstream. Please retry in a few seconds.`,
    };
  }
  if (/RESOURCE_EXHAUSTED|"code":\s*429/i.test(raw)) {
    return {
      status: 429,
      detail: `${modelLabel ? `${modelLabel} quota` : 'API quota'} reached on the current key. Upgrading to a paid tier increases quota—you can select a billing-enabled API key in Settings > Secrets.`,
    };
  }
  if (/PERMISSION_DENIED|"code":\s*403|paid/i.test(raw)) {
    return {
      status: 403,
      detail: `${modelLabel ? `${modelLabel} requires` : 'This model requires'} a billing-enabled API key. Select or check your API key in the Settings > Secrets panel.`,
    };
  }
  if (/API_KEY_INVALID|"code":\s*400.*API key/i.test(raw)) {
    return {
      status: 400,
      detail: 'Invalid Gemini API key. Please check your key in the Settings > Secrets panel.',
    };
  }
  return {
    status: 502,
    detail: `Upstream AI request failed: ${raw.slice(0, 220)}`,
  };
}

// ---------------------------------------------------------------------------
// SQLite Initialization (`lib(cid TEXT PRIMARY KEY, data TEXT)`)
// ---------------------------------------------------------------------------
function initDatabase(): Database.Database {
  const configuredPath = process.env.DB_PATH?.trim();
  const candidates = configuredPath
    ? [configuredPath, path.join(os.tmpdir(), 'ascend.db')]
    : [path.resolve(process.cwd(), 'ascend.db'), path.join(os.tmpdir(), 'ascend.db')];

  for (const dbFile of candidates) {
    try {
      const dir = path.dirname(dbFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const sqlite = new Database(dbFile);
      sqlite.pragma('journal_mode = WAL');
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS lib (
          cid TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS shares (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      return sqlite;
    } catch {
      // Fall back to /tmp/ascend.db if current working directory is read-only
    }
  }
  const memDb = new Database(':memory:');
  memDb.exec(`
    CREATE TABLE IF NOT EXISTS lib (cid TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  return memDb;
}

const db = initDatabase();
const getLibStmt = db.prepare('SELECT data FROM lib WHERE cid = ?');
const putLibStmt = db.prepare(
  'INSERT INTO lib (cid, data) VALUES (?, ?) ON CONFLICT(cid) DO UPDATE SET data = excluded.data'
);
const getShareStmt = db.prepare('SELECT payload, created_at FROM shares WHERE id = ?');
const putShareStmt = db.prepare(
  'INSERT INTO shares (id, payload, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload'
);

// ---------------------------------------------------------------------------
// Per-IP Rate Limiter (Sliding 60s Window, honours X-Forwarded-For)
// ---------------------------------------------------------------------------
const RATE_LIMIT_PER_MIN = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_PER_MIN || '8', 10) || 8);
const ipHits = new Map<string, number[]>();
const interactiveHits = new Map<string, number[]>();

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkBucketRateLimit(bucket: Map<string, number[]>, ip: string, maxPerMin: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (bucket.get(ip) || []).filter((t) => t > windowStart);
  if (timestamps.length >= maxPerMin) {
    bucket.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  bucket.set(ip, timestamps);

  if (bucket.size > 2000) {
    for (const [key, list] of bucket.entries()) {
      const active = list.filter((t) => t > windowStart);
      if (active.length === 0) bucket.delete(key);
      else bucket.set(key, active);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------
function validateClientId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 64) return null;
  if (!/^[a-zA-Z0-9_.:-]+$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Outbound Literature Connectors (Strict 4.5s Parallel Timeouts, Zero Sequential Stalls)
// ---------------------------------------------------------------------------
async function searchArxivPapers(query: string): Promise<CandidatePaper[]> {
  try {
    const terms = query
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 6);
    const searchExpr =
      terms.length > 0 && terms.length <= 4
        ? terms.map((t) => `all:${t}`).join(' AND ')
        : `all:${query.replace(/[^\w\s-]/g, ' ').trim()}`;
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchExpr)}&start=0&max_results=8&sortBy=relevance&sortOrder=descending`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'AscendResearchPlatform/1.0 (mailto:research@ascend.science)' },
      signal: AbortSignal.timeout(4_500),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const papers: CandidatePaper[] = [];

    for (const entry of entries) {
      const rawTitle = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
      const title = decodeXmlEntities(rawTitle);
      if (!title) continue;

      const rawSummary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] || '';
      const abstract = decodeXmlEntities(rawSummary).slice(0, 460);

      const rawId = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
      const urlClean = rawId.replace(/^http:\/\//i, 'https://');
      if (!urlClean.startsWith('https://')) continue;

      const published = entry.match(/<published>(\d{4})/)?.[1];
      const year = published ? Number.parseInt(published, 10) : null;

      const authorMatches = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) =>
        decodeXmlEntities(m[1])
      );
      const authors =
        authorMatches.length > 3
          ? `${authorMatches.slice(0, 3).join(', ')} et al.`
          : authorMatches.join(', ') || 'arXiv Authors';

      papers.push({
        title,
        authors,
        year,
        url: urlClean,
        source: 'arXiv',
        abstract,
      });
    }

    return papers;
  } catch {
    return [];
  }
}

async function searchSemanticScholarPapers(query: string): Promise<CandidatePaper[]> {
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=8&fields=title,authors,year,abstract,url,externalIds`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'AscendResearchPlatform/1.0',
    };
    const s2Key = process.env.S2_API_KEY?.trim();
    if (s2Key) {
      headers['x-api-key'] = s2Key;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(4_500),
    });
    if (!res.ok) return [];
    const payload = (await res.json()) as {
      data?: Array<{
        paperId?: string;
        title?: string;
        year?: number | null;
        abstract?: string | null;
        url?: string | null;
        externalIds?: { DOI?: string; ArXiv?: string };
        authors?: Array<{ name?: string }>;
      }>;
    };

    const papers: CandidatePaper[] = [];
    for (const item of payload.data || []) {
      const title = (item.title || '').trim();
      if (!title) continue;

      let paperUrl = (item.url || '').trim();
      if (!paperUrl && item.externalIds?.DOI) {
        paperUrl = `https://doi.org/${item.externalIds.DOI}`;
      } else if (!paperUrl && item.externalIds?.ArXiv) {
        paperUrl = `https://arxiv.org/abs/${item.externalIds.ArXiv}`;
      } else if (!paperUrl && item.paperId) {
        paperUrl = `https://www.semanticscholar.org/paper/${item.paperId}`;
      }
      if (!paperUrl.startsWith('http')) continue;

      const names = (item.authors || []).map((a) => (a.name || '').trim()).filter(Boolean);
      const authors =
        names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ') || 'Unknown Authors';

      papers.push({
        title,
        authors,
        year: typeof item.year === 'number' ? item.year : null,
        url: paperUrl,
        source: 'Semantic Scholar',
        abstract: (item.abstract || '').replace(/\s+/g, ' ').trim().slice(0, 460),
      });
    }
    return papers;
  } catch {
    return [];
  }
}

function reconstructOpenAlexAbstract(inverted?: Record<string, number[]> | null): string {
  if (!inverted) return '';
  const words: Array<{ pos: number; word: string }> = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) {
      words.push({ pos, word });
    }
  }
  words.sort((a, b) => a.pos - b.pos);
  return words.map((w) => w.word).join(' ');
}

async function searchOpenAlexPapers(query: string): Promise<CandidatePaper[]> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=8&mailto=research@ascend.science`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4_500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{
        id?: string;
        doi?: string | null;
        title?: string | null;
        publication_year?: number | null;
        abstract_inverted_index?: Record<string, number[]> | null;
        primary_location?: { landing_page_url?: string | null } | null;
        authorships?: Array<{ author?: { display_name?: string } }>;
      }>;
    };

    const papers: CandidatePaper[] = [];
    for (const work of data.results || []) {
      const title = (work.title || '').trim();
      if (!title) continue;
      const paperUrl = work.doi || work.primary_location?.landing_page_url || work.id || '';
      if (!paperUrl.startsWith('http')) continue;

      const names = (work.authorships || [])
        .map((a) => (a.author?.display_name || '').trim())
        .filter(Boolean);
      const authors =
        names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ') || 'Research Authors';

      papers.push({
        title,
        authors,
        year: typeof work.publication_year === 'number' ? work.publication_year : null,
        url: paperUrl,
        source: 'OpenAlex',
        abstract: reconstructOpenAlexAbstract(work.abstract_inverted_index).slice(0, 460),
      });
    }
    return papers;
  } catch {
    return [];
  }
}

async function searchEuropePmcPapers(query: string): Promise<CandidatePaper[]> {
  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=6`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4_500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      resultList?: {
        result?: Array<{
          pmid?: string;
          doi?: string;
          title?: string;
          authorString?: string;
          pubYear?: string;
          abstractText?: string;
        }>;
      };
    };

    const papers: CandidatePaper[] = [];
    for (const item of data.resultList?.result || []) {
      const title = (item.title || '').replace(/<[^>]+>/g, '').replace(/\.$/, '').trim();
      if (!title) continue;
      const paperUrl = item.doi
        ? `https://doi.org/${item.doi}`
        : item.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`
          : '';
      if (!paperUrl.startsWith('http')) continue;

      const yr = item.pubYear ? Number.parseInt(item.pubYear, 10) : null;
      const cleanAbstract = (item.abstractText || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 460);

      papers.push({
        title,
        authors: (item.authorString || 'Europe PMC Authors').slice(0, 140),
        year: Number.isFinite(yr) ? yr : null,
        url: paperUrl,
        source: 'Europe PMC',
        abstract: cleanAbstract,
      });
    }
    return papers;
  } catch {
    return [];
  }
}

function scoreCandidateRelevance(paper: CandidatePaper, queryTerms: string[]): number {
  const hayTitle = paper.title.toLowerCase();
  const hayAbs = (paper.abstract || '').toLowerCase();
  let score = paper.abstract && paper.abstract.length > 60 ? 2 : 0;
  for (const term of queryTerms) {
    if (hayTitle.includes(term)) score += 4;
    if (hayAbs.includes(term)) score += 2;
  }
  if (paper.year && paper.year >= 2021) score += 1.5;
  return score;
}

async function discoverCandidatePapers(query: string): Promise<CandidatePaper[]> {
  const hardTimeout = new Promise<CandidatePaper[][]>((resolve) =>
    setTimeout(() => resolve([[], [], [], []]), 5_000)
  );

  const parallelFetch = Promise.all([
    searchSemanticScholarPapers(query),
    searchArxivPapers(query),
    searchOpenAlexPapers(query),
    searchEuropePmcPapers(query),
  ]);

  const [s2List, arxivList, openAlexList, epmcList] = await Promise.race([
    parallelFetch,
    hardTimeout,
  ]);

  const combined: CandidatePaper[] = [];
  const maxLen = Math.max(s2List.length, arxivList.length, openAlexList.length, epmcList.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < s2List.length) combined.push(s2List[i]);
    if (i < arxivList.length) combined.push(arxivList[i]);
    if (i < epmcList.length) combined.push(epmcList[i]);
    if (i < openAlexList.length) combined.push(openAlexList[i]);
  }

  const queryTerms = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const seen = new Set<string>();
  const unique: CandidatePaper[] = [];
  for (const paper of combined) {
    const norm = normalizeTitle(paper.title);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    unique.push(paper);
  }

  unique.sort((a, b) => scoreCandidateRelevance(b, queryTerms) - scoreCandidateRelevance(a, queryTerms));
  return unique.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Research Briefing Synthesis
// ---------------------------------------------------------------------------
function buildSystemPrompt(): string {
  return `You are Ascend, an expert scientific research synthesis engine.
Given a user research topic and a numbered list of real retrieved scholarly papers, produce a rigorous, factual JSON briefing.

STRICT RULES:
1. Return ONLY valid JSON matching the exact schema below—no markdown fences, no commentary outside JSON.
2. "summary": 2-3 crisp, authoritative sentences synthesizing the state of the topic.
3. "sections": Exactly 4 objects with titles in this exact order:
   - "Background" (2-4 sentences)
   - "Key methods" (2-4 sentences)
   - "Recent findings" (2-4 sentences)
   - "Open questions" (2-4 sentences)
4. "selectedSources": Pick up to 6 most relevant papers ONLY from the provided retrieved papers list by specifying their exact integer "paperIndex" (0-based) and a 1-sentence "why" explaining why this specific paper matters to the topic. NEVER invent papers outside the provided indices. If no papers were retrieved, return an empty array [].
5. "graph":
   - "nodes": Array of 9 or 10 concise concept strings (2-4 words max each). The FIRST node (index 0) MUST be the core research topic itself.
   - "edges": Array of 10 to 14 triples [fromNode, toNode, relationLabel] where both fromNode and toNode are exact strings present in "nodes", and relationLabel is a short verb phrase (1-3 words, e.g. "optimizes", "constrains", "benchmarks", "enables").

REQUIRED JSON SCHEMA:
{
  "summary": "string",
  "sections": [
    { "title": "Background", "body": "string" },
    { "title": "Key methods", "body": "string" },
    { "title": "Recent findings", "body": "string" },
    { "title": "Open questions", "body": "string" }
  ],
  "selectedSources": [
    { "paperIndex": 0, "why": "One-line explanation of relevance." }
  ],
  "graph": {
    "nodes": ["Core Topic", "Concept 2", "Concept 3", "Concept 4", "Concept 5", "Concept 6", "Concept 7", "Concept 8", "Concept 9"],
    "edges": [
      ["Core Topic", "Concept 2", "drives"],
      ["Concept 2", "Concept 3", "stabilizes"]
    ]
  }
}`;
}

function buildUserMessage(query: string, candidates: CandidatePaper[]): string {
  const papersBlock =
    candidates.length === 0
      ? 'No candidate papers were returned by upstream indices.'
      : candidates
          .map(
            (p, idx) =>
              `[${idx}] Title: ${p.title}\n    Year: ${p.year ?? 'n.d.'} | Source: ${p.source} | Authors: ${p.authors}\n    Abstract: ${p.abstract || 'No abstract available.'}`
          )
          .join('\n\n');

  return `RESEARCH TOPIC: "${query}"\n\nRETRIEVED CANDIDATE PAPERS (cite ONLY by paperIndex from 0 to ${Math.max(0, candidates.length - 1)}):\n${papersBlock}`;
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model response did not contain a JSON object.');
  }
  const sliced = raw.slice(firstBrace, lastBrace + 1);
  return JSON.parse(sliced) as Record<string, unknown>;
}

async function callAnthropicModel(
  apiKey: string,
  query: string,
  candidates: CandidatePaper[]
): Promise<Record<string, unknown>> {
  const model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserMessage(query, candidates) }],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic upstream HTTP ${res.status}: ${errText.slice(0, 220)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (data.content || [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');

  return extractJsonObject(text);
}

async function callGeminiModel(
  apiKey: string,
  query: string,
  candidates: CandidatePaper[]
): Promise<Record<string, unknown>> {
  const ai = createGeminiClient(apiKey);
  const startedAt = Date.now();
  const totalBudgetMs = 9_500;

  const attempts: Array<{ name: string; timeoutMs: number; useLowThinking: boolean }> = [
    { name: 'gemini-3.8-flash', timeoutMs: 4_800, useLowThinking: true },
    { name: 'gemini-3.1-flash-lite', timeoutMs: 4_200, useLowThinking: false },
    { name: 'gemini-flash-latest', timeoutMs: 4_200, useLowThinking: false },
  ];

  let lastErr: unknown = null;
  for (const step of attempts) {
    const remainingMs = totalBudgetMs - (Date.now() - startedAt);
    if (remainingMs < 1_500) break;

    try {
      const response = await ai.models.generateContent({
        model: step.name,
        contents: buildUserMessage(query, candidates),
        config: {
          systemInstruction: buildSystemPrompt(),
          ...(step.useLowThinking
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          responseMimeType: 'application/json',
          abortSignal: AbortSignal.timeout(Math.min(step.timeoutMs, remainingMs)),
        },
      });
      const text = response.text || '';
      return extractJsonObject(text);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/API_KEY_INVALID|"code":\s*400.*API key/i.test(msg)) {
        throw err;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Gemini synthesis unavailable after retries.');
}

// Grounded Synthesis Directly from Retrieved Scholarly Abstracts when Upstream LLM Hits 503 High Demand
const CONCEPT_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'using', 'based', 'via',
  'between', 'through', 'across', 'under', 'over', 'study', 'studies', 'paper', 'review',
  'analysis', 'approach', 'approaches', 'method', 'methods', 'results', 'towards', 'toward',
  'novel', 'new', 'recent', 'advances', 'applications', 'effect', 'effects', 'role', 'high',
  'data', 'model', 'models', 'system', 'systems', 'their', 'these', 'those', 'have', 'been',
]);

function extractSalientConceptsFromPapers(query: string, candidates: CandidatePaper[]): string[] {
  const topicLower = query.toLowerCase();
  const phraseScores = new Map<string, { display: string; score: number }>();

  const toTitleCase = (phrase: string) =>
    phrase
      .split(/\s+/)
      .map((w) => (w.length <= 4 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');

  for (const paper of candidates) {
    const cleanTitle = paper.title.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleanTitle.split(' ').filter((w) => w.length >= 3);
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i <= words.length - len; i++) {
        const slice = words.slice(i, i + len);
        if (
          CONCEPT_STOPWORDS.has(slice[0].toLowerCase()) ||
          CONCEPT_STOPWORDS.has(slice[slice.length - 1].toLowerCase())
        ) {
          continue;
        }
        const rawPhrase = slice.join(' ');
        const key = rawPhrase.toLowerCase();
        if (key === topicLower || rawPhrase.length > 38 || rawPhrase.length < 7) continue;
        const prev = phraseScores.get(key);
        phraseScores.set(key, {
          display: prev?.display || toTitleCase(rawPhrase),
          score: (prev?.score || 0) + (len === 2 ? 3 : 2.5),
        });
      }
    }
  }

  const ranked = [...phraseScores.values()]
    .sort((a, b) => b.score - a.score)
    .map((item) => item.display);

  const selected: string[] = [];
  for (const candidate of ranked) {
    const lowerWords = new Set(candidate.toLowerCase().split(/\s+/));
    const overlapsExisting = selected.some((existing) => {
      const exWords = existing.toLowerCase().split(/\s+/);
      const shared = exWords.filter((w) => lowerWords.has(w)).length;
      return shared >= 2;
    });
    if (!overlapsExisting) {
      selected.push(candidate);
    }
    if (selected.length >= 8) break;
  }

  return selected;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 45 && s.length <= 320);
}

function synthesizeFromRetrievedLiterature(
  query: string,
  candidates: CandidatePaper[]
): Record<string, unknown> {
  const topPapers = candidates.slice(0, 6);
  const years = candidates
    .map((p) => p.year)
    .filter((y): y is number => typeof y === 'number' && y >= 1980);
  const minYear = years.length > 0 ? Math.min(...years) : null;
  const maxYear = years.length > 0 ? Math.max(...years) : null;
  const yearSpan =
    minYear && maxYear ? (minYear === maxYear ? `${maxYear}` : `${minYear}–${maxYear}`) : 'recent years';

  const indexNames = Array.from(new Set(candidates.map((c) => c.source))).join(', ') || 'scholarly indices';
  const allSentences: string[] = [];
  for (const p of candidates) {
    if (p.abstract) {
      allSentences.push(...splitSentences(p.abstract));
    }
  }

  const pickMatchingSentences = (pattern: RegExp, count: number, used: Set<string>): string[] => {
    const out: string[] = [];
    for (const s of allSentences) {
      if (used.has(s)) continue;
      if (pattern.test(s)) {
        used.add(s);
        out.push(s);
        if (out.length >= count) break;
      }
    }
    if (out.length < count) {
      for (const s of allSentences) {
        if (used.has(s)) continue;
        used.add(s);
        out.push(s);
        if (out.length >= count) break;
      }
    }
    return out;
  };

  const usedSentences = new Set<string>();
  const bgSentences = pickMatchingSentences(/background|fundamental|challenge|enable|mechanism|clinical|architecture|system/i, 2, usedSentences);
  const methodSentences = pickMatchingSentences(/method|design|formulat|algorithm|protocol|nanoparticle|delivery|network|framework|assay|train|engineer/i, 2, usedSentences);
  const findingSentences = pickMatchingSentences(/demonstrat|achiev|improv|show|increas|reduc|efficien|potent|benchmark|outperform|observ/i, 2, usedSentences);
  const openSentences = pickMatchingSentences(/remain|future|limit|safety|scale|off-target|immun|stability|generaliz|open|barrier|clinical/i, 2, usedSentences);

  const leadPaper = topPapers[0];
  const summary =
    candidates.length > 0
      ? `Peer-reviewed literature across ${indexNames} (${yearSpan}) actively investigates ${query}, spanning ${candidates.length} retrieved studies led by ${leadPaper.authors}${leadPaper.year ? ` (${leadPaper.year})` : ''}. ${bgSentences[0] || `Retrieved manuscripts examine core mechanistic architectures, experimental delivery and optimization strategies, and quantitative performance benchmarks.`}`
      : `Research on ${query} encompasses foundational domain mechanisms, experimental validation frameworks, quantitative benchmarking, and open translational challenges.`;

  const extractedConcepts = extractSalientConceptsFromPapers(query, candidates);
  const topicNode = query.length > 42 ? `${query.slice(0, 39).trim()}...` : query;
  const graphNodes = [topicNode, ...extractedConcepts].slice(0, 9);
  const relationVerbs = ['investigates', 'optimizes', 'benchmarks', 'constrains', 'enables', 'validates', 'characterizes', 'advances'];
  const graphEdges: [string, string, string][] = [];
  for (let i = 1; i < graphNodes.length; i++) {
    graphEdges.push([topicNode, graphNodes[i], relationVerbs[(i - 1) % relationVerbs.length]]);
  }
  for (let i = 1; i < graphNodes.length - 1 && graphEdges.length < 13; i++) {
    graphEdges.push([graphNodes[i], graphNodes[i + 1], 'couples with']);
  }

  return {
    summary,
    sections: [
      {
        title: 'Background',
        body:
          bgSentences.join(' ') ||
          `Foundational studies retrieved from ${indexNames} establish the theoretical and empirical motivation behind ${query}, framing key structural bottlenecks and design requirements.`,
      },
      {
        title: 'Key methods',
        body:
          methodSentences.join(' ') ||
          `Primary manuscripts investigating ${query} employ systematic experimental characterization, computational modeling, and controlled comparative protocols across benchmark datasets.`,
      },
      {
        title: 'Recent findings',
        body:
          findingSentences.join(' ') ||
          `Studies published through ${yearSpan} report measurable advances in specificity, efficiency, and reproducibility across primary evaluations of ${query}.`,
      },
      {
        title: 'Open questions',
        body:
          openSentences.join(' ') ||
          `Active open questions across the retrieved literature center on long-term stability, scalable manufacturing or deployment efficiency, and generalization across diverse real-world operating regimes.`,
      },
    ],
    selectedSources: topPapers.map((p, idx) => {
      const firstAbsSentence = splitSentences(p.abstract || '')[0];
      return {
        paperIndex: idx,
        why: firstAbsSentence
          ? firstAbsSentence.slice(0, 210)
          : `${p.source} study${p.year ? ` (${p.year})` : ''} by ${p.authors} directly examining ${query}.`,
      };
    }),
    graph: {
      nodes: graphNodes,
      edges: graphEdges,
    },
  };
}

function normalizeModelOutput(
  rawObj: Record<string, unknown>,
  query: string,
  candidates: CandidatePaper[]
): ResearchResponse {
  const summary =
    typeof rawObj.summary === 'string' && rawObj.summary.trim().length > 0
      ? rawObj.summary.trim()
      : `Current research on ${query} spans foundational theoretical frameworks, empirical benchmarks, and emerging experimental architectures.`;

  const requiredTitles = ['Background', 'Key methods', 'Recent findings', 'Open questions'];
  const rawSections = Array.isArray(rawObj.sections) ? rawObj.sections : [];
  const sections: ResearchSection[] = requiredTitles.map((expectedTitle, idx) => {
    const matched = rawSections.find(
      (s: unknown) =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as { title?: unknown }).title === 'string' &&
        (s as { title: string }).title.toLowerCase() === expectedTitle.toLowerCase()
    ) as { title?: string; body?: string } | undefined;

    const fallbackItem = rawSections[idx] as { body?: string } | undefined;
    const bodyText =
      (typeof matched?.body === 'string' && matched.body.trim()) ||
      (typeof fallbackItem?.body === 'string' && fallbackItem.body.trim()) ||
      `Active literature investigating ${query} examines core ${expectedTitle.toLowerCase()} considerations across theoretical and empirical studies.`;

    return {
      title: expectedTitle,
      body: bodyText,
    };
  });

  const sources: ResearchSource[] = [];
  const usedIndices = new Set<number>();
  const rawSelected = Array.isArray(rawObj.selectedSources) ? rawObj.selectedSources : [];

  for (const item of rawSelected) {
    if (typeof item !== 'object' || item === null) continue;
    const idx = Number((item as { paperIndex?: unknown }).paperIndex);
    const why =
      typeof (item as { why?: unknown }).why === 'string'
        ? (item as { why: string }).why.trim()
        : '';
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < candidates.length &&
      !usedIndices.has(idx)
    ) {
      usedIndices.add(idx);
      const p = candidates[idx];
      sources.push({
        title: p.title,
        authors: p.authors,
        year: p.year,
        url: p.url,
        source: p.source,
        why: why || `Provides direct empirical context on ${query}.`,
      });
      if (sources.length >= 6) break;
    }
  }

  for (let i = 0; i < candidates.length && sources.length < Math.min(5, candidates.length); i++) {
    if (usedIndices.has(i)) continue;
    usedIndices.add(i);
    const p = candidates[i];
    sources.push({
      title: p.title,
      authors: p.authors,
      year: p.year,
      url: p.url,
      source: p.source,
      why: `Relevant ${p.source} study addressing core mechanisms related to ${query}.`,
    });
  }

  const rawGraph =
    typeof rawObj.graph === 'object' && rawObj.graph !== null
      ? (rawObj.graph as { nodes?: unknown; edges?: unknown })
      : {};

  const topicLabel = query.length > 42 ? `${query.slice(0, 39).trim()}...` : query;
  const rawNodes = Array.isArray(rawGraph.nodes)
    ? rawGraph.nodes
        .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
        .map((n) => n.trim().slice(0, 48))
    : [];

  const uniqueNodes: string[] = [topicLabel];
  const nodeLowerSet = new Set<string>([topicLabel.toLowerCase()]);

  for (const n of rawNodes) {
    if (uniqueNodes.length >= 10) break;
    if (!nodeLowerSet.has(n.toLowerCase())) {
      nodeLowerSet.add(n.toLowerCase());
      uniqueNodes.push(n);
    }
  }

  const fallbackConcepts = [
    'Empirical Benchmarks',
    'Theoretical Foundations',
    'Scaling Dynamics',
    'Data Representation',
    'Model Architecture',
    'Inference Efficiency',
    'Causal Mechanisms',
    'Validation Protocols',
    'Open Challenges',
  ];
  for (const fb of fallbackConcepts) {
    if (uniqueNodes.length >= 9) break;
    if (!nodeLowerSet.has(fb.toLowerCase())) {
      nodeLowerSet.add(fb.toLowerCase());
      uniqueNodes.push(fb);
    }
  }

  const canonicalNodeMap = new Map<string, string>();
  uniqueNodes.forEach((n) => canonicalNodeMap.set(n.toLowerCase(), n));
  if (rawNodes[0]) {
    canonicalNodeMap.set(rawNodes[0].toLowerCase(), topicLabel);
  }

  const edges: [string, string, string][] = [];
  const edgePairSet = new Set<string>();
  const rawEdges = Array.isArray(rawGraph.edges) ? rawGraph.edges : [];

  for (const e of rawEdges) {
    if (!Array.isArray(e) || e.length < 2) continue;
    const fromRaw = String(e[0] || '').trim().toLowerCase();
    const toRaw = String(e[1] || '').trim().toLowerCase();
    const relRaw = String(e[2] || 'relates to').trim().slice(0, 28) || 'relates to';

    const fromNode = canonicalNodeMap.get(fromRaw);
    const toNode = canonicalNodeMap.get(toRaw);
    if (!fromNode || !toNode || fromNode === toNode) continue;

    const pairKey = [fromNode, toNode].sort().join('||');
    if (edgePairSet.has(pairKey)) continue;
    edgePairSet.add(pairKey);
    edges.push([fromNode, toNode, relRaw]);
    if (edges.length >= 14) break;
  }

  for (let i = 1; i < uniqueNodes.length && edges.length < 10; i++) {
    const target = uniqueNodes[i];
    const radialKey = [topicLabel, target].sort().join('||');
    if (!edgePairSet.has(radialKey)) {
      edgePairSet.add(radialKey);
      edges.push([topicLabel, target, 'encompasses']);
    }
  }
  for (let i = 1; i < uniqueNodes.length - 1 && edges.length < 11; i++) {
    const a = uniqueNodes[i];
    const b = uniqueNodes[i + 1];
    const ringKey = [a, b].sort().join('||');
    if (!edgePairSet.has(ringKey)) {
      edgePairSet.add(ringKey);
      edges.push([a, b, 'informs']);
    }
  }

  return {
    summary,
    sections,
    sources,
    graph: {
      nodes: uniqueNodes,
      edges,
    },
  };
}

// ---------------------------------------------------------------------------
// Authoritative Bioscience Connectors (UniProtKB + AlphaFold DB + RCSB PDB + Europe PMC)
// ---------------------------------------------------------------------------
async function fetchBioscienceProfile(rawQuery: string) {
  const cleaned = rawQuery.trim();
  const isAccession = /^[OPQ][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(cleaned);

  let uniprotEntry: Record<string, unknown> | null = null;

  if (isAccession) {
    const directRes = await fetch(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(cleaned.toUpperCase())}.json`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (directRes.ok) {
      uniprotEntry = (await directRes.json()) as Record<string, unknown>;
    }
  }

  if (!uniprotEntry) {
    const searchUrl = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(`(gene_exact:${cleaned} OR ${cleaned}) AND reviewed:true`)}&size=1&format=json`;
    const searchRes = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (searchRes.ok) {
      const payload = (await searchRes.json()) as { results?: Array<Record<string, unknown>> };
      if (payload.results && payload.results.length > 0) {
        uniprotEntry = payload.results[0];
      }
    }
  }

  if (!uniprotEntry) {
    const broadUrl = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(cleaned)}&size=1&format=json`;
    const broadRes = await fetch(broadUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (broadRes.ok) {
      const payload = (await broadRes.json()) as { results?: Array<Record<string, unknown>> };
      if (payload.results && payload.results.length > 0) {
        uniprotEntry = payload.results[0];
      }
    }
  }

  if (!uniprotEntry) {
    return null;
  }

  const accession = String(uniprotEntry.primaryAccession || cleaned.toUpperCase());
  const proteinDesc = uniprotEntry.proteinDescription as {
    recommendedName?: { fullName?: { value?: string } };
    submissionNames?: Array<{ fullName?: { value?: string } }>;
  } | undefined;
  const proteinName =
    proteinDesc?.recommendedName?.fullName?.value ||
    proteinDesc?.submissionNames?.[0]?.fullName?.value ||
    accession;

  const genesArr = uniprotEntry.genes as Array<{ geneName?: { value?: string } }> | undefined;
  const geneName = genesArr?.[0]?.geneName?.value || cleaned.toUpperCase();

  const organismObj = uniprotEntry.organism as { scientificName?: string; commonName?: string } | undefined;
  const organism = organismObj?.scientificName
    ? organismObj.commonName
      ? `${organismObj.scientificName} (${organismObj.commonName})`
      : organismObj.scientificName
    : 'Unknown organism';

  const seqObj = uniprotEntry.sequence as { length?: number; molWeight?: number; value?: string } | undefined;
  const sequenceLength = seqObj?.length || 0;
  const molecularMassDa = seqObj?.molWeight || 0;
  const sequenceSnippet = (seqObj?.value || '').slice(0, 120);

  const commentsArr = (uniprotEntry.comments as Array<{
    commentType?: string;
    texts?: Array<{ value?: string }>;
  }>) || [];
  const funcComment = commentsArr.find((c) => c.commentType === 'FUNCTION');
  const functionSummary =
    funcComment?.texts?.[0]?.value ||
    `Reviewed UniProtKB macromolecular entry (${accession}) for ${proteinName}.`;

  const featuresArr = (uniprotEntry.features as Array<{
    type?: string;
    description?: string;
    location?: { start?: { value?: number }; end?: { value?: number } };
  }>) || [];
  const domains = featuresArr
    .filter((f) => ['Domain', 'Region', 'Active site', 'Binding site', 'Motif', 'Zinc finger'].includes(String(f.type)))
    .slice(0, 8)
    .map((f) => ({
      type: String(f.type || 'Domain'),
      description: String(f.description || f.type || 'Annotated region'),
      start: Number(f.location?.start?.value || 1),
      end: Number(f.location?.end?.value || sequenceLength || 1),
    }));

  const crossRefs = (uniprotEntry.uniProtKBCrossReferences as Array<{
    database?: string;
    id?: string;
    properties?: Array<{ key?: string; value?: string }>;
  }>) || [];
  const pdbRefs = crossRefs
    .filter((r) => r.database === 'PDB' && r.id)
    .slice(0, 5)
    .map((r) => {
      const props = r.properties || [];
      const method = props.find((p) => p.key === 'Method')?.value || 'Experimental';
      const resolution = props.find((p) => p.key === 'Resolution')?.value || '-';
      const chains = props.find((p) => p.key === 'Chains')?.value || '';
      return {
        pdbId: String(r.id),
        method,
        resolution,
        chains,
        rcsbUrl: `https://www.rcsb.org/structure/${r.id}`,
      };
    });

  // Parallel calls to AlphaFold DB, RCSB PDB (top structure), and Europe PMC
  const [alphafoldResult, rcsbPrimary, epmcPapers] = await Promise.all([
    (async () => {
      try {
        const afRes = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(accession)}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!afRes.ok) return null;
        const afJson = (await afRes.json()) as Array<Record<string, unknown>>;
        const first = Array.isArray(afJson) && afJson.length > 0 ? afJson[0] : null;
        if (!first) return null;
        return {
          entryId: String(first.entryId || `AF-${accession}-F1`),
          meanPlddt: Number(first.globalMetricValue ?? 0),
          fractionVeryHigh: Number(first.fractionPlddtVeryHigh ?? 0),
          fractionConfident: Number(first.fractionPlddtConfident ?? 0),
          fractionLow: Number(first.fractionPlddtLow ?? 0),
          fractionVeryLow: Number(first.fractionPlddtVeryLow ?? 0),
          pdbUrl: String(first.pdbUrl || ''),
          cifUrl: String(first.cifUrl || ''),
          paeImageUrl: String(first.paeImageUrl || ''),
          modelCreatedDate: String(first.modelCreatedDate || ''),
          entryUrl: `https://alphafold.ebi.ac.uk/entry/${accession}`,
        };
      } catch {
        return null;
      }
    })(),
    (async () => {
      const topPdbId = pdbRefs[0]?.pdbId;
      if (!topPdbId) return null;
      try {
        const rcsbRes = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${encodeURIComponent(topPdbId)}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!rcsbRes.ok) return null;
        const rcsbJson = (await rcsbRes.json()) as {
          struct?: { title?: string };
          exptl?: Array<{ method?: string }>;
          rcsb_entry_info?: { resolution_combined?: number[]; deposited_atom_count?: number };
        };
        return {
          pdbId: topPdbId,
          title: rcsbJson.struct?.title || topPdbId,
          method: rcsbJson.exptl?.[0]?.method || pdbRefs[0].method,
          resolutionAngstrom: rcsbJson.rcsb_entry_info?.resolution_combined?.[0] ?? null,
          atomCount: rcsbJson.rcsb_entry_info?.deposited_atom_count ?? null,
          rcsbUrl: `https://www.rcsb.org/structure/${topPdbId}`,
        };
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const epmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`${geneName} ${accession}`)}&format=json&pageSize=4`;
        const epmcRes = await fetch(epmcUrl, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!epmcRes.ok) return [];
        const epmcJson = (await epmcRes.json()) as {
          resultList?: {
            result?: Array<{
              id?: string;
              pmid?: string;
              title?: string;
              authorString?: string;
              pubYear?: string;
              journalTitle?: string;
            }>;
          };
        };
        return (epmcJson.resultList?.result || [])
          .filter((p) => p.title)
          .slice(0, 4)
          .map((p) => ({
            pmid: p.pmid || p.id || '',
            title: String(p.title || ''),
            authors: String(p.authorString || 'Biomedical Authors'),
            year: p.pubYear || 'n.d.',
            journal: p.journalTitle || 'Europe PMC',
            url: p.pmid
              ? `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`
              : `https://europepmc.org/search?query=${encodeURIComponent(String(p.title || geneName))}`,
          }));
      } catch {
        return [];
      }
    })(),
  ]);

  return {
    accession,
    geneName,
    proteinName,
    organism,
    sequenceLength,
    molecularMassDa,
    sequenceSnippet,
    functionSummary,
    uniprotUrl: `https://www.uniprot.org/uniprotkb/${accession}/entry`,
    domains,
    pdbRefs,
    rcsbPrimary,
    alphafold: alphafoldResult,
    literature: epmcPapers,
  };
}

// ---------------------------------------------------------------------------
// Express App, WebSocket Live Bridge & Server Startup
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  // Allow up to 25MB for audio recordings and reference images; /api/library still enforces its strict 2MB cap
  app.use(express.json({ limit: '25mb' }));

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err && (err.status === 413 || err.type === 'entity.too.large')) {
      res.status(413).json({ detail: 'Request body exceeds the maximum allowed payload size.' });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ detail: 'Malformed JSON request body.' });
      return;
    }
    next(err);
  });

  // Health Check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Library GET (SQLite)
  app.get('/api/library', (req: Request, res: Response) => {
    const cid = validateClientId(req.headers['x-client-id']);
    if (!cid) {
      res.status(400).json({ detail: 'Missing or invalid X-Client-Id header (1–64 safe characters required).' });
      return;
    }
    try {
      const row = getLibStmt.get(cid) as { data: string } | undefined;
      if (!row) {
        res.json([]);
        return;
      }
      const parsed = JSON.parse(row.data);
      res.json(Array.isArray(parsed) ? parsed.slice(0, 40) : []);
    } catch {
      res.json([]);
    }
  });

  // Library PUT (SQLite — strictly <= 40 items and <= 2 MB)
  app.put('/api/library', (req: Request, res: Response) => {
    const cid = validateClientId(req.headers['x-client-id']);
    if (!cid) {
      res.status(400).json({ detail: 'Missing or invalid X-Client-Id header (1–64 safe characters required).' });
      return;
    }
    if (!Array.isArray(req.body)) {
      res.status(400).json({ detail: 'Library payload must be a JSON array.' });
      return;
    }
    if (req.body.length > 40) {
      res.status(400).json({ detail: 'Library cannot exceed 40 saved research items per client.' });
      return;
    }

    const serialized = JSON.stringify(req.body);
    if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) {
      res.status(413).json({ detail: 'Library payload exceeds 2 MB limit.' });
      return;
    }

    try {
      putLibStmt.run(cid, serialized);
      res.json(req.body);
    } catch {
      res.status(500).json({ detail: 'Failed to persist research library to SQLite.' });
    }
  });

  // Persistent Research Share Link Creation (`POST /api/shares`)
  app.post('/api/shares', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (!checkBucketRateLimit(interactiveHits, `share:${ip}`, 30)) {
      res.status(429).json({ detail: 'Too many share link requests. Please wait a moment and try again.' });
      return;
    }

    const body = req.body as {
      query?: unknown;
      createdAt?: unknown;
      summary?: unknown;
      sections?: unknown;
      sources?: unknown;
      graph?: unknown;
    } | null;

    const queryText = typeof body?.query === 'string' ? body.query.trim().replace(/\s+/g, ' ') : '';
    const summaryText = typeof body?.summary === 'string' ? body.summary.trim() : '';

    if (queryText.length < 3 || queryText.length > 200) {
      res.status(422).json({ detail: 'Shared briefing must include a valid research topic (3–200 chars).' });
      return;
    }
    if (summaryText.length < 1 || summaryText.length > 5000) {
      res.status(422).json({ detail: 'Shared briefing must include a non-empty synthesis summary.' });
      return;
    }

    const rawSections = Array.isArray(body?.sections) ? body.sections.slice(0, 6) : [];
    const sections: ResearchSection[] = rawSections
      .filter((s): s is { title: unknown; body: unknown } => Boolean(s && typeof s === 'object'))
      .map((s) => ({
        title: String(s.title || 'Section').slice(0, 80),
        body: String(s.body || '').slice(0, 3000),
      }))
      .filter((s) => s.body.length > 0);

    const rawSources = Array.isArray(body?.sources) ? body.sources.slice(0, 8) : [];
    const sources: ResearchSource[] = rawSources
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
      .map((s) => ({
        title: String(s.title || 'Untitled Manuscript').slice(0, 300),
        authors: String(s.authors || 'Authors').slice(0, 200),
        year: typeof s.year === 'number' && Number.isFinite(s.year) ? s.year : null,
        url: typeof s.url === 'string' && /^https?:\/\//i.test(s.url) ? s.url.slice(0, 500) : 'https://arxiv.org',
        source: String(s.source || 'Scholarly Index').slice(0, 80),
        why: String(s.why || '').slice(0, 500),
      }));

    const rawGraph = body?.graph as { nodes?: unknown; edges?: unknown } | undefined;
    const nodes = Array.isArray(rawGraph?.nodes)
      ? rawGraph.nodes.slice(0, 12).map((n) => String(n || '').slice(0, 90)).filter(Boolean)
      : [queryText];
    const edges: [string, string, string][] = Array.isArray(rawGraph?.edges)
      ? rawGraph.edges
          .slice(0, 20)
          .filter((e): e is [unknown, unknown, unknown] => Array.isArray(e) && e.length >= 3)
          .map((e) => [
            String(e[0] || '').slice(0, 90),
            String(e[1] || '').slice(0, 90),
            String(e[2] || 'relates to').slice(0, 60),
          ])
      : [];

    const createdAtIso =
      typeof body?.createdAt === 'string' && !Number.isNaN(Date.parse(body.createdAt))
        ? new Date(body.createdAt).toISOString()
        : new Date().toISOString();

    const digest = crypto
      .createHash('sha256')
      .update(`${queryText.toLowerCase()}||${summaryText}`)
      .digest('hex')
      .slice(0, 12);
    const shareId = `sh-${digest}`;

    const snapshot = {
      shareId,
      query: queryText,
      createdAt: createdAtIso,
      summary: summaryText,
      sections,
      sources,
      graph: {
        nodes: nodes.length > 0 ? nodes : [queryText],
        edges,
      },
    };

    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
      res.status(413).json({ detail: 'Shared briefing snapshot exceeds 256 KB limit.' });
      return;
    }

    try {
      putShareStmt.run(shareId, serialized, new Date().toISOString());
      res.status(201).json({ shareId, createdAt: createdAtIso });
    } catch {
      res.status(500).json({ detail: 'Failed to save shared research link on server.' });
    }
  });

  // Persistent Research Share Link Retrieval (`GET /api/shares/:shareId`)
  app.get('/api/shares/:shareId', (req: Request, res: Response) => {
    const shareId = String(req.params.shareId || '').trim().toLowerCase();
    if (!/^sh-[a-z0-9]{8,24}$/.test(shareId)) {
      res.status(400).json({ detail: 'Invalid shared research link identifier.' });
      return;
    }

    try {
      const row = getShareStmt.get(shareId) as { payload: string; created_at: string } | undefined;
      if (!row) {
        res.status(404).json({ detail: 'Shared research briefing link was not found.' });
        return;
      }
      const parsed = JSON.parse(row.payload);
      res.json(parsed);
    } catch {
      res.status(500).json({ detail: 'Could not read shared research briefing.' });
    }
  });

  // Primary Research Synthesis POST
  app.post('/api/research', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (!checkBucketRateLimit(ipHits, ip, RATE_LIMIT_PER_MIN)) {
      res.status(429).json({
        detail: `Rate limit reached (${RATE_LIMIT_PER_MIN} requests/minute). Please pause a moment before running your next topic search.`,
      });
      return;
    }

    const rawQuery = req.body?.query;
    if (typeof rawQuery !== 'string') {
      res.status(422).json({ detail: 'Field "query" is required and must be a string.' });
      return;
    }
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    if (query.length < 3 || query.length > 200) {
      res.status(422).json({ detail: 'Research topic must be between 3 and 200 characters.' });
      return;
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
    const geminiKey = getGeminiApiKey();
    const hasAnthropic = Boolean(anthropicKey && anthropicKey !== 'MY_ANTHROPIC_API_KEY');
    const hasGemini = Boolean(geminiKey);

    if (!hasAnthropic && !hasGemini) {
      res.status(503).json({
        detail: 'Server AI API key is not configured. Check your API key in Settings > Secrets.',
      });
      return;
    }

    try {
      const candidates = await discoverCandidatePapers(query);

      let rawModelJson: Record<string, unknown>;
      try {
        if (hasAnthropic && anthropicKey) {
          try {
            rawModelJson = await callAnthropicModel(anthropicKey, query, candidates);
          } catch (anthropicErr) {
            if (hasGemini && geminiKey) {
              rawModelJson = await callGeminiModel(geminiKey, query, candidates);
            } else {
              throw anthropicErr;
            }
          }
        } else {
          rawModelJson = await callGeminiModel(geminiKey!, query, candidates);
        }
      } catch (llmErr) {
        const errText = llmErr instanceof Error ? llmErr.message : String(llmErr);
        // Surface invalid API keys immediately; otherwise synthesize directly from real retrieved scholarly papers
        if (/API_KEY_INVALID|"code":\s*400.*API key/i.test(errText)) {
          const formatted = formatGeminiUpstreamError(llmErr);
          res.status(formatted.status).json({ detail: formatted.detail });
          return;
        }
        rawModelJson = synthesizeFromRetrievedLiterature(query, candidates);
      }

      const structured = normalizeModelOutput(rawModelJson, query, candidates);
      res.json(structured);
    } catch (err) {
      const formatted = formatGeminiUpstreamError(err);
      res.status(formatted.status).json({
        detail: formatted.detail,
      });
    }
  });

  // Authoritative Bioscience Structural & Genomic Lookup
  app.get('/api/bioscience/protein', async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 80) {
      res.status(400).json({ detail: 'Provide a valid gene symbol or UniProtKB accession (2–80 chars).' });
      return;
    }
    try {
      const profile = await fetchBioscienceProfile(q);
      if (!profile) {
        res.status(404).json({
          detail: `No UniProtKB macromolecular entry matched "${q}". Try TP53, BRCA1, EGFR, ABL1, or P04637.`,
        });
        return;
      }
      res.json(profile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bioscience lookup failed';
      res.status(502).json({ detail: `Upstream structural biology API error: ${msg.slice(0, 180)}` });
    }
  });

  // Multi-Turn Gemini Research Chatbot (gemini-3.8-flash | gemini-3.1-flash-lite | gemini-4-argon)
  app.post('/api/chat', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (!checkBucketRateLimit(interactiveHits, ip, 30)) {
      res.status(429).json({ detail: 'Interactive rate limit reached. Please wait a few seconds.' });
      return;
    }

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({ detail: 'Gemini API key is not configured in Settings > Secrets.' });
      return;
    }

    const allowedModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-4-argon'] as const;
    const requestedModel = typeof req.body?.model === 'string' ? req.body.model : 'gemini-3.8-flash';
    const selectedModel = allowedModels.includes(requestedModel as (typeof allowedModels)[number])
      ? requestedModel
      : 'gemini-3.8-flash';

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 6000) {
      res.status(422).json({ detail: 'Message must be between 1 and 6,000 characters.' });
      return;
    }

    const activeTopic = typeof req.body?.activeTopic === 'string' ? req.body.activeTopic.trim().slice(0, 200) : '';
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-24) : [];

    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    for (const turn of rawHistory) {
      if (
        typeof turn === 'object' &&
        turn !== null &&
        ((turn as { role?: unknown }).role === 'user' || (turn as { role?: unknown }).role === 'model') &&
        typeof (turn as { text?: unknown }).text === 'string' &&
        (turn as { text: string }).text.trim().length > 0
      ) {
        contents.push({
          role: (turn as { role: 'user' | 'model' }).role,
          parts: [{ text: (turn as { text: string }).text.trim().slice(0, 6000) }],
        });
      }
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    const systemInstruction = `You are Ascend Research Colleague, a rigorous scientific and technical research assistant.
${activeTopic ? `Current active workspace topic: "${activeTopic}".` : ''}
Provide clear, accurate, analytical answers grounded in established scientific methodology. Distinguish empirical results from open hypotheses, format equations or mechanisms cleanly, and keep responses concise and directly useful for researchers.`;

    const ai = createGeminiClient(geminiKey);

    try {
      const modelsToTry =
        selectedModel === 'gemini-3.8-flash'
          ? ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest']
          : selectedModel === 'gemini-3.1-flash-lite'
            ? ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash']
            : [selectedModel];

      let replyText = '';
      let usedModel = selectedModel;
      let lastErr: unknown = null;

      for (const candidateModel of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: candidateModel,
            contents,
            config: {
              systemInstruction,
              ...(candidateModel === 'gemini-3.8-flash'
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
              abortSignal: AbortSignal.timeout(14_000),
            },
          });
          replyText = (response.text || '').trim();
          usedModel = candidateModel;
          if (replyText) break;
        } catch (err) {
          lastErr = err;
          const errStr = err instanceof Error ? err.message : String(err);
          if (/PERMISSION_DENIED|API_KEY_INVALID|403/i.test(errStr)) {
            throw err;
          }
        }
      }

      if (!replyText) {
        throw lastErr || new Error('Empty response returned by Gemini.');
      }

      res.json({ reply: replyText, model: usedModel });
    } catch (err) {
      const formatted = formatGeminiUpstreamError(err, selectedModel);
      res.status(formatted.status).json({ detail: formatted.detail });
    }
  });

  // Google Search Grounding (gemini-3.8-flash + googleSearch)
  app.post('/api/grounding/search', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (!checkBucketRateLimit(interactiveHits, ip, 25)) {
      res.status(429).json({ detail: 'Rate limit reached. Please pause briefly.' });
      return;
    }

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({ detail: 'Gemini API key is not configured in Settings > Secrets.' });
      return;
    }

    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (query.length < 3 || query.length > 400) {
      res.status(422).json({ detail: 'Search query must be between 3 and 400 characters.' });
      return;
    }

    const ai = createGeminiClient(geminiKey);
    const models = ['gemini-3.8-flash', 'gemini-flash-latest'];
    let lastErr: unknown = null;

    for (const modelName of models) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: query,
          config: {
            systemInstruction:
              'Synthesize up-to-date, accurate scientific and technical findings using Google Search grounding. Highlight concrete dates, benchmarks, institutions, and key takeaways concisely.',
            tools: [{ googleSearch: {} }],
            abortSignal: AbortSignal.timeout(28_000),
          },
        });

        const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const seenUris = new Set<string>();
        const links: Array<{ title: string; uri: string }> = [];

        for (const chunk of rawChunks) {
          const web = (chunk as { web?: { uri?: string; title?: string } }).web;
          if (web?.uri && !seenUris.has(web.uri)) {
            seenUris.add(web.uri);
            links.push({
              title: (web.title || web.uri).trim(),
              uri: web.uri,
            });
          }
        }

        res.json({
          answer: (response.text || '').trim() || 'Search completed.',
          links,
          model: modelName,
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    const formatted = formatGeminiUpstreamError(lastErr, 'Google Search Grounding');
    res.status(formatted.status).json({ detail: formatted.detail });
  });

  // Google Maps Grounding (gemini-3.8-flash + googleMaps — NEVER set responseMimeType or responseSchema)
  app.post('/api/grounding/maps', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (!checkBucketRateLimit(interactiveHits, ip, 25)) {
      res.status(429).json({ detail: 'Rate limit reached. Please pause briefly.' });
      return;
    }

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({ detail: 'Gemini API key is not configured in Settings > Secrets.' });
      return;
    }

    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (query.length < 3 || query.length > 400) {
      res.status(422).json({ detail: 'Location query must be between 3 and 400 characters.' });
      return;
    }

    const rawLat = Number(req.body?.latitude);
    const rawLng = Number(req.body?.longitude);
    const hasCoords =
      Number.isFinite(rawLat) &&
      Number.isFinite(rawLng) &&
      Math.abs(rawLat) <= 90 &&
      Math.abs(rawLng) <= 180;

    const ai = createGeminiClient(geminiKey);
    const models = ['gemini-3.8-flash', 'gemini-flash-latest'];
    let lastErr: unknown = null;

    for (const modelName of models) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: query,
          config: {
            systemInstruction:
              'Help researchers discover universities, national laboratories, biotech hubs, synchrotrons, libraries, and academic conference venues using Google Maps grounding. Provide helpful geographic details.',
            tools: [{ googleMaps: {} }],
            ...(hasCoords
              ? {
                  toolConfig: {
                    retrievalConfig: {
                      latLng: {
                        latitude: rawLat,
                        longitude: rawLng,
                      },
                    },
                  },
                }
              : {}),
            abortSignal: AbortSignal.timeout(28_000),
          },
        });

        const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const seenUris = new Set<string>();
        const places: Array<{ title: string; uri: string; snippets: string[] }> = [];

        for (const chunk of rawChunks) {
          const mapsObj = (
            chunk as {
              maps?: {
                uri?: string;
                title?: string;
                placeAnswerSources?: {
                  reviewSnippets?: Array<{ content?: string; text?: string } | string>;
                };
              };
            }
          ).maps;
          if (mapsObj?.uri && !seenUris.has(mapsObj.uri)) {
            seenUris.add(mapsObj.uri);
            const rawSnippets = mapsObj.placeAnswerSources?.reviewSnippets || [];
            const snippets = rawSnippets
              .map((s) => {
                if (typeof s === 'string') return s.trim();
                return String(s?.content || s?.text || '').trim();
              })
              .filter(Boolean)
              .slice(0, 3);

            places.push({
              title: (mapsObj.title || 'View on Google Maps').trim(),
              uri: mapsObj.uri,
              snippets,
            });
          }
        }

        res.json({
          answer: (response.text || '').trim() || 'Found geographic results.',
          places,
          model: modelName,
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    const formatted = formatGeminiUpstreamError(lastErr, 'Google Maps Grounding');
    res.status(formatted.status).json({ detail: formatted.detail });
  });

  // Microphone Audio Transcription (gemini-3.5-transcribe)
  app.post('/api/transcribe', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (!checkBucketRateLimit(interactiveHits, ip, 25)) {
      res.status(429).json({ detail: 'Rate limit reached. Please wait a moment.' });
      return;
    }

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({ detail: 'Gemini API key is not configured in Settings > Secrets.' });
      return;
    }

    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64.trim() : '';
    const mimeType = typeof req.body?.mimeType === 'string' && req.body.mimeType.trim() ? req.body.mimeType.trim() : 'audio/webm';

    if (!audioBase64) {
      res.status(400).json({ detail: 'Audio recording data is required.' });
      return;
    }

    try {
      const ai = createGeminiClient(geminiKey);
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: 'Transcribe the spoken audio accurately, preserving scientific and technical terminology. Return only the clean transcript text with no extra preamble.',
            },
          ],
        },
        config: {
          abortSignal: AbortSignal.timeout(30_000),
        },
      });

      const transcript = (response.text || '').trim();
      res.json({ transcript });
    } catch (err) {
      const formatted = formatGeminiUpstreamError(err, 'gemini-3.5-transcribe');
      res.status(formatted.status).json({ detail: formatted.detail });
    }
  });

  // Scientific Image Generation & Editing (gemini-nano-banana-2.1 — NEVER set responseMimeType or responseSchema)
  app.post('/api/media/image', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (!checkBucketRateLimit(interactiveHits, ip, 15)) {
      res.status(429).json({ detail: 'Image studio rate limit reached. Please pause briefly.' });
      return;
    }

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({ detail: 'Gemini API key is not configured in Settings > Secrets.' });
      return;
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (prompt.length < 3 || prompt.length > 1500) {
      res.status(422).json({ detail: 'Image prompt must be between 3 and 1,500 characters.' });
      return;
    }

    const allowedRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
    const aspectRatio = allowedRatios.includes(req.body?.aspectRatio) ? String(req.body.aspectRatio) : '16:9';

    const allowedSizes = ['1K', '2K', '4K'];
    const imageSize = allowedSizes.includes(req.body?.imageSize) ? String(req.body.imageSize) : '1K';

    const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : '';
    const mimeType = typeof req.body?.mimeType === 'string' && req.body.mimeType.trim() ? req.body.mimeType.trim() : 'image/png';

    const parts: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> = [];
    if (imageBase64) {
      parts.push({
        inlineData: {
          data: imageBase64,
          mimeType,
        },
      });
    }
    parts.push({ text: prompt });

    try {
      const ai = createGeminiClient(geminiKey);
      const response = await ai.models.generateContent({
        model: 'gemini-nano-banana-2.1',
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio,
            imageSize,
          },
          abortSignal: AbortSignal.timeout(65_000),
        },
      });

      let outputImageDataUrl = '';
      let caption = '';

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) {
          const outMime = part.inlineData.mimeType || 'image/png';
          outputImageDataUrl = `data:${outMime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          caption += (caption ? '\n' : '') + part.text.trim();
        }
      }

      if (!outputImageDataUrl) {
        res.status(502).json({
          detail: caption || 'Model completed without returning an image payload.',
        });
        return;
      }

      res.json({
        imageDataUrl: outputImageDataUrl,
        caption,
        model: 'gemini-nano-banana-2.1',
      });
    } catch (err) {
      const formatted = formatGeminiUpstreamError(err, 'gemini-nano-banana-2.1');
      res.status(formatted.status).json({ detail: formatted.detail });
    }
  });

  // Video Generation & Photo-to-Video Animation (gemini-omni-1.1-flash via Interactions API ONLY)
  app.post('/api/media/video', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (!checkBucketRateLimit(interactiveHits, ip, 8)) {
      res.status(429).json({ detail: 'Video generation rate limit reached. Please pause before starting another render.' });
      return;
    }

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      res.status(503).json({ detail: 'Gemini API key is not configured in Settings > Secrets.' });
      return;
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (prompt.length < 3 || prompt.length > 1500) {
      res.status(422).json({ detail: 'Motion/video prompt must be between 3 and 1,500 characters.' });
      return;
    }

    const aspectRatio: '16:9' | '9:16' = req.body?.aspectRatio === '9:16' ? '9:16' : '16:9';
    const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : '';
    const mimeType = typeof req.body?.mimeType === 'string' && req.body.mimeType.trim() ? req.body.mimeType.trim() : 'image/png';

    try {
      const ai = createGeminiClient(geminiKey);

      const interactionInput = imageBase64
        ? [
            {
              type: 'image' as const,
              mime_type: mimeType,
              data: imageBase64,
            },
            {
              type: 'text' as const,
              text: prompt,
            },
          ]
        : prompt;

      const interaction = (await ai.interactions.create(
        {
          model: 'gemini-omni-1.1-flash',
          input: interactionInput,
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: aspectRatio,
            duration: '5s',
            resolution: '720p',
          },
        } as unknown as Parameters<typeof ai.interactions.create>[0],
        { timeout: 300_000 }
      )) as unknown as {
        output_video?: { data?: string; uri?: string; mime_type?: string };
        outputs?: Array<{ type?: string; data?: string; uri?: string; mime_type?: string }>;
      };

      const videoObj =
        interaction.output_video ||
        (interaction.outputs || []).find((o) => o.type === 'video');

      if (!videoObj) {
        res.status(502).json({ detail: 'Video interaction finished without a video output artifact.' });
        return;
      }

      const outMime = videoObj.mime_type || 'video/mp4';

      if (videoObj.data) {
        res.json({
          videoDataUrl: `data:${outMime};base64,${videoObj.data}`,
          mimeType: outMime,
          model: 'gemini-omni-1.1-flash',
        });
        return;
      }

      if (videoObj.uri) {
        const videoFetch = await fetch(videoObj.uri, {
          headers: { 'x-goog-api-key': geminiKey },
          signal: AbortSignal.timeout(60_000),
        });
        if (!videoFetch.ok) {
          res.status(502).json({ detail: `Failed to download generated video bytes (HTTP ${videoFetch.status}).` });
          return;
        }
        const arrayBuf = await videoFetch.arrayBuffer();
        const b64 = Buffer.from(arrayBuf).toString('base64');
        res.json({
          videoDataUrl: `data:${outMime};base64,${b64}`,
          mimeType: outMime,
          model: 'gemini-omni-1.1-flash',
        });
        return;
      }

      res.status(502).json({ detail: 'Generated video contained neither inline data nor a downloadable URI.' });
    } catch (err) {
      const formatted = formatGeminiUpstreamError(err, 'gemini-omni-1.1-flash');
      res.status(formatted.status).json({ detail: formatted.detail });
    }
  });

  // Static / Vite Frontend Mounting
  const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
  if (isProduction) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // HTTP Server + Live API WebSocket Bridge (`/api/live` -> `gemini-3.8-live`)
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname === '/api/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs: WebSocket, request) => {
    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          detail: 'Gemini API key is not configured in Settings > Secrets.',
        })
      );
      clientWs.close();
      return;
    }

    const urlObj = new URL(request.url || '/api/live', 'http://localhost');
    const topicParam = (urlObj.searchParams.get('topic') || '').trim().slice(0, 160);

    const ai = createGeminiClient(geminiKey);
    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let closed = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    try {
      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' },
            },
          },
          systemInstruction: `You are Ascend Live, a sharp, collegial scientific research partner speaking in real time. ${
            topicParam ? `The user is currently investigating "${topicParam}". ` : ''
          }Keep spoken explanations crisp, natural, and substantive—2 to 4 sentences per turn unless asked to elaborate.`,
        },
        callbacks: {
          onopen: () => {
            safeSend({ type: 'ready' });
          },
          onmessage: (msg: LiveServerMessage) => {
            const parts = msg.serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                safeSend({
                  type: 'audio',
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                });
              }
            }

            if (msg.serverContent?.inputTranscription?.text) {
              safeSend({
                type: 'inputTranscript',
                text: msg.serverContent.inputTranscription.text,
              });
            }

            if (msg.serverContent?.outputTranscription?.text) {
              safeSend({
                type: 'outputTranscript',
                text: msg.serverContent.outputTranscription.text,
              });
            }

            if (msg.serverContent?.interrupted) {
              safeSend({ type: 'interrupted' });
            }

            if (msg.serverContent?.turnComplete) {
              safeSend({ type: 'turnComplete' });
            }
          },
          onerror: (err: unknown) => {
            const msgText = err instanceof Error ? err.message : 'Live voice session encountered an upstream error.';
            safeSend({ type: 'error', detail: msgText.slice(0, 200) });
          },
          onclose: () => {
            if (!closed && clientWs.readyState === WebSocket.OPEN) {
              safeSend({ type: 'closed' });
              clientWs.close();
            }
          },
        },
      });
    } catch (err) {
      const formatted = formatGeminiUpstreamError(err, 'gemini-3.8-live');
      safeSend({ type: 'error', detail: formatted.detail });
      clientWs.close();
      return;
    }

    clientWs.on('message', (raw) => {
      if (!liveSession || closed) return;
      try {
        const parsed = JSON.parse(raw.toString()) as { type?: string; data?: string; text?: string };
        if (parsed.type === 'audio' && typeof parsed.data === 'string' && parsed.data.length > 0) {
          liveSession.sendRealtimeInput({
            audio: {
              data: parsed.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (parsed.type === 'text' && typeof parsed.text === 'string' && parsed.text.trim()) {
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: parsed.text.trim().slice(0, 1000) }] }],
            turnComplete: true,
          });
        }
      } catch {
        // Ignore malformed WS frame
      }
    });

    clientWs.on('close', () => {
      closed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
    });
  });

  const port = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Ascend server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
