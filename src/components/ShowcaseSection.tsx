import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

interface DomainLens {
  id: string;
  label: string;
  query: string;
  windowLabel: string;
  preprintSeries: number[];
  journalSeries: number[];
  years: string[];
  citationGrowth: string;
  medianHalfLife: string;
  bridgeCluster: string;
}

const DOMAIN_LENSES: DomainLens[] = [
  {
    id: 'sae',
    label: 'Mechanistic Interpretability',
    query: 'Mechanistic interpretability in sparse autoencoders',
    windowLabel: '2021 – 2026 Indexing Window',
    years: ['2021', '2022', '2023', '2024', '2025', '2026'],
    preprintSeries: [14, 29, 78, 210, 365, 492],
    journalSeries: [6, 12, 31, 88, 164, 238],
    citationGrowth: '+342% YoY',
    medianHalfLife: '4.2 mos',
    bridgeCluster: 'Sparse Coding ↔ Causal Scrubbing',
  },
  {
    id: 'crispr',
    label: 'Prime Editing Delivery',
    query: 'CRISPR prime editing lipid nanoparticle delivery',
    windowLabel: '2021 – 2026 Indexing Window',
    years: ['2021', '2022', '2023', '2024', '2025', '2026'],
    preprintSeries: [38, 64, 112, 178, 254, 330],
    journalSeries: [29, 52, 94, 149, 212, 286],
    citationGrowth: '+188% YoY',
    medianHalfLife: '7.8 mos',
    bridgeCluster: 'pegRNA Engineering ↔ Tissue Tropism',
  },
  {
    id: 'qec',
    label: 'Topological Surface Codes',
    query: 'Topological quantum error correction surface codes',
    windowLabel: '2021 – 2026 Indexing Window',
    years: ['2021', '2022', '2023', '2024', '2025', '2026'],
    preprintSeries: [62, 85, 134, 196, 288, 390],
    journalSeries: [44, 58, 91, 132, 195, 261],
    citationGrowth: '+215% YoY',
    medianHalfLife: '6.1 mos',
    bridgeCluster: 'Floquet Codes ↔ Neutral Atom Arrays',
  },
];

interface ShowcaseSectionProps {
  onRunLensQuery: (query: string) => void;
}

