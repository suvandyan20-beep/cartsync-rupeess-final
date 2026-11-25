import type { Product } from '../types.ts';

export interface RankedProduct {
  product: Product;
  score: number;
  matchHint: string | null;
}

export interface ParsedSearchQuery {
  cleanedText: string;
  tokens: string[];
  maxPrice: number | null;
  minPrice: number | null;
}

const CONVERSATIONAL_STOP_WORDS = new Set([
  'show',
  'me',
  'find',
  'search',
  'look',
  'looking',
  'want',
  'need',
  'buy',
  'get',
  'give',
  'please',
  'some',
  'any',
  'all',
  'the',
  'for',
  'with',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'an',
  'a',
  'i',
  'is',
  'are',
  'do',
  'you',
  'have',
  'can',
  'could',
  'would',
  'like',
  'products',
  'product',
  'items',
  'item',
  'things',
  'thing',
  'stuff',
  'options',
  'option',
  'deals',
  'deal',
  'rupees',
  'rupee',
  'rs',
  'inr',
  'bucks',
  'price',
  'priced',
  'cost',
  'costing',
  'costs',
  'only',
  'that',
  'which',
]);

const INVARIANT_PLURALS = new Set([
  'jeans',
  'sunglasses',
  'electronics',
  'optics',
  'acoustics',
  'glasses',
]);

// Strictly scoped synonyms so searches only match genuinely equivalent product types
const TOKEN_SYNONYMS: Record<string, string[]> = {
  earphone: ['headphones'],
  earphones: ['headphones'],
  earbud: ['headphones'],
  earbuds: ['headphones'],
  headset: ['headphones'],
  headsets: ['headphones'],
  tshirt: ['t-shirt'],
  tshirts: ['t-shirt'],
  tee: ['t-shirt'],
  tees: ['t-shirt'],
  phone: ['mobiles'],
  phones: ['mobiles'],
  smartphone: ['mobiles'],
  smartphones: ['mobiles'],
  notebook: ['laptop'],
  notebooks: ['laptop'],
  rucksack: ['backpack'],
  rucksacks: ['backpack'],
  bag: ['backpack', 'tote'],
  bags: ['backpack', 'tote'],
  shoe: ['sneakers'],
  shoes: ['sneakers'],
  sneaker: ['shoes'],
  sneakers: ['shoes'],
  footwear: ['shoes', 'sneakers'],
  hat: ['cap'],
  hats: ['cap'],
  glasses: ['sunglasses'],
  shades: ['sunglasses'],
  eyewear: ['sunglasses'],
  box: ['containers', 'storage'],
  boxes: ['containers', 'storage'],
  container: ['storage'],
  containers: ['storage'],
  flask: ['bottle'],
  flasks: ['bottle'],
  thermos: ['bottle'],
  coffee: ['espresso'],
  cookware: ['pot'],
  pan: ['pot'],
  pans: ['pot'],
  cleaning: ['cleaner'],
  cleanser: ['facewash'],
  sunblock: ['sunscreen'],
  skincare: ['beauty'],
  groceries: ['grocery'],
  charger: ['powerbank'],
  chargers: ['powerbank'],
};

function normalizeCompoundText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\bt[\s-]*shirts?\b/g, 't-shirt')
    .replace(/\bpower\s+banks?\b/g, 'powerbank')
    .replace(/\bface\s+wash(?:es)?\b/g, 'facewash')
    .replace(/\bsun\s+screens?\b/g, 'sunscreen')
    .replace(/\bsun\s+glasses\b/g, 'sunglasses')
    .replace(/\s+/g, ' ');
}

