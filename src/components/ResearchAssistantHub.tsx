import { useState, useRef, useEffect, FormEvent } from 'react';
import {
  MessageSquare,
  Mic,
  MicOff,
  Radio,
  Globe,
  MapPin,
  Send,
  Loader2,
  ExternalLink,
  AlertCircle,
  PhoneOff,
  RotateCcw,
} from 'lucide-react';
import { recordChatExchangeToCloud, type User } from '../lib/firebase';

export type HubTab = 'chat' | 'live' | 'search' | 'maps';
type ChatModelId = 'gemini-3.8-flash' | 'gemini-3.1-flash-lite' | 'gemini-4-argon';

interface ChatMessageItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelLabel?: string;
}

interface ResearchAssistantHubProps {
  activeTopic: string;
  currentUser: User | null;
  onTranscribeToWorkspace?: (transcript: string) => void;
  requestedTab?: { tab: HubTab; seq: number } | null;
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

function base64ToInt16Array(b64: string): Int16Array {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export default function ResearchAssistantHub({
  activeTopic,
  currentUser,
  onTranscribeToWorkspace,
  requestedTab,
}: ResearchAssistantHubProps) {
  const [activeTab, setActiveTab] = useState<HubTab>('chat');

  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab.tab);
    }
  }, [requestedTab]);

  // -------------------------------------------------------------------------
  // TAB 1: Multi-Turn Chat + Mic Audio Transcription (`gemini-3.5-transcribe`)
  // -------------------------------------------------------------------------
  const [chatModel, setChatModel] = useState<ChatModelId>('gemini-3.8-flash');
  const [chatThreadId, setChatThreadId] = useState<string>(() => `thread-${Date.now()}`);
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([
    {
      id: 'welcome-turn',
      role: 'model',
      text: 'Ask follow-up questions about experimental methodology, mathematical derivations, dataset benchmarks, or competing hypotheses. You can also dictate questions with the microphone button.',
      modelLabel: 'gemini-3.8-flash',
    },
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string>('');

  const [isRecordingDictation, setIsRecordingDictation] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatLoading]);

  const handleSendChat = async (e?: FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const prompt = (overrideText ?? chatInput).trim();
    if (!prompt || chatLoading) return;

    setChatInput('');
    setChatError('');

    const userMsg: ChatMessageItem = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: prompt,
    };

    const historyPayload = chatMessages
      .filter((m) => m.id !== 'welcome-turn')
      .map((m) => ({ role: m.role, text: m.text }));

    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          history: historyPayload,
          message: prompt,
          activeTopic,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        model?: string;
        detail?: string;
      };
      if (!res.ok || !data.reply) {
        setChatError(data.detail || `Chat request failed (${res.status}).`);
        return;
      }

      const replyItem: ChatMessageItem = {
        id: `m-${Date.now()}`,
        role: 'model',
        text: data.reply,
        modelLabel: data.model || chatModel,
      };
      setChatMessages((prev) => [...prev, replyItem]);

      if (currentUser && currentUser.emailVerified) {
        const turnCount = Math.floor((historyPayload.length + 2) / 2);
        void recordChatExchangeToCloud(
          currentUser,
          chatThreadId,
          activeTopic || prompt.slice(0, 80),
          chatModel,
          turnCount,
          prompt,
          data.reply
        ).catch(() => {
          // Handled via console error logger in firebase helper
        });
      }
    } catch {
      setChatError('Network error communicating with the research chat endpoint.');
    } finally {
      setChatLoading(false);
    }
  };

  const toggleMicDictation = async () => {
    if (isRecordingDictation) {
      mediaRecorderRef.current?.stop();
      setIsRecordingDictation(false);
      return;
    }

    setChatError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      recordedChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (blob.size < 200) return;

        setIsTranscribing(true);
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
          if (!res.ok) {
            setChatError(data.detail || 'Audio transcription failed.');
            return;
          }
          if (data.transcript) {
            setChatInput((prev) => (prev ? `${prev} ${data.transcript}` : data.transcript!));
            if (onTranscribeToWorkspace) {
              onTranscribeToWorkspace(data.transcript);
            }
          }
        } catch {
          setChatError('Failed to send audio recording for transcription.');
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingDictation(true);
    } catch {
      setChatError('Microphone permission was denied or no audio input device is available.');
    }
  };

  // -------------------------------------------------------------------------
  // TAB 2: Real-Time Live Voice Colleague (`gemini-3.8-live` via `/api/live`)
  // -------------------------------------------------------------------------
  const [liveStatus, setLiveStatus] = useState<'disconnected' | 'connecting' | 'live'>('disconnected');
  const [liveError, setLiveError] = useState<string>('');
  const [liveTranscripts, setLiveTranscripts] = useState<
    Array<{ id: string; speaker: 'You' | 'Ascend Live'; text: string }>
  >([]);

  const liveWsRef = useRef<WebSocket | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const playAudioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);

  const stopLiveVoiceSession = () => {
    try {
      liveWsRef.current?.close();
    } catch {
      // ignore
    }
    liveWsRef.current = null;

    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // ignore
      }
    });
    activeSourcesRef.current.clear();

    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;

    void micAudioCtxRef.current?.close();
    micAudioCtxRef.current = null;

    void playAudioCtxRef.current?.close();
    playAudioCtxRef.current = null;

    nextStartTimeRef.current = 0;
    setLiveStatus('disconnected');
  };

  useEffect(() => {
    return () => {
      stopLiveVoiceSession();
    };
  }, []);

  const startLiveVoiceSession = async () => {
    if (liveStatus !== 'disconnected') {
      stopLiveVoiceSession();
      return;
    }

    setLiveError('');
    setLiveStatus('connecting');

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;

      const micCtx = new AudioContext({ sampleRate: 16000 });
      const playCtx = new AudioContext({ sampleRate: 24000 });
      micAudioCtxRef.current = micCtx;
      playAudioCtxRef.current = playCtx;
      nextStartTimeRef.current = playCtx.currentTime;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/api/live?topic=${encodeURIComponent(activeTopic)}`;
      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            data?: string;
            text?: string;
            detail?: string;
          };

          if (msg.type === 'ready') {
            setLiveStatus('live');
            // Start streaming 16kHz PCM frames once upstream session is open
            const source = micCtx.createMediaStreamSource(micStream);
            const processor = micCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (audioEvent) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const inputFloat = audioEvent.inputBuffer.getChannelData(0);
              const pcm16 = new Int16Array(inputFloat.length);
              for (let i = 0; i < inputFloat.length; i++) {
                const s = Math.max(-1, Math.min(1, inputFloat[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
              }
              ws.send(
                JSON.stringify({
                  type: 'audio',
                  data: arrayBufferToBase64(pcm16.buffer),
                })
              );
            };
            source.connect(processor);
            processor.connect(micCtx.destination);
          } else if (msg.type === 'audio' && msg.data && playAudioCtxRef.current) {
            const pCtx = playAudioCtxRef.current;
            const int16 = base64ToInt16Array(msg.data);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) {
              float32[i] = int16[i] / 32768;
            }
            const audioBuf = pCtx.createBuffer(1, float32.length, 24000);
            audioBuf.copyToChannel(float32, 0);

            const srcNode = pCtx.createBufferSource();
            srcNode.buffer = audioBuf;
            srcNode.connect(pCtx.destination);

            const startAt = Math.max(pCtx.currentTime, nextStartTimeRef.current);
            srcNode.start(startAt);
            nextStartTimeRef.current = startAt + audioBuf.duration;

            activeSourcesRef.current.add(srcNode);
            srcNode.onended = () => {
              activeSourcesRef.current.delete(srcNode);
            };
          } else if (msg.type === 'interrupted' && playAudioCtxRef.current) {
            activeSourcesRef.current.forEach((s) => {
              try {
                s.stop();
              } catch {
                // ignore
              }
            });
            activeSourcesRef.current.clear();
            nextStartTimeRef.current = playAudioCtxRef.current.currentTime;
          } else if (msg.type === 'inputTranscript' && msg.text) {
            setLiveTranscripts((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.speaker === 'You') {
                return [...prev.slice(0, -1), { ...last, text: `${last.text}${msg.text}` }];
              }
              return [...prev.slice(-18), { id: `in-${Date.now()}`, speaker: 'You', text: msg.text! }];
            });
          } else if (msg.type === 'outputTranscript' && msg.text) {
            setLiveTranscripts((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.speaker === 'Ascend Live') {
                return [...prev.slice(0, -1), { ...last, text: `${last.text}${msg.text}` }];
              }
              return [
                ...prev.slice(-18),
                { id: `out-${Date.now()}`, speaker: 'Ascend Live', text: msg.text! },
              ];
            });
          } else if (msg.type === 'error') {
            setLiveError(msg.detail || 'Live voice session error.');
            stopLiveVoiceSession();
          } else if (msg.type === 'closed') {
            stopLiveVoiceSession();
          }
        } catch {
          // ignore parse error
        }
      };

      ws.onerror = () => {
        setLiveError('WebSocket connection to Live Voice bridge failed.');
        stopLiveVoiceSession();
      };

      ws.onclose = () => {
        setLiveStatus('disconnected');
      };
    } catch {
      setLiveError('Microphone access is required for real-time voice conversations.');
      stopLiveVoiceSession();
    }
  };

  // -------------------------------------------------------------------------
  // TAB 3: Google Search Grounding (`gemini-3.8-flash` + `googleSearch`)
  // -------------------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState<string>(
    'Latest frontier breakthroughs in mechanistic interpretability and sparse autoencoders'
  );
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string>('');
  const [searchResult, setSearchResult] = useState<{
    answer: string;
    links: Array<{ title: string; uri: string }>;
  } | null>(null);

  const runGroundedWebSearch = async (rawQ: string) => {
    const cleaned = rawQ.trim();
    if (cleaned.length < 3 || searchLoading) return;
    setSearchQuery(cleaned);
    setSearchLoading(true);
    setSearchError('');
    try {
      const res = await fetch('/api/grounding/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cleaned }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string;
        links?: Array<{ title: string; uri: string }>;
        detail?: string;
      };
      if (!res.ok) {
        setSearchError(data.detail || `Grounded web search failed (${res.status}).`);
        return;
      }
      setSearchResult({
        answer: data.answer || '',
        links: Array.isArray(data.links) ? data.links : [],
      });
    } catch {
      setSearchError('Network error during Google Search grounding.');
    } finally {
      setSearchLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // TAB 4: Google Maps Grounding (`gemini-3.8-flash` + `googleMaps`)
  // -------------------------------------------------------------------------
  const [mapsQuery, setMapsQuery] = useState<string>(
    'Leading genomics, biotech, and AI research institutes near Kendall Square Cambridge MA'
  );
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<boolean>(false);
  const [mapsLoading, setMapsLoading] = useState<boolean>(false);
  const [mapsError, setMapsError] = useState<string>('');
  const [mapsResult, setMapsResult] = useState<{
    answer: string;
    places: Array<{ title: string; uri: string; snippets: string[] }>;
  } | null>(null);

  const requestUserGeolocation = () => {
    if (!navigator.geolocation) {
      setMapsError('Geolocation is not supported by this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocating(false);
        setMapsQuery('Universities, research libraries, and science laboratories near me');
      },
      () => {
        setLocating(false);
        setMapsError('Location permission declined; enter any city or region explicitly.');
      },
      { timeout: 8000 }
    );
  };

  const runGroundedMapsLookup = async (rawQ: string) => {
    const cleaned = rawQ.trim();
    if (cleaned.length < 3 || mapsLoading) return;
    setMapsQuery(cleaned);
    setMapsLoading(true);
    setMapsError('');
    try {
      const res = await fetch('/api/grounding/maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: cleaned,
          ...(userCoords ? { latitude: userCoords.lat, longitude: userCoords.lng } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string;
        places?: Array<{ title: string; uri: string; snippets: string[] }>;
        detail?: string;
      };
      if (!res.ok) {
        setMapsError(data.detail || `Maps grounding lookup failed (${res.status}).`);
        return;
      }
      setMapsResult({
        answer: data.answer || '',
        places: Array.isArray(data.places) ? data.places : [],
      });
    } catch {
      setMapsError('Network error during Google Maps grounding.');
    } finally {
      setMapsLoading(false);
    }
  };

  return (
    <section id="intelligence-hub" className="mx-auto max-w-6xl px-5 sm:px-8 py-16">
      <div className="reveal-block flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#5df0a8] mb-2">
              Multimodal Research Intelligence · Multi-Turn Chat · Live Voice · Search &amp; Maps Grounding
            </p>
            <h2
              className="text-2xl sm:text-4xl font-bold tracking-tight text-[#f3f6ff]"
              style={{ textWrap: 'balance' }}
            >
              Interactive Research Colleague
            </h2>
          </div>

          {/* 4-Mode Segmented Switcher */}
          <div
            role="tablist"
            aria-label="Research intelligence modes"
            className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#080d1e] border border-[#96afe6]/18"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'chat'}
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'chat'
                  ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                  : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span>Multi-Turn Chat</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'live'}
              onClick={() => setActiveTab('live')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'live'
                  ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                  : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
              }`}
            >
              <Radio className="w-3.5 h-3.5 shrink-0" />
              <span>Live Voice</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'search'}
              onClick={() => setActiveTab('search')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'search'
                  ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                  : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>Web Grounding</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'maps'}
              onClick={() => setActiveTab('maps')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'maps'
                  ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                  : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
              }`}
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>Lab &amp; Venue Atlas</span>
            </button>
          </div>
        </div>

        {/* =================================================================
            MODE 1: MULTI-TURN GEMINI CHAT + MIC TRANSCRIPTION
        ================================================================== */}
        {activeTab === 'chat' && (
          <div className="ascend-panel rounded-2xl p-5 sm:p-6 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#96afe6]/14">
              <div className="text-xs text-[#9aa6c4]">
                Context: <span className="text-[#f3f6ff] font-medium">{activeTopic}</span>
                {currentUser && (
                  <span className="text-[#5df0a8]"> · Syncing turns to Firestore</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="chat-model-select" className="text-xs text-[#6b7796]">
                  Engine:
                </label>
                <select
                  id="chat-model-select"
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value as ChatModelId)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#050917] border border-[#96afe6]/20 text-xs text-[#f3f6ff] focus:outline-none focus:border-[#5df0a8]"
                >
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash (Balanced Research)</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Low-Latency)</option>
                  <option value="gemini-4-argon">Gemini 4 Argon (Deep STEM Reasoning)</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setChatThreadId(`thread-${Date.now()}`);
                    setChatMessages([chatMessages[0]]);
                    setChatError('');
                  }}
                  title="Start a fresh conversation thread"
                  className="px-2.5 py-1.5 rounded-lg border border-[#96afe6]/18 bg-[#080d1e] text-xs text-[#9aa6c4] hover:text-[#f3f6ff] flex items-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>New Thread</span>
                </button>
              </div>
            </div>

            <div
              ref={chatScrollRef}
              className="h-[320px] overflow-y-auto pr-2 flex flex-col gap-3"
            >
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col max-w-[88%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'self-end bg-[#15254d] border border-[#96afe6]/25 text-[#f3f6ff]'
                      : 'self-start bg-[#070c1c] border border-[#96afe6]/14 text-[#dbe4ff]'
                  }`}
                >
                  <div className="text-[11px] text-[#6b7796] mb-1">
                    {msg.role === 'user' ? 'Researcher' : `Ascend · ${msg.modelLabel || chatModel}`}
                  </div>
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                </div>
              ))}

              {chatLoading && (
                <div className="self-start bg-[#070c1c] border border-[#96afe6]/14 rounded-xl px-4 py-3 text-xs text-[#5df0a8] flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Reasoning with {chatModel}…</span>
                </div>
              )}
            </div>

            {chatError && (
              <div className="flex items-center gap-2 text-xs text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{chatError}</span>
              </div>
            )}

            <form onSubmit={(e) => void handleSendChat(e)} className="flex flex-col sm:flex-row gap-2.5">
              <div className="flex flex-1 gap-2">
                <button
                  type="button"
                  onClick={() => void toggleMicDictation()}
                  disabled={isTranscribing}
                  title="Dictate scientific note via gemini-3.5-transcribe"
                  className={`h-11 px-3.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    isRecordingDictation
                      ? 'border-rose-400 bg-rose-500/20 text-rose-300'
                      : 'border-[#96afe6]/20 bg-[#080d1e] text-[#9aa6c4] hover:text-[#f3f6ff]'
                  }`}
                >
                  {isTranscribing ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#5df0a8]" />
                  ) : isRecordingDictation ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4 text-[#5df0a8]" />
                  )}
                  <span>
                    {isTranscribing
                      ? 'Transcribing…'
                      : isRecordingDictation
                        ? 'Stop Mic'
                        : 'Dictate'}
                  </span>
                </button>

                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  maxLength={4000}
                  placeholder="Ask a methodological question, critique an assumption, or click Dictate…"
                  className="flex-1 h-11 px-4 rounded-xl bg-[#050917] border border-[#96afe6]/20 text-sm text-[#f3f6ff] placeholder:text-[#6b7796] focus:outline-none focus:border-[#5df0a8]"
                />
              </div>

              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="mint-btn-primary h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <span>Send</span>
                <Send className="w-3.5 h-3.5 shrink-0" />
              </button>
            </form>
          </div>
        )}

        {/* =================================================================
            MODE 2: REAL-TIME VOICE CONVERSATIONS (`gemini-3.8-live`)
        ================================================================== */}
        {activeTab === 'live' && (
          <div className="ascend-panel rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs text-[#6b7796]">
                  Low-Latency Bidirectional Audio · 16 kHz PCM Mic Stream · 24 kHz Gapless Voice Output
                </div>
                <h3 className="mt-1 text-lg sm:text-xl font-bold text-[#f3f6ff]">
                  Ascend Live Voice Partner (`gemini-3.8-live`)
                </h3>
                <p className="mt-1 text-xs sm:text-sm text-[#9aa6c4]">
                  Speak naturally to brainstorm experimental designs, probe open questions on{' '}
                  <span className="text-[#f3f6ff] font-medium">{activeTopic}</span>, or interrupt mid-sentence at any time.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void startLiveVoiceSession()}
                className={`px-5 py-3 rounded-full text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  liveStatus === 'live'
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : liveStatus === 'connecting'
                      ? 'bg-[#192852] text-[#5df0a8] border border-[#5df0a8]/40'
                      : 'mint-btn-primary'
                }`}
              >
                {liveStatus === 'connecting' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting Audio Bridge…</span>
                  </>
                ) : liveStatus === 'live' ? (
                  <>
                    <PhoneOff className="w-4 h-4" />
                    <span>End Voice Session</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-4 h-4" />
                    <span>Start Live Voice Session</span>
                  </>
                )}
              </button>
            </div>

            {liveError && (
              <div className="flex items-center gap-2 text-xs text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{liveError}</span>
              </div>
            )}

            <div className="rounded-xl bg-[#060a18] border border-[#96afe6]/16 p-4 min-h-[200px] max-h-[280px] overflow-y-auto flex flex-col gap-2.5">
              {liveTranscripts.length === 0 ? (
                <p className="text-xs text-[#6b7796] my-auto text-center">
                  {liveStatus === 'live'
                    ? 'Microphone active — start speaking and real-time transcripts will stream here.'
                    : 'Click "Start Live Voice Session" above to open a bidirectional voice link with Ascend.'}
                </p>
              ) : (
                liveTranscripts.map((item) => (
                  <div key={item.id} className="text-xs sm:text-sm leading-relaxed">
                    <span
                      className={`font-semibold mr-2 ${
                        item.speaker === 'You' ? 'text-[#9aa6c4]' : 'text-[#5df0a8]'
                      }`}
                    >
                      {item.speaker}:
                    </span>
                    <span className="text-[#f3f6ff]">{item.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =================================================================
            MODE 3: GOOGLE SEARCH GROUNDING (`gemini-3.8-flash` + `googleSearch`)
        ================================================================== */}
        {activeTab === 'search' && (
          <div className="ascend-panel rounded-2xl p-6 sm:p-7 flex flex-col gap-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runGroundedWebSearch(searchQuery);
              }}
              className="flex flex-col sm:flex-row gap-3"
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                maxLength={400}
                placeholder="Query live scientific announcements, benchmarks, or policy updates…"
                className="flex-1 h-11 px-4 rounded-xl bg-[#050917] border border-[#96afe6]/20 text-sm text-[#f3f6ff] placeholder:text-[#6b7796] focus:outline-none focus:border-[#5df0a8]"
              />
              <button
                type="submit"
                disabled={searchLoading}
                className="mint-btn-primary h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                {searchLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Searching Web…</span>
                  </>
                ) : (
                  <>
                    <Globe className="w-4 h-4" />
                    <span>Run Grounded Search</span>
                  </>
                )}
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#6b7796]">Quick web checks:</span>
              {[
                `Recent 2025-2026 benchmarks on ${activeTopic}`,
                'Frontier open-weight reasoning model evaluations',
                'Clinical trial milestones in base and prime gene editing',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={searchLoading}
                  onClick={() => void runGroundedWebSearch(preset)}
                  className="px-2.5 py-1 rounded-lg bg-[#080e22] hover:bg-[#111c3a] border border-[#96afe6]/14 text-[#9aa6c4] hover:text-[#f3f6ff] cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>

            {searchError && (
              <div className="flex items-center gap-2 text-xs text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{searchError}</span>
              </div>
            )}

            {searchResult && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2 border-t border-[#96afe6]/14">
                <div className="lg:col-span-8 text-sm text-[#dbe4ff] leading-relaxed whitespace-pre-wrap">
                  {searchResult.answer}
                </div>
                <div className="lg:col-span-4 flex flex-col gap-2.5">
                  <div className="text-xs font-semibold text-[#5df0a8]">
                    Verified Web Sources ({searchResult.links.length})
                  </div>
                  {searchResult.links.length === 0 ? (
                    <p className="text-xs text-[#6b7796]">
                      Synthesized from built-in knowledge; no external web chunks returned.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#96afe6]/12">
                      {searchResult.links.map((lnk, i) => (
                        <a
                          key={`${lnk.uri}-${i}`}
                          href={lnk.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2 first:pt-0 last:pb-0 flex items-start justify-between gap-2 text-xs text-[#f3f6ff] hover:text-[#5df0a8] transition-colors"
                        >
                          <span className="line-clamp-2">{lnk.title}</span>
                          <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-70" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================
            MODE 4: GOOGLE MAPS GROUNDING (`gemini-3.8-flash` + `googleMaps`)
        ================================================================== */}
        {activeTab === 'maps' && (
          <div className="ascend-panel rounded-2xl p-6 sm:p-7 flex flex-col gap-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runGroundedMapsLookup(mapsQuery);
              }}
              className="flex flex-col sm:flex-row gap-3"
            >
              <input
                type="text"
                value={mapsQuery}
                onChange={(e) => setMapsQuery(e.target.value)}
                maxLength={400}
                placeholder="Locate research universities, synchrotrons, biotech hubs, or conference venues…"
                className="flex-1 h-11 px-4 rounded-xl bg-[#050917] border border-[#96afe6]/20 text-sm text-[#f3f6ff] placeholder:text-[#6b7796] focus:outline-none focus:border-[#5df0a8]"
              />
              <button
                type="button"
                onClick={requestUserGeolocation}
                disabled={locating}
                className="h-11 px-4 rounded-xl border border-[#96afe6]/20 bg-[#080d1e] text-xs font-medium text-[#9aa6c4] hover:text-[#f3f6ff] flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MapPin className="w-3.5 h-3.5 text-[#5df0a8]" />
                <span>
                  {locating
                    ? 'Locating…'
                    : userCoords
                      ? 'Near Me Active'
                      : 'Use My Location'}
                </span>
              </button>
              <button
                type="submit"
                disabled={mapsLoading}
                className="mint-btn-primary h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                {mapsLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Mapping…</span>
                  </>
                ) : (
                  <span>Find Places</span>
                )}
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#6b7796]">Explore hubs:</span>
              {[
                'Genomics and biomedical research institutes near Kendall Square Cambridge MA',
                'Quantum computing and physics laboratories in Zurich and Geneva',
                'AI and robotics research centers in Palo Alto and San Francisco',
              ].map((hub) => (
                <button
                  key={hub}
                  type="button"
                  disabled={mapsLoading}
                  onClick={() => void runGroundedMapsLookup(hub)}
                  className="px-2.5 py-1 rounded-lg bg-[#080e22] hover:bg-[#111c3a] border border-[#96afe6]/14 text-[#9aa6c4] hover:text-[#f3f6ff] cursor-pointer"
                >
                  {hub}
                </button>
              ))}
            </div>

            {mapsError && (
              <div className="flex items-center gap-2 text-xs text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{mapsError}</span>
              </div>
            )}

            {mapsResult && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2 border-t border-[#96afe6]/14">
                <div className="lg:col-span-7 text-sm text-[#dbe4ff] leading-relaxed whitespace-pre-wrap">
                  {mapsResult.answer}
                </div>
                <div className="lg:col-span-5 flex flex-col gap-3">
                  <div className="text-xs font-semibold text-[#5df0a8]">
                    Google Maps Grounded Locations ({mapsResult.places.length})
                  </div>
                  {mapsResult.places.length === 0 ? (
                    <p className="text-xs text-[#6b7796]">
                      No direct Maps place links were returned for this query.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#96afe6]/12">
                      {mapsResult.places.map((pl, idx) => (
                        <div key={`${pl.uri}-${idx}`} className="py-2.5 first:pt-0 last:pb-0">
                          <a
                            href={pl.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#f3f6ff] hover:text-[#5df0a8] transition-colors"
                          >
                            <MapPin className="w-3.5 h-3.5 text-[#5df0a8] shrink-0" />
                            <span>{pl.title}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                          </a>
                          {pl.snippets.map((snip, sIdx) => (
                            <p key={sIdx} className="mt-1 text-xs text-[#9aa6c4] line-clamp-2">
                              “{snip}”
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