export default function ShowcaseSection({ onRunLensQuery }: ShowcaseSectionProps) {
  const [activeLensId, setActiveLensId] = useState<string>(DOMAIN_LENSES[0].id);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const lens = DOMAIN_LENSES.find((d) => d.id === activeLensId) || DOMAIN_LENSES[0];
  const maxVal = Math.max(...lens.preprintSeries, ...lens.journalSeries, 100);

  const chartW = 640;
  const chartH = 220;
  const padX = 42;
  const padY = 24;
  const innerW = chartW - padX * 2;
  const innerH = chartH - padY * 2;

  const toCoords = (series: number[]) =>
    series.map((v, i) => ({
      x: padX + (i / (series.length - 1)) * innerW,
      y: padY + innerH - (v / maxVal) * innerH,
      val: v,
    }));

  const preprintPts = toCoords(lens.preprintSeries);
  const journalPts = toCoords(lens.journalSeries);

  const preprintPath = preprintPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const preprintArea = `${preprintPath} L ${preprintPts[preprintPts.length - 1].x} ${padY + innerH} L ${preprintPts[0].x} ${padY + innerH} Z`;
  const journalPath = journalPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const inspectedIndex = hoverIdx !== null ? hoverIdx : lens.years.length - 1;

  return (
    <section id="showcase" className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-20 md:py-28">
      <div className="reveal-block flex flex-col gap-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-xs font-medium text-[#5df0a8] mb-3">Literature Velocity Observatory</p>
            <h2
              className="text-2xl sm:text-4xl font-bold tracking-tight text-[#f3f6ff]"
              style={{ textWrap: 'balance' }}
            >
              See the whole literature move in real time
            </h2>
            <p className="mt-3 text-sm sm:text-base text-[#9aa6c4] leading-relaxed">
              Preprints on arXiv often precede journal indexing by six to fourteen months. Ascend fuses live preprint velocity with citation-graph topology so emerging methods surface before consensus textbooks catch up.
            </p>
          </div>

          {/* Functional Domain Lens Switcher */}
          <div
            className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#0a1024] border border-[#96afe6]/15 self-start"
            role="tablist"
            aria-label="Select research trajectory domain"
          >
            {DOMAIN_LENSES.map((item) => {
              const active = item.id === lens.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveLensId(item.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                      : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Interactive Dual-Series Trajectory Panel */}
        <div className="ascend-panel rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-8 flex flex-col justify-between gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#f3f6ff]">{lens.label}</h3>
                <p className="text-xs text-[#6b7796] mt-0.5">
                  {lens.windowLabel} · {lens.bridgeCluster}
                </p>
              </div>
              <div className="flex items-center gap-5 text-xs text-[#9aa6c4]">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="inline-block w-3 h-0.5 bg-[#5df0a8]" />
                  arXiv Preprints
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="inline-block w-3 h-0.5 border-t border-dashed border-[#7aaeff]" />
                  Indexed Graph Citations
                </span>
              </div>
            </div>

            <div className="w-full overflow-hidden rounded-xl border border-[#96afe6]/12 bg-[#050814]/85 p-3">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-auto block cursor-crosshair"
                role="img"
                aria-label={`Annual publication curve for ${lens.label}`}
                onMouseLeave={() => setHoverIdx(null)}
              >
                <defs>
                  <linearGradient id="mintCurveFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5df0a8" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#5df0a8" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal calibration gridlines */}
                {[0, 0.33, 0.66, 1].map((ratio) => {
                  const y = padY + innerH * ratio;
                  return (
                    <line
                      key={ratio}
                      x1={padX}
                      x2={chartW - padX}
                      y1={y}
                      y2={y}
                      stroke="rgba(150, 175, 230, 0.08)"
                      strokeWidth="1"
                    />
                  );
                })}

                <path d={preprintArea} fill="url(#mintCurveFill)" />
                <path d={preprintPath} fill="none" stroke="#5df0a8" strokeWidth="2.4" />
                <path
                  d={journalPath}
                  fill="none"
                  stroke="#7aaeff"
                  strokeWidth="2"
                  strokeDasharray="5 5"
                />

                {/* Crosshair & interactive year columns */}
                {lens.years.map((yr, idx) => {
                  const pPt = preprintPts[idx];
                  const jPt = journalPts[idx];
                  const active = idx === inspectedIndex;
                  const colWidth = innerW / lens.years.length;

                  return (
                    <g key={yr}>
                      {active && (
                        <line
                          x1={pPt.x}
                          x2={pPt.x}
                          y1={padY}
                          y2={padY + innerH}
                          stroke="rgba(93, 240, 168, 0.35)"
                          strokeDasharray="3 3"
                        />
                      )}
                      <circle
                        cx={pPt.x}
                        cy={pPt.y}
                        r={active ? 4.5 : 3}
                        fill="#5df0a8"
                        stroke="#04060f"
                        strokeWidth="1.5"
                      />
                      <circle
                        cx={jPt.x}
                        cy={jPt.y}
                        r={active ? 4 : 2.5}
                        fill="#7aaeff"
                        stroke="#04060f"
                        strokeWidth="1.5"
                      />
                      <text
                        x={pPt.x}
                        y={chartH - 5}
                        textAnchor="middle"
                        fontSize="10.5"
                        fill={active ? '#f3f6ff' : '#6b7796'}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {yr}
                      </text>
                      <rect
                        x={pPt.x - colWidth / 2}
                        y={0}
                        width={colWidth}
                        height={chartH}
                        fill="transparent"
                        onMouseEnter={() => setHoverIdx(idx)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Right Inspection Readout + Launch Action */}
          <div className="lg:col-span-4 flex flex-col justify-between gap-6 border-t lg:border-t-0 lg:border-l border-[#96afe6]/12 pt-6 lg:pt-0 lg:pl-8">
            <div className="flex flex-col gap-5">
              <div>
                <div className="text-xs text-[#6b7796]">
                  Snapshot Year · <span className="font-mono-tabular text-[#f3f6ff]">{lens.years[inspectedIndex]}</span>
                </div>
                <div className="mt-2 flex items-baseline gap-6">
                  <div>
                    <div className="text-2xl font-bold font-mono-tabular text-[#5df0a8]">
                      {lens.preprintSeries[inspectedIndex]}
                    </div>
                    <div className="text-xs text-[#9aa6c4]">arXiv preprints</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono-tabular text-[#7aaeff]">
                      {lens.journalSeries[inspectedIndex]}
                    </div>
                    <div className="text-xs text-[#9aa6c4]">Graph-indexed works</div>
                  </div>
                </div>
              </div>

              <div className="h-px bg-[#96afe6]/12" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-[#6b7796]">Citation Velocity</div>
                  <div className="mt-1 text-base font-semibold font-mono-tabular text-[#f3f6ff]">
                    {lens.citationGrowth}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#6b7796]">Discovery Lead Time</div>
                  <div className="mt-1 text-base font-semibold font-mono-tabular text-[#f3f6ff]">
                    {lens.medianHalfLife}
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onRunLensQuery(lens.query)}
              className="w-full py-2.5 px-4 rounded-xl border border-[#5df0a8]/35 bg-[#5df0a8]/10 hover:bg-[#5df0a8]/18 text-xs font-semibold text-[#5df0a8] transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <span>Synthesize Live Briefing on This Topic</span>
              <ArrowUpRight className="w-4 h-4 shrink-0" />
            </button>
          </div>
        </div>

        {/* Four Calibrated Benchmark Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="ascend-panel-subtle rounded-xl p-5">
            <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-[#f3f6ff]">214M+</div>
            <div className="mt-1 text-xs text-[#9aa6c4]">
              Scholarly records reachable via Semantic Scholar &amp; arXiv APIs
            </div>
          </div>
          <div className="ascend-panel-subtle rounded-xl p-5">
            <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-[#5df0a8]">100%</div>
            <div className="mt-1 text-xs text-[#9aa6c4]">
              Citations grounded strictly in retrieved upstream paper metadata
            </div>
          </div>
          <div className="ascend-panel-subtle rounded-xl p-5">
            <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-[#f3f6ff]">9–10</div>
            <div className="mt-1 text-xs text-[#9aa6c4]">
              Interactive concept nodes mapped per query for 1-click exploration
            </div>
          </div>
          <div className="ascend-panel-subtle rounded-xl p-5">
            <div className="text-2xl sm:text-3xl font-bold font-mono-tabular text-[#f3f6ff]">40 max</div>
            <div className="mt-1 text-xs text-[#9aa6c4]">
              Persistent SQLite research briefings stored per client vault
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
