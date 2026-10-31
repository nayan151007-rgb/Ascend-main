import type { LibraryItem } from '../types/research';

function formatReportDate(iso?: string): string {
  try {
    const d = iso ? new Date(iso) : new Date();
    return d.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

function renderTopicBlock(item: LibraryItem, index?: number): string {
  const headingPrefix = typeof index === 'number' ? `## ${index + 1}. ` : '## ';
  const lines: string[] = [];

  lines.push(`${headingPrefix}${item.query}`);
  lines.push(`*Synthesized on ${formatReportDate(item.createdAt)}${item.saved ? ' · Starred in Library' : ''}*`);
  lines.push('');
  lines.push('### Executive Summary');
  lines.push(item.summary);
  lines.push('');

  for (const sec of item.sections) {
    lines.push(`### ${sec.title}`);
    lines.push(sec.body);
    lines.push('');
  }

  lines.push('### Retrieved Scholarly Sources');
  if (item.sources.length === 0) {
    lines.push('_No indexed sources matched this query._');
  } else {
    item.sources.forEach((src, i) => {
      const yearStr = src.year ? String(src.year) : 'n.d.';
      lines.push(
        `${i + 1}. **[${src.title}](${src.url})** — ${src.authors} (${yearStr}, *${src.source}*)  `
      );
      lines.push(`   - *Relevance:* ${src.why}`);
    });
  }
  lines.push('');

  lines.push('### Concept Graph Connections');
  if (item.graph.edges.length === 0) {
    lines.push('_No concept edges recorded._');
  } else {
    item.graph.edges.forEach(([from, to, rel]) => {
      lines.push(`- **${from}** — *${rel}* → **${to}**`);
    });
  }
  lines.push('');

  return lines.join('\n');
}

const DISCLAIMER_FOOTER = [
  '---',
  '',
  '> **AI-Generated Research Briefing Disclaimer:** This report was synthesized automatically by **Ascend** using paper metadata and abstracts retrieved live from **arXiv** and **Semantic Scholar**. While source links point directly to retrieved scholarly records, summaries and conceptual links may contain omissions or interpretive errors. Verify primary full-text manuscripts before citing in academic or clinical work.',
  '',
].join('\n');

export function generateSingleReportMarkdown(item: LibraryItem): string {
  const generatedDate = formatReportDate();
  return [
    `# Ascend Research Briefing: ${item.query}`,
    '',
    `**Generated:** ${generatedDate}  `,
    `**Sources Indexed:** ${item.sources.length} papers (arXiv & Semantic Scholar)  `,
    `**Concept Nodes:** ${item.graph.nodes.length}`,
    '',
    '---',
    '',
    renderTopicBlock(item),
    DISCLAIMER_FOOTER,
  ].join('\n');
}

export function generateCollectionReportMarkdown(items: LibraryItem[], label = 'Saved Research Library'): string {
  const generatedDate = formatReportDate();
  const bodyBlocks = items.map((item, idx) => renderTopicBlock(item, idx)).join('\n---\n\n');

  return [
    `# Ascend Research Dossier — ${label}`,
    '',
    `**Generated:** ${generatedDate}  `,
    `**Topics Compiled:** ${items.length}`,
    '',
    '---',
    '',
    bodyBlocks,
    DISCLAIMER_FOOTER,
  ].join('\n');
}

export function triggerMarkdownDownload(markdownContent: string, filename = 'ascend-research-report.md'): void {
  const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
