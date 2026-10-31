import { useEffect } from 'react';
import {
  Compass,
  Layers,
  Search,
  GitBranch,
  Bookmark,
  Dna,
  MessageSquare,
  Radio,
  Globe,
  MapPin,
  Image as ImageIcon,
  Film,
  Box,
  TrendingUp,
  Gamepad2,
  Share2,
  Download,
  Pin,
  PinOff,
  X,
  ChevronRight,
} from 'lucide-react';
import type { HubTab } from './ResearchAssistantHub';
import type { StudioMode } from './MediaStudioPanel';

export interface CommandDashboardProps {
  open: boolean;
  pinned: boolean;
  activeSectionId: string;
  activeTopic: string;
  libraryCount: number;
  savedCount: number;
  onClose: () => void;
  onTogglePin: () => void;
  onNavigateSection: (selector: string, focusSearch?: boolean) => void;
  onNavigateHubTab: (tab: HubTab) => void;
  onNavigateStudioMode: (mode: StudioMode) => void;
  onOpenShareModal: () => void;
  onExportCurrent: () => void;
  onLaunchOrbitalSim: () => void;
}

export default function CommandDashboardDrawer({
  open,
  pinned,
  activeSectionId,
  activeTopic,
  libraryCount,
  savedCount,
  onClose,
  onTogglePin,
  onNavigateSection,
  onNavigateHubTab,
  onNavigateStudioMode,
  onOpenShareModal,
  onExportCurrent,
  onLaunchOrbitalSim,
}: CommandDashboardProps) {
  useEffect(() => {
    if (!open || pinned) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, pinned, onClose]);

  if (!open) return null;

  const triggerAndMaybeClose = (fn: () => void) => {
    fn();
    if (!pinned) {
      onClose();
    }
  };

  const navItemClass = (isActive: boolean) =>
    `w-full px-3 py-2 rounded-xl text-left flex items-center justify-between gap-2.5 text-xs font-medium transition-colors cursor-pointer ${
      isActive
        ? 'bg-[#5df0a8]/14 text-[#5df0a8] font-semibold'
        : 'text-[#dbe4ff] hover:bg-[#0d1530] hover:text-[#f3f6ff]'
    }`;

  return (
    <>
      {/* Click-away backdrop when unpinned */}
      {!pinned && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 top-14 z-30 bg-black/50"
        />
      )}

      <aside
        id="ascend-command-dashboard"
        aria-label="Ascend Command Dashboard"
        className="fixed top-14 left-0 bottom-0 z-40 w-full max-w-[324px] bg-[#050916]/98 border-r border-[#96afe6]/18 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Top Dashboard Header & Workspace Summary */}
        <div className="px-4 py-3.5 border-b border-[#96afe6]/14 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#f3f6ff] tracking-tight">
                Navigation Dashboard
              </h2>
              <p className="text-[11px] text-[#6b7796]">
                One-click access to every workspace &amp; module
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onTogglePin}
                title={pinned ? 'Unpin sidebar' : 'Keep dashboard pinned open'}
                aria-label={pinned ? 'Unpin dashboard' : 'Pin dashboard'}
                className={`hidden xl:inline-flex p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  pinned
                    ? 'border-[#5df0a8]/45 bg-[#5df0a8]/14 text-[#5df0a8]'
                    : 'border-[#96afe6]/16 bg-[#0a1024] text-[#9aa6c4] hover:text-[#f3f6ff]'
                }`}
              >
                {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close navigation dashboard"
                className="p-1.5 rounded-lg border border-[#96afe6]/16 bg-[#0a1024] text-[#9aa6c4] hover:text-[#f3f6ff] transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quiet Inline Workspace Telemetry (Unboxed text with middot separators) */}
          <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#9aa6c4]">
            <span className="truncate max-w-[165px]" title={activeTopic}>
              {activeTopic}
            </span>
            <span aria-hidden="true" className="text-[#6b7796]">
              ·
            </span>
            <span className="font-mono-tabular">{libraryCount} history</span>
            <span aria-hidden="true" className="text-[#6b7796]">
              ·
            </span>
            <span className="font-mono-tabular text-[#5df0a8]">{savedCount} saved</span>
          </div>
        </div>

        {/* Scrollable 1-Click Directory of Every Website Section & Sub-Tool */}
        <div className="flex-1 overflow-y-auto px-3.5 py-4 flex flex-col gap-5">
          {/* Group 1: Core Research */}
          <div className="flex flex-col gap-1">
            <div className="px-2.5 pb-1 text-[11px] font-semibold text-[#6b7796] tracking-wide">
              01. Core Research &amp; Library
            </div>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateSection('#top'))}
              className={navItemClass(activeSectionId === 'top')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Compass className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Overview &amp; Hero</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateSection('#features'))}
              className={navItemClass(activeSectionId === 'features')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Layers className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Platform Capabilities</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateSection('#workspace', true))}
              className={navItemClass(activeSectionId === 'workspace')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Search className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Research Workspace</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateSection('#graph-stage'))}
              className={navItemClass(activeSectionId === 'graph-stage')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <GitBranch className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Interactive Knowledge Graph</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateSection('#library'))}
              className={navItemClass(activeSectionId === 'library')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Bookmark className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Personal Research Library</span>
              </span>
              <span className="font-mono-tabular text-[11px] text-[#6b7796] shrink-0">
                {libraryCount}
              </span>
            </button>
          </div>

          <div className="h-px bg-[#96afe6]/12" />

          {/* Group 2: Bioscience & Grounded AI Colleague */}
          <div className="flex flex-col gap-1">
            <div className="px-2.5 pb-1 text-[11px] font-semibold text-[#6b7796] tracking-wide">
              02. Bioscience &amp; AI Colleague
            </div>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateSection('#bioscience'))}
              className={navItemClass(activeSectionId === 'bioscience')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Dna className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Bioscience Workbench</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateHubTab('chat'))}
              className={navItemClass(activeSectionId === 'intelligence-hub')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <MessageSquare className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Multi-Turn STEM Chat</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateHubTab('live'))}
              className={navItemClass(false)}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Radio className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Live Voice Research Partner</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateHubTab('search'))}
              className={navItemClass(false)}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Globe className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Web Search Grounding</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateHubTab('maps'))}
              className={navItemClass(false)}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <MapPin className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Research Lab &amp; Venue Atlas</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>
          </div>

          <div className="h-px bg-[#96afe6]/12" />

          {/* Group 3: Visual Studio, 3D Instruments & Simulation */}
          <div className="flex flex-col gap-1">
            <div className="px-2.5 pb-1 text-[11px] font-semibold text-[#6b7796] tracking-wide">
              03. Visual Studio &amp; 3D Labs
            </div>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateStudioMode('image'))}
              className={navItemClass(activeSectionId === 'media-studio')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <ImageIcon className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Scientific Figure Generator</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateStudioMode('video'))}
              className={navItemClass(false)}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Film className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Motion &amp; Video Studio</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateSection('#observatory-3d'))}
              className={navItemClass(activeSectionId === 'observatory-3d')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Box className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">3D Hardware Observatory</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(() => onNavigateSection('#showcase'))}
              className={navItemClass(activeSectionId === 'showcase')}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <TrendingUp className="w-4 h-4 text-[#5df0a8] shrink-0" />
                <span className="truncate">Literature Velocity Showcase</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-55 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => triggerAndMaybeClose(onLaunchOrbitalSim)}
              className="w-full mt-1 px-3 py-2 rounded-xl text-left flex items-center justify-between gap-2.5 text-xs font-semibold text-[#5df0a8] bg-[#091628] border border-[#5df0a8]/28 hover:border-[#5df0a8]/55 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Gamepad2 className="w-4 h-4 shrink-0" />
                <span className="truncate">Launch 3D Orbital Sim</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </div>

        {/* Footer Quick Actions: Share & Export */}
        <div className="p-3.5 border-t border-[#96afe6]/14 bg-[#040712] flex items-center gap-2">
          <button
            type="button"
            onClick={() => triggerAndMaybeClose(onOpenShareModal)}
            className="mint-btn-primary flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5 shrink-0" />
            <span>Share Topic</span>
          </button>

          <button
            type="button"
            onClick={() => triggerAndMaybeClose(onExportCurrent)}
            className="flex-1 py-2 px-3 rounded-xl border border-[#96afe6]/20 bg-[#0b1228] hover:border-[#96afe6]/45 text-xs font-semibold text-[#f3f6ff] flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-[#5df0a8] shrink-0" />
            <span>Export (.md)</span>
          </button>
        </div>
      </aside>
    </>
  );
}
