import { GoogleGenAI, Type } from '@google/genai';
import type { ProductSpec, Review, SpecDiscrepancy } from '../src/types.ts';

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface HeuristicCheckResult {
  aiTrustFlag: 'trusted' | 'flagged_suspicious';
  aiFlagReason: string | null;
}

const AI_GENERATIVE_PHRASES: { pattern: RegExp; label: string }[] = [
  { pattern: /\bexceeded all (?:of )?my expectations\b|\bexceeds every expectation\b/i, label: 'exceeds expectations' },
  { pattern: /\bseamlessly blends?\b|\bseamlessly integrates?\b|\bseamlessly transitions?\b/i, label: 'seamlessly blends/transitions' },
  { pattern: /\btestament to\b/i, label: 'testament to' },
  { pattern: /\bgame[- ]changer\b/i, label: 'game-changer' },
  { pattern: /\belevates? (?:my|your|any) (?:daily |everyday )?(?:routine|experience|wardrobe|ensemble|workflow|look)\b/i, label: 'elevates routine/look' },
  { pattern: /\bstrikes the perfect balance\b/i, label: 'strikes the perfect balance' },
  { pattern: /\bmeticulously (?:crafted|tailored|designed|engineered)\b/i, label: 'meticulously crafted/tailored' },
  { pattern: /\bunmatched (?:craftsmanship|quality|comfort|clarity|performance)\b/i, label: 'unmatched craftsmanship/clarity' },
  { pattern: /\bsecond to none\b/i, label: 'second to none' },
  { pattern: /\bfrom the moment i unboxed\b/i, label: 'from the moment I unboxed' },
  { pattern: /\bcannot recommend (?:this|it) enough\b/i, label: 'cannot recommend enough' },
  { pattern: /\b(?:in conclusion|in summary|furthermore|moreover)\b/i, label: 'formal LLM transition' },
  { pattern: /\btrue masterpiece\b|\btimeless elegance\b|\beffortless sophistication\b/i, label: 'brochure superlatives' },
];

/**
 * Deterministic pattern detector run immediately on new review submission
 * to flag repeated copy-paste content, AI-generated LLM templates, factually false
 * product claims, extreme all-caps hype, or unverified bursts.
 * Flags suspicious patterns for buyer awareness rather than auto-removing reviews.
 */
