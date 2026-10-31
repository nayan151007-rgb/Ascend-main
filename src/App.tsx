import { useEffect, useState, useRef, useCallback, FormEvent } from 'react';
import Lenis from 'lenis';
import {
  Search,
  Star,
  Download,
  Trash2,
  ExternalLink,
  ArrowRight,
  Loader2,
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  X,
  Mic,
  MicOff,
  Gamepad2,
  LogIn,
  LogOut,
  Cloud,
} from 'lucide-react';
import EarthCanvas from './components/EarthCanvas';
import KnowledgeGraphSvg from './components/KnowledgeGraphSvg';
import ShowcaseSection from './components/ShowcaseSection';
import OrbitalObservatory3D from './components/OrbitalObservatory3D';
import BioscienceWorkbench from './components/BioscienceWorkbench';
import ResearchAssistantHub from './components/ResearchAssistantHub';
import MediaStudioPanel from './components/MediaStudioPanel';
import OrbitalDefenseGame from './components/OrbitalDefenseGame';
import {
  auth,
  onAuthStateChanged,
  signInResearcherWithGoogle,
  signOutResearcher,
  upsertCloudBriefing,
  removeCloudBriefing,
  subscribeUserCloudBriefings,
  type CloudBriefingSummary,
  type User,
} from './lib/firebase';
import {
  INITIAL_FEATURED_BRIEFING,
  QUICK_STARTER_TOPICS,
  type LibraryItem,
  type ResearchResult,
} from './types/research';
import {
  generateCollectionReportMarkdown,
  generateSingleReportMarkdown,
  triggerMarkdownDownload,
} from './utils/markdownReport';

const CLIENT_ID_STORAGE_KEY = 'ascend_client_id';
const MAX_LIBRARY_ITEMS = 40;

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getOrCreateClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)?.trim();
    if (existing && /^[a-zA-Z0-9_.:-]{1,64}$/.test(existing)) {
      return existing;
    }
    const created = generateUuid();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return generateUuid();
  }
}

function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

const FEATURES_LIST = [
  {
    index: '01.',
    title: 'Semantic Literature Search',
    body: 'Queries arXiv preprints and the Semantic Scholar citation graph simultaneously, normalizing and deduplicating overlapping manuscripts in seconds.',
  },
  {
    index: '02.',
    title: 'Bioscience Macromolecular Suite',
    body: 'Inspects UniProtKB protein architectures, 4-band AlphaFold pLDDT confidence scores, RCSB PDB crystal structures, and Europe PMC literature.',
  },
  {
    index: '03.',
    title: 'Interactive Concept Graph',
    body: 'Maps nine to ten core domain concepts and directional relationships onto an interactive SVG orbit—click any node to pivot your investigation.',
  },
  {
    index: '04.',
    title: 'Live Voice & Grounded AI',
    body: 'Converse via real-time 24 kHz voice, multi-turn STEM chat, Google Search web grounding, and Google Maps research laboratory discovery.',
  },
  {
    index: '05.',
    title: 'Cloud & SQLite Research Vault',
    body: 'Persists briefings locally in SQLite and syncs across devices with Google Sign-In and hardened Firestore security rules.',
  },
  {
    index: '06.',
    title: '3D Hardware & Media Studio',
    body: 'Explore composite Three.js scientific instruments, generate or edit 4K figures, animate photos into video, and pilot the 3D Orbital Sim.',
  },
];

const TRUSTED_LABS = [
  'MIT CSAIL',
  'Stanford HAI',
  'ETH Zürich',
  'Broad Institute',
  'Mila Québec',
  'Oxford OII',
];

