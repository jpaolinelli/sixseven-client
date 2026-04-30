/**
 * SixSevenDB SQL language support for CodeMirror 6.
 *
 * Extends the standard SQL dialect with SixSevenDB-specific keywords
 * (TRAVERSE, NEAREST, MATCH, LINK, UNLINK, EMBEDDING, REEMBED) and the
 * graph-pattern syntax added in GDB-427 (SELECT FROM MATCH, ANY/ALL/SHORTEST K
 * path selectors, variable-length quantifiers `*min..max`, WEIGHT clause, and
 * path functions). Also provides schema-aware autocomplete from catalog
 * metadata.
 */

import {
  SQLDialect,
  sql,
  type SQLConfig,
} from "@codemirror/lang-sql";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { DatabaseSchema } from "./types";

// ----- SixSevenDB-specific keywords -----

export const SIXSEVEN_KEYWORDS = [
  "TRAVERSE",
  "NEAREST",
  "MATCH",
  "LINK",
  "UNLINK",
  "EMBEDDING",
  "REEMBED",
  "EDGE",
  "VERTEX",
  "PATH",
  "SHORTEST",
  "NEIGHBORS",
  "DEPTH",
  "BREADTH",
  "HOPS",
  "WEIGHT",
  // GDB-428: graph-pattern selectors. ALL is already a SQL keyword, but
  // ANY is not — added here so it is highlighted in graph contexts like
  // `MATCH ANY SHORTEST (a)-[*]->(b)`.
  "ANY",
];

// Standard SQL keywords (subset for autocomplete)
export const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "DROP",
  "ALTER",
  "INDEX",
  "ON",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "AS",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "CROSS",
  "GROUP",
  "BY",
  "ORDER",
  "ASC",
  "DESC",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "DISTINCT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "BETWEEN",
  "LIKE",
  "EXISTS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "UNION",
  "ALL",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "UNIQUE",
  "CHECK",
  "DEFAULT",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRANSACTION",
  "SHOW",
  "DATABASES",
  "TABLES",
  "COLUMNS",
  "INDEXES",
  "TRUE",
  "FALSE",
];

/**
 * Graph path functions added in GDB-427. These are built-ins exposed by the
 * server to operate on `PATH` values returned from MATCH queries.
 */
export const PATH_FUNCTIONS = [
  "path_length",
  "path_cost",
  "nodes",
  "edges",
];

/**
 * Path selectors that follow `MATCH` to constrain which paths are returned.
 * Suggested as completions immediately after `MATCH` or after the path
 * quantifier keywords (`ANY`, `ALL`).
 */
export const PATH_SELECTORS = [
  "ANY",
  "ALL",
  "ANY SHORTEST",
  "ALL SHORTEST",
  "SHORTEST",
];

/**
 * Quantifier suggestions emitted right after a `*` inside a graph pattern,
 * e.g. `(a)-[*..3]->(b)`. The completions cover the four supported forms:
 * exact `*n`, range `*m..n`, upper-bound `*..n`, lower-bound `*n..`.
 */
export const QUANTIFIER_TEMPLATES = [
  { label: "1..3", detail: "range (1 to 3 hops)" },
  { label: "1..5", detail: "range (1 to 5 hops)" },
  { label: "..3", detail: "upper bound (up to 3 hops)" },
  { label: "..5", detail: "upper bound (up to 5 hops)" },
  { label: "1..", detail: "lower bound (1 or more hops)" },
  { label: "2", detail: "exact (2 hops)" },
  { label: "3", detail: "exact (3 hops)" },
];

// Custom dialect that adds SixSevenDB keywords to SQL
const sixsevenDialect = SQLDialect.define({
  keywords:
    SQL_KEYWORDS.join(" ").toLowerCase() +
    " " +
    SIXSEVEN_KEYWORDS.join(" ").toLowerCase(),
  types:
    "int8 int16 int32 int64 uint8 uint16 uint32 uint64 float32 float64 decimal bool string blob date time timestamp interval point json uuid embedding text integer bigint smallint real double varchar char boolean",
  // GDB-428: register the new graph path functions as built-ins so they get
  // function-style highlighting alongside the existing path_cost helper.
  builtin:
    "current_timestamp current_date current_time coalesce nullif cast " +
    PATH_FUNCTIONS.join(" "),
  operatorChars: "+-*/<>=~!@#%^&|?",
  specialVar: "",
  identifierQuotes: '"',
  hashComments: false,
  slashComments: true,
  backslashEscapes: true,
});

// ----- Schema-aware autocomplete -----

export interface SchemaCompletionData {
  tables: { name: string; columns: { name: string; type: string }[] }[];
  edgeTypes: string[];
}

/**
 * Extract the table name from the FROM clause preceding the cursor.
 * Handles simple cases like `SELECT ... FROM tablename WHERE ...`
 */
function extractTableFromContext(docText: string, pos: number): string | null {
  const textBefore = docText.slice(0, pos).toUpperCase();
  // Look backwards for FROM <table>
  const fromMatch = textBefore.match(
    /FROM\s+[""]?(\w+)[""]?(?:\s+(?:AS\s+)?\w+)?\s*$/i
  );
  if (fromMatch) return fromMatch[1].toLowerCase();

  // Also try: FROM <table> WHERE ... (cursor somewhere after)
  const fromMatchEarlier = textBefore.match(
    /FROM\s+[""]?(\w+)[""]?/i
  );
  if (fromMatchEarlier) return fromMatchEarlier[1].toLowerCase();

  return null;
}

