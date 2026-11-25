import { useEffect, useState } from 'react';
import {
  Star,
  Users,
  AlertTriangle,
  ShieldAlert,
  ShoppingBag,
  GitCompareArrows,
  Heart,
  Clock,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import { formatTimeRemaining } from '../utils/time.ts';
import { formatINR } from '../utils/currency.ts';
import type { Product } from '../types.ts';

interface ProductCardProps {
  product: Product;
  matchHint?: string | null;
  wishlisted?: boolean;
  onToggleWishlist?: (productId: string) => void;
  onSelectProduct: (productId: string) => void;
  onCompareProduct: (productId: string) => void;
  onAddToCart: (product: Product, useGroupPrice: boolean, quantity?: number) => void;
  badgeLabel?: string | null;
}

export function ProductCard({
  product,
  matchHint,
  wishlisted = false,
  onToggleWishlist,
  onSelectProduct,
  onCompareProduct,
  onAddToCart,
  badgeLabel,
}: ProductCardProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const deal = product.activeDeal;
  const stage = deal?.stageLabel;
  const isConfirmed = stage === 'Confirmed';
  const isApprovedOpen = stage === 'Approved · Awaiting Payments';
  const isPendingApproval = stage === 'Pending Seller Approval';
  const isRejected = stage === 'Rejected' || deal?.status === 'rejected';
  const isExpired = stage === 'Expired' || deal?.status === 'expired';
  const isDealVisible = Boolean(
    deal && !isRejected && !isExpired && deal.status !== 'dissolved' && deal.status !== 'completed'
  );
  const priceGuaranteed = Boolean(deal?.priceGuaranteed && (isApprovedOpen || isConfirmed));
  const committedCount = deal ? (deal.committedCount ?? deal.currentParticipants) : 0;
  const rawEstGroupPrice = deal
    ? Math.min(Math.round(product.price * (1 - deal.discountPercent / 100)), Math.max(1, product.price - 1))
    : product.price;
  const guaranteedPrice =
    priceGuaranteed && deal
      ? deal.finalGroupPrice ?? rawEstGroupPrice
      : product.price;
  const displayPrice = product.price;
  const groupPreviewPrice = deal
    ? deal.finalGroupPrice ?? rawEstGroupPrice
    : product.price;
  const rupeeSavings = Math.max(0, product.price - groupPreviewPrice);
  const discrepanciesCount = product.insights?.discrepancies.length || 0;
  const activeDeadlineIso = isApprovedOpen && deal?.paymentExpiresAt ? deal.paymentExpiresAt : deal?.expiresAt;
  const timeInfo = activeDeadlineIso ? formatTimeRemaining(activeDeadlineIso, nowMs) : null;
  const verifiedRating = product.insights?.verifiedAvgRating ?? 0;

  return (
    <article className="group bg-[#FFFFFF] border-2 border-[#E6D8CB] hover:border-[#24152F] rounded-2xl overflow-hidden shadow-card hover:shadow-card-lg flex flex-col justify-between transition-all duration-200">
      <div>
        {/* Product Image Container */}
        <div className="relative aspect-[4/3] bg-[#FFF8F0] overflow-hidden border-b border-[#E6D8CB]">
          <button
            type="button"
            onClick={() => onSelectProduct(product.id)}
            className="w-full h-full block cursor-pointer"
            aria-label={`View ${product.name}`}
          >
            <ProductImage
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full group-hover:scale-105 transition-transform duration-300 ease-out"
            />
          </button>

          {/* Top-Left Deal or Highlight Badge */}
          {(isDealVisible && deal) || badgeLabel ? (
            <span
              className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wide pointer-events-none border ${
                isConfirmed
                  ? 'bg-[#D9F36A] text-[#24152F] border-[#24152F]'
                  : isApprovedOpen
                    ? 'bg-[#FF783D] text-[#24152F] border-[#24152F]'
                    : isPendingApproval
                      ? 'bg-[#BBA5D5] text-[#24152F] border-[#24152F]'
                      : isDealVisible && deal
                        ? 'bg-[#FF783D] text-[#24152F] border-[#24152F]'
                        : 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
              }`}
            >
              {isDealVisible && deal
                ? isConfirmed
                  ? `Confirmed · Save ${formatINR(product.price - guaranteedPrice)}`
                  : isApprovedOpen
                    ? `Approved · Save ${formatINR(rupeeSavings)}`
                    : isPendingApproval
                      ? `Pending · Save ${formatINR(rupeeSavings)}`
                      : `Pool · Save ${formatINR(rupeeSavings)} (-${deal.discountPercent}%)`
                : badgeLabel}
            </span>
          ) : null}

          {/* Top-Right Stock Indicator or Wishlist */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <span
              className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                product.stock === 0
                  ? 'bg-[#C83E4D] text-[#FFFFFF] border-[#24152F]'
                  : product.stock <= 10
                    ? 'bg-[#D9F36A] text-[#24152F] border-[#24152F]'
                    : 'bg-[#FFFFFF] text-[#24152F] border-[#24152F]'
              }`}
            >
              {product.stock === 0 ? 'Out of Stock' : product.stock <= 10 ? `Only ${product.stock} left` : 'In Stock'}
            </span>
            {onToggleWishlist && (
              <button
                type="button"
                onClick={() => onToggleWishlist(product.id)}
                aria-label={wishlisted ? `Remove ${product.name} from saved items` : `Save ${product.name}`}
                className="w-8 h-8 rounded-lg bg-[#FFFFFF] border border-[#24152F] flex items-center justify-center text-[#24152F] hover:bg-[#FFF8F0] transition-colors cursor-pointer"
              >
                <Heart
                  className={`w-4 h-4 ${wishlisted ? 'fill-[#FF783D] text-[#FF783D]' : 'text-[#24152F]'}`}
                  strokeWidth={1.8}
                />
              </button>
            )}
          </div>
        </div>

        {/* Product Content */}
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-[#5E5468]">
            <span className="truncate">
              {product.category} · {product.brand}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#24152F] text-[#D9F36A] font-mono shrink-0">
              <Star className="w-3 h-3 fill-[#D9F36A] text-[#D9F36A]" strokeWidth={1.6} />
              <span>{verifiedRating.toFixed(1)}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => onSelectProduct(product.id)}
            className="text-left font-display text-lg font-bold text-[#24152F] group-hover:text-[#FF783D] transition-colors line-clamp-1 block cursor-pointer"
          >
            {product.name}
          </button>

          {matchHint && (
            <div className="text-[11px] font-semibold text-[#24152F] bg-[#BBA5D5] px-2.5 py-0.5 rounded-md inline-block">
              Matched: {matchHint}
            </div>
          )}

          {/* Trust & Audit Summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5E5468]">
            <span className="tabular-nums">
              {product.reviewCount} reviews · Est. {product.estimatedDeliveryDate}
            </span>
            <button
              type="button"
              onClick={() => onCompareProduct(product.id)}
              className="inline-flex items-center gap-1 font-bold text-[#24152F] hover:text-[#FF783D] underline underline-offset-2 cursor-pointer"
            >
              <GitCompareArrows className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={1.8} />
              <span>Spec Audit</span>
            </button>
          </div>

          {(discrepanciesCount > 0 || product.flaggedCount > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {discrepanciesCount > 0 && (
                <button
                  type="button"
                  onClick={() => onCompareProduct(product.id)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FFF8F0] border border-[#E6D8CB] text-[#24152F] font-semibold hover:border-[#FF783D] cursor-pointer"
                >
                  <AlertTriangle className="w-3 h-3 text-[#FF783D]" strokeWidth={1.8} />
                  <span>{discrepanciesCount} spec note</span>
                </button>
              )}
              {product.flaggedCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FFF8F0] border border-[#E6D8CB] text-[#5E5468] font-medium">
                  <ShieldAlert className="w-3 h-3 text-[#24152F]" strokeWidth={1.8} />
                  <span>{product.flaggedCount} flagged</span>
                </span>
              )}
            </div>
          )}

          {/* Price & Active Pool Progress */}
          <div className="pt-3 border-t border-[#E6D8CB] flex items-end justify-between gap-2">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-mono font-bold tabular-nums text-[#24152F]">
                  {formatINR(displayPrice)}
                </span>
              </div>
              {isDealVisible && deal && (
                <div className="text-[11px] font-semibold text-[#29232F]">
                  {priceGuaranteed ? (
                    <>
                      Approved pool:{' '}
                      <span className="font-mono font-bold text-[#2F7D4C]">
                        {formatINR(groupPreviewPrice)}
                      </span>{' '}
                      <span className="text-[#2F7D4C] font-bold">· Save {formatINR(rupeeSavings)}</span>
                    </>
                  ) : (
                    <>
                      Group: <span className="font-mono font-bold">{formatINR(groupPreviewPrice)}</span>{' '}
                      <span className="text-[#2F7D4C] font-bold">· Save {formatINR(rupeeSavings)}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {isDealVisible && deal && (
              <div className="text-right">
                <span className="inline-flex items-center gap-1 text-xs font-bold text-[#24152F] tabular-nums">
                  <Users className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={1.8} />
                  <span>
                    {priceGuaranteed
                      ? `${deal.paidCount}/${committedCount} paid`
                      : `${committedCount}/${deal.minParticipants} committed`}
                  </span>
                </span>
                {timeInfo && !timeInfo.expired && (
                  <div className="text-[11px] text-[#5E5468] flex items-center justify-end gap-1 tabular-nums">
                    <Clock className="w-3 h-3 text-[#24152F]" strokeWidth={1.7} />
                    <span>{timeInfo.label}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Card Actions */}
      <div className="px-5 pb-5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onSelectProduct(product.id)}
          className="py-2.5 px-3.5 text-xs font-bold text-[#24152F] bg-[#FFF8F0] hover:bg-[#BBA5D5] border-2 border-[#24152F] rounded-xl transition-colors whitespace-nowrap cursor-pointer"
        >
          {isDealVisible ? 'Group Pool' : 'Details'}
        </button>
        <button
          type="button"
          disabled={product.stock === 0}
          onClick={() => onAddToCart(product, false, 1)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-bold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
        >
          <ShoppingBag className="w-3.5 h-3.5" strokeWidth={2} />
          <span>{product.stock === 0 ? 'Sold Out' : 'Add to Cart'}</span>
        </button>
      </div>
    </article>
  );
}
