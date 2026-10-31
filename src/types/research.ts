export interface ResearchSection {
  title: string;
  body: string;
}

export interface ResearchSource {
  title: string;
  authors: string;
  year: number | null;
  url: string;
  source: string;
  why: string;
}

export interface ResearchGraph {
  nodes: string[];
  edges: [string, string, string][];
}

export interface ResearchResult {
  summary: string;
  sections: ResearchSection[];
  sources: ResearchSource[];
  graph: ResearchGraph;
}

export interface LibraryItem extends ResearchResult {
  id: string;
  query: string;
  createdAt: string;
  saved: boolean;
}

export const QUICK_STARTER_TOPICS: string[] = [
  'Mechanistic interpretability in sparse autoencoders',
  'CRISPR prime editing lipid nanoparticle delivery',
  'Topological quantum error correction surface codes',
  '3D Gaussian splatting for dynamic scene reconstruction',
  'Solid-state lithium-metal battery dendrite suppression',
];

export const INITIAL_FEATURED_BRIEFING: LibraryItem = {
  id: 'featured-sparse-autoencoders',
  query: 'Mechanistic interpretability in sparse autoencoders',
  createdAt: '2026-10-30T18:00:00.000Z',
  saved: true,
  summary:
    'Sparse autoencoders (SAEs) decompose polysemantic neural network activations into overcomplete, human-interpretable monosemantic feature dictionaries. Recent scaling studies demonstrate that top-k and gated dictionary architectures successfully isolate causal circuits inside frontier language models while maintaining low reconstruction error.',
  sections: [
    {
      title: 'Background',
      body: 'Neural networks routinely pack many unrelated concepts into fewer neurons than features—a phenomenon known as superposition. Individual residual-stream coordinates therefore fire across disparate contexts, frustrating direct neuron-level inspection. Sparse dictionary learning addresses superposition by projecting dense hidden states into a much wider sparse basis.',
    },
    {
      title: 'Key methods',
      body: 'Modern pipelines collect residual-stream, MLP, or attention-output activations across billions of tokens and train overcomplete autoencoders with L1 sparsity penalties, Gated linear units, or direct TopK activation constraints. Researchers then validate discovered features via activation patching, causal scrubbing, and automated interpretability scoring.',
    },
    {
      title: 'Recent findings',
      body: 'Scaling dictionary widths to millions of latents reveals structured feature hierarchies spanning syntax, factual entities, code safety bugs, and abstract reasoning motifs. Steering specific SAE latents causally modulates downstream model behavior without retraining model weights, confirming functional relevance beyond correlation.',
    },
    {
      title: 'Open questions',
      body: 'Feature splitting across dictionary scales makes it unclear whether a single canonical feature basis exists for transformer representations. Furthermore, cross-layer superposition, high activation reconstruction residuals on multi-step reasoning, and standardized ground-truth benchmarks remain active unsolved problems.',
    },
  ],
  sources: [
    {
      title: 'Towards Monosemanticity: Decomposing Language Models With Dictionary Learning',
      authors: 'T. Bricken, A. Templeton, J. Batson et al.',
      year: 2023,
      url: 'https://transformer-circuits.pub/2023/monosemantic-features/index.html',
      source: 'Semantic Scholar',
      why: 'Establishes that overcomplete sparse autoencoders extract thousands of monosemantic features from transformer MLP activations.',
    },
    {
      title: 'Sparse Autoencoders Find Highly Interpretable Features in Language Models',
      authors: 'H. Cunningham, A. Ewart, L. Riggs et al.',
      year: 2023,
      url: 'https://arxiv.org/abs/2309.08600',
      source: 'arXiv',
      why: 'Demonstrates scalable dictionary learning on open-weight Pythia transformers with quantitative causal intervention benchmarks.',
    },
    {
      title: 'Improving Dictionary Learning with Gated Sparse Autoencoders',
      authors: 'S. Rajamanoharan, A. Conmy, L. Smith et al.',
      year: 2024,
      url: 'https://arxiv.org/abs/2404.16014',
      source: 'arXiv',
      why: 'Resolves L1 shrinkage bias by decoupling feature detection from magnitude estimation, Pareto-improving reconstruction fidelity.',
    },
    {
      title: 'Scaling and Evaluating Sparse Autoencoders',
      authors: 'L. Gao, T. Dupré la Tour, H. Tillman et al.',
      year: 2024,
      url: 'https://arxiv.org/abs/2406.04093',
      source: 'arXiv',
      why: 'Introduces k-sparse TopK autoencoders and power-law scaling laws for training 16M-latent dictionaries on GPT-4 class activations.',
    },
  ],
  graph: {
    nodes: [
      'Sparse Autoencoders',
      'Superposition Hypothesis',
      'Monosemantic Features',
      'Gated & TopK Encoders',
      'Residual Stream',
      'Activation Patching',
      'Feature Steering',
      'Feature Splitting',
      'Circuit Discovery',
    ],
    edges: [
      ['Sparse Autoencoders', 'Superposition Hypothesis', 'untangles'],
      ['Sparse Autoencoders', 'Monosemantic Features', 'extracts'],
      ['Gated & TopK Encoders', 'Sparse Autoencoders', 'optimizes'],
      ['Residual Stream', 'Sparse Autoencoders', 'supplies states'],
      ['Monosemantic Features', 'Feature Steering', 'enables'],
      ['Activation Patching', 'Circuit Discovery', 'verifies'],
      ['Monosemantic Features', 'Circuit Discovery', 'composes'],
      ['Sparse Autoencoders', 'Feature Splitting', 'exhibits at scale'],
      ['Superposition Hypothesis', 'Residual Stream', 'compresses'],
      ['Feature Steering', 'Activation Patching', 'validates'],
      ['Gated & TopK Encoders', 'Feature Splitting', 'mitigates'],
    ],
  },
};
