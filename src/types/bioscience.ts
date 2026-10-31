export interface BioscienceDomain {
  type: string;
  description: string;
  start: number;
  end: number;
}

export interface BiosciencePdbRef {
  pdbId: string;
  method: string;
  resolution: string;
  chains: string;
  rcsbUrl: string;
}

export interface BioscienceAlphaFold {
  entryId: string;
  meanPlddt: number;
  fractionVeryHigh: number;
  fractionConfident: number;
  fractionLow: number;
  fractionVeryLow: number;
  pdbUrl: string;
  cifUrl: string;
  paeImageUrl: string;
  modelCreatedDate: string;
  entryUrl: string;
}

export interface BioscienceProfile {
  accession: string;
  geneName: string;
  proteinName: string;
  organism: string;
  sequenceLength: number;
  molecularMassDa: number;
  sequenceSnippet: string;
  functionSummary: string;
  uniprotUrl: string;
  domains: BioscienceDomain[];
  pdbRefs: BiosciencePdbRef[];
  rcsbPrimary: {
    pdbId: string;
    title: string;
    method: string;
    resolutionAngstrom: number | null;
    atomCount: number | null;
    rcsbUrl: string;
  } | null;
  alphafold: BioscienceAlphaFold | null;
  literature: Array<{
    pmid: string;
    title: string;
    authors: string;
    year: string;
    journal: string;
    url: string;
  }>;
}

export const QUICK_BIOSCIENCE_TARGETS = [
  { label: 'TP53 · Tumor Suppressor p53', query: 'P04637' },
  { label: 'BRCA1 · DNA Repair E3 Ligase', query: 'P38398' },
  { label: 'EGFR · Receptor Tyrosine Kinase', query: 'P00533' },
  { label: 'ABL1 · Tyrosine-Protein Kinase', query: 'P00520' },
  { label: 'INS · Human Insulin', query: 'P01308' },
];