/**
 * True if the cursor is positioned immediately after a `*` inside a graph
 * edge quantifier, e.g. `-[*` or `-[:KNOWS *`. Used to decide whether to
 * surface quantifier templates instead of the generic keyword list.
 */
export function isInQuantifierContext(
  docText: string,
  pos: number
): boolean {
  const textBefore = docText.slice(0, pos);
  // Quantifier appears inside `[...]` after an asterisk. We require the
  // most recent unbalanced `[` to come after the most recent `]`, and the
  // `*` to be the last non-whitespace character before the cursor.
  const lastOpen = textBefore.lastIndexOf("[");
  const lastClose = textBefore.lastIndexOf("]");
  if (lastOpen === -1 || lastOpen < lastClose) return false;
  const inside = textBefore.slice(lastOpen + 1);
  return /\*\s*(?:\d*\.?\.?\d*)?$/.test(inside);
}

/**
 * True if the cursor sits immediately after `MATCH` (with optional
 * whitespace), where path selectors like `ANY SHORTEST` are expected.
 */
export function isAfterMatchKeyword(
  docText: string,
  pos: number
): boolean {
  const textBefore = docText.slice(0, pos);
  return /\bMATCH\s+\w*$/i.test(textBefore);
}

/**
 * Build a CodeMirror autocomplete source from SixSevenDB schema data.
 */
export function sixsevenCompletionSource(schemaData: SchemaCompletionData) {
  return (context: CompletionContext): CompletionResult | null => {
    const docText = context.state.doc.toString();

    // GDB-428: quantifier completions inside `[...]` after an asterisk.
    // Trigger on `*` itself or after a partial digit/range.
    if (isInQuantifierContext(docText, context.pos)) {
      const partial = context.matchBefore(/[\d.]*/);
      const from = partial ? partial.from : context.pos;
      return {
        from,
        options: QUANTIFIER_TEMPLATES.map((q) => ({
          label: q.label,
          type: "text",
          detail: q.detail,
          boost: 5,
        })),
        validFor: /^[\d.]*$/,
      };
    }

    // GDB-428: path selector completions immediately after `MATCH`.
    if (isAfterMatchKeyword(docText, context.pos)) {
      const wordMatch = context.matchBefore(/\w*/);
      const from = wordMatch ? wordMatch.from : context.pos;
      return {
        from,
        options: PATH_SELECTORS.map((sel) => ({
          label: sel,
          type: "keyword",
          detail: "path selector",
          boost: 5,
        })),
        validFor: /^\w*$/,
      };
    }

    // Check if we're after a dot (table.column completion)
    const dotMatch = context.matchBefore(/\w+\.\w*/);
    if (dotMatch) {
      const dotPos = dotMatch.text.indexOf(".");
      const tableName = dotMatch.text.slice(0, dotPos).toLowerCase();
      const table = schemaData.tables.find(
        (t) => t.name.toLowerCase() === tableName
      );
      if (!table) return null;

      const options: Completion[] = table.columns.map((col) => ({
        label: col.name,
        type: "property",
        detail: col.type,
      }));

      return {
        from: dotMatch.from + dotPos + 1,
        options,
        validFor: /^\w*$/,
      };
    }

    // General word completion
    const wordMatch = context.matchBefore(/\w+/);
    if (!wordMatch && !context.explicit) return null;

    const from = wordMatch ? wordMatch.from : context.pos;
    const options: Completion[] = [];

    // SQL + SixSevenDB keywords
    const allKeywords = [...SQL_KEYWORDS, ...SIXSEVEN_KEYWORDS];
    for (const kw of allKeywords) {
      options.push({
        label: kw,
        type: "keyword",
        boost: SIXSEVEN_KEYWORDS.includes(kw) ? 1 : 0,
      });
    }

    // GDB-428: graph path functions in the global completion list.
    for (const fn of PATH_FUNCTIONS) {
      options.push({
        label: fn,
        type: "function",
        detail: "path function",
        boost: 1,
      });
    }

    // Table names
    for (const table of schemaData.tables) {
      options.push({
        label: table.name,
        type: "type",
        detail: "table",
      });
    }

    // Edge type names
    for (const et of schemaData.edgeTypes) {
      options.push({
        label: et,
        type: "type",
        detail: "edge type",
      });
    }

    // Context-aware column completion: if we can detect a FROM table, add its columns
    const contextTable = extractTableFromContext(docText, context.pos);
    if (contextTable) {
      const table = schemaData.tables.find(
        (t) => t.name.toLowerCase() === contextTable
      );
      if (table) {
        for (const col of table.columns) {
          options.push({
            label: col.name,
            type: "property",
            detail: `${table.name}.${col.type}`,
          });
        }
      }
    }

    return {
      from,
      options,
      validFor: /^\w*$/,
    };
  };
}

/**
 * Create the SixSevenDB SQL language extension for CodeMirror.
 */
export function sixsevenSQL(config?: Partial<SQLConfig>) {
  return sql({
    dialect: sixsevenDialect,
    upperCaseKeywords: true,
    ...config,
  });
}
