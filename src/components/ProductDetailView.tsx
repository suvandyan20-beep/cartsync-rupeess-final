import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Users,
  ShoppingBag,
  Sparkles,
  Star,
  ThumbsUp,
  ThumbsDown,
  GitCompareArrows,
  Clock,
  ClipboardList,
  MessageSquareText,
  UserMinus,
  Minus,
  Plus,
  Zap,
  ChevronRight,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import { formatTimeRemaining } from '../utils/time.ts';
import { formatINR, INDIVIDUAL_DELIVERY_FEE_INR } from '../utils/currency.ts';
import type { Product, User } from '../types.ts';

interface ProductDetailViewProps {
  product: Product;
  currentUser: User;
  onBack: () => void;
  onAddToCart: (product: Product, useGroupPrice: boolean, quantity?: number) => Promise<boolean> | void;
  onBuyNow: (product: Product, useGroupPrice: boolean, quantity: number) => Promise<void>;
  onJoinGroupDeal: (dealId: string, quantity?: number) => Promise<void>;
  onWithdrawGroupDeal: (dealId: string) => Promise<void>;
  onPayPendingOrder: (orderId: string) => Promise<void>;
  onResolveExpiredOrder: (
    orderId: string,
    action: 'continue_individual' | 'cancel_refund'
  ) => Promise<void>;
  onOpenCart: () => void;
  onOpenOrders: () => void;
  onRequestGroupDeal: (
    productId: string,
    targetParticipants: number,
    desiredDiscount: number,
    quantity?: number,
    deadlineHours?: number
  ) => Promise<void>;
  onSubmitReview: (
    productId: string,
    payload: { rating: number; title: string; body: string }
  ) => Promise<{ flagged: boolean }>;
  onRunAiAudit: (productId: string) => Promise<void>;
  onOpenComparison: () => void;
}

type SidePanelTab = 'group' | 'compare' | 'reviews' | 'specs';