export function detectSuspiciousReviewPattern(
  newReview: { rating: number; title: string; body: string; verifiedPurchase: boolean },
  existingReviews: Review[],
  productContext?: { name: string; category: string; description: string; specs: ProductSpec[] }
): HeuristicCheckResult {
  const combined = `${newReview.title} ${newReview.body}`.trim();
  const normalizedNew = combined.toLowerCase().replace(/[^a-z0-9\s]/g, '');

  // 1. Check duplicate / near-duplicate text against existing reviews
  for (const rev of existingReviews) {
    const normalizedExisting = `${rev.title} ${rev.body}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '');
    if (normalizedNew.length > 20 && normalizedExisting === normalizedNew) {
      return {
        aiTrustFlag: 'flagged_suspicious',
        aiFlagReason: 'Repeated review text matches an existing submission on this product.',
      };
    }
    const wordsNew = new Set(normalizedNew.split(/\s+/).filter((w) => w.length > 3));
    const wordsOld = new Set(normalizedExisting.split(/\s+/).filter((w) => w.length > 3));
    if (wordsNew.size >= 6 && wordsOld.size >= 6) {
      let overlap = 0;
      for (const w of wordsNew) {
        if (wordsOld.has(w)) overlap++;
      }
      const jaccard = overlap / (wordsNew.size + wordsOld.size - overlap);
      if (jaccard >= 0.78) {
        return {
          aiTrustFlag: 'flagged_suspicious',
          aiFlagReason: 'High textual overlap detected with another review on this listing.',
        };
      }
    }
  }

  // 2. Check AI-generated / synthetic review phrasing
  const matchedAiLabels = AI_GENERATIVE_PHRASES
    .filter((entry) => entry.pattern.test(combined))
    .map((entry) => entry.label);

  if (
    matchedAiLabels.length >= 2 ||
    (matchedAiLabels.length >= 1 && !newReview.verifiedPurchase && combined.length >= 55)
  ) {
    return {
      aiTrustFlag: 'flagged_suspicious',
      aiFlagReason: `Potentially AI-generated pattern: uses formulaic LLM/marketing phrasing (${matchedAiLabels
        .slice(0, 3)
        .map((l) => `"${l}"`)
        .join(', ')}) lacking grounded personal usage specifics.`,
    };
  }

  // 3. Check factually false / spec-contradicting or wrong-product claims
  if (productContext) {
    const specBlob = `${productContext.name} ${productContext.category} ${productContext.description} ${productContext.specs
      .map((s) => `${s.label} ${s.value}`)
      .join(' ')}`.toLowerCase();

    const isNonElectronic = !/\b(bluetooth|wi-?fi|usb-?c|battery|led|digital|smart|sensor|pump|anc|wireless|2\.4ghz|matter)\b/i.test(
      specBlob
    );
    if (isNonElectronic) {
      const electronicClaimMatch = combined.match(
        /\b(bluetooth|wi-?fi|usb-?c|digital (?:temperature )?display|touchscreen|fingerprint scanner|charging cable|battery life|recharge)\b/i
      );
      if (electronicClaimMatch) {
        return {
          aiTrustFlag: 'flagged_suspicious',
          aiFlagReason: `Potentially false or wrong-product review: references electronic feature "${electronicClaimMatch[0]}" absent from this ${productContext.category.toLowerCase()} listing.`,
        };
      }
    }

    if (
      /\b(aluminum|leather|cowhide|titanium|ceramic)\b/i.test(specBlob) &&
      /\b(cheap plastic|faux vinyl|fake leather|cardboard)\b/i.test(combined) &&
      !newReview.verifiedPurchase
    ) {
      return {
        aiTrustFlag: 'flagged_suspicious',
        aiFlagReason:
          'Potentially false claim: contradicts the product’s advertised material specifications without verified purchase history.',
      };
    }

    if (
      /\b(magnetic(?: top)? seal|magnetic snap)\b/i.test(specBlob) &&
      /\btop zipper\b/i.test(combined) &&
      !newReview.verifiedPurchase
    ) {
      return {
        aiTrustFlag: 'flagged_suspicious',
        aiFlagReason:
          'Potentially false claim: mentions a top zipper, contradicting the advertised magnetic top closure.',
      };
    }
  }

  // 4. Check excessive uppercase / exclamation spam on unverified reviews
  const letters = combined.replace(/[^a-zA-Z]/g, '');
  const upperLetters = combined.replace(/[^A-Z]/g, '');
  const upperRatio = letters.length > 12 ? upperLetters.length / letters.length : 0;
  const exclamations = (combined.match(/!/g) || []).length;

  if (!newReview.verifiedPurchase && (upperRatio > 0.55 || exclamations >= 4)) {
    return {
      aiTrustFlag: 'flagged_suspicious',
      aiFlagReason:
        'Unverified review exhibits excessive capitalization or promotional punctuation patterns.',
    };
  }

  // 5. Check generic hype phrase without product-specific substance on unverified 5-star
  const genericHype = /\b(best ever|10\/10|buy now|five stars|highly recommend to everyone)\b/i;
  if (!newReview.verifiedPurchase && newReview.rating === 5 && genericHype.test(combined) && combined.length < 130) {
    return {
      aiTrustFlag: 'flagged_suspicious',
      aiFlagReason:
        'Short unverified 5-star review relies on generic promotional phrasing with minimal product detail.',
    };
  }

  return { aiTrustFlag: 'trusted', aiFlagReason: null };
}

export interface GeminiProductAuditResult {
  summaryHeadline: string;
  pros: string[];
  cons: string[];
  discrepancies: SpecDiscrepancy[];
  reviewFlags: {
    reviewId: string;
    aiTrustFlag: 'trusted' | 'flagged_suspicious';
    aiFlagReason: string | null;
  }[];
}

export async function runGeminiProductAudit(params: {
  productName: string;
  description: string;
  specs: ProductSpec[];
  reviews: Review[];
}): Promise<GeminiProductAuditResult> {
  const ai = getAiClient();
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not configured in the server environment. Add a valid key in Settings > Secrets to run live Gemini review & spec auditing.'
    );
  }

  const prompt = `Analyze this e-commerce product listing and its customer reviews for CartSync.

Product: ${params.productName}
Description: ${params.description}
Advertised Specifications:
${params.specs.map((s) => `- ${s.label}: ${s.value}`).join('\n')}

Customer Reviews:
${params.reviews
  .map(
    (r) =>
      `[ID: ${r.id}] Rating: ${r.rating}/5 | Verified Purchase: ${r.verifiedPurchase ? 'Yes' : 'No'} | Date: ${r.createdAt} | Author: ${r.authorName}
Title: ${r.title}
Body: ${r.body}`
  )
  .join('\n\n')}

Tasks:
1. Summarize verified positive feedback (pros, 2-4 concise bullet points) and negative feedback (cons, 1-3 concise bullet points).
2. Compare the Advertised Specifications against verified customer reviews and highlight any potential discrepancies (e.g., shorter battery life, longer setup time, smaller room coverage). Only report genuine discrepancies supported by reviews; return an empty list if specs align well.
3. Evaluate each review for suspicious patterns:
   - **AI-generated / synthetic phrasing**: overly polished LLM prose, brochure clichés ("seamlessly blends", "testament to", "game-changer", "exceeds all expectations", "in conclusion", "furthermore", "meticulously crafted"), and generic praise lacking concrete personal usage details.
   - **False or factually inconsistent claims**: claims referencing features/materials absent from the product (e.g., Bluetooth/digital displays on clothing/cookware, wrong closures/materials) or contradicting verified buyer consensus.
   - **Spam / manipulation**: repeated copy-paste wording or extreme unverified hype.
   Flag potentially suspicious, AI-generated, or false reviews as "flagged_suspicious" with a cautious, non-accusatory explanation (prefix with "Potentially AI-generated:", "Potentially false claim:", or "Suspicious pattern:"—never declare them 100% fake). Keep genuine reviews as "trusted" with null reason.
4. Provide a concise 1-sentence summaryHeadline.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are a careful, objective e-commerce trust and product specification analyst. Base findings strictly on the supplied specs and reviews.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summaryHeadline: { type: Type.STRING },
          pros: { type: Type.ARRAY, items: { type: Type.STRING } },
          cons: { type: Type.ARRAY, items: { type: Type.STRING } },
          discrepancies: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                specName: { type: Type.STRING },
                advertisedClaim: { type: Type.STRING },
                verifiedFeedback: { type: Type.STRING },
                severity: { type: Type.STRING },
                evidenceCount: { type: Type.INTEGER },
              },
              required: ['specName', 'advertisedClaim', 'verifiedFeedback', 'severity', 'evidenceCount'],
            },
          },
          reviewFlags: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                reviewId: { type: Type.STRING },
                aiTrustFlag: { type: Type.STRING },
                aiFlagReason: { type: Type.STRING, nullable: true },
              },
              required: ['reviewId', 'aiTrustFlag'],
            },
          },
        },
        required: ['summaryHeadline', 'pros', 'cons', 'discrepancies', 'reviewFlags'],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text) as GeminiProductAuditResult;

  return {
    summaryHeadline: parsed.summaryHeadline || 'Customer feedback summary updated.',
    pros: Array.isArray(parsed.pros) ? parsed.pros.slice(0, 5) : [],
    cons: Array.isArray(parsed.cons) ? parsed.cons.slice(0, 4) : [],
    discrepancies: Array.isArray(parsed.discrepancies)
      ? parsed.discrepancies.map((d) => ({
          specName: d.specName,
          advertisedClaim: d.advertisedClaim,
          verifiedFeedback: d.verifiedFeedback,
          severity: d.severity === 'notable' ? 'notable' : 'minor',
          evidenceCount: Number(d.evidenceCount) || 1,
        }))
      : [],
    reviewFlags: Array.isArray(parsed.reviewFlags)
      ? parsed.reviewFlags.map((f) => ({
          reviewId: f.reviewId,
          aiTrustFlag: f.aiTrustFlag === 'flagged_suspicious' ? 'flagged_suspicious' : 'trusted',
          aiFlagReason: f.aiTrustFlag === 'flagged_suspicious' ? f.aiFlagReason || 'Flagged for suspicious review pattern.' : null,
        }))
      : [],
  };
}

