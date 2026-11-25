import type { Product } from '../types.ts';

export interface RankedProduct {
  product: Product;
  score: number;
  matchHint: string | null;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[n];
}

function tokenMatchesText(
  token: string,
  words: string[],
  rawLower: string
): 'exact' | 'prefix' | 'fuzzy' | null {
  if (rawLower.includes(token)) {
    return words.includes(token) ? 'exact' : 'prefix';
  }
  if (token.length >= 4) {
    const maxDist = token.length >= 7 ? 2 : 1;
    for (const w of words) {
      if (w.length >= 4 && editDistance(token, w) <= maxDist) {
        return 'fuzzy';
      }
    }
  }
  return null;
}

export function rankProductsByQuery(products: Product[], rawQuery: string): RankedProduct[] {
  let working = rawQuery.trim().toLowerCase();
  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  const underMatch = /\b(?:under|below|max|less than)\s*(?:₹|rs\.?|inr|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\b/i.exec(working);
  if (underMatch) {
    maxPrice = Number(underMatch[1].replace(/,/g, ''));
    working = working.replace(underMatch[0], ' ').trim();
  }
  const overMatch = /\b(?:over|above|min)\s*(?:₹|rs\.?|inr|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\b/i.exec(working);
  if (overMatch) {
    minPrice = Number(overMatch[1].replace(/,/g, ''));
    working = working.replace(overMatch[0], ' ').trim();
  }

  const tokens = working
    .split(/[^a-z0-9.+_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  if (tokens.length === 0 && maxPrice === null && minPrice === null) {
    return products.map((product) => ({ product, score: 0, matchHint: null }));
  }

  const ranked: RankedProduct[] = [];
  for (const product of products) {
    if (maxPrice !== null && product.price > maxPrice) continue;
    if (minPrice !== null && product.price < minPrice) continue;

    if (tokens.length === 0) {
      ranked.push({
        product,
        score: 10,
        matchHint:
          maxPrice !== null
            ? `Under ₹${maxPrice.toLocaleString('en-IN')}`
            : `Over ₹${(minPrice ?? 0).toLocaleString('en-IN')}`,
      });
      continue;
    }

    const nameLower = product.name.toLowerCase();
    const brandLower = product.brand.toLowerCase();
    const catLower = product.category.toLowerCase();
    const descLower = product.description.toLowerCase();
    const specsJoined = product.specs.map((s) => `${s.label} ${s.value}`).join(' ').toLowerCase();
    const prosJoined = (product.insights?.pros || []).join(' ').toLowerCase();

    const tokenize = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);
    const nameWords = tokenize(nameLower);
    const brandWords = tokenize(brandLower);
    const catWords = tokenize(catLower);
    const specWords = tokenize(specsJoined);
    const descWords = tokenize(`${descLower} ${prosJoined}`);

    let totalScore = 0;
    let matchedTokens = 0;
    let hint: string | null = null;

    for (const token of tokens) {
      let tokenScore = 0;
      const nameHit = tokenMatchesText(token, nameWords, nameLower);
      if (nameHit) {
        tokenScore += nameHit === 'exact' ? 14 : nameHit === 'prefix' ? 10 : 6;
        if (!hint && nameHit === 'fuzzy') hint = 'Close spelling match';
      }

      const catHit = tokenMatchesText(token, catWords, catLower);
      if (catHit) {
        tokenScore += catHit === 'fuzzy' ? 4 : 8;
        if (!hint) hint = `Category: ${product.category}`;
      }

      const brandHit = tokenMatchesText(token, brandWords, brandLower);
      if (brandHit) {
        tokenScore += brandHit === 'fuzzy' ? 4 : 7;
        if (!hint) hint = `Brand: ${product.brand}`;
      }

      const specHit = tokenMatchesText(token, specWords, specsJoined);
      if (specHit) {
        tokenScore += specHit === 'fuzzy' ? 3 : 6;
        if (!hint) {
          const matchedSpec = product.specs.find(
            (s) => s.label.toLowerCase().includes(token) || s.value.toLowerCase().includes(token)
          );
          if (matchedSpec) hint = `Spec: ${matchedSpec.value}`;
        }
      }

      const descHit = tokenMatchesText(token, descWords, `${descLower} ${prosJoined}`);
      if (descHit) {
        tokenScore += descHit === 'fuzzy' ? 1.5 : 3;
      }

      if (tokenScore > 0) {
        matchedTokens++;
        totalScore += tokenScore;
      }
    }

    if (
      matchedTokens === tokens.length ||
      (tokens.length > 1 && matchedTokens >= Math.ceil(tokens.length * 0.6))
    ) {
      const allMatchedBonus = matchedTokens === tokens.length ? 8 : 0;
      ranked.push({
        product,
        score: totalScore + allMatchedBonus,
        matchHint: hint,
      });
    }
  }

  return ranked.sort((a, b) => b.score - a.score);
}