export function ProductDetailView({
  product,
  onBack,
  onAddToCart,
  onBuyNow,
  onJoinGroupDeal,
  onWithdrawGroupDeal,
  onPayPendingOrder,
  onResolveExpiredOrder,
  onOpenCart,
  onOpenOrders,
  onRequestGroupDeal,
  onSubmitReview,
  onRunAiAudit,
  onOpenComparison,
}: ProductDetailViewProps) {
  const [activePanel, setActivePanel] = useState<SidePanelTab>('group');
  const [quantity, setQuantity] = useState(1);
  const [buyingNow, setBuyingNow] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'trusted' | 'flagged'>('all');
  const [joiningDeal, setJoiningDeal] = useState(false);
  const [withdrawingDeal, setWithdrawingDeal] = useState(false);
  const [busyOrderAction, setBusyOrderAction] = useState(false);
  const [requestingDeal, setRequestingDeal] = useState(false);
  const [targetParticipants, setTargetParticipants] = useState(5);
  const [deadlineHours, setDeadlineHours] = useState(72);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSuccess, setAuditSuccess] = useState<string | null>(null);

  // Review form state
  const [rating, setRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<{
    type: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);

  const deal = product.activeDeal;
  const stage = deal?.stageLabel;
  const isWaiting = stage === 'Waiting for Group Completion';
  const isPendingApproval = stage === 'Pending Seller Approval';
  const isApprovedOpen = stage === 'Approved · Awaiting Payments';
  const isConfirmed = stage === 'Confirmed';
  const isExpired = stage === 'Expired';
  const isRejected = stage === 'Rejected';
  const priceGuaranteed = Boolean(deal?.priceGuaranteed && (isApprovedOpen || isConfirmed));
  const committedCount = deal ? (deal.committedCount ?? deal.currentParticipants) : 0;
  const tier2Active =
    deal && deal.tier2Min && deal.tier2Discount && committedCount >= deal.tier2Min;
  const effectiveDiscount =
    deal && !isRejected && !isExpired
      ? tier2Active && deal.tier2Discount
        ? deal.tier2Discount
        : deal.discountPercent
      : 0;
  const rawPreviewPrice = Math.min(
    Math.round(product.price * (1 - effectiveDiscount / 100)),
    Math.max(1, product.price - 1)
  );
  const previewTier1Price = deal
    ? deal.finalGroupPrice ?? rawPreviewPrice
    : product.price;
  const unitPrice = product.price;

  const filteredReviews = product.reviews.filter((r) => {
    if (reviewFilter === 'trusted') return r.aiTrustFlag === 'trusted';
    if (reviewFilter === 'flagged') return r.aiTrustFlag === 'flagged_suspicious';
    return true;
  });

  const trustedCount = product.reviews.filter((r) => r.aiTrustFlag === 'trusted').length;
  const discrepanciesCount = product.insights?.discrepancies.length || 0;

  async function handleJoin() {
    if (!deal) return;
    setJoiningDeal(true);
    try {
      await onJoinGroupDeal(deal.id, quantity);
    } finally {
      setJoiningDeal(false);
    }
  }

  async function handleWithdraw() {
    if (!deal) return;
    setWithdrawingDeal(true);
    try {
      await onWithdrawGroupDeal(deal.id);
    } finally {
      setWithdrawingDeal(false);
    }
  }

  async function handleRequestDeal() {
    setRequestingDeal(true);
    try {
      await onRequestGroupDeal(product.id, targetParticipants, 10, quantity, deadlineHours);
    } finally {
      setRequestingDeal(false);
    }
  }

  async function handleBuyNowClick() {
    setBuyingNow(true);
    try {
      await onBuyNow(product, false, quantity);
    } finally {
      setBuyingNow(false);
    }
  }

  async function handleAiAudit() {
    setAuditError(null);
    setAuditSuccess(null);
    setAuditing(true);
    try {
      await onRunAiAudit(product.id);
      setAuditSuccess('Gemini trust & specification audit completed and saved.');
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Unable to run Gemini audit.');
    } finally {
      setAuditing(false);
    }
  }

  async function handleReviewSubmit(e: FormEvent) {
    e.preventDefault();
    setReviewFeedback(null);
    setSubmittingReview(true);
    try {
      const result = await onSubmitReview(product.id, {
        rating,
        title: reviewTitle,
        body: reviewBody,
      });
      setReviewTitle('');
      setReviewBody('');
      if (result.flagged) {
        setReviewFeedback({
          type: 'warn',
          text: 'Your review was posted, and CartSync flagged a suspicious pattern for buyer transparency.',
        });
      } else {
        setReviewFeedback({
          type: 'ok',
          text: 'Review published to product feedback.',
        });
      }
    } catch (err) {
      setReviewFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to submit review.',
      });
    } finally {
      setSubmittingReview(false);
    }
  }

  const sideTabs: {
    id: SidePanelTab;
    label: string;
    shortLabel: string;
    badge?: string | number | null;
    icon: typeof Users;
  }[] = [
    {
      id: 'group',
      label: 'Group Pool',
      shortLabel: 'Group',
      badge: deal ? `${deal.discountPercent}%` : null,
      icon: Users,
    },
    {
      id: 'compare',
      label: 'Spec vs. Reviews',
      shortLabel: 'Audit',
      badge: discrepanciesCount > 0 ? discrepanciesCount : null,
      icon: GitCompareArrows,
    },
    {
      id: 'reviews',
      label: 'Reviews & Trust',
      shortLabel: 'Reviews',
      badge: product.reviews.length,
      icon: MessageSquareText,
    },
    {
      id: 'specs',
      label: 'Specifications',
      shortLabel: 'Specs',
      badge: product.specs.length,
      icon: ClipboardList,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb & Back */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FFFFFF] border-2 border-[#24152F] text-xs font-bold text-[#24152F] hover:bg-[#D9F36A] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          <span>Back</span>
        </button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-[#5E5468]">
          <span>Catalog</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span>{product.category}</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#24152F] font-bold">{product.name}</span>
        </nav>
      </div>

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Left: Product Image & Purchase Card */}
        <div className="lg:col-span-6 space-y-5">
          <div className="rounded-2xl overflow-hidden border-2 border-[#24152F] bg-[#FFFFFF] shadow-card aspect-[4/3]">
            <ProductImage src={product.imageUrl} alt={product.name} className="w-full h-full" />
          </div>

          <div className="border-2 border-[#24152F] rounded-2xl p-6 bg-[#FFFFFF] shadow-card space-y-5">
            <div>
              <div className="text-[11px] uppercase tracking-widest font-extrabold text-[#FF783D]">
                {product.category} · {product.brand} · Sold by {product.sellerName}
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#24152F] mt-1.5">
                {product.name}
              </h1>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#24152F] text-[#D9F36A] font-mono font-bold tabular-nums">
                  <Star className="w-3.5 h-3.5 fill-[#D9F36A] text-[#D9F36A]" strokeWidth={1.6} />
                  <span>{(product.insights?.verifiedAvgRating ?? 0).toFixed(1)}</span>
                </span>
                <span className="text-[#5E5468] font-semibold tabular-nums">
                  {trustedCount} trusted reviews
                </span>
                {product.flaggedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-[#FFF8F0] border border-[#E6D8CB] text-[#24152F] font-bold tabular-nums">
                    {product.flaggedCount} flagged
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#F2EBFF] border-2 border-[#C8B6E8] space-y-1">
              <div className="text-[11px] uppercase tracking-wider font-extrabold text-[#5B3A8C]">
                Seller Description
              </div>
              <p className="text-sm text-[#24152F] leading-relaxed">{product.description}</p>
            </div>

            {/* Pricing & Stock */}
            <div className="pt-4 border-t border-[#E6D8CB] flex items-baseline justify-between gap-4">
              <div>
                <div className="flex items-baseline gap-2.5">
                  <span className="text-3xl font-mono font-extrabold tabular-nums text-[#24152F]">
                    {formatINR(unitPrice)}
                  </span>
                </div>
                {deal && !isRejected && !isExpired && (
                  <span className="inline-block mt-1 px-2.5 py-0.5 rounded-md bg-[#FFF8F0] border border-[#24152F] text-[#24152F] text-xs font-extrabold">
                    {priceGuaranteed
                      ? `Seller-approved pool: ${formatINR(previewTier1Price)} · Save ${formatINR(unitPrice - previewTier1Price)} (vs ${formatINR(unitPrice)})`
                      : `Est. group pool: ${formatINR(previewTier1Price)} · Save ${formatINR(unitPrice - previewTier1Price)} (-${effectiveDiscount}%) · ₹0 due to commit`}
                  </span>
                )}
                <p className="text-[11px] text-[#5E5468] mt-1.5">
                  Fixed sample INR retail demo price (not a live market feed).
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`inline-block px-2.5 py-1 rounded-lg text-xs font-extrabold tabular-nums ${
                    product.stock > 10
                      ? 'bg-[#D9F36A] text-[#24152F]'
                      : product.stock > 0
                        ? 'bg-[#FF783D] text-[#24152F]'
                        : 'bg-[#C83E4D] text-[#FFFFFF]'
                  }`}
                >
                  {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                </span>
                <span className="block text-xs text-[#5E5468] font-medium mt-1.5">
                  Est. delivery {product.estimatedDeliveryDate} ({product.deliveryDays}d)
                </span>
              </div>
            </div>

            {/* Quantity Selection + Add to Cart & Buy Now */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB]">
                <span className="text-xs font-extrabold text-[#24152F]">Quantity</span>
                <div className="inline-flex items-center bg-[#FFFFFF] border-2 border-[#24152F] rounded-xl">
                  <button
                    type="button"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    aria-label="Decrease quantity"
                    className="p-2 text-[#24152F] hover:bg-[#BBA5D5] rounded-l-lg disabled:opacity-40 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" strokeWidth={2.2} />
                  </button>
                  <span className="px-4 text-sm font-mono font-extrabold text-[#24152F] tabular-nums">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    disabled={quantity >= Math.max(1, product.stock)}
                    onClick={() => setQuantity((q) => Math.min(Math.max(1, product.stock), q + 1))}
                    aria-label="Increase quantity"
                    className="p-2 text-[#24152F] hover:bg-[#BBA5D5] rounded-r-lg disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={product.stock === 0}
                  onClick={() => onAddToCart(product, false, quantity)}
                  className="inline-flex items-center justify-center gap-2 py-3.5 px-4 text-sm font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <ShoppingBag className="w-4 h-4" strokeWidth={2.2} />
                  <span>Add to Cart · {formatINR(unitPrice * quantity)}</span>
                </button>

                <button
                  type="button"
                  disabled={product.stock === 0 || buyingNow}
                  onClick={handleBuyNowClick}
                  className="inline-flex items-center justify-center gap-2 py-3.5 px-4 text-sm font-extrabold text-[#D9F36A] bg-[#24152F] hover:bg-[#352145] border-2 border-[#24152F] rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Zap className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
                  <span>{buyingNow ? 'Opening Cart...' : 'Buy Now (Retail)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Sticky Side Info Panel + Icon Rail */}
        <div className="lg:col-span-6 lg:sticky lg:top-32 flex flex-col sm:flex-row gap-3 items-stretch">
          <nav
            aria-label="Product tools navigation"
            className="flex sm:flex-col gap-2 bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl p-2 shadow-card shrink-0 justify-between sm:justify-start"
          >
            {sideTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activePanel === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActivePanel(tab.id)}
                  title={tab.label}
                  className={`relative flex-1 sm:flex-initial flex flex-col items-center justify-center gap-1 px-3 py-3 rounded-xl text-[11px] font-bold transition-colors cursor-pointer min-w-[68px] ${
                    isActive
                      ? 'bg-[#24152F] text-[#D9F36A]'
                      : 'text-[#29232F] hover:bg-[#FFF8F0]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${isActive ? 'text-[#FF783D]' : 'text-[#24152F]'}`}
                    strokeWidth={2}
                  />
                  <span>{tab.shortLabel}</span>
                  {tab.badge !== null && tab.badge !== undefined && (
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-extrabold tabular-nums ${
                        isActive
                          ? 'bg-[#FF783D] text-[#24152F]'
                          : 'bg-[#BBA5D5] text-[#24152F]'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Active Side Panel Content */}
          <div className="flex-1 border-2 border-[#24152F] rounded-2xl bg-[#FFFFFF] shadow-card p-5 sm:p-6 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto space-y-5">
            {/* PANEL 1: COLLABORATIVE GROUP BUYING */}
            {activePanel === 'group' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E6D8CB]">
                  <div>
                    <div className="text-[11px] uppercase tracking-widest font-extrabold text-[#FF783D]">
                      Commit Now · Pay After Approval
                    </div>
                    <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                      Collaborative Group Buying
                    </h2>
                  </div>
                  {deal && (
                    <span
                      className={`px-2.5 py-1 rounded-lg text-xs font-extrabold tabular-nums whitespace-nowrap ${
                        isRejected || isExpired
                          ? 'bg-[#C83E4D] text-[#FFFFFF]'
                          : isConfirmed
                            ? 'bg-[#D9F36A] text-[#24152F]'
                            : isApprovedOpen
                              ? 'bg-[#FF783D] text-[#24152F]'
                              : isPendingApproval
                                ? 'bg-[#BBA5D5] text-[#24152F]'
                                : 'bg-[#FFF8F0] border border-[#24152F] text-[#24152F]'
                      }`}
                    >
                      {deal.stageLabel}
                    </span>
                  )}
                </div>

                {deal && !isExpired && !isRejected ? (
                  <div className="p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#E6D8CB] space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-base font-extrabold text-[#24152F] block">
                          {deal.title}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-[#5E5468] mt-1 tabular-nums">
                          <Clock className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                          <span>
                            {isApprovedOpen && deal.paymentExpiresAt
                              ? `Payment deadline: ${formatTimeRemaining(deal.paymentExpiresAt).label}`
                              : `Pool deadline: ${formatTimeRemaining(deal.expiresAt).label}`}
                          </span>
                        </span>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-[#FF783D] text-[#24152F] text-xs font-mono font-extrabold tabular-nums shrink-0">
                        {priceGuaranteed
                          ? `Confirmed ${formatINR(previewTier1Price)} (Save ${formatINR(unitPrice - previewTier1Price)})`
                          : `Save ${formatINR(unitPrice - previewTier1Price)} (-${effectiveDiscount}% · ${formatINR(previewTier1Price)})`}
                      </span>
                    </div>

                    {isWaiting && (
                      <div className="p-3 rounded-xl bg-[#24152F] text-[#FFFFFF] text-xs space-y-1">
                        <div className="font-extrabold text-[#D9F36A]">
                          Waiting for Group Completion · No payment required yet
                        </div>
                        <p className="text-[#BBA5D5] leading-relaxed">
                          Commit with your quantity ({quantity}×) at ₹0 upfront. Once {deal.minParticipants} participants commit, the seller confirms the final group price &amp; stock before any payment is requested.
                        </p>
                      </div>
                    )}

                    {isPendingApproval && (
                      <div className="p-3 rounded-xl bg-[#BBA5D5] border-2 border-[#24152F] text-[#24152F] text-xs space-y-1">
                        <div className="font-extrabold">
                          Threshold Reached ({committedCount}/{deal.minParticipants}) · Pending Seller Approval
                        </div>
                        <p className="font-medium">
                          No payment required yet. The seller is reviewing stock and confirming the final guaranteed group price.
                        </p>
                      </div>
                    )}

                    <div>
                      <div className="flex justify-between text-xs font-bold text-[#29232F] mb-1.5 tabular-nums">
                        <span>
                          {priceGuaranteed
                            ? `${deal.paidCount} / ${committedCount} committed participants paid`
                            : `${committedCount} / ${deal.minParticipants} confirmed participants`}
                        </span>
                        <span className="text-[#FF783D]">
                          {isWaiting
                            ? `${deal.remainingConfirmedNeeded} more participant${deal.remainingConfirmedNeeded === 1 ? '' : 's'} required`
                            : isPendingApproval
                              ? 'Awaiting Seller'
                              : isConfirmed
                                ? 'All Payments Complete'
                                : `${Math.max(0, committedCount - deal.paidCount)} payment(s) pending`}
                        </span>
                      </div>
                      <div className="h-3 bg-[#E6D8CB] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 rounded-full ${
                            isConfirmed ? 'bg-[#D9F36A]' : isPendingApproval ? 'bg-[#BBA5D5]' : 'bg-[#FF783D]'
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                ((priceGuaranteed ? deal.paidCount : committedCount) /
                                  Math.max(1, priceGuaranteed ? committedCount : deal.minParticipants)) *
                                  100
                              )
                            )}%`,
                          }}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 text-[11px] font-bold tabular-nums mt-2.5">
                        <div className="px-2 py-1 rounded-lg bg-[#FFFFFF] border border-[#24152F] text-[#24152F] text-center">
                          Committed: {committedCount}
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-[#D9F36A] border border-[#24152F] text-[#24152F] text-center">
                          Paid: {deal.paidCount}
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-[#FFF8F0] border border-[#E6D8CB] text-[#5E5468] text-center">
                          Expired: {deal.expiredMembersCount ?? 0}
                        </div>
                      </div>
                    </div>

                    {priceGuaranteed && (
                      <div className="p-3.5 rounded-xl bg-[#D9F36A] border-2 border-[#24152F] text-[#24152F] text-xs space-y-1.5">
                        <div className="font-extrabold">
                          Seller Approved · Confirmed Group Price Guaranteed
                        </div>
                        <div className="flex justify-between">
                          <span>Confirmed group price:</span>
                          <strong className="font-mono">{formatINR(previewTier1Price)} / unit</strong>
                        </div>
                        {deal.sharedDeliveryCostPerMember !== null && deal.sharedDeliveryCostPerMember !== undefined && (
                          <>
                            <div className="flex justify-between">
                              <span>Shared delivery split:</span>
                              <strong className="font-mono">
                                {formatINR(deal.sharedDeliveryCostPerMember)}/buyer (vs {formatINR(INDIVIDUAL_DELIVERY_FEE_INR)})
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span>Group vs. Normal order (1 unit):</span>
                              <strong className="font-mono">
                                {formatINR(previewTier1Price + deal.sharedDeliveryCostPerMember)} vs {formatINR(unitPrice + INDIVIDUAL_DELIVERY_FEE_INR)}
                              </strong>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between">
                          <span>Total individual savings:</span>
                          <strong className="font-mono">
                            {formatINR(deal.totalIndividualSavings ?? 0)}
                          </strong>
                        </div>
                        {deal.paymentExpiresAt && (
                          <div className="flex justify-between pt-1 border-t border-[#24152F]/20">
                            <span>Payment deadline:</span>
                            <strong className="font-mono">
                              {new Date(deal.paymentExpiresAt).toLocaleString()}
                            </strong>
                          </div>
                        )}
                      </div>
                    )}

                    {deal.members && deal.members.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#5E5468]">
                          Pool Participants ({deal.members.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {deal.members.map((m) => (
                            <span
                              key={m.userId}
                              className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${
                                m.memberStatus === 'Paid'
                                  ? 'bg-[#D9F36A] border-[#24152F] text-[#24152F]'
                                  : m.memberStatus === 'Expired'
                                    ? 'bg-[#C83E4D] border-[#24152F] text-[#FFFFFF]'
                                    : 'bg-[#FFFFFF] border-[#24152F] text-[#24152F]'
                              }`}
                            >
                              {m.name} ({m.quantity}×) · {m.memberStatus}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {deal.currentUserMemberStatus === 'Paid' ? (
                      <button
                        type="button"
                        onClick={onOpenOrders}
                        className="w-full py-2.5 px-3 text-xs font-extrabold text-[#24152F] bg-[#D9F36A] border-2 border-[#24152F] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                        <span>
                          Order Confirmed · Payment Complete ({deal.paidCount}/{committedCount})
                        </span>
                      </button>
                    ) : deal.currentUserMemberStatus === 'Expired' ? (
                      <div className="p-3 rounded-xl bg-[#C83E4D] text-[#FFFFFF] text-xs font-bold">
                        Your participation expired because payment was not completed before the payment deadline.
                      </div>
                    ) : deal.currentUserMemberStatus === 'Committed' && priceGuaranteed && deal.currentUserOrderId ? (
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={busyOrderAction}
                          onClick={async () => {
                            setBusyOrderAction(true);
                            try {
                              await onPayPendingOrder(deal.currentUserOrderId!);
                            } finally {
                              setBusyOrderAction(false);
                            }
                          }}
                          className="w-full py-3 px-3 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          {busyOrderAction
                            ? 'Completing Payment...'
                            : `Complete Individual Payment (${formatINR(
                                previewTier1Price *
                                  (deal.members?.find((m) => m.orderId === deal.currentUserOrderId)
                                    ?.quantity || 1) +
                                  (deal.sharedDeliveryCostPerMember ?? 0)
                              )})`}
                        </button>
                        <button
                          type="button"
                          disabled={withdrawingDeal}
                          onClick={handleWithdraw}
                          className="w-full py-2 px-3 text-xs font-bold text-[#C83E4D] bg-[#FFFFFF] hover:bg-[#FFF8F0] border-2 border-[#C83E4D] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <UserMinus className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>{withdrawingDeal ? 'Leaving...' : 'Withdraw & Cancel Order'}</span>
                        </button>
                      </div>
                    ) : deal.currentUserMemberStatus === 'Committed' ? (
                      <div className="space-y-2.5">
                        <div className="text-xs text-[#24152F] bg-[#D9F36A] border-2 border-[#24152F] rounded-xl px-3.5 py-2.5 font-bold">
                          {isPendingApproval
                            ? 'Committed (₹0 charged) · Waiting for seller final price & availability approval.'
                            : `Committed (₹0 charged) · Waiting for ${deal.remainingConfirmedNeeded} more participant${deal.remainingConfirmedNeeded === 1 ? '' : 's'}. No payment required yet.`}
                        </div>
                        <button
                          type="button"
                          disabled={withdrawingDeal}
                          onClick={handleWithdraw}
                          className="w-full py-2.5 px-3 text-xs font-bold text-[#C83E4D] bg-[#FFFFFF] border-2 border-[#C83E4D] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <UserMinus className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>{withdrawingDeal ? 'Leaving...' : 'Withdraw Commitment'}</span>
                        </button>
                      </div>
                    ) : priceGuaranteed ? (
                      <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E6D8CB] text-xs font-semibold text-[#5E5468]">
                        This group has already received seller approval and is currently in its individual payment window.
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={joiningDeal || product.stock < quantity}
                        onClick={handleJoin}
                        className="w-full py-3 px-4 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {joiningDeal
                          ? 'Recording Commitment...'
                          : `Commit Now for ${quantity}× (₹0 Due Today · ${committedCount}/${deal.minParticipants})`}
                      </button>
                    )}
                  </div>
                ) : deal && isExpired ? (
                  <div className="p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#C83E4D] space-y-2">
                    <div className="text-xs font-extrabold text-[#C83E4D]">
                      Previous pool expired before reaching completion ({committedCount}/{deal.minParticipants} committed).
                    </div>
                    <p className="text-xs text-[#29232F]">
                      Since no payment was collected upfront, no refund is necessary. You can still purchase individually or launch a new group order.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#E6D8CB] space-y-3">
                    <p className="text-xs text-[#29232F] leading-relaxed">
                      No active group pool yet for this product. Launch one with a minimum participant threshold and deadline — <strong>no payment is collected until threshold &amp; seller approval</strong>.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-[#24152F] mb-1">
                          Min Participants
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={25}
                          value={targetParticipants}
                          onChange={(e) =>
                            setTargetParticipants(Math.max(2, Math.min(25, Number(e.target.value) || 2)))
                          }
                          className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-[#FFFFFF] border-2 border-[#24152F] rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-[#24152F] mb-1">
                          Deadline Window
                        </label>
                        <select
                          value={deadlineHours}
                          onChange={(e) => setDeadlineHours(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 text-xs font-bold bg-[#FFFFFF] border-2 border-[#24152F] rounded-lg"
                        >
                          <option value={0.25}>15 Mins</option>
                          <option value={1}>1 Hour</option>
                          <option value={24}>24 Hours</option>
                          <option value={72}>72 Hours</option>
                        </select>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={requestingDeal}
                      onClick={handleRequestDeal}
                      className="w-full py-2.5 px-3 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors cursor-pointer"
                    >
                      {requestingDeal ? 'Launching Pool...' : 'Launch Group Order (₹0 Due Today)'}
                    </button>
                  </div>
                )}

                <p className="text-xs text-[#5E5468] leading-relaxed">
                  Commit Now, Pay After Approval: joining collects ₹0 upfront. After the threshold is reached and the seller approves the final group price &amp; availability, each buyer completes payment individually before the payment deadline.
                </p>
              </div>
            )}

            {/* PANEL 2: DESCRIPTION VS. REVIEWS COMPARISON */}
            {activePanel === 'compare' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E6D8CB]">
                  <div>
                    <div className="text-[11px] uppercase tracking-widest font-extrabold text-[#FF783D]">
                      Reality Check
                    </div>
                    <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                      Description vs. Verified Reviews
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onOpenComparison}
                      className="px-3 py-1.5 text-xs font-bold text-[#24152F] bg-[#BBA5D5] hover:bg-[#a98fcb] rounded-xl cursor-pointer"
                    >
                      Pop-up View
                    </button>
                    <button
                      type="button"
                      disabled={auditing}
                      onClick={handleAiAudit}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-extrabold text-[#D9F36A] bg-[#24152F] hover:bg-[#352145] rounded-xl cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                      <span>{auditing ? 'Auditing...' : 'Gemini Audit'}</span>
                    </button>
                  </div>
                </div>

                {product.insights?.summaryHeadline && (
                  <p className="text-xs font-medium text-[#29232F] leading-relaxed">
                    {product.insights.summaryHeadline}
                  </p>
                )}

                {auditError && (
                  <div className="p-3 rounded-xl bg-[#C83E4D] text-xs font-semibold text-[#FFFFFF]">
                    {auditError}
                  </div>
                )}
                {auditSuccess && (
                  <div className="p-3 rounded-xl bg-[#D9F36A] border-2 border-[#24152F] text-xs font-bold text-[#24152F]">
                    {auditSuccess}
                  </div>
                )}

                {product.insights && product.insights.discrepancies.length > 0 ? (
                  <div className="space-y-2.5">
                    {product.insights.discrepancies.map((d, idx) => (
                      <div
                        key={`${d.specName}_${idx}`}
                        className="p-3.5 rounded-xl border-2 border-[#E6D8CB] bg-[#FFFFFF] space-y-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-[#24152F]">{d.specName}</span>
                          <span
                            className={`inline-flex items-center gap-1 font-extrabold ${
                              d.severity === 'notable' ? 'text-[#C83E4D]' : 'text-[#FF783D]'
                            }`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
                            <span>
                              {d.severity === 'notable' ? 'Notable gap' : 'Minor note'} ({d.evidenceCount})
                            </span>
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div className="p-2.5 rounded-xl bg-[#F2EBFF] border border-[#C8B6E8] text-[#24152F]">
                            <strong className="block text-[11px] uppercase tracking-wider text-[#5B3A8C] mb-0.5">
                              Description Says
                            </strong>
                            <span>{d.advertisedClaim}</span>
                          </div>
                          <div className="p-2.5 rounded-xl bg-[#E6F6F8] border border-[#A3D5DC] text-[#24152F]">
                            <strong className="block text-[11px] uppercase tracking-wider text-[#165D68] mb-0.5">
                              Verified Reviews Say
                            </strong>
                            <span>{d.verifiedFeedback}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border-2 border-[#24152F] bg-[#D9F36A] flex items-center gap-2.5 text-xs font-bold text-[#24152F]">
                    <ShieldCheck className="w-4 h-4 shrink-0" strokeWidth={2} />
                    <span>
                      No discrepancies detected — verified buyer feedback aligns with advertised specifications.
                    </span>
                  </div>
                )}

                {/* Pros & Cons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3.5 rounded-xl border-2 border-[#24152F] bg-[#D9F36A] text-[#24152F] space-y-2">
                    <h3 className="text-xs font-extrabold flex items-center gap-1.5">
                      <ThumbsUp className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>Pros</span>
                    </h3>
                    <ul className="space-y-1.5 text-xs font-medium">
                      {(product.insights?.pros || []).map((pro, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="font-extrabold">+</span>
                          <span>{pro}</span>
                        </li>
                      ))}
                      {(!product.insights || product.insights.pros.length === 0) && (
                        <li>No summarized positives yet.</li>
                      )}
                    </ul>
                  </div>

                  <div className="p-3.5 rounded-xl border-2 border-[#24152F] bg-[#24152F] text-[#FFFFFF] space-y-2">
                    <h3 className="text-xs font-extrabold text-[#FF783D] flex items-center gap-1.5">
                      <ThumbsDown className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>Cons & Watchouts</span>
                    </h3>
                    <ul className="space-y-1.5 text-xs">
                      {(product.insights?.cons || []).map((con, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-[#FF783D] font-extrabold">−</span>
                          <span>{con}</span>
                        </li>
                      ))}
                      {(!product.insights || product.insights.cons.length === 0) && (
                        <li className="text-[#BBA5D5]">No recurring complaints recorded.</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* PANEL 3: REVIEWS & TRUST */}
            {activePanel === 'reviews' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E6D8CB]">
                  <div>
                    <div className="text-[11px] uppercase tracking-widest font-extrabold text-[#FF783D]">
                      Trust Screening
                    </div>
                    <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                      Reviews ({product.insights?.verifiedAvgRating ?? 0} / 5.0)
                    </h2>
                  </div>

                  <div className="inline-flex items-center gap-1">
                    {(['all', 'trusted', 'flagged'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setReviewFilter(tab)}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                          reviewFilter === tab
                            ? 'bg-[#24152F] text-[#D9F36A]'
                            : 'bg-[#FFF8F0] text-[#24152F] border border-[#E6D8CB]'
                        }`}
                      >
                        {tab === 'all'
                          ? `All (${product.reviews.length})`
                          : tab === 'trusted'
                            ? `Trusted (${trustedCount})`
                            : `Flagged (${product.flaggedCount})`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2 text-center p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB]">
                  {product.ratingBreakdown.map((row) => (
                    <div key={row.stars} className="text-[11px]">
                      <div className="font-mono font-extrabold text-[#24152F]">{row.stars}★</div>
                      <div className="text-[#5E5468] font-mono tabular-nums">{row.count}</div>
                    </div>
                  ))}
                </div>

                <div className="divide-y divide-[#A3D5DC] border-2 border-[#2A7B88] rounded-2xl overflow-hidden">
                  {filteredReviews.map((rev) => {
                    const isFlagged = rev.aiTrustFlag === 'flagged_suspicious';
                    return (
                      <article
                        key={rev.id}
                        className={`p-4 space-y-2 ${isFlagged ? 'bg-[#FFF0F2]' : 'bg-[#E6F6F8]'}`}
                      >
                        {isFlagged && (
                          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-[#C83E4D] text-[11px] text-[#FFFFFF]">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={2} />
                            <span>
                              <strong>Suspicious Pattern Flagged:</strong> {rev.aiFlagReason}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-extrabold text-[#24152F]">
                            <span className="font-mono mr-1.5 text-[#165D68]">{rev.rating}★</span>
                            {rev.title}
                          </span>
                          <span className="text-[11px] text-[#165D68] font-semibold shrink-0">
                            {rev.authorName} · {rev.verifiedPurchase ? 'Verified' : 'Unverified'}
                          </span>
                        </div>
                        <p className="text-xs text-[#24152F] leading-relaxed">{rev.body}</p>
                      </article>
                    );
                  })}
                  {filteredReviews.length === 0 && (
                    <div className="p-6 text-center text-xs text-[#165D68] bg-[#E6F6F8]">
                      No reviews match this filter.
                    </div>
                  )}
                </div>

                <form
                  onSubmit={handleReviewSubmit}
                  className="p-4 rounded-2xl border-2 border-[#E6D8CB] bg-[#FFF8F0] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-extrabold text-[#24152F]">Write a Review</h3>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRating(n)}
                          className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded-lg border cursor-pointer ${
                            rating === n
                              ? 'border-[#24152F] bg-[#24152F] text-[#D9F36A]'
                              : 'border-[#E6D8CB] bg-[#FFFFFF] text-[#24152F]'
                          }`}
                        >
                          {n}★
                        </button>
                      ))}
                    </div>
                  </div>

                  {reviewFeedback && (
                    <div
                      className={`p-2.5 rounded-xl text-[11px] font-bold border ${
                        reviewFeedback.type === 'ok'
                          ? 'bg-[#D9F36A] border-[#24152F] text-[#24152F]'
                          : reviewFeedback.type === 'warn'
                            ? 'bg-[#BBA5D5] border-[#24152F] text-[#24152F]'
                            : 'bg-[#C83E4D] border-[#24152F] text-[#FFFFFF]'
                      }`}
                    >
                      {reviewFeedback.text}
                    </div>
                  )}

                  <input
                    type="text"
                    required
                    value={reviewTitle}
                    onChange={(e) => setReviewTitle(e.target.value)}
                    placeholder="Headline (e.g. How does it compare to the specs?)"
                    className="w-full px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] text-[#29232F] rounded-xl focus:border-[#FF783D] focus:outline-none"
                  />
                  <textarea
                    required
                    rows={2}
                    value={reviewBody}
                    onChange={(e) => setReviewBody(e.target.value)}
                    placeholder="Share real build quality, sizing, or battery feedback..."
                    className="w-full px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] text-[#29232F] rounded-xl focus:border-[#FF783D] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={submittingReview}
                    className="w-full py-2.5 px-3 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {submittingReview ? 'Submitting...' : 'Submit Review'}
                  </button>
                </form>
              </div>
            )}

            {/* PANEL 4: ADVERTISED SPECIFICATIONS */}
            {activePanel === 'specs' && (
              <div className="space-y-4">
                <div className="pb-3 border-b border-[#C8B6E8]">
                  <div className="text-[11px] uppercase tracking-widest font-extrabold text-[#5B3A8C]">
                    Seller Listing Details
                  </div>
                  <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                    Advertised Technical Specifications
                  </h2>
                </div>
                <div className="p-4 rounded-2xl bg-[#F2EBFF] border-2 border-[#7C5BA6] divide-y divide-[#D6C7F0]">
                  {product.specs.map((spec) => (
                    <div
                      key={spec.label}
                      className="flex items-baseline justify-between gap-4 py-3 text-sm"
                    >
                      <span className="text-[#45385A] font-medium">{spec.label}</span>
                      <span className="font-bold text-[#24152F] text-right">{spec.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
