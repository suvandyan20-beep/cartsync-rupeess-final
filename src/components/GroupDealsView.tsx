import { useEffect, useState, type FormEvent } from 'react';
import {
  Users,
  CheckCircle2,
  Clock,
  ArrowRight,
  UserMinus,
  Plus,
  Share2,
  Copy,
  Check,
  PackageCheck,
  X,
  ChevronRight,
  CreditCard,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import { formatTimeRemaining } from '../utils/time.ts';
import { rankProductsByQuery } from '../utils/productSearch.ts';
import { formatINR, INDIVIDUAL_DELIVERY_FEE_INR } from '../utils/currency.ts';
import type { GroupMemberProgressStatus, Product } from '../types.ts';

interface GroupDealsViewProps {
  products: Product[];
  search?: string;
  category?: string;
  sortBy?: 'featured' | 'price_asc' | 'rating_desc' | 'price_desc' | 'popularity';
  onJoinGroupDeal: (dealId: string, quantity?: number) => Promise<void>;
  onWithdrawGroupDeal: (dealId: string) => Promise<void>;
  onCreateGroupOrder: (payload: {
    productId: string;
    quantity: number;
    targetParticipants: number;
    desiredDiscount: number;
    deadlineHours: number;
    paymentWindowHours?: number;
    title: string;
  }) => Promise<void>;
  onAddToCart: (product: Product, useGroupPrice: boolean, quantity?: number) => Promise<boolean> | void;
  onPayPendingOrder: (orderId: string) => Promise<void>;
  onResolveExpiredOrder: (
    orderId: string,
    action: 'continue_individual' | 'cancel_refund'
  ) => Promise<void>;
  onOpenCart: () => void;
  onOpenOrders: () => void;
  onSelectProduct: (productId: string) => void;
  onBackHome: () => void;
}

function getMemberBadgeClass(status: GroupMemberProgressStatus): string {
  if (status === 'Paid') {
    return 'bg-[#D9F36A] border-[#24152F] text-[#24152F]';
  }
  if (status === 'Expired') {
    return 'bg-[#C83E4D] border-[#24152F] text-[#FFFFFF]';
  }
  return 'bg-[#FFFFFF] border-[#24152F] text-[#24152F]';
}

export function GroupDealsView({
  products,
  search = '',
  category = 'All',
  sortBy = 'featured',
  onJoinGroupDeal,
  onWithdrawGroupDeal,
  onCreateGroupOrder,
  onPayPendingOrder,
  onOpenOrders,
  onSelectProduct,
  onBackHome,
}: GroupDealsViewProps) {
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'waiting' | 'pending_approval' | 'payment_open' | 'confirmed' | 'expired' | 'joined'
  >('all');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [createOpen, setCreateOpen] = useState(false);
  const [shareDealId, setShareDealId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [joinQtyMap, setJoinQtyMap] = useState<Record<string, number>>({});

  // Create group order form state
  const eligibleProducts = products.filter(
    (p) =>
      p.stock > 0 &&
      (!p.activeDeal ||
        p.activeDeal.stageLabel === 'Rejected' ||
        p.activeDeal.stageLabel === 'Expired' ||
        p.activeDeal.status === 'dissolved' ||
        p.activeDeal.status === 'completed')
  );
  const [selectedProdId, setSelectedProdId] = useState<string>(eligibleProducts[0]?.id || '');
  const [createQty, setCreateQty] = useState(1);
  const [targetParticipants, setTargetParticipants] = useState(5);
  const [desiredDiscount, setDesiredDiscount] = useState(10);
  const [deadlineHours, setDeadlineHours] = useState(72);
  const [paymentWindowHours, setPaymentWindowHours] = useState(24);
  const [customTitle, setCustomTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedProdId && eligibleProducts[0]) {
      setSelectedProdId(eligibleProducts[0].id);
    }
  }, [eligibleProducts, selectedProdId]);

  const baseDealProducts = products.filter((p) => {
    if (!p.activeDeal || p.activeDeal.status === 'dissolved' || p.activeDeal.status === 'completed') {
      return false;
    }
    const stage = p.activeDeal.stageLabel;
    if (category !== 'All' && p.category !== category) {
      return false;
    }
    if (statusFilter === 'waiting') {
      return stage === 'Waiting for Group Completion';
    }
    if (statusFilter === 'pending_approval') {
      return stage === 'Pending Seller Approval';
    }
    if (statusFilter === 'payment_open') {
      return stage === 'Approved · Awaiting Payments';
    }
    if (statusFilter === 'confirmed') {
      return stage === 'Confirmed';
    }
    if (statusFilter === 'expired') {
      return stage === 'Expired';
    }
    if (statusFilter === 'joined') {
      return Boolean(
        p.activeDeal.joinedByCurrentUser || p.activeDeal.currentUserMemberStatus === 'Expired'
      );
    }
    return true;
  });

  const searchedDeals = rankProductsByQuery(baseDealProducts, search).map((r) => r.product);
  const dealProducts =
    sortBy === 'price_asc'
      ? [...searchedDeals].sort((a, b) => a.price - b.price)
      : sortBy === 'price_desc'
        ? [...searchedDeals].sort((a, b) => b.price - a.price)
        : sortBy === 'rating_desc'
          ? [...searchedDeals].sort(
              (a, b) => (b.insights?.verifiedAvgRating || 0) - (a.insights?.verifiedAvgRating || 0)
            )
          : searchedDeals;

  async function handleJoin(dealId: string) {
    setJoiningId(dealId);
    try {
      await onJoinGroupDeal(dealId, joinQtyMap[dealId] || 1);
    } finally {
      setJoiningId(null);
    }
  }

  async function handleWithdraw(dealId: string) {
    setWithdrawingId(dealId);
    try {
      await onWithdrawGroupDeal(dealId);
    } finally {
      setWithdrawingId(null);
    }
  }

  async function handlePayOrderClick(orderId: string) {
    setBusyOrderId(orderId);
    try {
      await onPayPendingOrder(orderId);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedProdId) {
      setCreateError('Please select a product that does not already have an open pool.');
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      await onCreateGroupOrder({
        productId: selectedProdId,
        quantity: createQty,
        targetParticipants,
        desiredDiscount,
        deadlineHours,
        paymentWindowHours,
        title: customTitle.trim(),
      });
      setCreateOpen(false);
      setCustomTitle('');
      setCreateQty(1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create group order.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyInvite(dealId: string, shareCode: string, productName: string) {
    const url = `${window.location.origin}/?group=${encodeURIComponent(shareCode)}`;
    const text = `Commit with ₹0 upfront to my CartSync Group Order for ${productName}! Invite code: ${shareCode} · ${url}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard fallback ignored if blocked
    }
    setCopiedId(dealId);
    setTimeout(() => setCopiedId((prev) => (prev === dealId ? null : prev)), 2500);
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header & Create CTA */}
      <div className="space-y-4 border-b-2 border-[#E6D8CB] pb-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-[#5E5468]">
          <button type="button" onClick={onBackHome} className="hover:text-[#FF783D] cursor-pointer">
            Home
          </button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#24152F] font-bold">Group Orders</span>
        </nav>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-[#FF783D]">
              Commit Now · Pay After Group Confirmation
            </div>
            <h1 className="font-display text-3xl font-extrabold text-[#24152F] mt-1">
              Group Orders & Buying Pools
            </h1>
            <p className="text-sm text-[#5E5468] mt-1.5 max-w-2xl">
              Commit your quantity today with zero upfront charge. Once the pool hits its minimum participant threshold, the seller approves the final group price &amp; availability before individual payments open. Prices are fixed sample INR retail demo prices.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] border-2 border-[#24152F] text-xs font-extrabold cursor-pointer shrink-0 self-start whitespace-nowrap"
          >
            {createOpen ? <X className="w-4 h-4" strokeWidth={2.2} /> : <Plus className="w-4 h-4" strokeWidth={2.2} />}
            <span>{createOpen ? 'Close Creator' : 'Create Group Order'}</span>
          </button>
        </div>
      </div>

      {/* Create Group Order Form */}
      {createOpen && (
        <section className="p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-5">
          <div className="flex items-center justify-between gap-2 border-b border-[#E6D8CB] pb-3">
            <div>
              <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                Start a New Collaborative Group Order
              </h2>
              <p className="text-xs text-[#5E5468]">
                Pool starts at 1/{targetParticipants} committed with <strong>₹0 collected now</strong>. Duplicate open pools on the same product are blocked.
              </p>
            </div>
          </div>

          {eligibleProducts.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB] text-xs font-semibold text-[#5E5468]">
              Every in-stock product currently has an open or confirmed group pool. Commit to one of the pools below.
            </div>
          ) : (
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              {createError && (
                <div className="p-3 rounded-xl bg-[#C83E4D] text-[#FFFFFF] text-xs font-bold">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                    Select Product
                  </label>
                  <select
                    value={selectedProdId}
                    onChange={(e) => setSelectedProdId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs font-bold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#24152F]"
                  >
                    {eligibleProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatINR(p.price)} · {p.stock} in stock)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                    Minimum Participants
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={25}
                    value={targetParticipants}
                    onChange={(e) =>
                      setTargetParticipants(Math.max(2, Math.min(25, Number(e.target.value) || 2)))
                    }
                    className="w-full px-3.5 py-2.5 text-xs font-mono font-bold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#24152F]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                    Commitment Deadline
                  </label>
                  <select
                    value={deadlineHours}
                    onChange={(e) => setDeadlineHours(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 text-xs font-bold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#24152F]"
                  >
                    <option value={0.25}>15 Minutes (Quick Demo)</option>
                    <option value={1}>1 Hour</option>
                    <option value={24}>24 Hours (1 Day)</option>
                    <option value={48}>48 Hours (2 Days)</option>
                    <option value={72}>72 Hours (3 Days)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                <div className="md:col-span-2">
                  <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                    Group Order Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g. Weekend Neighborhood Drop"
                    className="w-full px-3.5 py-2.5 text-xs bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#24152F]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                    Your Quantity
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, eligibleProducts.find((p) => p.id === selectedProdId)?.stock || 10)}
                    value={createQty}
                    onChange={(e) => setCreateQty(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-3.5 py-2.5 text-xs font-mono font-bold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#24152F]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                    Est. Discount (%)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={25}
                    value={desiredDiscount}
                    onChange={(e) =>
                      setDesiredDiscount(Math.max(5, Math.min(25, Number(e.target.value) || 10)))
                    }
                    className="w-full px-3.5 py-2.5 text-xs font-mono font-bold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#24152F]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-[#24152F] mb-1.5">
                    Payment Window
                  </label>
                  <select
                    value={paymentWindowHours}
                    onChange={(e) => setPaymentWindowHours(Number(e.target.value))}
                    className="w-full px-3 py-2.5 text-xs font-bold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl text-[#24152F]"
                  >
                    <option value={0.25}>15 Mins</option>
                    <option value={12}>12 Hours</option>
                    <option value={24}>24 Hours</option>
                    <option value={48}>48 Hours</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-[#24152F] bg-[#FFF8F0] border-2 border-[#24152F] rounded-xl cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-6 py-2.5 text-xs font-extrabold text-[#D9F36A] bg-[#24152F] hover:bg-[#352145] rounded-xl cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  {creating ? 'Launching Pool...' : 'Launch Group Order (₹0 Due Now)'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Commit Now, Pay After Approval Flow Explainers */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="Commit Now Pay Later Workflow">
        <div className="p-5 rounded-2xl bg-[#24152F] text-[#FFFFFF] border-2 border-[#24152F] flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-[#D9F36A] text-[#24152F] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" strokeWidth={2.2} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-extrabold text-[#FFFFFF]">
                1. Commit Now · ₹0 Payment Today
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-[#D9F36A] text-[#24152F] text-[10px] font-extrabold">
                NO UPFRONT CHARGE
              </span>
            </div>
            <p className="text-xs text-[#BBA5D5] leading-relaxed">
              Select your quantity and commit to a pool. While filling, status shows &ldquo;Waiting for Group Completion&rdquo; with no payment collected. If the pool expires short, no refund is ever needed.
            </p>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#FFFFFF] text-[#29232F] border-2 border-[#24152F] flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-[#FF783D] text-[#24152F] border border-[#24152F] flex items-center justify-center shrink-0">
            <PackageCheck className="w-5 h-5" strokeWidth={2.2} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-extrabold text-[#24152F]">
                2. Seller Approves → Pay Individually
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-[#BBA5D5] text-[#24152F] text-[10px] font-extrabold">
                GUARANTEED PRICE
              </span>
            </div>
            <p className="text-xs text-[#5E5468] leading-relaxed">
              Once threshold is met, the seller approves final group price &amp; stock. Participants receive the guaranteed price, shared delivery savings, and a payment window to confirm their individual order.
            </p>
          </div>
        </div>
      </section>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'all', label: 'All Pools' },
              { id: 'waiting', label: 'Waiting for Completion' },
              { id: 'pending_approval', label: 'Pending Seller Approval' },
              { id: 'payment_open', label: 'Open for Payment' },
              { id: 'confirmed', label: 'Confirmed' },
              { id: 'expired', label: 'Expired' },
              { id: 'joined', label: 'My Groups' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3.5 py-2 text-xs font-extrabold rounded-xl border-2 transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                  : 'bg-[#FFFFFF] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="text-xs font-bold text-[#5E5468] tabular-nums">
          {dealProducts.length} {dealProducts.length === 1 ? 'group order' : 'group orders'}
        </span>
      </div>

      {/* Group Order Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {dealProducts.map((product) => {
          const deal = product.activeDeal!;
          const stage = deal.stageLabel;
          const isWaiting = stage === 'Waiting for Group Completion';
          const isPendingApproval = stage === 'Pending Seller Approval';
          const isApprovedOpen = stage === 'Approved · Awaiting Payments';
          const isConfirmed = stage === 'Confirmed';
          const isExpired = stage === 'Expired';
          const isRejected = stage === 'Rejected';
          const priceGuaranteed = Boolean(deal.priceGuaranteed && (isApprovedOpen || isConfirmed));
          const committedCount = deal.committedCount ?? deal.currentParticipants;
          const tier2Active =
            deal.tier2Min && deal.tier2Discount && committedCount >= deal.tier2Min;
          const discountPct =
            tier2Active && deal.tier2Discount ? deal.tier2Discount : deal.discountPercent;
          const estDealPrice = Math.min(
            Math.round(product.price * (1 - discountPct / 100)),
            Math.max(1, product.price - 1)
          );
          const displayDealPrice = deal.finalGroupPrice ?? estDealPrice;
          const rupeeSavings = Math.max(0, product.price - displayDealPrice);
          const progressDenominator = priceGuaranteed
            ? Math.max(1, committedCount)
            : Math.max(1, deal.minParticipants);
          const progressNumerator = priceGuaranteed ? deal.paidCount : committedCount;
          const progress = Math.min(100, Math.round((progressNumerator / progressDenominator) * 100));
          const remainingNeeded = deal.remainingConfirmedNeeded;
          const deadlineIso = isApprovedOpen && deal.paymentExpiresAt ? deal.paymentExpiresAt : deal.expiresAt;
          const timeInfo = formatTimeRemaining(deadlineIso, nowMs);
          const members = deal.members || [];
          const shareCode = deal.shareCode || `CS-${deal.id.slice(-6).toUpperCase()}`;
          const joinQty = joinQtyMap[deal.id] || 1;
          const myStatus = deal.currentUserMemberStatus;
          const myOrderId = deal.currentUserOrderId;
          const myMember = members.find((m) => m.orderId === myOrderId);
          const myTotalDue = Number(
            (displayDealPrice * (myMember?.quantity || 1) + (deal.sharedDeliveryCostPerMember ?? 0)).toFixed(2)
          );

          return (
            <div
              key={deal.id}
              className="group border-2 border-[#E6D8CB] hover:border-[#24152F] rounded-2xl overflow-hidden bg-[#FFFFFF] shadow-card flex flex-col justify-between transition-all"
            >
              <div>
                <div className="relative aspect-[4/3] bg-[#FFF8F0] overflow-hidden border-b border-[#E6D8CB]">
                  <button
                    type="button"
                    onClick={() => onSelectProduct(product.id)}
                    className="w-full h-full block cursor-pointer"
                  >
                    <ProductImage
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-full h-full group-hover:scale-105 transition-transform duration-300 ease-out"
                    />
                  </button>
                  <span
                    className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg border border-[#24152F] text-[11px] font-extrabold ${
                      priceGuaranteed
                        ? 'bg-[#D9F36A] text-[#24152F]'
                        : 'bg-[#FF783D] text-[#24152F]'
                    }`}
                  >
                    {priceGuaranteed
                      ? `Save ${formatINR(rupeeSavings)} (-${discountPct}%)`
                      : `Est. Save ${formatINR(rupeeSavings)} (-${discountPct}%)`}
                  </span>
                  <span
                    className={`absolute top-3 right-3 px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 tabular-nums border ${
                      isExpired || timeInfo.urgent
                        ? 'bg-[#C83E4D] text-[#FFFFFF] border-[#24152F]'
                        : 'bg-[#FFFFFF] text-[#24152F] border-[#24152F]'
                    }`}
                  >
                    <Clock className="w-3 h-3" strokeWidth={2} />
                    <span>
                      {isExpired
                        ? 'Expired'
                        : isApprovedOpen
                          ? `Pay: ${timeInfo.label}`
                          : timeInfo.label}
                    </span>
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider">
                      <span className="font-bold text-[#5E5468] truncate">
                        {product.category} · {product.brand}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md font-extrabold whitespace-nowrap ${
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
                        {stage}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectProduct(product.id)}
                      className="text-left font-display text-lg font-extrabold text-[#24152F] hover:text-[#FF783D] transition-colors mt-1.5 block cursor-pointer"
                    >
                      {deal.title}
                    </button>
                    <div className="text-xs font-semibold text-[#5E5468] mt-0.5">
                      {product.name} · {product.sellerName}
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xl font-mono font-extrabold tabular-nums text-[#24152F]">
                        {formatINR(displayDealPrice)}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-[#5E5468] line-through">
                        {formatINR(product.price)}
                      </span>
                      <span className="text-[11px] font-extrabold text-[#2F7D4C]">
                        Save {formatINR(rupeeSavings)}
                      </span>
                    </div>
                    <span
                      className={`text-xs font-extrabold tabular-nums ${
                        isConfirmed
                          ? 'text-[#2F7D4C]'
                          : isExpired
                            ? 'text-[#C83E4D]'
                            : isPendingApproval
                              ? 'text-[#24152F]'
                              : 'text-[#FF783D]'
                      }`}
                    >
                      {isConfirmed
                        ? 'All Confirmed'
                        : isApprovedOpen
                          ? `${deal.paidCount}/${committedCount} paid`
                          : isPendingApproval
                            ? 'Seller Reviewing'
                            : isExpired
                              ? `${committedCount}/${deal.minParticipants} committed`
                              : `${remainingNeeded} more required`}
                    </span>
                  </div>

                  {/* Waiting for Completion Callout */}
                  {isWaiting && (
                    <div className="px-3 py-2 rounded-xl bg-[#24152F] text-[#D9F36A] text-[11px] font-extrabold flex items-center justify-between gap-2">
                      <span>Waiting for Group Completion</span>
                      <span className="text-[#FFFFFF] font-semibold">No payment required yet</span>
                    </div>
                  )}

                  {isPendingApproval && (
                    <div className="px-3 py-2 rounded-xl bg-[#BBA5D5] border border-[#24152F] text-[#24152F] text-[11px] font-extrabold">
                      Threshold Reached ({committedCount}/{deal.minParticipants}) · Sent to seller for final price &amp; stock approval (no payment yet).
                    </div>
                  )}

                  {/* Live Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-[#24152F] tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                        <span>
                          {priceGuaranteed
                            ? `${deal.paidCount} / ${committedCount} individual payments`
                            : `${committedCount} / ${deal.minParticipants} confirmed participants`}
                        </span>
                      </span>
                      {deal.tier2Min && deal.tier2Discount && !priceGuaranteed && (
                        <span className="text-[#5E5468]">
                          {deal.tier2Min}+ → ~{deal.tier2Discount}%
                        </span>
                      )}
                    </div>
                    <div className="h-2.5 bg-[#E6D8CB] rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 rounded-full ${
                          isRejected || isExpired
                            ? 'bg-[#C83E4D]'
                            : isConfirmed
                              ? 'bg-[#D9F36A]'
                              : isPendingApproval
                                ? 'bg-[#BBA5D5]'
                                : 'bg-[#FF783D]'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    {/* Explicit Committed vs Paid vs Expired Breakdown */}
                    <div className="grid grid-cols-3 gap-1.5 text-[11px] font-bold tabular-nums pt-0.5">
                      <div className="px-2 py-1 rounded-lg bg-[#FFF8F0] border border-[#24152F] text-[#24152F] text-center">
                        Committed: {committedCount}
                      </div>
                      <div className="px-2 py-1 rounded-lg bg-[#D9F36A] border border-[#24152F] text-[#24152F] text-center">
                        Paid: {deal.paidCount}
                      </div>
                      <div className="px-2 py-1 rounded-lg bg-[#FFFFFF] border border-[#E6D8CB] text-[#5E5468] text-center">
                        Expired: {deal.expiredMembersCount ?? 0}
                      </div>
                    </div>
                  </div>

                  {/* Seller Approved Guaranteed Price & Deadline Callout */}
                  {priceGuaranteed && (
                    <div className="p-3 rounded-xl bg-[#D9F36A] border-2 border-[#24152F] text-[#24152F] space-y-1 text-xs">
                      <div className="font-extrabold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                        <span>Seller Approved · Final Price Guaranteed</span>
                      </div>
                      <div className="flex justify-between font-semibold tabular-nums">
                        <span>Confirmed Price:</span>
                        <span className="font-mono font-extrabold">{formatINR(displayDealPrice)}/unit</span>
                      </div>
                      {deal.sharedDeliveryCostPerMember !== null && deal.sharedDeliveryCostPerMember !== undefined && (
                        <div className="flex justify-between font-semibold tabular-nums">
                          <span>Shared Delivery:</span>
                          <span className="font-mono font-extrabold">
                            {formatINR(deal.sharedDeliveryCostPerMember)}/buyer (vs {formatINR(INDIVIDUAL_DELIVERY_FEE_INR)})
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold tabular-nums">
                        <span>Total Savings:</span>
                        <span className="font-mono font-extrabold">
                          {formatINR(deal.totalIndividualSavings ?? 0)} saved
                        </span>
                      </div>
                      {deal.paymentExpiresAt && (
                        <div className="flex justify-between font-semibold tabular-nums pt-1 border-t border-[#24152F]/20">
                          <span>Pay Before:</span>
                          <span className="font-mono font-extrabold">
                            {new Date(deal.paymentExpiresAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Participants & Share */}
                  <div className="p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB] space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-[#24152F]">
                        Participants ({members.length})
                      </span>
                      {!isExpired && !isRejected && (
                        <button
                          type="button"
                          onClick={() => setShareDealId((prev) => (prev === deal.id ? null : deal.id))}
                          className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#24152F] hover:text-[#FF783D] cursor-pointer"
                        >
                          <Share2 className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                          <span>Invite</span>
                        </button>
                      )}
                    </div>

                    {members.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {members.map((m) => (
                          <span
                            key={m.userId}
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${getMemberBadgeClass(
                              m.memberStatus
                            )}`}
                          >
                            {m.name} ({m.quantity}×) · {m.memberStatus}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#5E5468]">
                        No commitments yet — commit with ₹0 upfront to start this pool.
                      </div>
                    )}

                    {shareDealId === deal.id && (
                      <div className="pt-2 border-t border-[#E6D8CB] flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-bold text-[#24152F] truncate">
                          Code: {shareCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyInvite(deal.id, shareCode, product.name)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#24152F] text-[#D9F36A] text-[11px] font-bold cursor-pointer shrink-0 whitespace-nowrap"
                        >
                          {copiedId === deal.id ? (
                            <>
                              <Check className="w-3 h-3" strokeWidth={2.2} />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" strokeWidth={2} />
                              <span>Copy Invite</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Footer */}
              <div className="px-5 pb-5 pt-1 space-y-2">
                {isRejected ? (
                  <div className="w-full py-2.5 px-3 text-xs font-extrabold text-[#FFFFFF] bg-[#C83E4D] rounded-xl text-center">
                    Declined by Seller · No payment collected, no refund needed
                  </div>
                ) : isExpired ? (
                  <div className="p-3 rounded-xl bg-[#FFF8F0] border-2 border-[#C83E4D] text-xs font-bold text-[#9E2A3B] space-y-1">
                    <div className="flex items-center gap-1.5 font-extrabold">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Expired ({committedCount}/{deal.minParticipants} committed)
                      </span>
                    </div>
                    <p className="text-[11px] font-medium text-[#29232F]">
                      {deal.paidCount > 0
                        ? 'Payment window closed. Unpaid participations expired; paid orders remain confirmed.'
                        : 'Since no payment was collected upfront, no refund is necessary.'}
                    </p>
                  </div>
                ) : myStatus === 'Paid' ? (
                  <button
                    type="button"
                    onClick={onOpenOrders}
                    className="w-full py-2.5 px-3 text-xs font-extrabold text-[#24152F] bg-[#D9F36A] hover:bg-[#cce856] border-2 border-[#24152F] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={2} />
                    <span>
                      Order Confirmed · Paid ({deal.paidCount}/{committedCount}) · View Order
                    </span>
                  </button>
                ) : myStatus === 'Expired' ? (
                  <div className="w-full py-2.5 px-3 text-xs font-extrabold text-[#FFFFFF] bg-[#C83E4D] rounded-xl text-center">
                    Participation Expired · Payment Deadline Missed
                  </div>
                ) : myStatus === 'Committed' && priceGuaranteed && myOrderId ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={busyOrderId === myOrderId}
                      onClick={() => handlePayOrderClick(myOrderId)}
                      className="w-full py-2.5 px-3 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <CreditCard className="w-4 h-4 shrink-0" strokeWidth={2} />
                      <span>
                        {busyOrderId === myOrderId
                          ? 'Completing Payment...'
                          : `Complete Individual Payment (${formatINR(myTotalDue)})`}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={withdrawingId === deal.id}
                      onClick={() => handleWithdraw(deal.id)}
                      className="w-full py-2 px-3 text-xs font-bold text-[#C83E4D] bg-[#FFFFFF] border-2 border-[#C83E4D] rounded-xl inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <UserMinus className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>{withdrawingId === deal.id ? 'Cancelling...' : 'Withdraw & Cancel Order'}</span>
                    </button>
                  </div>
                ) : myStatus === 'Committed' ? (
                  <div className="space-y-2">
                    <div className="px-3 py-2 rounded-xl bg-[#D9F36A] border-2 border-[#24152F] text-[11px] font-extrabold text-[#24152F] text-center">
                      {isPendingApproval
                        ? 'Committed (₹0 charged) · Awaiting seller final price approval'
                        : `Committed (₹0 charged) · No payment required yet (${remainingNeeded} left)`}
                    </div>
                    <button
                      type="button"
                      disabled={withdrawingId === deal.id}
                      onClick={() => handleWithdraw(deal.id)}
                      className="w-full py-2 px-3 text-xs font-bold text-[#C83E4D] bg-[#FFFFFF] border-2 border-[#C83E4D] rounded-xl inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <UserMinus className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>{withdrawingId === deal.id ? 'Withdrawing...' : 'Withdraw Commitment'}</span>
                    </button>
                  </div>
                ) : priceGuaranteed ? (
                  <div className="w-full py-2.5 px-3 text-xs font-bold text-[#5E5468] bg-[#FFF8F0] border border-[#E6D8CB] rounded-xl text-center">
                    Pool closed for new commits · Approved payment window active
                  </div>
                ) : isPendingApproval ? (
                  <div className="w-full py-2.5 px-3 text-xs font-bold text-[#24152F] bg-[#BBA5D5] border border-[#24152F] rounded-xl text-center">
                    Threshold met · Awaiting seller approval
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Quantity for ${deal.title}`}
                      value={joinQty}
                      onChange={(e) =>
                        setJoinQtyMap((prev) => ({
                          ...prev,
                          [deal.id]: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="px-2.5 py-2.5 text-xs font-mono font-bold bg-[#FFF8F0] border-2 border-[#24152F] rounded-xl text-[#24152F]"
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}×
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={joiningId === deal.id || product.stock < joinQty}
                      onClick={() => handleJoin(deal.id)}
                      className="flex-1 py-2.5 px-4 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <span>
                        {joiningId === deal.id
                          ? 'Committing...'
                          : `Commit Now · ₹0 (${remainingNeeded} left)`}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dealProducts.length === 0 && (
        <div className="p-12 text-center border-2 border-[#E6D8CB] rounded-2xl bg-[#FFFFFF] space-y-3">
          <p className="text-sm font-semibold text-[#5E5468]">
            No group orders match this filter right now.
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="px-5 py-2.5 text-xs font-extrabold bg-[#FF783D] text-[#24152F] border-2 border-[#24152F] rounded-xl cursor-pointer whitespace-nowrap"
          >
            Create a New Group Order
          </button>
        </div>
      )}
    </div>
  );
}

