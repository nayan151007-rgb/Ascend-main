import { useState, useMemo } from 'react';
import type { ResearchGraph } from '../types/research';

interface KnowledgeGraphSvgProps {
  graph: ResearchGraph;
  isLoading: boolean;
  onSelectConcept: (concept: string) => void;
}

interface PositionedNode {
  label: string;
  x: number;
  y: number;
  isCenter: boolean;
}

function truncateNodeLabel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trim()}…`;
}

export default function KnowledgeGraphSvg({
  graph,
  isLoading,
  onSelectConcept,
}: KnowledgeGraphSvgProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const { nodesList, nodeLookup } = useMemo(() => {
    const cleanNodes = graph.nodes.slice(0, 10);
    const cx = 450;
    const cy = 260;
    const rx = 315;
    const ry = 182;

    const list: PositionedNode[] = [];
    const lookup = new Map<string, PositionedNode>();

    if (cleanNodes.length > 0) {
      const center: PositionedNode = {
        label: cleanNodes[0],
        x: cx,
        y: cy,
        isCenter: true,
      };
      list.push(center);
      lookup.set(center.label, center);

      const outerCount = cleanNodes.length - 1;
      for (let i = 1; i < cleanNodes.length; i++) {
        const angle = -Math.PI / 2 + ((i - 1) / Math.max(1, outerCount)) * Math.PI * 2;
        const pos: PositionedNode = {
          label: cleanNodes[i],
          x: cx + Math.cos(angle) * rx,
          y: cy + Math.sin(angle) * ry,
          isCenter: false,
        };
        list.push(pos);
        lookup.set(pos.label, pos);
      }
    }

    return { nodesList: list, nodeLookup: lookup };
  }, [graph.nodes]);

  const activeEdges = useMemo(() => {
    return graph.edges
      .map(([from, to, relation]) => {
        const src = nodeLookup.get(from);
        const dst = nodeLookup.get(to);
        if (!src || !dst) return null;
        return { from, to, relation, src, dst };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [graph.edges, nodeLookup]);

  const hoveredRelations = useMemo(() => {
    if (!hoveredNode) return [];
    return activeEdges.filter((e) => e.from === hoveredNode || e.to === hoveredNode);
  }, [activeEdges, hoveredNode]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full overflow-hidden rounded-xl border border-[#96afe6]/15 bg-[#050916]/90">
        {/* Subtle elliptical orbit guides */}
        <svg
          viewBox="0 0 900 520"
          className="w-full h-auto block select-none"
          role="img"
          aria-label={`Interactive concept graph for ${graph.nodes[0] || 'research topic'}. Click any concept node to run a new search.`}
        >
          <defs>
            <radialGradient id="centerNodeGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#5df0a8" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#5df0a8" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="centerFill" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5df0a8" />
              <stop offset="100%" stopColor="#2fd38a" />
            </linearGradient>
          </defs>

          {/* Coordinate grid & elliptical ring */}
          <ellipse
            cx={450}
            cy={260}
            rx={315}
            ry={182}
            fill="none"
            stroke="rgba(150, 175, 230, 0.09)"
            strokeDasharray="4 6"
          />
          <ellipse
            cx={450}
            cy={260}
            rx={175}
            ry={102}
            fill="none"
            stroke="rgba(150, 175, 230, 0.05)"
          />

          {/* Edges */}
          {activeEdges.map((edge, idx) => {
            const isHighlighted =
              hoveredNode === null
                ? edge.src.isCenter || edge.dst.isCenter
                : edge.from === hoveredNode || edge.to === hoveredNode;
            const isDimmed = hoveredNode !== null && !isHighlighted;

            const midX = (edge.src.x + edge.dst.x) / 2;
            const midY = (edge.src.y + edge.dst.y) / 2;

            // Slight curvature away from center for outer-to-outer links
            const dx = edge.dst.x - edge.src.x;
            const dy = edge.dst.y - edge.src.y;
            const len = Math.max(1, Math.hypot(dx, dy));
            const curveOffset = !edge.src.isCenter && !edge.dst.isCenter ? 18 : 0;
            const ctrlX = midX - (dy / len) * curveOffset;
            const ctrlY = midY + (dx / len) * curveOffset;

            const labelX = (edge.src.x + 2 * ctrlX + edge.dst.x) / 4;
            const labelY = (edge.src.y + 2 * ctrlY + edge.dst.y) / 4;

            const showRelationLabel =
              hoveredNode !== null
                ? isHighlighted
                : idx < 6 || (!edge.src.isCenter && !edge.dst.isCenter);

            return (
              <g key={`${edge.from}-${edge.to}-${idx}`}>
                <path
                  d={`M ${edge.src.x} ${edge.src.y} Q ${ctrlX} ${ctrlY} ${edge.dst.x} ${edge.dst.y}`}
                  fill="none"
                  stroke={
                    hoveredNode && isHighlighted
                      ? '#5df0a8'
                      : isHighlighted
                        ? 'rgba(130, 185, 255, 0.42)'
                        : 'rgba(150, 175, 230, 0.18)'
                  }
                  strokeWidth={hoveredNode && isHighlighted ? 2.1 : 1.25}
                  opacity={isDimmed ? 0.2 : 1}
                />
                {showRelationLabel && (
                  <g opacity={isDimmed ? 0.15 : 0.95}>
                    <rect
                      x={labelX - Math.min(62, edge.relation.length * 3.4 + 8)}
                      y={labelY - 9}
                      width={Math.min(124, edge.relation.length * 6.8 + 16)}
                      height={18}
                      rx={4}
                      fill="#070c1d"
                      stroke="rgba(150, 175, 230, 0.16)"
                    />
                    <text
                      x={labelX}
                      y={labelY + 3.5}
                      textAnchor="middle"
                      fontSize="10"
                      fill={hoveredNode && isHighlighted ? '#5df0a8' : '#9aa6c4'}
                      fontFamily="'JetBrains Mono', monospace"
                    >
                      {truncateNodeLabel(edge.relation, 18)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodesList.map((node) => {
            const isHovered = hoveredNode === node.label;
            const isNeighbor =
              hoveredNode !== null &&
              activeEdges.some(
                (e) =>
                  (e.from === hoveredNode && e.to === node.label) ||
                  (e.to === hoveredNode && e.from === node.label)
              );
            const dimmed = hoveredNode !== null && !isHovered && !isNeighbor;

            const boxWidth = node.isCenter
              ? Math.max(150, Math.min(230, node.label.length * 7.6 + 32))
              : Math.max(124, Math.min(196, node.label.length * 6.9 + 26));
            const boxHeight = node.isCenter ? 44 : 36;

            return (
              <g
                key={node.label}
                transform={`translate(${node.x}, ${node.y})`}
                className={isLoading ? 'cursor-wait' : 'cursor-pointer'}
                opacity={dimmed ? 0.35 : 1}
                role="button"
                tabIndex={0}
                aria-label={`Explore concept: ${node.label}`}
                onMouseEnter={() => setHoveredNode(node.label)}
                onMouseLeave={() => setHoveredNode(null)}
                onFocus={() => setHoveredNode(node.label)}
                onBlur={() => setHoveredNode(null)}
                onClick={() => {
                  if (!isLoading) onSelectConcept(node.label);
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isLoading) {
                    e.preventDefault();
                    onSelectConcept(node.label);
                  }
                }}
              >
                {node.isCenter && <circle r={62} fill="url(#centerNodeGlow)" />}

                <rect
                  x={-boxWidth / 2}
                  y={-boxHeight / 2}
                  width={boxWidth}
                  height={boxHeight}
                  rx={node.isCenter ? 11 : 9}
                  fill={
                    node.isCenter
                      ? 'url(#centerFill)'
                      : isHovered
                        ? '#132347'
                        : '#0b1329'
                  }
                  stroke={
                    node.isCenter
                      ? '#7efad8'
                      : isHovered
                        ? '#5df0a8'
                        : isNeighbor
                          ? 'rgba(93, 240, 168, 0.55)'
                          : 'rgba(150, 175, 230, 0.28)'
                  }
                  strokeWidth={node.isCenter || isHovered ? 1.8 : 1.1}
                />

                <text
                  x={0}
                  y={4.5}
                  textAnchor="middle"
                  fontSize={node.isCenter ? '12.5' : '11.5'}
                  fontWeight={node.isCenter ? '700' : '600'}
                  fill={node.isCenter ? '#032018' : isHovered ? '#5df0a8' : '#f3f6ff'}
                  fontFamily="'Plus Jakarta Sans', 'Inter', sans-serif"
                >
                  {truncateNodeLabel(node.label, node.isCenter ? 28 : 24)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Synchronized Concept Relation Readout */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#9aa6c4]">
        <div>
          {hoveredNode ? (
            <span>
              <strong className="text-[#f3f6ff] font-semibold">{hoveredNode}</strong>
              <span aria-hidden="true" className="mx-2 text-[#6b7796]">
                ·
              </span>
              {hoveredRelations.length > 0
                ? hoveredRelations
                    .slice(0, 3)
                    .map((r) => `${r.from === hoveredNode ? `→ ${r.relation} ${r.to}` : `← ${r.relation} from ${r.from}`}`)
                    .join(' · ')
                : 'Click node to synthesize full briefing'}
            </span>
          ) : (
            <span>
              Click any concept node in the graph to run a deep research synthesis on that concept.
            </span>
          )}
        </div>
        <div className="font-mono-tabular text-[#6b7796] shrink-0">
          {nodesList.length} nodes · {activeEdges.length} edges
        </div>
      </div>
    </div>
  );
}
