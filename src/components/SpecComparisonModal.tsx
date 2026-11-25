import { useEffect, useState } from 'react';
import {
  X,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Star,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  FileText,
  MessageSquareQuote,
  ArrowRight,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import type { Product } from '../types.ts';

interface SpecComparisonModalProps {
  product: Product | null;
  onClose: () => void;
  onViewFullProduct?: (productId: string) => void;
  onRunAiAudit?: (productId: string) => Promise<void>;
}

export function SpecComparisonModal({
  product,
  onClose,
  onViewFullProduct,
  onRunAiAudit,
}: SpecComparisonModalProps) {
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSuccess, setAuditSuccess] = useState<string | null>(null);

  useEffect(() => {
    setAuditError(null);
    setAuditSuccess(null);
  }, [product?.id]);

  useEffect(() => {
    if (!product) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [product, onClose]);

  if (!product) return null;

  const discrepancies = product.insights?.discrepancies || [];
  const pros = product.insights?.pros || [];
  const cons = product.insights?.cons || [];
  const trustedReviews = product.reviews.filter((r) => r.aiTrustFlag === 'trusted');

  async function handleRunAudit() {
    if (!product || !onRunAiAudit) return;
    setAuditing(true);
    setAuditError(null);
    setAuditSuccess(null);
    try {
      await onRunAiAudit(product.id);
      setAuditSuccess('Comparison refreshed with latest Gemini audit.');
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Unable to refresh comparison audit.');
    } finally {
      setAuditing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#24152F]/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="spec-comparison-title"
    >
      <div className="bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl w-full max-w-4xl shadow-card-lg overflow-hidden flex flex-col max-h-[90vh] animate-fade-in">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#24152F] text-[#FFFFFF] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <ProductImage
              src={product.imageUrl}
              alt={product.name}
              className="w-12 h-12 rounded-xl border-2 border-[#FF783D] shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#BBA5D5] truncate">
                <span>{product.category}</span>
                <span aria-hidden="true"> · </span>
                <span>{product.brand}</span>
                <span aria-hidden="true"> · </span>
                <span className="font-extrabold text-[#D9F36A]">Description vs. Reviews</span>
              </div>
              <h2
                id="spec-comparison-title"
                className="font-display text-xl font-extrabold text-[#FFFFFF] truncate"
              >
                {product.name}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#FFFFFF] hover:bg-[#352145] rounded-xl transition-colors shrink-0 cursor-pointer"
            aria-label="Close comparison popup"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Scrollable Comparison Body */}
        <div className="p-6 overflow-y-auto space-y-6 bg-[#FFF8F0]">
          {/* Headline Summary Banner */}
          <div className="p-5 rounded-2xl border-2 border-[#E6D8CB] bg-[#FFFFFF] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-card">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-extrabold">
                {discrepancies.length > 0 ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-[#FF783D] shrink-0" strokeWidth={2} />
                    <span className="text-[#24152F]">
                      {discrepancies.length} {discrepancies.length === 1 ? 'difference' : 'differences'} found between description & verified reviews
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 text-[#24152F] shrink-0" strokeWidth={2} />
                    <span className="text-[#24152F]">
                      Verified reviews match the seller’s product description
                    </span>
                  </>
                )}
              </div>
              <p className="text-sm text-[#5E5468] leading-relaxed">
                {product.insights?.summaryHeadline ||
                  'Verified customer experiences compared directly against advertised claims.'}
              </p>
            </div>

            <div className="shrink-0 sm:text-right border-t sm:border-t-0 pt-3 sm:pt-0 border-[#E6D8CB]">
              <div className="inline-flex items-center gap-1.5 text-lg font-mono font-extrabold tabular-nums text-[#24152F]">
                <Star className="w-4 h-4 fill-[#FF783D] text-[#FF783D]" strokeWidth={1.8} />
                <span>{product.insights?.verifiedAvgRating ?? 0} / 5.0</span>
              </div>
              <div className="text-xs text-[#5E5468] tabular-nums">
                {trustedReviews.length} verified reviews
                {product.flaggedCount > 0 ? ` · ${product.flaggedCount} flagged excluded` : ''}
              </div>
            </div>
          </div>

          {auditError && (
            <div className="p-3 rounded-xl bg-[#FEE2E2] border-2 border-[#C83E4D] text-xs font-bold text-[#9E2A3B]">
              {auditError}
            </div>
          )}
          {auditSuccess && (
            <div className="p-3 rounded-xl bg-[#ECFCCB] border-2 border-[#24152F] text-xs font-bold text-[#24152F]">
              {auditSuccess}
            </div>
          )}

          {/* Side-by-Side: What the Description Says vs. What the Reviews Say */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left: Description & Advertised Specs */}
            <div className="border-2 border-[#7C5BA6] rounded-2xl p-5 bg-[#F2EBFF] space-y-4">
              <div className="flex items-center justify-between gap-2 border-b-2 border-[#C8B6E8] pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#5B3A8C] shrink-0" strokeWidth={2.2} />
                  <h3 className="text-sm font-extrabold text-[#24152F]">
                    What the Description Says
                  </h3>
                </div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#5B3A8C]">
                  Seller Claim
                </span>
              </div>

              <p className="text-sm text-[#24152F] leading-relaxed">
                {product.description}
              </p>

              <div className="space-y-2 pt-2 border-t border-[#C8B6E8]">
                <div className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-[#5B3A8C]">
                  Advertised Specifications
                </div>
                <div className="divide-y divide-[#D6C7F0]">
                  {product.specs.map((spec) => (
                    <div
                      key={spec.label}
                      className="flex items-baseline justify-between gap-3 py-2 text-xs"
                    >
                      <span className="text-[#45385A] font-medium">{spec.label}</span>
                      <span className="font-bold text-[#24152F] text-right">{spec.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: What Verified Reviews Say */}
            <div className="border-2 border-[#2A7B88] rounded-2xl p-5 bg-[#E6F6F8] space-y-4">
              <div className="flex items-center justify-between gap-2 border-b-2 border-[#A3D5DC] pb-3">
                <div className="flex items-center gap-2">
                  <MessageSquareQuote className="w-4 h-4 text-[#165D68] shrink-0" strokeWidth={2.2} />
                  <h3 className="text-sm font-extrabold text-[#24152F]">
                    What Customer Reviews Say
                  </h3>
                </div>
                {product.flaggedCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[#165D68] font-bold">
                    <ShieldAlert className="w-3.5 h-3.5 text-[#C83E4D] shrink-0" strokeWidth={2} />
                    <span>{product.flaggedCount} suspicious excluded</span>
                  </span>
                ) : (
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#165D68]">
                    Buyer Feedback
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <div className="p-4 rounded-xl border-2 border-[#24152F] bg-[#ECFCCB] text-[#24152F] space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold">
                    <ThumbsUp className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>Pros — Confirmed Positives</span>
                  </div>
                  {pros.length > 0 ? (
                    <ul className="space-y-1.5 text-xs">
                      {pros.map((pro, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="font-extrabold">+</span>
                          <span>{pro}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[#29232F]">No positive highlights summarized yet.</p>
                  )}
                </div>

                <div className="p-4 rounded-xl border-2 border-[#C83E4D] bg-[#FEE2E2] text-[#9E2A3B] space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold">
                    <ThumbsDown className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>Cons — Buyer Caveats & Complaints</span>
                  </div>
                  {cons.length > 0 ? (
                    <ul className="space-y-1.5 text-xs">
                      {cons.map((con, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="font-extrabold">−</span>
                          <span>{con}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs">
                      No recurring caveats reported by verified buyers.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Direct Point-by-Point Differences Table */}
          <div className="space-y-3">
            <h3 className="text-sm font-extrabold text-[#24152F]">
              Point-by-Point Claim vs. Review Comparison
            </h3>

            {discrepancies.length > 0 ? (
              <div className="border-2 border-[#E6D8CB] rounded-2xl overflow-hidden bg-[#FFFFFF]">
                <div className="hidden md:grid grid-cols-12 text-xs font-extrabold">
                  <div className="col-span-2 bg-[#24152F] text-[#D9F36A] px-4 py-3">Feature</div>
                  <div className="col-span-4 bg-[#5B3A8C] text-[#FFFFFF] px-4 py-3">Description Says</div>
                  <div className="col-span-4 bg-[#165D68] text-[#FFFFFF] px-4 py-3">Verified Reviews Say</div>
                  <div className="col-span-2 bg-[#24152F] text-[#D9F36A] px-4 py-3 text-right">Gap Level</div>
                </div>
                <div className="divide-y divide-[#E6D8CB]">
                  {discrepancies.map((d, idx) => (
                    <div
                      key={`${d.specName}_${idx}`}
                      className="grid grid-cols-1 md:grid-cols-12 gap-3 px-4 py-3.5 bg-[#FFFFFF] text-xs items-stretch"
                    >
                      <div className="md:col-span-2 font-extrabold text-[#24152F] flex items-center">
                        {d.specName}
                      </div>
                      <div className="md:col-span-4 p-2.5 rounded-xl bg-[#F2EBFF] border border-[#C8B6E8] text-[#24152F]">
                        <span className="md:hidden font-extrabold text-[#5B3A8C] block mb-0.5">Description:</span>
                        {d.advertisedClaim}
                      </div>
                      <div className="md:col-span-4 p-2.5 rounded-xl bg-[#E6F6F8] border border-[#A3D5DC] text-[#24152F]">
                        <span className="md:hidden font-extrabold text-[#165D68] block mb-0.5">Reviews:</span>
                        {d.verifiedFeedback}
                      </div>
                      <div className="md:col-span-2 md:text-right flex items-center md:justify-end">
                        <span
                          className={`inline-flex items-center gap-1 font-extrabold tabular-nums ${
                            d.severity === 'notable' ? 'text-[#C83E4D]' : 'text-[#FF783D]'
                          }`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                          <span>
                            {d.severity === 'notable' ? 'Notable' : 'Minor'} ({d.evidenceCount})
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl border-2 border-[#24152F] bg-[#ECFCCB] flex items-center gap-3 text-xs font-bold text-[#24152F]">
                <ShieldCheck className="w-4 h-4 shrink-0" strokeWidth={2} />
                <span>
                  Every advertised specification aligns with verified buyer feedback — no contradictions flagged.
                </span>
              </div>
            )}
          </div>

          {/* Supporting Verified Buyer Quotes */}
          {trustedReviews.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-[#24152F]">
                Verified Buyer Quotes ({trustedReviews.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trustedReviews.slice(0, 4).map((rev) => (
                  <div
                    key={rev.id}
                    className="p-4 rounded-2xl border-2 border-[#A3D5DC] bg-[#E6F6F8] space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-extrabold text-[#24152F] truncate">{rev.title}</span>
                      <span className="font-mono font-extrabold text-[#165D68] shrink-0 tabular-nums">
                        {rev.rating}.0 ★
                      </span>
                    </div>
                    <p className="text-xs text-[#24152F] leading-relaxed line-clamp-3">
                      "{rev.body}"
                    </p>
                    <div className="text-[11px] font-semibold text-[#165D68]">
                      {rev.authorName} · {rev.verifiedPurchase ? 'Verified Buyer' : 'Unverified'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t-2 border-[#E6D8CB] bg-[#FFFFFF] flex flex-wrap items-center justify-between gap-3">
          <div>
            {onRunAiAudit && (
              <button
                type="button"
                disabled={auditing}
                onClick={handleRunAudit}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#BBA5D5] hover:bg-[#D9F36A] border-2 border-[#24152F] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{auditing ? 'Refreshing Audit...' : 'Refresh Gemini Comparison'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-[#24152F] bg-[#FFFFFF] hover:bg-[#FFF8F0] border-2 border-[#24152F] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Close
            </button>
            {onViewFullProduct && (
              <button
                type="button"
                onClick={() => {
                  const id = product.id;
                  onClose();
                  onViewFullProduct(id);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Open Product Page</span>
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
