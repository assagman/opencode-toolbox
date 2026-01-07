import type { CatalogTool, SearchResult, ToolIdString } from "../catalog/types";

/**
 * Simple tokenizer for BM25
 * Lowercases and splits on whitespace and punctuation
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")  // Replace punctuation with spaces
    .split(/\s+/)
    .filter(token => token.length > 0);
}

/**
 * BM25 search implementation
 * Using standard BM25 parameters: k1=1.2, b=0.75
 */
export class BM25Index {
  private documents: Map<ToolIdString, { tokens: string[]; tool: CatalogTool }>;
  private docFreqs: Map<string, number>;  // Document frequency for each term
  private docLengths: Map<ToolIdString, number>;
  private avgDocLength: number = 0;
  private totalDocs: number = 0;

  // BM25 parameters
  private readonly k1: number = 1.2;
  private readonly b: number = 0.75;

  constructor() {
    this.documents = new Map();
    this.docFreqs = new Map();
    this.docLengths = new Map();
  }

  /**
   * Add tools to the index
   */
  indexTools(tools: CatalogTool[]): void {
    this.documents.clear();
    this.docFreqs.clear();
    this.docLengths.clear();

    for (const tool of tools) {
      const tokens = tokenize(tool.searchableText);
      this.documents.set(tool.idString, { tokens, tool });
      this.docLengths.set(tool.idString, tokens.length);

      // Update document frequencies
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
      }
    }

    this.totalDocs = this.documents.size;
    this.avgDocLength = Array.from(this.docLengths.values())
      .reduce((sum, len) => sum + len, 0) / this.totalDocs;
  }

  /**
   * Search for tools matching a natural language query
   */
  search(query: string, limit: number = 5): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.totalDocs === 0) {
      return [];
    }

    const scores = new Map<ToolIdString, number>();

    for (const [idString, doc] of this.documents) {
      let score = 0;
      const docLength = this.docLengths.get(idString)!;

      for (const token of queryTokens) {
        // Document frequency
        const df = this.docFreqs.get(token) || 0;
        if (df === 0) continue;

        // IDF (Inverse Document Frequency)
        const idf = Math.log((this.totalDocs - df + 0.5) / (df + 0.5) + 1);

        // Term frequency in document
        const tf = doc.tokens.filter(t => t === token).length;

        // BM25 score
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scores.set(idString, score);
      }
    }

    // Sort by score (descending), then by tool name for stable tie-breaking
    const sorted = Array.from(scores.entries())
      .sort(([aId, aScore], [bId, bScore]) => {
        if (Math.abs(aScore - bScore) < 0.0001) {
          return aId.localeCompare(bId);  // Stable alphabetical sort
        }
        return bScore - aScore;
      })
      .slice(0, limit);

    return sorted.map(([idString, score]) => {
      const tool = this.documents.get(idString)!.tool;
      return this.toSearchResult(tool, score);
    });
  }

  private toSearchResult(tool: CatalogTool, score: number): SearchResult {
    // Generate function signature
    const argList = tool.args
      .map(arg => {
        const optional = arg.description?.includes("optional") || arg.description?.includes("(optional)") ? "?" : "";
        return `${arg.name}${optional}`;
      })
      .join(", ");
    const signature = `${tool.id.name}(${argList})`;

    return {
      tool: tool.id,
      idString: tool.idString,
      score,
      preview: tool.description,
      signature,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents.clear();
    this.docFreqs.clear();
    this.docLengths.clear();
    this.avgDocLength = 0;
    this.totalDocs = 0;
  }

  /**
   * Get the number of documents in the index
   */
  get size(): number {
    return this.totalDocs;
  }
}