export interface GeminiCameraSearchResult {
  detectedItemSummary: string;
  searchKeywords: string[];
  matchedProductIds: string[];
  reasoning: string;
}

export async function runGeminiCameraSearch(params: {
  imageBase64: string;
  mimeType: string;
  catalogProducts: {
    id: string;
    name: string;
    brand: string;
    category: string;
    price: number;
    description: string;
    specs: ProductSpec[];
  }[];
}): Promise<GeminiCameraSearchResult> {
  const ai = getAiClient();
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not configured in the server environment. Add a valid key in Settings > Secrets to use live visual camera search.'
    );
  }

  const catalogContext = params.catalogProducts
    .map(
      (p) =>
        `- ID: ${p.id} | Name: ${p.name} | Brand: ${p.brand} | Category: ${p.category} | Price: ₹${p.price} | Description: ${p.description} | Specs: ${p.specs.map((s) => `${s.label}: ${s.value}`).join(', ')}`
    )
    .join('\n');

  const prompt = `Identify the product or item shown in this photo and match it against the CartSync catalog below.

Catalog Products:
${catalogContext}

Instructions:
1. Inspect the image closely: identify the item type, material, color, silhouette, and likely use case.
2. Provide a brief 1-line "detectedItemSummary" (e.g., "Knit athletic running sneaker" or "Stainless steel espresso machine").
3. Provide 3 to 6 relevant "searchKeywords" describing the object.
4. Select all matching or closely related product IDs from the catalog above in "matchedProductIds", ordered from best visual/category match to secondary match. If an exact item or direct category match exists in the catalog, return it first. If nothing in the catalog matches at all, return an empty array.
5. Provide a concise 1-sentence "reasoning" explaining the visual match.`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.imageBase64,
          },
        },
        { text: prompt },
      ],
      config: {
        systemInstruction:
          'You are a precise visual shopping assistant for an e-commerce store. Match only genuine catalog IDs provided in the prompt.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedItemSummary: { type: Type.STRING },
            searchKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            matchedProductIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            reasoning: { type: Type.STRING },
          },
          required: ['detectedItemSummary', 'searchKeywords', 'matchedProductIds', 'reasoning'],
        },
      },
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isTransient = rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE');
    if (isTransient) {
      await new Promise((r) => setTimeout(r, 1200));
      try {
        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [
            {
              inlineData: {
                mimeType: params.mimeType,
                data: params.imageBase64,
              },
            },
            { text: prompt },
          ],
          config: {
            systemInstruction:
              'You are a precise visual shopping assistant for an e-commerce store. Match only genuine catalog IDs provided in the prompt.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                detectedItemSummary: { type: Type.STRING },
                searchKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                matchedProductIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                reasoning: { type: Type.STRING },
              },
              required: ['detectedItemSummary', 'searchKeywords', 'matchedProductIds', 'reasoning'],
            },
          },
        });
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (retryMsg.includes('503') || retryMsg.includes('UNAVAILABLE')) {
          throw new Error(
            'Visual search AI service is temporarily experiencing high demand (503). Please try again in a moment.'
          );
        }
        throw retryErr;
      }
    } else {
      throw err;
    }
  }

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text) as Partial<GeminiCameraSearchResult>;
  const validIds = new Set(params.catalogProducts.map((p) => p.id));

  return {
    detectedItemSummary: parsed.detectedItemSummary?.trim() || 'Uploaded product image',
    searchKeywords: Array.isArray(parsed.searchKeywords)
      ? parsed.searchKeywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 6)
      : [],
    matchedProductIds: Array.isArray(parsed.matchedProductIds)
      ? Array.from(new Set(parsed.matchedProductIds.map(String).filter((id) => validIds.has(id))))
      : [],
    reasoning: parsed.reasoning?.trim() || 'Matched visually against available catalog items.',
  };
}