function singularizeToken(token: string): string {
  if (INVARIANT_PLURALS.has(token)) {
    return token;
  }
  if (token.length > 4 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 4 && /(?:ches|shes|xes|zes|sses)$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

interface TokenizedField {
  compoundWords: string[];
  subWords: string[];
}

function tokenizeField(rawText: string): TokenizedField {
  const normalized = normalizeCompoundText(rawText);
  const compoundWords = normalized
    .split(/[^a-z0-9-]+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter(Boolean);

  const subWords: string[] = [];
  for (const w of compoundWords) {
    if (w.includes('-')) {
      for (const part of w.split('-')) {
        if (part) subWords.push(part);
      }
    }
  }

  return { compoundWords, subWords };
}

function matchTermInField(
  term: string,
  field: TokenizedField,
  allowPrefix: boolean
): 'exact' | 'subword' | 'prefix' | null {
  const termSingular = singularizeToken(term);

  for (const word of field.compoundWords) {
    const wordSingular = singularizeToken(word);
    if (word === term || wordSingular === termSingular) {
      return 'exact';
    }
  }

  // Match hyphenated parts (e.g. searching "shirt" matches "t-shirt", while "t-shirt" does not match "shirt")
  if (!term.includes('-')) {
    for (const part of field.subWords) {
      const partSingular = singularizeToken(part);
      if (part === term || partSingular === termSingular) {
        return 'subword';
      }
    }
  }

  if (allowPrefix) {
    for (const word of field.compoundWords) {
      if (word.startsWith(term)) {
        return 'prefix';
      }
    }
  }

  return null;
}

export function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  let working = normalizeCompoundText(rawQuery);

  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  const betweenMatch =
    /\bbetween\s*(?:₹|rs\.?|inr|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:and|to|-)\s*(?:₹|rs\.?|inr|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rupees|rs\.?|inr)?\b/i.exec(
      working
    );
  if (betweenMatch) {
    const low = Number(betweenMatch[1].replace(/,/g, ''));
    const high = Number(betweenMatch[2].replace(/,/g, ''));
    if (Number.isFinite(low) && Number.isFinite(high)) {
      minPrice = Math.min(low, high);
      maxPrice = Math.max(low, high);
      working = working.replace(betweenMatch[0], ' ').trim();
    }
  }

  const underMatch =
    /\b(?:under|below|max|within|up to|upto|less than|cheaper than)\s*(?:₹|rs\.?|inr|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rupees|rupee|rs\.?|inr)?\b/i.exec(
      working
    );
  if (underMatch) {
    maxPrice = Number(underMatch[1].replace(/,/g, ''));
    working = working.replace(underMatch[0], ' ').trim();
  }

  const overMatch =
    /\b(?:over|above|min|more than|greater than|starting at)\s*(?:₹|rs\.?|inr|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rupees|rupee|rs\.?|inr)?\b/i.exec(
      working
    );
  if (overMatch) {
    minPrice = Number(overMatch[1].replace(/,/g, ''));
    working = working.replace(overMatch[0], ' ').trim();
  }

  const splitWords = working
    .split(/[^a-z0-9-]+/)
    .map((t) => t.replace(/^-+|-+$/g, '').trim())
    .filter(Boolean);

  // Preserve a single typed character (e.g. "z" or "x") for live search-as-you-type,
  // while stripping conversational filler words in multi-word/voice queries.
  const filteredTokens =
    splitWords.length === 1 && !CONVERSATIONAL_STOP_WORDS.has(splitWords[0])
      ? splitWords
      : splitWords.length === 1 && splitWords[0].length === 1
        ? splitWords
        : splitWords.filter((t) => t.length >= 2 && !CONVERSATIONAL_STOP_WORDS.has(t));

  return {
    cleanedText: working,
    tokens: Array.from(new Set(filteredTokens)),
    maxPrice,
    minPrice,
  };
}

export function rankProductsByQuery(products: Product[], rawQuery: string): RankedProduct[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return products.map((product) => ({ product, score: 0, matchHint: null }));
  }

  const { tokens, maxPrice, minPrice } = parseSearchQuery(trimmed);

  // If the user typed non-empty characters that produced neither product tokens nor price bounds
  // (e.g. pure punctuation or only stop words), check whether price-only or stop-words-only:
  if (tokens.length === 0 && maxPrice === null && minPrice === null) {
    const hasLettersOrDigits = /[a-z0-9]/i.test(trimmed);
    const cleanedWords = normalizeCompoundText(trimmed)
      .split(/[^a-z0-9-]+/)
      .filter(Boolean);
    const onlyStopWords =
      cleanedWords.length > 0 && cleanedWords.every((w) => CONVERSATIONAL_STOP_WORDS.has(w));
    if (onlyStopWords) {
      return products.map((product) => ({ product, score: 0, matchHint: null }));
    }
    if (hasLettersOrDigits) {
      return [];
    }
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
          maxPrice !== null && minPrice !== null
            ? `₹${minPrice.toLocaleString('en-IN')} – ₹${maxPrice.toLocaleString('en-IN')}`
            : maxPrice !== null
              ? `Under ₹${maxPrice.toLocaleString('en-IN')}`
              : `Over ₹${(minPrice ?? 0).toLocaleString('en-IN')}`,
      });
      continue;
    }

    const nameField = tokenizeField(product.name);
    const catField = tokenizeField(product.category);

    let totalScore = 0;
    let matchedTokens = 0;
    let hint: string | null =
      maxPrice !== null ? `Under ₹${maxPrice.toLocaleString('en-IN')}` : null;

    for (const token of tokens) {
      const synonyms = TOKEN_SYNONYMS[token] || [];
      const candidateTerms = [token, ...synonyms];
      let bestTokenScore = 0;
      let tokenHint: string | null = null;

      for (const term of candidateTerms) {
        const isSynonym = term !== token;
        const synScale = isSynonym ? 0.85 : 1;
        const allowPrefix = !isSynonym && (token.length === 1 || !TOKEN_SYNONYMS[token]);

        const nameHit = matchTermInField(term, nameField, allowPrefix);
        if (nameHit) {
          const s = (nameHit === 'exact' ? 24 : nameHit === 'subword' ? 16 : 10) * synScale;
          if (s > bestTokenScore) {
            bestTokenScore = s;
            if (!isSynonym) {
              tokenHint = null;
            } else {
              tokenHint = `Matches ${product.category}`;
            }
          }
        }

        const catHit = matchTermInField(term, catField, allowPrefix);
        if (catHit) {
          const s = (catHit === 'exact' ? 14 : catHit === 'subword' ? 10 : 8) * synScale;
          if (s > bestTokenScore) {
            bestTokenScore = s;
            tokenHint = `Category: ${product.category}`;
          } else if (nameHit && !isSynonym) {
            // Boost when BOTH product name and category directly match (e.g. Laptop in Laptops above Laptop Backpack)
            bestTokenScore += 6;
          }
        }
      }

      if (bestTokenScore > 0) {
        matchedTokens++;
        totalScore += bestTokenScore;
        if (!hint && tokenHint) hint = tokenHint;
      }
    }

    // Require ALL meaningful query tokens to match product name or category so unrelated products never slip in
    if (matchedTokens === tokens.length) {
      ranked.push({
        product,
        score: totalScore,
        matchHint: hint,
      });
    }
  }

  return ranked.sort((a, b) => b.score - a.score);
}

export function suggestSimilarProducts(
  allProducts: Product[],
  rawQuery: string,
  activeCategory = 'All',
  limit = 3
): Product[] {
  if (allProducts.length === 0) return [];
  const { tokens, maxPrice, minPrice } = parseSearchQuery(rawQuery);
  const scored: { product: Product; score: number }[] = [];

  for (const product of allProducts) {
    let score = 0;
    const nameField = tokenizeField(product.name);
    const catField = tokenizeField(product.category);

    for (const token of tokens) {
      const terms = [token, ...(TOKEN_SYNONYMS[token] || [])];
      for (const term of terms) {
        if (
          matchTermInField(term, nameField, term === token) ||
          matchTermInField(term, catField, term === token)
        ) {
          score += term === token ? 10 : 6;
          break;
        }
      }
    }

    if (activeCategory !== 'All' && product.category === activeCategory) {
      score += 5;
    }
    if (maxPrice !== null && product.price <= maxPrice) score += 4;
    if (minPrice !== null && product.price >= minPrice) score += 2;

    if (score > 0) {
      scored.push({ product, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.product);
}

