import { useEffect, useState, FormEvent } from 'react';
import {
  Dna,
  ExternalLink,
  Loader2,
  Search,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import {
  QUICK_BIOSCIENCE_TARGETS,
  type BioscienceProfile,
} from '../types/bioscience';

interface BioscienceWorkbenchProps {
  onSynthesizeTopic: (topic: string) => void;
}

export default function BioscienceWorkbench({
  onSynthesizeTopic,
}: BioscienceWorkbenchProps) {
  const [queryInput, setQueryInput] = useState<string>('P04637');
  const [profile, setProfile] = useState<BioscienceProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>('');

  const lookupTarget = async (raw: string) => {
    const cleaned = raw.trim();
    if (cleaned.length < 2) return;
    setQueryInput(cleaned);
    setLoading(true);
    setErrorText('');
    try {
      const res = await fetch(`/api/bioscience/protein?q=${encodeURIComponent(cleaned)}`);
      const data = (await res.json().catch(() => ({}))) as BioscienceProfile & { detail?: string };
      if (!res.ok) {
        setErrorText(data.detail || `Protein lookup failed (${res.status}).`);
        return;
      }
      setProfile(data);
    } catch {
      setErrorText('Network error reaching UniProtKB / AlphaFold DB connector.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void lookupTarget('P04637');
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!loading) {
      void lookupTarget(queryInput);
    }
  };

  const af = profile?.alphafold;
  const vhPct = af ? Math.round(af.fractionVeryHigh * 100) : 0;
  const confPct = af ? Math.round(af.fractionConfident * 100) : 0;
  const lowPct = af ? Math.round(af.fractionLow * 100) : 0;
  const vlPct = af ? Math.max(0, 100 - vhPct - confPct - lowPct) : 0;

  return (
    <section id="bioscience" className="mx-auto max-w-6xl px-5 sm:px-8 py-16">
      <div className="reveal-block flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#5df0a8] mb-2">
              Authoritative Structural &amp; Genomic Informatics · UniProtKB · AlphaFold DB · RCSB PDB
            </p>
            <h2
              className="text-2xl sm:text-4xl font-bold tracking-tight text-[#f3f6ff]"
              style={{ textWrap: 'balance' }}
            >
              Bioscience Macromolecular Workbench
            </h2>
          </div>

          {profile && (
            <button
              type="button"
              onClick={() =>
                onSynthesizeTopic(
                  `${profile.geneName} (${profile.accession}) ${profile.proteinName} structural mechanisms`
                )
              }
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-[#5df0a8]/40 bg-[#5df0a8]/12 text-[#5df0a8] hover:bg-[#5df0a8]/20 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Synthesize Briefing for {profile.geneName}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          )}
        </div>

        {/* Search & Quick-Try Gene / UniProt Bar */}
        <div className="ascend-panel rounded-2xl p-5 sm:p-6 flex flex-col gap-4">
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#6b7796] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                maxLength={80}
                placeholder="Enter human gene symbol or UniProtKB accession (e.g. TP53, BRCA1, EGFR, P04637)…"
                aria-label="Gene symbol or UniProtKB accession"
                className="w-full h-11 pl-11 pr-4 rounded-xl bg-[#050917] border border-[#96afe6]/20 text-sm text-[#f3f6ff] placeholder:text-[#6b7796] focus:outline-none focus:border-[#5df0a8]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mint-btn-primary h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Querying Databases…</span>
                </>
              ) : (
                <>
                  <Dna className="w-4 h-4 shrink-0" />
                  <span>Inspect Macromolecule</span>
                </>
              )}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#6b7796] mr-1 shrink-0">Canonical targets:</span>
            {QUICK_BIOSCIENCE_TARGETS.map((item) => (
              <button
                key={item.query}
                type="button"
                disabled={loading}
                onClick={() => void lookupTarget(item.query)}
                className="px-2.5 py-1 rounded-lg text-xs text-[#9aa6c4] hover:text-[#f3f6ff] bg-[#080e22] hover:bg-[#111c3a] border border-[#96afe6]/14 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
          </div>

          {errorText && (
            <div className="flex items-center gap-2 text-xs text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorText}</span>
            </div>
          )}
        </div>

        {/* Results Grid */}
        {profile && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left 7 Cols: UniProtKB Function + Domain Map + Biomedical Papers */}
            <div className="lg:col-span-7 ascend-panel rounded-2xl p-6 sm:p-7 flex flex-col gap-6">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b7796]">
                  <span className="font-mono-tabular text-[#5df0a8] font-semibold">
                    {profile.accession}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-[#f3f6ff]">{profile.geneName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{profile.organism}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">{profile.sequenceLength} aa</span>
                  {profile.molecularMassDa > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        {(profile.molecularMassDa / 1000).toFixed(1)} kDa
                      </span>
                    </>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-[#f3f6ff] tracking-tight">
                    {profile.proteinName}
                  </h3>
                  <a
                    href={profile.uniprotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#5df0a8] hover:underline underline-offset-4 whitespace-nowrap"
                  >
                    <span>UniProtKB Entry</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>

                <p className="mt-3 text-sm text-[#dbe4ff] leading-relaxed">
                  {profile.functionSummary}
                </p>
              </div>

              {/* Annotated Sequence Domains Track */}
              {profile.domains.length > 0 && profile.sequenceLength > 0 && (
                <div className="pt-4 border-t border-[#96afe6]/14 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs text-[#6b7796]">
                    <span>Annotated Sequence Architecture (1 – {profile.sequenceLength} aa)</span>
                    <span>Curated UniProtKB Features</span>
                  </div>

                  <div className="relative h-4 w-full rounded-full bg-[#060a18] border border-[#96afe6]/18 overflow-hidden">
                    {profile.domains.map((dom, idx) => {
                      const leftPct = Math.max(
                        0,
                        Math.min(98, ((dom.start - 1) / profile.sequenceLength) * 100)
                      );
                      const widthPct = Math.max(
                        2,
                        Math.min(100 - leftPct, ((dom.end - dom.start + 1) / profile.sequenceLength) * 100)
                      );
                      return (
                        <div
                          key={`${dom.description}-${idx}`}
                          title={`${dom.type}: ${dom.description} (${dom.start}–${dom.end})`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          className="absolute top-0 bottom-0 bg-[#5df0a8]/65 border-r border-[#04060f]"
                        />
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {profile.domains.slice(0, 6).map((dom, idx) => (
                      <div
                        key={`${dom.description}-${idx}`}
                        className="flex items-center justify-between gap-2 py-1 border-b border-[#96afe6]/10"
                      >
                        <span className="text-[#dbe4ff] truncate">{dom.description}</span>
                        <span className="font-mono-tabular text-[#6b7796] shrink-0">
                          {dom.start}–{dom.end}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Europe PMC / PubMed Peer-Reviewed Literature */}
              {profile.literature.length > 0 && (
                <div className="pt-4 border-t border-[#96afe6]/14 flex flex-col gap-3">
                  <div className="text-xs text-[#6b7796]">
                    Indexed Biomedical Literature · Europe PMC &amp; PubMed
                  </div>
                  <div className="divide-y divide-[#96afe6]/10">
                    {profile.literature.map((paper, idx) => (
                      <div key={`${paper.pmid}-${idx}`} className="py-2.5 first:pt-0 last:pb-0">
                        <a
                          href={paper.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-start gap-1.5 text-xs sm:text-sm font-semibold text-[#f3f6ff] hover:text-[#5df0a8] transition-colors"
                        >
                          <span>{paper.title}</span>
                          <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-70" />
                        </a>
                        <div className="mt-0.5 text-xs text-[#6b7796]">
                          {paper.authors} · <span className="font-mono-tabular">{paper.year}</span> ·{' '}
                          {paper.journal}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right 5 Cols: AlphaFold DB pLDDT Confidence + Experimental RCSB PDB Cross-Refs */}
            <div className="lg:col-span-5 ascend-panel rounded-2xl p-6 sm:p-7 flex flex-col justify-between gap-6">
              {/* AlphaFold Predicted Structure Block */}
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-[#5df0a8]">
                      Predicted by Model · AlphaFold Structure Database
                    </div>
                    <h4 className="mt-1 text-base font-bold text-[#f3f6ff]">
                      {af ? af.entryId : `AlphaFold Monomer (${profile.accession})`}
                    </h4>
                  </div>
                  {af && (
                    <a
                      href={af.entryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#5df0a8] hover:underline underline-offset-4 whitespace-nowrap"
                    >
                      <span>3D Entry</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                </div>

                {af ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-[#9aa6c4]">Global Mean pLDDT Confidence</span>
                      <span className="font-mono-tabular text-xl font-bold text-[#f3f6ff]">
                        {af.meanPlddt.toFixed(1)}
                      </span>
                    </div>

                    {/* Canonical 4-Band AlphaFold pLDDT Bar (#0053D6, #65CBF3, #FFDB13, #FF7D45) */}
                    <div className="h-3.5 w-full rounded-full overflow-hidden flex border border-[#96afe6]/20">
                      <div
                        style={{ width: `${vhPct}%`, backgroundColor: '#0053D6' }}
                        title={`Very high (pLDDT > 90): ${vhPct}%`}
                      />
                      <div
                        style={{ width: `${confPct}%`, backgroundColor: '#65CBF3' }}
                        title={`Confident (90 > pLDDT > 70): ${confPct}%`}
                      />
                      <div
                        style={{ width: `${lowPct}%`, backgroundColor: '#FFDB13' }}
                        title={`Low (70 > pLDDT > 50): ${lowPct}%`}
                      />
                      <div
                        style={{ width: `${vlPct}%`, backgroundColor: '#FF7D45' }}
                        title={`Very low (pLDDT < 50): ${vlPct}%`}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[#9aa6c4]">
                          <span className="w-2.5 h-2.5 rounded-sm bg-[#0053D6] inline-block" />
                          Very high (&gt;90)
                        </span>
                        <span className="font-mono-tabular text-[#f3f6ff]">{vhPct}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[#9aa6c4]">
                          <span className="w-2.5 h-2.5 rounded-sm bg-[#65CBF3] inline-block" />
                          Confident (70–90)
                        </span>
                        <span className="font-mono-tabular text-[#f3f6ff]">{confPct}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[#9aa6c4]">
                          <span className="w-2.5 h-2.5 rounded-sm bg-[#FFDB13] inline-block" />
                          Low (50–70)
                        </span>
                        <span className="font-mono-tabular text-[#f3f6ff]">{lowPct}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[#9aa6c4]">
                          <span className="w-2.5 h-2.5 rounded-sm bg-[#FF7D45] inline-block" />
                          Disordered (&lt;50)
                        </span>
                        <span className="font-mono-tabular text-[#f3f6ff]">{vlPct}%</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
                      {af.pdbUrl && (
                        <a
                          href={af.pdbUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#5df0a8] hover:underline underline-offset-4"
                        >
                          Download PDB Coordinates
                        </a>
                      )}
                      {af.cifUrl && (
                        <>
                          <span aria-hidden="true" className="text-[#6b7796]">
                            ·
                          </span>
                          <a
                            href={af.cifUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#5df0a8] hover:underline underline-offset-4"
                          >
                            mmCIF
                          </a>
                        </>
                      )}
                      {af.paeImageUrl && (
                        <>
                          <span aria-hidden="true" className="text-[#6b7796]">
                            ·
                          </span>
                          <a
                            href={af.paeImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#5df0a8] hover:underline underline-offset-4"
                          >
                            PAE Error Matrix
                          </a>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-[#9aa6c4]">
                    No monomer AlphaFold prediction available for this isoform (e.g. multi-chain viral or &gt;2,700 aa complex).
                  </p>
                )}
              </div>

              {/* Experimental RCSB PDB Structures Block */}
              <div className="pt-5 border-t border-[#96afe6]/14 flex flex-col gap-3">
                <div>
                  <div className="text-xs text-[#6b7796]">
                    Experimentally Determined · RCSB Protein Data Bank
                  </div>
                  <h4 className="mt-0.5 text-sm font-bold text-[#f3f6ff]">
                    Deposited Crystal &amp; Cryo-EM Structures ({profile.pdbRefs.length})
                  </h4>
                </div>

                {profile.rcsbPrimary && (
                  <div className="p-3 rounded-xl bg-[#070c1c] border border-[#96afe6]/14 text-xs flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={profile.rcsbPrimary.rcsbUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono-tabular font-bold text-[#5df0a8] hover:underline inline-flex items-center gap-1"
                      >
                        <span>PDB {profile.rcsbPrimary.pdbId}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <span className="font-mono-tabular text-[#9aa6c4]">
                        {profile.rcsbPrimary.method}
                        {profile.rcsbPrimary.resolutionAngstrom
                          ? ` · ${profile.rcsbPrimary.resolutionAngstrom.toFixed(2)} Å`
                          : ''}
                      </span>
                    </div>
                    <p className="text-[#dbe4ff] line-clamp-2">{profile.rcsbPrimary.title}</p>
                  </div>
                )}

                {profile.pdbRefs.length > 0 ? (
                  <div className="divide-y divide-[#96afe6]/10 text-xs">
                    {profile.pdbRefs.map((pdb) => (
                      <div
                        key={pdb.pdbId}
                        className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                      >
                        <a
                          href={pdb.rcsbUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono-tabular font-semibold text-[#f3f6ff] hover:text-[#5df0a8] inline-flex items-center gap-1"
                        >
                          <span>{pdb.pdbId}</span>
                          <ExternalLink className="w-3 h-3 opacity-70" />
                        </a>
                        <span className="text-[#9aa6c4] font-mono-tabular">
                          {pdb.method} · {pdb.resolution}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#6b7796]">
                    No experimental PDB depositions cross-referenced on this UniProtKB record.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