export default function App() {
  const [clientId, setClientId] = useState<string>(() => getOrCreateClientId());
  const [queryInput, setQueryInput] = useState<string>('');
  const [activeItem, setActiveItem] = useState<LibraryItem>(INITIAL_FEATURED_BRIEFING);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState<boolean>(false);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'saved'>('all');

  // Firebase Auth & Cloud Briefings State
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [cloudBriefings, setCloudBriefings] = useState<CloudBriefingSummary[]>([]);
  const [authBusy, setAuthBusy] = useState<boolean>(false);

  // Full-Viewport 3D Orbital Simulation Mode
  const [gameModeActive, setGameModeActive] = useState<boolean>(false);

  // Mic Dictation on Main Topic Bar (`gemini-3.5-transcribe`)
  const [topicRecording, setTopicRecording] = useState<boolean>(false);
  const [topicTranscribing, setTopicTranscribing] = useState<boolean>(false);
  const topicRecorderRef = useRef<MediaRecorder | null>(null);
  const topicChunksRef = useRef<Blob[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    tone: 'idle' | 'loading' | 'error' | 'success';
    text: string;
  }>({
    tone: 'idle',
    text: 'Showing featured briefing · Enter or dictate any research topic above, or click a concept node to synthesize live.',
  });

  const [vaultModalOpen, setVaultModalOpen] = useState<boolean>(false);
  const [vaultInput, setVaultInput] = useState<string>('');
  const [copiedId, setCopiedId] = useState<boolean>(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const lenisRef = useRef<Lenis | null>(null);

  // Track Firebase Authentication Readiness
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Attach Firestore listener ONLY once auth is ready and user is authenticated
  useEffect(() => {
    if (!authReady || !currentUser) {
      setCloudBriefings([]);
      return;
    }
    const unsub = subscribeUserCloudBriefings(currentUser, (items) => {
      setCloudBriefings(items);
    });
    return () => unsub();
  }, [authReady, currentUser]);

  // Initialize Lenis smooth scroll (disabled while full-viewport game shell is active)
  useEffect(() => {
    if (gameModeActive) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;

    const lenis = new Lenis({
      duration: 1.08,
      smoothWheel: true,
    });
    lenisRef.current = lenis;

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = window.requestAnimationFrame(raf);
    };
    rafId = window.requestAnimationFrame(raf);

    return () => {
      window.cancelAnimationFrame(rafId);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [gameModeActive]);

  // Staggered IntersectionObserver reveals
  useEffect(() => {
    if (gameModeActive) return;
    const elements = Array.from(document.querySelectorAll('.reveal-block'));
    if (elements.length === 0) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches || typeof IntersectionObserver === 'undefined') {
      elements.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.06, rootMargin: '0px 0px -24px 0px' }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [gameModeActive]);

  const scrollToSection = useCallback((selector: string, focusSearch = false) => {
    const target = document.querySelector(selector) as HTMLElement | null;
    if (!target) return;

    if (lenisRef.current) {
      lenisRef.current.scrollTo(target, { offset: -72 });
    } else {
      target.scrollIntoView({ behavior: 'smooth' });
    }

    if (focusSearch) {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 420);
    }
  }, []);

  // Sync Library from SQLite backend
  const fetchLibrary = useCallback(async (cid: string) => {
    try {
      const res = await fetch('/api/library', {
        headers: { 'X-Client-Id': cid },
      });
      if (!res.ok) {
        setLibraryLoaded(true);
        return;
      }
      const data = (await res.json()) as LibraryItem[];
      if (Array.isArray(data)) {
        setLibrary(data);
        if (data.length > 0) {
          setActiveItem(data[0]);
          setStatusMessage({
            tone: 'idle',
            text: `Loaded ${data.length} saved research ${data.length === 1 ? 'briefing' : 'briefings'} from your library.`,
          });
        }
      }
    } catch {
      // Keep local fallback seamlessly
    } finally {
      setLibraryLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchLibrary(clientId);
  }, [clientId, fetchLibrary]);

  const persistLibrary = useCallback(
    async (nextItems: LibraryItem[], cid = clientId) => {
      const capped = nextItems.slice(0, MAX_LIBRARY_ITEMS);
      setLibrary(capped);
      try {
        const res = await fetch('/api/library', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': cid,
          },
          body: JSON.stringify(capped),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { detail?: string };
          if (err.detail) {
            setStatusMessage({ tone: 'error', text: err.detail });
          }
        }
      } catch {
        setStatusMessage({
          tone: 'error',
          text: 'Network error while syncing library to server.',
        });
      }
    },
    [clientId]
  );

  // Run Live Research Query
  const executeResearch = useCallback(
    async (rawTopic: string) => {
      const cleaned = rawTopic.trim().replace(/\s+/g, ' ');
      if (cleaned.length < 3 || cleaned.length > 200) {
        setStatusMessage({
          tone: 'error',
          text: 'Please enter a research topic between 3 and 200 characters.',
        });
        return;
      }

      setQueryInput(cleaned);
      setIsLoading(true);
      setStatusMessage({
        tone: 'loading',
        text: `Querying arXiv & Semantic Scholar in parallel and synthesizing "${cleaned}"…`,
      });

      scrollToSection('#workspace');

      try {
        const res = await fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: cleaned }),
        });

        const payload = (await res.json().catch(() => ({}))) as Partial<ResearchResult> & {
          detail?: string;
        };

        if (!res.ok) {
          setStatusMessage({
            tone: 'error',
            text: payload.detail || `Request failed with status ${res.status}.`,
          });
          setIsLoading(false);
          return;
        }

        const newItem: LibraryItem = {
          id: generateUuid(),
          query: cleaned,
          createdAt: new Date().toISOString(),
          saved: false,
          summary: payload.summary || '',
          sections: Array.isArray(payload.sections) ? payload.sections : [],
          sources: Array.isArray(payload.sources) ? payload.sources : [],
          graph:
            payload.graph && Array.isArray(payload.graph.nodes) && Array.isArray(payload.graph.edges)
              ? payload.graph
              : { nodes: [cleaned], edges: [] },
        };

        setActiveItem(newItem);

        const filteredExisting = library.filter(
          (item) => item.query.toLowerCase() !== cleaned.toLowerCase()
        );
        const updatedLibrary = [newItem, ...filteredExisting].slice(0, MAX_LIBRARY_ITEMS);
        await persistLibrary(updatedLibrary);

        if (currentUser && currentUser.emailVerified) {
          void upsertCloudBriefing(currentUser, newItem).catch(() => {
            // Logged via handleFirestoreError
          });
        }

        setStatusMessage({
          tone: 'success',
          text: `Synthesized briefing with ${newItem.sources.length} verified sources and ${newItem.graph.nodes.length} concept nodes.`,
        });
      } catch {
        setStatusMessage({
          tone: 'error',
          text: 'Could not reach the research synthesis server. Check your connection and retry.',
        });
      } finally {
        setIsLoading(false);
      }
    },
    [currentUser, library, persistLibrary, scrollToSection]
  );

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isLoading) {
      void executeResearch(queryInput);
    }
  };

  // Mic Dictation on Main Topic Search Bar (`gemini-3.5-transcribe`)
  const handleToggleTopicMic = async () => {
    if (topicRecording) {
      topicRecorderRef.current?.stop();
      setTopicRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      topicChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          topicChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(topicChunksRef.current, { type: mimeType });
        if (blob.size < 200) return;

        setTopicTranscribing(true);
        setStatusMessage({
          tone: 'loading',
          text: 'Transcribing spoken research topic via gemini-3.5-transcribe…',
        });

        try {
          const buf = await blob.arrayBuffer();
          const b64 = arrayBufferToBase64(buf);
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: b64,
              mimeType: mimeType.split(';')[0],
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            transcript?: string;
            detail?: string;
          };
          if (!res.ok || !data.transcript) {
            setStatusMessage({
              tone: 'error',
              text: data.detail || 'Audio transcription failed.',
            });
            return;
          }
          setQueryInput(data.transcript);
          setStatusMessage({
            tone: 'success',
            text: `Transcribed: "${data.transcript}" — click Synthesize Topic to run.`,
          });
        } catch {
          setStatusMessage({
            tone: 'error',
            text: 'Network error during audio transcription.',
          });
        } finally {
          setTopicTranscribing(false);
        }
      };

      topicRecorderRef.current = recorder;
      recorder.start();
      setTopicRecording(true);
    } catch {
      setStatusMessage({
        tone: 'error',
        text: 'Microphone access denied or unavailable.',
      });
    }
  };

  // Google Sign-In / Sign-Out
  const handleGoogleAuthToggle = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      if (currentUser) {
        await signOutResearcher();
        setStatusMessage({
          tone: 'idle',
          text: 'Signed out of cloud vault. Local SQLite library remains active.',
        });
      } else {
        const user = await signInResearcherWithGoogle();
        setStatusMessage({
          tone: 'success',
          text: `Signed in as ${user.displayName || user.email}. Cloud Firestore sync active.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In cancelled or blocked.';
      setStatusMessage({
        tone: 'error',
        text: msg.includes('popup-closed-by-user')
          ? 'Google Sign-In popup was closed before completing.'
          : `Authentication notice: ${msg.slice(0, 140)}`,
      });
    } finally {
      setAuthBusy(false);
    }
  };

  // Toggle Star / Save on Active or Library Item
  const handleToggleSave = async (targetItem: LibraryItem) => {
    const existsInLib = library.some((i) => i.id === targetItem.id);
    let updatedItem: LibraryItem = { ...targetItem, saved: !targetItem.saved };
    let nextLibrary: LibraryItem[];

    if (existsInLib) {
      nextLibrary = library.map((item) => {
        if (item.id === targetItem.id) {
          updatedItem = { ...item, saved: !item.saved };
          return updatedItem;
        }
        return item;
      });
    } else {
      nextLibrary = [updatedItem, ...library].slice(0, MAX_LIBRARY_ITEMS);
    }

    if (activeItem.id === targetItem.id) {
      setActiveItem(updatedItem);
    }
    await persistLibrary(nextLibrary);

    if (currentUser && currentUser.emailVerified) {
      void upsertCloudBriefing(currentUser, updatedItem).catch(() => {
        // Logged via handleFirestoreError
      });
    }
  };

  const handleDeleteLibraryItem = async (id: string) => {
    const nextLibrary = library.filter((item) => item.id !== id);
    await persistLibrary(nextLibrary);
    if (activeItem.id === id) {
      setActiveItem(nextLibrary[0] || INITIAL_FEATURED_BRIEFING);
    }
    if (currentUser && currentUser.emailVerified) {
      void removeCloudBriefing(currentUser, id).catch(() => {
        // Logged via handleFirestoreError
      });
    }
  };

  const handleOpenLibraryItem = (item: LibraryItem) => {
    setActiveItem(item);
    setQueryInput(item.query);
    setStatusMessage({
      tone: 'idle',
      text: `Viewing archived briefing from ${formatShortDate(item.createdAt)}.`,
    });
    scrollToSection('#workspace');
  };

  const handleOpenCloudBriefing = (cloud: CloudBriefingSummary) => {
    const nodes = cloud.conceptNodes.length > 0 ? cloud.conceptNodes : [cloud.query];
    const edges: [string, string, string][] = nodes
      .slice(1)
      .map((n) => [nodes[0], n, 'encompasses']);

    const reconstructed: LibraryItem = {
      id: cloud.docId,
      query: cloud.query,
      createdAt: cloud.createdAtIso,
      saved: cloud.saved,
      summary: cloud.summary,
      sections: [
        { title: 'Background', body: cloud.background },
        { title: 'Key methods', body: cloud.keyMethods },
        { title: 'Recent findings', body: cloud.recentFindings },
        { title: 'Open questions', body: cloud.openQuestions },
      ],
      sources: cloud.sourceLinks.map((line) => {
        const dashIdx = line.lastIndexOf(' — ');
        const url = dashIdx !== -1 ? line.slice(dashIdx + 3).trim() : 'https://arxiv.org';
        const title = dashIdx !== -1 ? line.slice(0, dashIdx).trim() : line;
        return {
          title,
          authors: 'Cloud Archived Citation',
          year: null,
          url,
          source: 'Cloud Vault',
          why: 'Synced from your authenticated Firestore research vault.',
        };
      }),
      graph: { nodes, edges },
    };

    setActiveItem(reconstructed);
    setQueryInput(cloud.query);
    scrollToSection('#workspace');
  };

  const handleExportCurrent = () => {
    const md = generateSingleReportMarkdown(activeItem);
    triggerMarkdownDownload(md, 'ascend-research-report.md');
    setStatusMessage({
      tone: 'success',
      text: `Downloaded Markdown report for "${activeItem.query}".`,
    });
  };

  const handleExportSavedCollection = () => {
    const starred = library.filter((item) => item.saved);
    const itemsToExport =
      starred.length > 0 ? starred : library.length > 0 ? library : [activeItem];
    const label =
      starred.length > 0
        ? `Starred Research Library (${starred.length} Topics)`
        : `Research Workspace (${itemsToExport.length} Topics)`;
    const md = generateCollectionReportMarkdown(itemsToExport, label);
    triggerMarkdownDownload(md, 'ascend-research-report.md');
    setStatusMessage({
      tone: 'success',
      text: `Downloaded compiled Markdown dossier (${itemsToExport.length} ${itemsToExport.length === 1 ? 'topic' : 'topics'}).`,
    });
  };

  const handleCopyVaultId = async () => {
    try {
      await navigator.clipboard.writeText(clientId);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // Clipboard unavailable in restricted contexts
    }
  };

  const handleSwitchVaultId = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = vaultInput.trim();
    if (!/^[a-zA-Z0-9_.:-]{4,64}$/.test(cleaned)) {
      return;
    }
    try {
      window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, cleaned);
    } catch {
      // Ignore storage restriction
    }
    setClientId(cleaned);
    setVaultModalOpen(false);
    setVaultInput('');
  };

  // Dedicated Full-Viewport Game Shell (Hides Website Chrome Completely)
  if (gameModeActive) {
    return (
      <OrbitalDefenseGame
        currentUser={currentUser}
        onExitGame={() => setGameModeActive(false)}
      />
    );
  }

  const visibleLibrary =
    libraryFilter === 'saved' ? library.filter((item) => item.saved) : library;
  const savedCount = library.filter((item) => item.saved).length;

  const activeIsSaved = library.some((i) => i.id === activeItem.id)
    ? Boolean(library.find((i) => i.id === activeItem.id)?.saved)
    : activeItem.saved;

  const encodedActiveQuery = encodeURIComponent(activeItem.query);

  return (
    <div className="relative min-h-screen text-[#f3f6ff]">
      {/* Fixed Full-Viewport 3D Planet Background */}
      <EarthCanvas />

      {/* Strict 3-Zone Top Navigation Bar (<= 56px height, single row, zero wrap) */}
      <header className="sticky top-0 z-30 h-14 border-b border-[#96afe6]/14 bg-[#04060f]/92">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('#top');
            }}
            className="text-base sm:text-lg font-bold tracking-tight text-[#f3f6ff] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5df0a8] rounded"
          >
            ▲ Ascend
          </a>

          {/* Zone 2: 5 Concise Single-Line Navigation Links */}
          <nav
            aria-label="Primary"
            className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#9aa6c4]"
          >
            <a
              href="#workspace"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('#workspace', true);
              }}
              className="hover:text-[#f3f6ff] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Workspace
            </a>
            <a
              href="#bioscience"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('#bioscience');
              }}
              className="hover:text-[#f3f6ff] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Bioscience
            </a>
            <a
              href="#intelligence-hub"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('#intelligence-hub');
              }}
              className="hover:text-[#f3f6ff] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Colleague
            </a>
            <a
              href="#media-studio"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('#media-studio');
              }}
              className="hover:text-[#f3f6ff] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Studio
            </a>
            <a
              href="#observatory-3d"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('#observatory-3d');
              }}
              className="hover:text-[#f3f6ff] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              3D Lab
            </a>
          </nav>

          {/* Zone 3: Max 2 Clean Actions (Orbital 3D Sim + Google Sign-In) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setGameModeActive(true)}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold border border-[#96afe6]/24 bg-[#0b1228] text-[#f3f6ff] hover:border-[#5df0a8]/55 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Gamepad2 className="w-3.5 h-3.5 text-[#5df0a8] shrink-0" />
              <span>Orbital Sim</span>
            </button>

            <button
              type="button"
              disabled={authBusy}
              onClick={() => void handleGoogleAuthToggle()}
              className="mint-btn-primary px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              {currentUser ? (
                <>
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {(currentUser.displayName || currentUser.email || 'Account')
                      .split(' ')[0]
                      .slice(0, 12)}
                  </span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 shrink-0" />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="relative z-10">
        {/* ================================================================
            SECTION 1: HERO
        ================================================================= */}
        <section className="mx-auto max-w-6xl px-5 sm:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <div className="reveal-block max-w-3xl">
            <p className="text-xs sm:text-sm font-medium text-[#5df0a8] tracking-wide mb-4">
              Grounded Scientific Synthesis · arXiv · Semantic Scholar · AlphaFold DB · Gemini Live
            </p>
            <h1
              className="font-extrabold tracking-tight text-[#f3f6ff] leading-[1.06]"
              style={{
                fontSize: 'clamp(2.35rem, 5vw, 4.1rem)',
                textWrap: 'balance',
              }}
            >
              Discover Smarter, Read{' '}
              <span className="mint-gradient-text italic">Less</span>
            </h1>

            <p className="mt-6 max-w-2xl text-base sm:text-lg text-[#9aa6c4] leading-relaxed">
              Enter or speak any technical hypothesis, protein target, or research frontier. Ascend queries peer-reviewed graphs and macromolecular databases in parallel, synthesizes verified briefings, maps interactive concept topologies, and powers live voice &amp; visual discovery.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={() => scrollToSection('#workspace', true)}
                className="mint-btn-primary px-6 py-3 rounded-full text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Open Research Workspace</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => scrollToSection('#bioscience')}
                className="px-5 py-3 rounded-full text-sm font-semibold text-[#f3f6ff] border border-[#96afe6]/22 bg-[#0b1228]/85 hover:border-[#96afe6]/45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Bioscience Workbench
              </button>

              <button
                type="button"
                onClick={() => setGameModeActive(true)}
                className="px-5 py-3 rounded-full text-sm font-semibold text-[#5df0a8] border border-[#5df0a8]/35 bg-[#081326]/90 hover:bg-[#0d1f3a] transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Gamepad2 className="w-4 h-4 shrink-0" />
                <span>Launch 3D Orbital Sim</span>
              </button>
            </div>

            <div className="mt-14 pt-8 border-t border-[#96afe6]/12">
              <p className="text-xs text-[#6b7796] mb-3">
                Built for researchers and fast-moving labs across
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs sm:text-sm font-semibold tracking-tight text-[#9aa6c4]">
                {TRUSTED_LABS.map((lab, idx) => (
                  <span key={lab} className="flex items-center gap-6 whitespace-nowrap">
                    <span>{lab}</span>
                    {idx < TRUSTED_LABS.length - 1 && (
                      <span aria-hidden="true" className="text-[#6b7796]/50">
                        ·
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            SECTION 2: FEATURES (Six Precision Cards)
        ================================================================= */}
        <section id="features" className="mx-auto max-w-6xl px-5 sm:px-8 py-16">
          <div className="reveal-block flex flex-col gap-10">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-[#5df0a8] mb-2">
                Full-Spectrum Scientific Discovery Platform
              </p>
              <h2
                className="text-2xl sm:text-4xl font-bold tracking-tight text-[#f3f6ff]"
                style={{ textWrap: 'balance' }}
              >
                From raw query to citable synthesis, macromolecular data, and 3D simulation
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES_LIST.map((feat) => (
                <article
                  key={feat.title}
                  className="ascend-panel rounded-2xl p-6 flex flex-col justify-between gap-4"
                >
                  <div>
                    <span className="font-mono-tabular text-xs font-medium text-[#5df0a8]">
                      {feat.index}
                    </span>
                    <h3 className="mt-2 text-lg font-semibold text-[#f3f6ff] tracking-tight">
                      {feat.title}
                    </h3>
                    <p className="mt-2.5 text-sm text-[#9aa6c4] leading-relaxed">{feat.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            SECTION 3: RESEARCH WORKSPACE (Literature Synthesis + Mic Dictation + Graph + Vault)
        ================================================================= */}
        <section
          id="workspace"
          ref={workspaceRef}
          className="mx-auto max-w-6xl px-5 sm:px-8 py-16"
        >
          <div className="reveal-block flex flex-col gap-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#5df0a8] mb-2">Live Synthesis Workbench</p>
                <h2
                  className="text-2xl sm:text-4xl font-bold tracking-tight text-[#f3f6ff]"
                  style={{ textWrap: 'balance' }}
                >
                  Research Workspace
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleToggleSave(activeItem)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    activeIsSaved
                      ? 'border-[#5df0a8]/55 bg-[#5df0a8]/15 text-[#5df0a8]'
                      : 'border-[#96afe6]/20 bg-[#0b1228]/85 text-[#9aa6c4] hover:text-[#f3f6ff]'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 shrink-0 ${activeIsSaved ? 'fill-[#5df0a8]' : ''}`} />
                  <span>{activeIsSaved ? 'Saved in Library' : 'Save Briefing'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCurrent}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-[#96afe6]/20 bg-[#0b1228]/85 text-[#f3f6ff] hover:border-[#96afe6]/45 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 shrink-0 text-[#5df0a8]" />
                  <span>Export Current (.md)</span>
                </button>
              </div>
            </div>

            {/* Topic Search Bar + Mic Transcription + Quick-Try Starters */}
            <div className="ascend-panel rounded-2xl p-5 sm:p-6 flex flex-col gap-4">
              <form onSubmit={handleFormSubmit} className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-[#6b7796] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={queryInput}
                      onChange={(e) => setQueryInput(e.target.value)}
                      minLength={3}
                      maxLength={200}
                      placeholder="Enter or dictate a research topic, e.g. Mechanistic interpretability in sparse autoencoders…"
                      aria-label="Research topic"
                      disabled={isLoading}
                      className="w-full h-12 pl-11 pr-4 rounded-xl bg-[#050917] border border-[#96afe6]/20 text-sm sm:text-base text-[#f3f6ff] placeholder:text-[#6b7796] focus:outline-none focus:border-[#5df0a8] transition-colors disabled:opacity-60"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleToggleTopicMic()}
                    disabled={topicTranscribing || isLoading}
                    title="Dictate topic with microphone (gemini-3.5-transcribe)"
                    className={`h-12 px-3.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      topicRecording
                        ? 'border-rose-400 bg-rose-500/20 text-rose-300'
                        : 'border-[#96afe6]/20 bg-[#080d1e] text-[#9aa6c4] hover:text-[#f3f6ff]'
                    }`}
                  >
                    {topicTranscribing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#5df0a8]" />
                    ) : topicRecording ? (
                      <MicOff className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4 text-[#5df0a8]" />
                    )}
                    <span className="hidden sm:inline">
                      {topicTranscribing ? 'Transcribing…' : topicRecording ? 'Stop' : 'Voice'}
                    </span>
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="mint-btn-primary h-12 px-6 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>Synthesizing…</span>
                    </>
                  ) : (
                    <>
                      <span>Synthesize Topic</span>
                      <ArrowRight className="w-4 h-4 shrink-0" />
                    </>
                  )}
                </button>
              </form>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[#6b7796] mr-1 shrink-0">Try topic:</span>
                {QUICK_STARTER_TOPICS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void executeResearch(sample)}
                    className="px-2.5 py-1 rounded-lg text-xs text-[#9aa6c4] hover:text-[#f3f6ff] bg-[#080e22] hover:bg-[#111c3a] border border-[#96afe6]/14 transition-colors truncate max-w-[260px] sm:max-w-none cursor-pointer disabled:opacity-50"
                  >
                    {sample}
                  </button>
                ))}
              </div>

              <div
                role="status"
                aria-live="polite"
                className={`flex items-center gap-2 text-xs pt-1 ${
                  statusMessage.tone === 'error'
                    ? 'text-rose-400'
                    : statusMessage.tone === 'loading'
                      ? 'text-[#5df0a8]'
                      : statusMessage.tone === 'success'
                        ? 'text-[#5df0a8]'
                        : 'text-[#6b7796]'
                }`}
              >
                {statusMessage.tone === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
                {statusMessage.tone === 'loading' && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                )}
                {statusMessage.tone === 'success' && <Check className="w-3.5 h-3.5 shrink-0" />}
                <span>{statusMessage.text}</span>
              </div>
            </div>

            {/* Split Workspace: Briefing + Sections | Smart Sources */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 ascend-panel rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b7796]">
                    <span>Structured Research Briefing</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{formatShortDate(activeItem.createdAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{activeItem.sources.length} cited papers</span>
                  </div>
                  <h3 className="mt-2 text-xl sm:text-2xl font-bold text-[#f3f6ff] tracking-tight">
                    {activeItem.query}
                  </h3>
                  <p className="mt-4 text-sm sm:text-base text-[#dbe4ff] leading-relaxed">
                    {activeItem.summary}
                  </p>
                </div>

                <div className="h-px bg-[#96afe6]/14" />

                <div className="flex flex-col gap-6">
                  {activeItem.sections.map((sec, idx) => (
                    <div key={sec.title} className="flex flex-col gap-1.5">
                      <h4 className="text-sm font-semibold text-[#5df0a8] tracking-tight">
                        0{idx + 1}. {sec.title}
                      </h4>
                      <p className="text-sm text-[#9aa6c4] leading-relaxed">{sec.body}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-5 ascend-panel rounded-2xl p-6 sm:p-8 flex flex-col justify-between gap-6">
                <div className="flex flex-col gap-5">
                  <div>
                    <div className="text-xs text-[#6b7796]">
                      Verified Citations · Retrieved from arXiv &amp; Semantic Scholar
                    </div>
                    <h3 className="mt-1 text-lg font-bold text-[#f3f6ff] tracking-tight">
                      Primary Literature ({activeItem.sources.length})
                    </h3>
                  </div>

                  {activeItem.sources.length === 0 ? (
                    <div className="py-8 text-sm text-[#9aa6c4]">
                      No direct upstream manuscripts matched this exact phrase. Use the search-more links below to broaden discovery across arXiv and Google Scholar.
                    </div>
                  ) : (
                    <div className="flex flex-col divide-y divide-[#96afe6]/12">
                      {activeItem.sources.map((src, idx) => (
                        <div key={`${src.url}-${idx}`} className="py-4 first:pt-0 last:pb-0">
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group inline-flex items-start gap-2 text-sm font-semibold text-[#f3f6ff] hover:text-[#5df0a8] transition-colors leading-snug"
                          >
                            <span>{src.title}</span>
                            <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-65 group-hover:opacity-100" />
                          </a>

                          <div className="mt-1 text-xs text-[#6b7796] flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span>{src.authors}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">{src.year ?? 'n.d.'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#9aa6c4]">{src.source}</span>
                          </div>

                          <p className="mt-2 text-xs text-[#9aa6c4] leading-relaxed">{src.why}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-5 border-t border-[#96afe6]/14 flex flex-col gap-2.5">
                  <div className="text-xs text-[#6b7796]">Search deeper across scholarly indices</div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
                    <a
                      href={`https://arxiv.org/search/?query=${encodedActiveQuery}&searchtype=all`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#5df0a8] hover:underline underline-offset-4 whitespace-nowrap"
                    >
                      <span>arXiv</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                    <span aria-hidden="true" className="text-[#6b7796]">
                      ·
                    </span>
                    <a
                      href={`https://www.semanticscholar.org/search?q=${encodedActiveQuery}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#5df0a8] hover:underline underline-offset-4 whitespace-nowrap"
                    >
                      <span>Semantic Scholar</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                    <span aria-hidden="true" className="text-[#6b7796]">
                      ·
                    </span>
                    <a
                      href={`https://scholar.google.com/scholar?q=${encodedActiveQuery}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#5df0a8] hover:underline underline-offset-4 whitespace-nowrap"
                    >
                      <span>Google Scholar</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Knowledge Graph Pane */}
            <div id="graph-stage" className="ascend-panel rounded-2xl p-6 sm:p-8 flex flex-col gap-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-[#5df0a8]">Interactive Concept Topology</p>
                  <h3 className="mt-1 text-lg sm:text-xl font-bold text-[#f3f6ff] tracking-tight">
                    Knowledge Graph — {activeItem.graph.nodes[0] || activeItem.query}
                  </h3>
                </div>
                <p className="text-xs text-[#9aa6c4]">
                  Hover nodes to inspect semantic edges · Click any node to run a new search
                </p>
              </div>

              <KnowledgeGraphSvg
                graph={activeItem.graph}
                isLoading={isLoading}
                onSelectConcept={(concept) => void executeResearch(concept)}
              />
            </div>

            {/* Personal Research Library Pane (SQLite + Authenticated Cloud Firestore Vault) */}
            <div id="library" className="ascend-panel rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-[#6b7796]">
                    SQLite + Cloud Firestore Research Vault ·{' '}
                    <span className="font-mono-tabular">
                      {library.length} / {MAX_LIBRARY_ITEMS} local
                    </span>
                    {currentUser && (
                      <>
                        {' · '}
                        <span className="text-[#5df0a8] font-mono-tabular">
                          {cloudBriefings.length} synced to Firestore
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="mt-1 text-lg sm:text-xl font-bold text-[#f3f6ff] tracking-tight">
                    Personal Research Library
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className="flex items-center gap-1 p-1 rounded-xl bg-[#080d1e] border border-[#96afe6]/15"
                    role="tablist"
                    aria-label="Filter research library"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={libraryFilter === 'all'}
                      onClick={() => setLibraryFilter('all')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        libraryFilter === 'all'
                          ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                          : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
                      }`}
                    >
                      All ({library.length})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={libraryFilter === 'saved'}
                      onClick={() => setLibraryFilter('saved')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        libraryFilter === 'saved'
                          ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                          : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
                      }`}
                    >
                      Saved ({savedCount})
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportSavedCollection}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-[#5df0a8]/35 bg-[#5df0a8]/10 hover:bg-[#5df0a8]/18 text-[#5df0a8] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Export Saved Dossier (.md)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setVaultModalOpen(true)}
                    className="px-3 py-2 rounded-xl text-xs font-medium border border-[#96afe6]/18 bg-[#080d1e] text-[#9aa6c4] hover:text-[#f3f6ff] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5 shrink-0" />
                    <span>Vault ID</span>
                  </button>
                </div>
              </div>

              {!libraryLoaded ? (
                <div className="py-8 text-sm text-[#6b7796] flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading your research library…</span>
                </div>
              ) : visibleLibrary.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-[#96afe6]/15 rounded-xl px-4">
                  <p className="text-sm text-[#9aa6c4]">
                    {libraryFilter === 'saved'
                      ? 'No starred briefings yet. Click the star button on any research topic to pin it to your Saved collection.'
                      : 'Every topic you synthesize is automatically saved here for instant reopening and multi-topic Markdown export.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#96afe6]/12">
                  {visibleLibrary.map((item) => {
                    const isCurrent = item.id === activeItem.id;
                    return (
                      <div
                        key={item.id}
                        className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => handleOpenLibraryItem(item)}
                            className="text-left group focus-visible:outline-none"
                          >
                            <div className="text-sm sm:text-base font-semibold text-[#f3f6ff] group-hover:text-[#5df0a8] transition-colors truncate">
                              {item.query}
                            </div>
                            <div className="mt-1 text-xs text-[#6b7796] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-mono-tabular">{formatShortDate(item.createdAt)}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-tabular">{item.sources.length} sources</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-tabular">{item.graph.nodes.length} concepts</span>
                              {isCurrent && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-[#5df0a8]">Active in workspace</span>
                                </>
                              )}
                            </div>
                          </button>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleToggleSave(item)}
                            aria-label={item.saved ? 'Remove star' : 'Star topic'}
                            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                              item.saved
                                ? 'border-[#5df0a8]/50 bg-[#5df0a8]/12 text-[#5df0a8]'
                                : 'border-[#96afe6]/15 bg-[#080d1e] text-[#6b7796] hover:text-[#f3f6ff]'
                            }`}
                          >
                            <Star className={`w-4 h-4 ${item.saved ? 'fill-[#5df0a8]' : ''}`} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenLibraryItem(item)}
                            className="px-3 py-1.5 rounded-lg border border-[#96afe6]/18 bg-[#080d1e] hover:border-[#96afe6]/40 text-xs font-medium text-[#f3f6ff] transition-colors whitespace-nowrap cursor-pointer"
                          >
                            Open
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDeleteLibraryItem(item.id)}
                            aria-label={`Delete ${item.query}`}
                            className="p-2 rounded-lg border border-[#96afe6]/15 bg-[#080d1e] text-[#6b7796] hover:text-rose-400 hover:border-rose-400/35 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Signed-In Firestore Cloud Briefings Mirror */}
              {currentUser && cloudBriefings.length > 0 && (
                <div className="pt-5 border-t border-[#96afe6]/14 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#5df0a8]">
                    <Cloud className="w-3.5 h-3.5" />
                    <span>Cloud-Synced Firestore Briefings ({cloudBriefings.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {cloudBriefings.slice(0, 6).map((cb) => (
                      <button
                        key={cb.docId}
                        type="button"
                        onClick={() => handleOpenCloudBriefing(cb)}
                        className="p-3.5 rounded-xl bg-[#070c1c] border border-[#96afe6]/14 hover:border-[#5df0a8]/45 text-left transition-colors cursor-pointer"
                      >
                        <div className="text-xs sm:text-sm font-semibold text-[#f3f6ff] truncate">
                          {cb.query}
                        </div>
                        <div className="mt-1 text-[11px] text-[#6b7796] font-mono-tabular">
                          {formatShortDate(cb.createdAtIso)} · {cb.conceptNodes.length} concepts
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ================================================================
            SECTION 4: BIOSCIENCE MACROMOLECULAR WORKBENCH
        ================================================================= */}
        <BioscienceWorkbench onSynthesizeTopic={(topic) => void executeResearch(topic)} />

        {/* ================================================================
            SECTION 5: MULTIMODAL RESEARCH COLLEAGUE (Chat, Live Voice, Search, Maps)
        ================================================================= */}
        <ResearchAssistantHub
          activeTopic={activeItem.query}
          currentUser={currentUser}
        />

        {/* ================================================================
            SECTION 6: VISUAL FIGURE & MOTION STUDIO (Nano Banana 2.1 + Omni 1.1 Flash)
        ================================================================= */}
        <MediaStudioPanel activeTopic={activeItem.query} />

        {/* ================================================================
            SECTION 7: INTERACTIVE 3D PBR HARDWARE OBSERVATORY
        ================================================================= */}
        <OrbitalObservatory3D />

        {/* ================================================================
            SECTION 8: LITERATURE VELOCITY SHOWCASE
        ================================================================= */}
        <ShowcaseSection onRunLensQuery={(q) => void executeResearch(q)} />

        {/* ================================================================
            SECTION 9: CTA CARD & QUIET FOOTER
        ================================================================= */}
        <section className="mx-auto max-w-6xl px-5 sm:px-8 pt-8 pb-24">
          <div className="reveal-block ascend-panel rounded-2xl p-8 sm:p-12 flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight text-[#f3f6ff]"
                style={{ textWrap: 'balance' }}
              >
                Ready to map your next literature review or test orbital telemetry?
              </h2>
              <p className="mt-2.5 text-sm sm:text-base text-[#9aa6c4] leading-relaxed">
                Synthesize peer-reviewed preprints, inspect AlphaFold macromolecular confidence, converse via live voice, or enter the full-viewport 3D Kessler Vector simulation.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => scrollToSection('#workspace', true)}
                className="mint-btn-primary px-6 py-3 rounded-full text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Run a New Topic Search</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setGameModeActive(true)}
                className="px-5 py-3 rounded-full border border-[#96afe6]/24 bg-[#0b1228] text-sm font-semibold text-[#f3f6ff] hover:border-[#5df0a8]/50 flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Gamepad2 className="w-4 h-4 text-[#5df0a8]" />
                <span>Play Orbital Sim</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer with Mandatory arXiv, Semantic Scholar, UniProtKB & AlphaFold Attribution */}
      <footer className="relative z-10 border-t border-[#96afe6]/12 bg-[#04060f]/95 py-10">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 text-xs text-[#6b7796]">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-[#f3f6ff]">▲ Ascend</span>
            <span>
              Thank you to arXiv, Semantic Scholar, UniProtKB, RCSB PDB, and AlphaFold DB (EMBL-EBI) for open scientific interoperability APIs.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-6 whitespace-nowrap">
            <a
              href="#workspace"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('#workspace', true);
              }}
              className="hover:text-[#f3f6ff] transition-colors"
            >
              Workspace
            </a>
            <a
              href="#bioscience"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('#bioscience');
              }}
              className="hover:text-[#f3f6ff] transition-colors"
            >
              Bioscience
            </a>
            <a
              href="#intelligence-hub"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('#intelligence-hub');
              }}
              className="hover:text-[#f3f6ff] transition-colors"
            >
              Colleague
            </a>
            <span>© {new Date().getFullYear()} Ascend Research</span>
          </div>
        </div>
      </footer>

      {/* Client Vault Sync Modal */}
      {vaultModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vault-modal-title"
        >
          <div className="ascend-panel w-full max-w-md rounded-2xl p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <h3 id="vault-modal-title" className="text-base font-bold text-[#f3f6ff]">
                Anonymous Research Vault Key
              </h3>
              <button
                type="button"
                onClick={() => setVaultModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-[#9aa6c4] hover:text-[#f3f6ff] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#9aa6c4] leading-relaxed">
              Your local library is stored server-side in SQLite under this anonymous client UUID (`X-Client-Id`), or sign in with Google in the header to sync across devices via Firestore.
            </p>

            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded-lg bg-[#050814] border border-[#96afe6]/20 text-xs font-mono-tabular text-[#5df0a8] truncate">
                {clientId}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyVaultId()}
                className="px-3 py-2 rounded-lg border border-[#96afe6]/20 bg-[#0b132b] text-xs font-medium text-[#f3f6ff] flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                {copiedId ? (
                  <Check className="w-3.5 h-3.5 text-[#5df0a8]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedId ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSwitchVaultId(e)}
              className="flex flex-col gap-2.5 pt-2 border-t border-[#96afe6]/12"
            >
              <label htmlFor="restore-vault-input" className="text-xs text-[#9aa6c4]">
                Switch to an existing Vault ID
              </label>
              <div className="flex gap-2">
                <input
                  id="restore-vault-input"
                  type="text"
                  value={vaultInput}
                  onChange={(e) => setVaultInput(e.target.value)}
                  placeholder="Paste existing UUID…"
                  maxLength={64}
                  className="flex-1 px-3 py-2 rounded-lg bg-[#050814] border border-[#96afe6]/20 text-xs font-mono-tabular text-[#f3f6ff] focus:outline-none focus:border-[#5df0a8]"
                />
                <button
                  type="submit"
                  className="mint-btn-primary px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  Load Vault
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
