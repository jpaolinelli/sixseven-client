"use client";

import { useState, useCallback, useMemo } from "react";
import type {
  AlgorithmId,
  AlgorithmDef,
  AlgorithmResult,
  SortConfig,
} from "@/lib/algorithm-types";
import {
  ALGORITHMS,
  getAlgorithm,
  getAlgorithmsByCategory,
  CATEGORY_LABELS,
} from "@/lib/algorithm-types";
import {
  runAlgorithm,
  scoreToColor,
  formatScore,
} from "@/lib/algorithm-utils";
import { buildCSV } from "@/lib/export";
import { useConnection } from "@/lib/ConnectionContext";

interface AlgorithmPanelProps {
  database: string;
  /** Callback to apply heat map colors to graph nodes. Map of nodeId -> hex color. */
  onApplyHeatMap?: (colors: Map<string, string> | null) => void;
  /** Available table names for source/target selectors. */
  tables?: string[];
}

export function AlgorithmPanel({
  database,
  onApplyHeatMap,
  tables = [],
}: AlgorithmPanelProps) {
  const { connectionParams } = useConnection();
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<AlgorithmId>("pagerank");
  const [params, setParams] = useState<Record<string, string | number>>({});
  const [result, setResult] = useState<AlgorithmResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortConfig>({ column: "score", direction: "desc" });
  const [heatMapActive, setHeatMapActive] = useState(false);

  const algorithmsByCategory = useMemo(() => getAlgorithmsByCategory(), []);
  const currentAlgo = useMemo(() => getAlgorithm(selectedAlgorithm), [selectedAlgorithm]);

  const handleAlgorithmChange = useCallback((id: AlgorithmId) => {
    setSelectedAlgorithm(id);
    setParams({});
    setResult(null);
    setError(null);
    setHeatMapActive(false);
    onApplyHeatMap?.(null);
  }, [onApplyHeatMap]);

  const handleParamChange = useCallback((name: string, value: string | number) => {
    setParams((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleRun = useCallback(async () => {
    if (!currentAlgo) return;

    setLoading(true);
    setError(null);

    try {
      const effectiveParams: Record<string, string | number> = {};
      for (const p of currentAlgo.params) {
        effectiveParams[p.name] = params[p.name] ?? p.default;
      }

      const res = await runAlgorithm(database, selectedAlgorithm, effectiveParams, connectionParams);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algorithm execution failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [currentAlgo, database, selectedAlgorithm, params, connectionParams]);

  const handleToggleHeatMap = useCallback(() => {
    if (!result || !onApplyHeatMap) return;

    if (heatMapActive) {
      onApplyHeatMap(null);
      setHeatMapActive(false);
    } else {
      const colorMap = new Map<string, string>();
      for (const node of result.nodes) {
        colorMap.set(node.nodeId, scoreToColor(node.score, result.stats.min, result.stats.max));
      }
      onApplyHeatMap(colorMap);
      setHeatMapActive(true);
    }
  }, [result, onApplyHeatMap, heatMapActive]);

  const sortedResults = useMemo(() => {
    if (!result) return [];
    const sorted = [...result.nodes];
    sorted.sort((a, b) => {
      if (sort.column === "node") {
        const cmp = a.nodeId.localeCompare(b.nodeId);
        return sort.direction === "asc" ? cmp : -cmp;
      }
      const cmp = a.score - b.score;
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [result, sort]);

  const handleSort = useCallback((column: "node" | "score") => {
    setSort((prev) => ({
      column,
      direction: prev.column === column && prev.direction === "desc" ? "asc" : "desc",
    }));
  }, []);

  const handleExportCSV = useCallback(() => {
    if (!result) return;
    const csv = buildCSV(result.columns, result.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.algorithmId}-results.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Algorithm selector */}
      <div className="p-2 border-b border-gray-800">
        <div className="text-xs text-gray-500 mb-1 font-medium">Algorithm</div>
        <select
          value={selectedAlgorithm}
          onChange={(e) => handleAlgorithmChange(e.target.value as AlgorithmId)}
          className="w-full bg-gray-800 text-gray-200 text-xs px-2 py-1.5 rounded border border-gray-700"
        >
          {Array.from(algorithmsByCategory.entries()).map(([category, algos]) => (
            <optgroup key={category} label={CATEGORY_LABELS[category]}>
              {algos.map((algo) => (
                <option key={algo.id} value={algo.id}>
                  {algo.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {currentAlgo && (
          <p className="text-xs text-gray-600 mt-1">{currentAlgo.description}</p>
        )}
      </div>

      {/* Parameters */}
      {currentAlgo && currentAlgo.params.length > 0 && (
        <div className="p-2 border-b border-gray-800">
          <div className="text-xs text-gray-500 mb-1 font-medium">Parameters</div>
          <div className="space-y-1.5">
            {currentAlgo.params.map((param) => (
              <div key={param.name}>
                <label className="text-xs text-gray-400 block mb-0.5">
                  {param.label}
                </label>
                {param.type === "select" ? (
                  <select
                    value={String(params[param.name] ?? param.default)}
                    onChange={(e) => handleParamChange(param.name, e.target.value)}
                    className="w-full bg-gray-800 text-gray-200 text-xs px-2 py-1 rounded border border-gray-700"
                  >
                    {param.options ? (
                      param.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))
                    ) : (
                      // Dynamic options from tables list
                      <>
                        <option value="">Select...</option>
                        {tables.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                ) : (
                  <input
                    type="number"
                    value={params[param.name] ?? param.default}
                    onChange={(e) =>
                      handleParamChange(
                        param.name,
                        e.target.value === "" ? param.default : Number(e.target.value)
                      )
                    }
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    className="w-full bg-gray-800 text-gray-200 text-xs px-2 py-1 rounded border border-gray-700"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run button */}
      <div className="p-2 border-b border-gray-800">
        <button
          onClick={handleRun}
          disabled={loading}
          className="w-full px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-medium"
        >
          {loading ? "Running..." : "Run Algorithm"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-2 py-1.5 bg-red-900/30 border-b border-red-800/50 text-red-400 text-xs flex items-center justify-between">
          <span className="truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-300 ml-1 shrink-0"
          >
            x
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Stats summary */}
          <div className="p-2 border-b border-gray-800">
            <div className="text-xs text-gray-500 mb-1 font-medium">
              Summary — {result.algorithmName}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <div className="text-gray-500">Nodes:</div>
              <div className="text-gray-300">{result.stats.count}</div>
              <div className="text-gray-500">Min:</div>
              <div className="text-gray-300">{formatScore(result.stats.min)}</div>
              <div className="text-gray-500">Max:</div>
              <div className="text-gray-300">{formatScore(result.stats.max)}</div>
              <div className="text-gray-500">Mean:</div>
              <div className="text-gray-300">{formatScore(result.stats.mean)}</div>
              <div className="text-gray-500">Median:</div>
              <div className="text-gray-300">{formatScore(result.stats.median)}</div>
            </div>
          </div>

          {/* Color scale legend */}
          <div className="p-2 border-b border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 font-medium">Color Scale</span>
              <button
                onClick={handleToggleHeatMap}
                disabled={!onApplyHeatMap}
                className={`px-2 py-0.5 text-xs rounded ${
                  heatMapActive
                    ? "bg-amber-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:text-gray-200"
                }`}
              >
                {heatMapActive ? "Remove Overlay" : "Apply to Graph"}
              </button>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">{formatScore(result.stats.min)}</span>
              <div
                className="flex-1 h-3 rounded"
                style={{
                  background: "linear-gradient(to right, #3b82f6, #eab308, #ef4444)",
                }}
              />
              <span className="text-xs text-gray-500">{formatScore(result.stats.max)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 p-2 border-b border-gray-800">
            <button
              onClick={handleExportCSV}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
            >
              Export CSV
            </button>
          </div>

          {/* Results table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr>
                  <th
                    onClick={() => handleSort("node")}
                    className="text-left px-2 py-1.5 text-gray-500 font-medium cursor-pointer hover:text-gray-300 border-b border-gray-800"
                  >
                    Node{" "}
                    {sort.column === "node" && (sort.direction === "asc" ? "\u25B2" : "\u25BC")}
                  </th>
                  <th
                    onClick={() => handleSort("score")}
                    className="text-right px-2 py-1.5 text-gray-500 font-medium cursor-pointer hover:text-gray-300 border-b border-gray-800"
                  >
                    {currentAlgo?.scoreColumn ?? "Score"}{" "}
                    {sort.column === "score" && (sort.direction === "asc" ? "\u25B2" : "\u25BC")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((node) => (
                  <tr key={node.nodeId} className="hover:bg-gray-800/50">
                    <td className="px-2 py-1 text-gray-300 border-b border-gray-800/50">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: scoreToColor(
                              node.score,
                              result.stats.min,
                              result.stats.max
                            ),
                          }}
                        />
                        {node.nodeId}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-gray-400 text-right border-b border-gray-800/50 font-mono">
                      {formatScore(node.score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
