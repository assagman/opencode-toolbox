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
 * Yield to the event loop - allows other async work to proceed
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * BM25 search implementation with incremental indexing support
 * Using standard BM25 parameters: k1=1.2, b=0.75
 * 
 * Features:
 * - Incremental updates without full reindex
 * - Async chunked indexing for large batches
 * - Thread-safe concurrent search support
 */
export class BM25Index {
  private documents: Map<ToolIdString, { tokens: string[]; tool: CatalogTool }>;
  private docFreqs: Map<string, number>;  // Document frequency for each term
  private docLengths: Map<ToolIdString, number>;
  private avgDocLength: number = 0;
  private totalDocs: number = 0;
  private totalTokens: number = 0;  // Track total tokens for incremental avg calculation

  // BM25 parameters
  private readonly k1: number = 1.2;
  private readonly b: number = 0.75;

  constructor() {
    this.documents = new Map();
    this.docFreqs = new Map();
    this.docLengths = new Map();
  }

  /**
   * Add tools to the index (replaces existing index)
   * Synchronous version for backward compatibility
   */
  indexTools(tools: CatalogTool[]): void {
    this.clear();
    this.addToolsBatch(tools);
  }

  /**
   * Add tools to the index asynchronously with chunked processing
   * Yields to event loop between chunks to prevent blocking
   * 
   * @param tools - Tools to index
   * @param chunkSize - Number of tools to process before yielding (default: 50)
   */
  async indexToolsAsync(tools: CatalogTool[], chunkSize: number = 50): Promise<void> {
    this.clear();
    await this.addToolsAsync(tools, chunkSize);
  }

  /**
   * Add multiple tools incrementally without clearing existing index
   * Synchronous version for small batches
   */
  addToolsBatch(tools: CatalogTool[]): void {
    for (const tool of tools) {
      this.addToolInternal(tool);
    }
    this.recalculateAvgDocLength();
  }

  /**
   * Add multiple tools incrementally with async chunking
   * Use for large batches to prevent blocking
   * 
   * @param tools - Tools to add
   * @param chunkSize - Number of tools to process before yielding
   */
  async addToolsAsync(tools: CatalogTool[], chunkSize: number = 50): Promise<void> {
    for (let i = 0; i < tools.length; i += chunkSize) {
      const chunk = tools.slice(i, i + chunkSize);
      for (const tool of chunk) {
        this.addToolInternal(tool);
      }
      
      // Yield to event loop if more chunks remain
      if (i + chunkSize < tools.length) {
        await yieldToEventLoop();
      }
    }
    this.recalculateAvgDocLength();
  }

  /**
   * Add a single tool to the index incrementally
   * Updates avgDocLength incrementally for efficiency
   */
  addTool(tool: CatalogTool): void {
    this.addToolInternal(tool);
    this.recalculateAvgDocLengthIncremental();
  }

  /**
   * Internal method to add a tool without recalculating averages
   */
  private addToolInternal(tool: CatalogTool): void {
    // Skip if already indexed
    if (this.documents.has(tool.idString)) {
      return;
    }

    const tokens = tokenize(tool.searchableText);
    this.documents.set(tool.idString, { tokens, tool });
    this.docLengths.set(tool.idString, tokens.length);
    this.totalTokens += tokens.length;
    this.totalDocs++;

    // Update document frequencies
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
    }
  }

  /**
   * Remove a tool from the index
   */
  removeTool(idString: ToolIdString): boolean {
    const doc = this.documents.get(idString);
    if (!doc) return false;

    // Update document frequencies
    const uniqueTokens = new Set(doc.tokens);
    for (const token of uniqueTokens) {
      const freq = this.docFreqs.get(token) || 0;
      if (freq <= 1) {
        this.docFreqs.delete(token);
      } else {
        this.docFreqs.set(token, freq - 1);
      }
    }

    // Remove from maps
    this.totalTokens -= doc.tokens.length;
    this.documents.delete(idString);
    this.docLengths.delete(idString);
    this.totalDocs--;

    this.recalculateAvgDocLengthIncremental();
    return true;
  }

  /**
   * Recalculate average document length (full recalculation)
   */
  private recalculateAvgDocLength(): void {
    if (this.totalDocs === 0) {
      this.avgDocLength = 0;
      return;
    }
    this.avgDocLength = this.totalTokens / this.totalDocs;
  }

  /**
   * Recalculate average document length incrementally
   * More efficient for single additions/removals
   */
  private recalculateAvgDocLengthIncremental(): void {
    if (this.totalDocs === 0) {
      this.avgDocLength = 0;
      return;
    }
    this.avgDocLength = this.totalTokens / this.totalDocs;
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
    this.totalTokens = 0;
  }

  /**
   * Get the number of documents in the index
   */
  get size(): number {
    return this.totalDocs;
  }

  /**
   * Check if a tool is indexed
   */
  has(idString: ToolIdString): boolean {
    return this.documents.has(idString);
  }

  /**
   * Get index statistics
   */
  getStats(): { docCount: number; termCount: number; avgDocLength: number } {
    return {
      docCount: this.totalDocs,
      termCount: this.docFreqs.size,
      avgDocLength: this.avgDocLength,
    };
  }
}
