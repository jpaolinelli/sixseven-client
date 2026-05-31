/**
 * Type definitions for graph algorithm selection, parameters, and results.
 */

export type AlgorithmId =
  | "pagerank"
  | "betweenness_centrality"
  | "connected_components"
  | "community_detection"
  | "degree_centrality"
  | "closeness_centrality"
  | "closeness_centrality_wf"
  | "eigenvector_centrality"
  | "harmonic_centrality"
  | "clustering_coefficient"
  | "triangle_count"
  | "strongly_connected_components"
  | "weighted_shortest_path";

export type AlgorithmCategory =
  | "centrality"
  | "community"
  | "path";

/** Describes a parameter input for an algorithm. */
export interface AlgorithmParam {
  name: string;
  label: string;
  type: "number" | "select";
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
}

/** Full definition of an algorithm including UI metadata. */
export interface AlgorithmDef {
  id: AlgorithmId;
  name: string;
  category: AlgorithmCategory;
  description: string;
  params: AlgorithmParam[];
  /** The SQL function/keyword used in the CALL statement */
  sqlFunction: string;
  /** Column name in results containing the node identifier */
  nodeColumn: string;
  /** Column name in results containing the score/value */
  scoreColumn: string;
}

/** A single node's algorithm result. */
export interface AlgorithmNodeResult {
  nodeId: string;
  table: string;
  pk: string;
  score: number;
}

/** Full results from running an algorithm. */
export interface AlgorithmResult {
  algorithmId: AlgorithmId;
  algorithmName: string;
  nodes: AlgorithmNodeResult[];
  stats: AlgorithmStats;
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

/** Summary statistics for algorithm results. */
export interface AlgorithmStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  count: number;
}

/** Sort configuration for results table. */
export interface SortConfig {
  column: "node" | "score";
  direction: "asc" | "desc";
}

/** Direction parameters shared by multiple algorithms. */
const DIRECTION_PARAM: AlgorithmParam = {
  name: "direction",
  label: "Direction",
  type: "select",
  default: "both",
  options: [
    { label: "Both", value: "both" },
    { label: "Outgoing", value: "out" },
    { label: "Incoming", value: "in" },
  ],
};

const ITERATIONS_PARAM: AlgorithmParam = {
  name: "iterations",
  label: "Iterations",
  type: "number",
  default: 20,
  min: 1,
  max: 100,
  step: 1,
};

const DAMPING_PARAM: AlgorithmParam = {
  name: "damping",
  label: "Damping Factor",
  type: "number",
  default: 0.85,
  min: 0,
  max: 1,
  step: 0.05,
};

const TOLERANCE_PARAM: AlgorithmParam = {
  name: "tolerance",
  label: "Tolerance",
  type: "number",
  default: 0.0001,
  min: 0.000001,
  max: 0.1,
  step: 0.0001,
};

/** All 13 supported graph algorithms. */
export const ALGORITHMS: AlgorithmDef[] = [
  {
    id: "pagerank",
    name: "PageRank",
    category: "centrality",
    description: "Node importance via link analysis",
    params: [ITERATIONS_PARAM, DAMPING_PARAM, TOLERANCE_PARAM],
    sqlFunction: "PAGERANK",
    nodeColumn: "node",
    scoreColumn: "score",
  },
  {
    id: "betweenness_centrality",
    name: "Betweenness Centrality",
    category: "centrality",
    description: "Bridge node identification",
    params: [DIRECTION_PARAM],
    sqlFunction: "BETWEENNESS_CENTRALITY",
    nodeColumn: "node",
    scoreColumn: "score",
  },
  {
    id: "connected_components",
    name: "Connected Components",
    category: "community",
    description: "Subgraph discovery",
    params: [],
    sqlFunction: "CONNECTED_COMPONENTS",
    nodeColumn: "node",
    scoreColumn: "component",
  },
  {
    id: "community_detection",
    name: "Community Detection (Louvain)",
    category: "community",
    description: "Community clustering",
    params: [ITERATIONS_PARAM],
    sqlFunction: "COMMUNITY_DETECTION",
    nodeColumn: "node",
    scoreColumn: "community",
  },
  {
    id: "degree_centrality",
    name: "Degree Centrality",
    category: "centrality",
    description: "In/out/total degree",
    params: [
      {
        name: "variant",
        label: "Variant",
        type: "select",
        default: "total",
        options: [
          { label: "Total", value: "total" },
          { label: "In-degree", value: "in" },
          { label: "Out-degree", value: "out" },
        ],
      },
    ],
    sqlFunction: "DEGREE_CENTRALITY",
    nodeColumn: "node",
    scoreColumn: "score",
  },
  {
    id: "closeness_centrality",
    name: "Closeness Centrality",
    category: "centrality",
    description: "Distance-based importance",
    params: [DIRECTION_PARAM],
    sqlFunction: "CLOSENESS_CENTRALITY",
    nodeColumn: "node",
    scoreColumn: "score",
  },
  {
    id: "closeness_centrality_wf",
    name: "Closeness Centrality (Wasserman-Faust)",
    category: "centrality",
    description: "Disconnected graph variant",
    params: [DIRECTION_PARAM],
    sqlFunction: "CLOSENESS_CENTRALITY_WF",
    nodeColumn: "node",
    scoreColumn: "score",
  },
  {
    id: "eigenvector_centrality",
    name: "Eigenvector Centrality",
    category: "centrality",
    description: "Influence-based importance",
    params: [ITERATIONS_PARAM, TOLERANCE_PARAM],
    sqlFunction: "EIGENVECTOR_CENTRALITY",
    nodeColumn: "node",
    scoreColumn: "score",
  },
  {
    id: "harmonic_centrality",
    name: "Harmonic Centrality",
    category: "centrality",
    description: "Reciprocal distance centrality",
    params: [DIRECTION_PARAM],
    sqlFunction: "HARMONIC_CENTRALITY",
    nodeColumn: "node",
    scoreColumn: "score",
  },
  {
    id: "clustering_coefficient",
    name: "Clustering Coefficient",
    category: "centrality",
    description: "Local clustering density",
    params: [],
    sqlFunction: "CLUSTERING_COEFFICIENT",
    nodeColumn: "node",
    scoreColumn: "score",
  },
  {
    id: "triangle_count",
    name: "Triangle Count",
    category: "centrality",
    description: "Triangle participation",
    params: [],
    sqlFunction: "TRIANGLE_COUNT",
    nodeColumn: "node",
    scoreColumn: "count",
  },
  {
    id: "strongly_connected_components",
    name: "Strongly Connected Components",
    category: "community",
    description: "Directed reachability groups",
    params: [],
    sqlFunction: "STRONGLY_CONNECTED_COMPONENTS",
    nodeColumn: "node",
    scoreColumn: "component",
  },
  {
    id: "weighted_shortest_path",
    name: "Weighted Shortest Path",
    category: "path",
    description: "Shortest path via WEIGHT clause",
    params: [
      {
        name: "source_table",
        label: "Source Table",
        type: "select",
        default: "",
      },
      {
        name: "source_id",
        label: "Source ID",
        type: "number",
        default: 1,
        min: 1,
      },
      {
        name: "target_table",
        label: "Target Table",
        type: "select",
        default: "",
      },
      {
        name: "target_id",
        label: "Target ID",
        type: "number",
        default: 1,
        min: 1,
      },
      {
        name: "weight_property",
        label: "Weight Property",
        type: "select",
        default: "weight",
      },
    ],
    sqlFunction: "SHORTEST PATH",
    nodeColumn: "node",
    scoreColumn: "total_weight",
  },
];

/** Get an algorithm definition by ID. */
export function getAlgorithm(id: AlgorithmId): AlgorithmDef | undefined {
  return ALGORITHMS.find((a) => a.id === id);
}

/** Group algorithms by category. */
export function getAlgorithmsByCategory(): Map<AlgorithmCategory, AlgorithmDef[]> {
  const grouped = new Map<AlgorithmCategory, AlgorithmDef[]>();
  for (const algo of ALGORITHMS) {
    const list = grouped.get(algo.category) ?? [];
    list.push(algo);
    grouped.set(algo.category, list);
  }
  return grouped;
}

export const CATEGORY_LABELS: Record<AlgorithmCategory, string> = {
  centrality: "Centrality",
  community: "Community Detection",
  path: "Path",
};
