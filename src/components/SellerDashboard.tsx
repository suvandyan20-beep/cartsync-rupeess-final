import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Minus,
  Package,
  Plus,
  ShieldAlert,
  CalendarClock,
  Users,
  GitCompareArrows,
  Clock,
  XCircle,
  Truck,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import { formatTimeRemaining } from '../utils/time.ts';
import { formatINR, INDIVIDUAL_DELIVERY_FEE_INR } from '../utils/currency.ts';
import type {
  AppNotification,
  GroupDeal,
  Order,
  Product,
  SellerAnalytics,
  User,
} from '../types.ts';
import type { SellerTab } from './TopBar.tsx';

interface SellerDashboardProps {
  seller: User;
  activeTab: SellerTab;
  onChangeTab: (tab: SellerTab) => void;
  products: Product[];
  deals: GroupDeal[];
  orders: Order[];
  notifications: AppNotification[];
  analytics: SellerAnalytics | null;
  onOpenAddProduct: () => void;
  onEditProduct: (product: Product) => void;
  onUpdateStock: (productId: string, nextStock: number) => Promise<void>;
  onUpdateDealSeller: (
    dealId: string,
    payload: {
      approve?: boolean;
      minParticipants?: number;
      discountPercent?: number;
      tier2Min?: number | null;
      tier2Discount?: number | null;
    }
  ) => Promise<void>;
  onApproveGroupDeal: (
    dealId: string,
    overrides?: {
      finalDiscountPercent?: number;
      finalGroupPrice?: number;
      paymentWindowHours?: number;
      title?: string;
      minParticipants?: number;
    }
  ) => Promise<void>;
  onRejectGroupDeal: (dealId: string, reason?: string) => Promise<void>;
  onExpireGroupNow: (dealId: string) => Promise<void>;
  onExpirePaymentWindowNow: (dealId: string) => Promise<void>;
  onUpdateOrderStatus: (orderId: string, status: Order['fulfillmentStatus']) => Promise<void>;
  onCompareProduct: (productId: string) => void;
}

export function SellerDashboard({
  seller,
  activeTab,
  onChangeTab,
  products,
  deals,
  orders,
  notifications,
  analytics,
  onOpenAddProduct,
  onEditProduct,
  onUpdateStock,
  onUpdateDealSeller,
  onApproveGroupDeal,
  onRejectGroupDeal,
  onExpireGroupNow,
  onExpirePaymentWindowNow,
  onUpdateOrderStatus,
  onCompareProduct,
}: SellerDashboardProps) {
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [tierDraft, setTierDraft] = useState<{
    minParticipants: string;
    discountPercent: string;
    tier2Min: string;
    tier2Discount: string;
  }>({ minParticipants: '5', discountPercent: '10', tier2Min: '10', tier2Discount: '15' });
  const [approvalDrafts, setApprovalDrafts] = useState<
    Record<string, { finalGroupPrice: string; paymentWindowHours: number }>
  >({});
  const [busyDealId, setBusyDealId] = useState<string | null>(null);
  const [rejectingDealId, setRejectingDealId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  function getApprovalDraft(d: GroupDeal) {
    if (approvalDrafts[d.id]) return approvalDrafts[d.id];
    const committed = Math.max(1, d.committedCount ?? d.currentParticipants ?? 1);
    const sharedFee = INDIVIDUAL_DELIVERY_FEE_INR / committed;
    const retail = d.productPrice || 0;
    const maxAllowedUnitPrice = Math.max(1, Math.floor(retail - sharedFee - 1));
    const calculated = Math.round(retail * (1 - d.discountPercent / 100));
    const defaultPrice = retail > 0 ? Math.max(1, Math.min(calculated, maxAllowedUnitPrice)) : 1;
    return {
      finalGroupPrice: String(defaultPrice),
      paymentWindowHours: d.paymentWindowHours || 24,
    };
  }

  function startEditDeal(deal: GroupDeal) {
    setEditingDealId(deal.id);
    setTierDraft({
      minParticipants: String(deal.minParticipants),
      discountPercent: String(deal.discountPercent),
      tier2Min: deal.tier2Min ? String(deal.tier2Min) : '',
      tier2Discount: deal.tier2Discount ? String(deal.tier2Discount) : '',
    });
  }

  async function saveDealTiers(dealId: string) {
    await onUpdateDealSeller(dealId, {
      minParticipants: Number(tierDraft.minParticipants),
      discountPercent: Number(tierDraft.discountPercent),
      tier2Min: tierDraft.tier2Min ? Number(tierDraft.tier2Min) : null,
      tier2Discount: tierDraft.tier2Discount ? Number(tierDraft.tier2Discount) : null,
    });
    setEditingDealId(null);
  }

  const pendingApprovalDeals = deals.filter((d) => d.stageLabel === 'Pending Seller Approval');
  const paymentOpenDeals = deals.filter((d) => d.stageLabel === 'Approved · Awaiting Payments');
  const waitingDealsList = deals.filter((d) => d.stageLabel === 'Waiting for Group Completion');
  const confirmedDealsList = deals.filter((d) => d.stageLabel === 'Confirmed');
  const rejectedDealsList = deals.filter((d) => d.stageLabel === 'Rejected');
  const expiredDealsList = deals.filter(
    (d) => d.stageLabel === 'Expired' || d.status === 'dissolved'
  );
  const pendingApprovalNotifs = notifications.filter(
    (n) => n.type === 'seller_group_approval_request' && n.actionStatus === 'pending'
  );
  const rescheduleNotifs = notifications.filter(
    (n) => n.type === 'delivery_reschedule_requested' && !n.isRead
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Seller Contextual Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b-2 border-[#E6D8CB] pb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] font-extrabold text-[#FF783D]">
            Seller Hub · {seller.name}
          </div>
          <h1 className="font-display text-3xl font-extrabold text-[#24152F] mt-1">
            {activeTab === 'overview' && 'Sales, Demand & Trust Overview'}
            {activeTab === 'inventory' && 'Catalog & Stock Inventory'}
            {activeTab === 'deals' && 'Group-Buying Requests & Order Approvals'}
            {activeTab === 'orders' && 'Orders, Availability & Dispatch'}
          </h1>
        </div>

        <div className="inline-flex flex-wrap items-center gap-2 self-start">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'inventory', label: `Inventory (${products.length})` },
              {
                id: 'deals',
                label: `Group Pools (${pendingApprovalDeals.length + paymentOpenDeals.length + waitingDealsList.length})`,
              },
              { id: 'orders', label: `Orders (${orders.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChangeTab(t.id)}
              className={`px-4 py-2 text-xs font-extrabold rounded-xl border-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === t.id
                  ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                  : 'bg-[#FFFFFF] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Actionable Seller Alert Strip */}
      {(pendingApprovalDeals.length > 0 || pendingApprovalNotifs.length > 0 || rescheduleNotifs.length > 0) && (
        <div className="p-4 rounded-2xl bg-[#FFEAD9] border-2 border-[#FF783D] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-card">
          <div className="space-y-1 text-xs text-[#24152F]">
            {(pendingApprovalDeals.length > 0 || pendingApprovalNotifs.length > 0) && (
              <div className="font-extrabold">
                {Math.max(pendingApprovalDeals.length, pendingApprovalNotifs.length)} group pool
                {Math.max(pendingApprovalDeals.length, pendingApprovalNotifs.length) === 1 ? '' : 's'} reached threshold and need your final price &amp; availability approval.
              </div>
            )}
            {rescheduleNotifs.length > 0 && (
              <div className="text-[#9E2A3B] font-bold">
                {rescheduleNotifs.length} customer delivery reschedule alert
                {rescheduleNotifs.length === 1 ? '' : 's'} received.
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(pendingApprovalDeals.length > 0 || pendingApprovalNotifs.length > 0) && activeTab !== 'deals' && (
              <button
                type="button"
                onClick={() => onChangeTab('deals')}
                className="px-4 py-2 text-xs font-extrabold text-[#D9F36A] bg-[#24152F] hover:bg-[#352145] rounded-xl cursor-pointer"
              >
                Approve Group Prices
              </button>
            )}
            {rescheduleNotifs.length > 0 && activeTab !== 'orders' && (
              <button
                type="button"
                onClick={() => onChangeTab('orders')}
                className="px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FFFFFF] border-2 border-[#24152F] hover:bg-[#FFF8F0] rounded-xl cursor-pointer"
              >
                View Reschedules
              </button>
            )}
          </div>
        </div>
      )}

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && analytics && (
        <div className="space-y-8">
          {/* 4-Column Tabular KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl border-2 border-[#24152F] bg-[#FFFFFF] shadow-card">
              <div className="text-xs font-bold text-[#5E5468]">Gross Revenue</div>
              <div className="text-2xl font-mono font-extrabold tabular-nums text-[#24152F] mt-1.5">
                {formatINR(analytics.totalRevenue)}
              </div>
              <div className="text-xs text-[#5E5468] mt-1 tabular-nums">
                Across {analytics.totalOrders} active & delivered orders
              </div>
            </div>

            <div className="p-5 rounded-2xl border-2 border-[#E6D8CB] bg-[#ECFCCB] shadow-card">
              <div className="text-xs font-bold text-[#24152F]">Combined Delivery Adoption</div>
              <div className="text-2xl font-mono font-extrabold tabular-nums text-[#24152F] mt-1.5">
                {analytics.combinedOrdersRate}%
              </div>
              <div className="text-xs text-[#29232F] mt-1">
                Orders consolidated into synced windows
              </div>
            </div>

            <div className="p-5 rounded-2xl border-2 border-[#E6D8CB] bg-[#F2EBFF] shadow-card">
              <div className="text-xs font-bold text-[#24152F]">Active Group Pools</div>
              <div className="text-2xl font-mono font-extrabold tabular-nums text-[#24152F] mt-1.5">
                {analytics.activeGroupDeals}
              </div>
              <div className="text-xs text-[#29232F] mt-1 tabular-nums">
                {analytics.pendingGroupRequests} pending · {analytics.lowStockProducts} low stock
              </div>
            </div>

            <div className="p-5 rounded-2xl border-2 border-[#E6D8CB] bg-[#FFFFFF] shadow-card">
              <div className="text-xs font-bold text-[#5E5468]">Verified Catalog Rating</div>
              <div className="text-2xl font-mono font-extrabold tabular-nums text-[#24152F] mt-1.5">
                {analytics.averageVerifiedRating} / 5.0
              </div>
              <div className="text-xs font-bold text-[#FF783D] mt-1 tabular-nums">
                {analytics.flaggedReviewsCount} suspicious patterns flagged
              </div>
            </div>
          </div>

          {/* Product Demand & Trust Table */}
          <div className="space-y-3">
            <h2 className="font-display text-xl font-extrabold text-[#24152F]">
              Product Demand, Inventory & Review Trust
            </h2>
            <div className="border-2 border-[#E6D8CB] rounded-2xl overflow-x-auto bg-[#FFFFFF] shadow-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-[#24152F] text-[#FFFFFF] text-xs font-extrabold">
                    <th className="text-left px-5 py-3.5 text-[#D9F36A]">Product</th>
                    <th className="text-right px-4 py-3.5">Stock</th>
                    <th className="text-right px-4 py-3.5">Units Sold</th>
                    <th className="text-right px-4 py-3.5">Revenue</th>
                    <th className="text-right px-4 py-3.5">Group Demand</th>
                    <th className="text-right px-5 py-3.5">Verified Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6D8CB]">
                  {analytics.productDemand.map((row) => (
                    <tr key={row.productId} className="hover:bg-[#FFF8F0] transition-colors">
                      <td className="px-5 py-3.5 font-bold text-[#24152F]">{row.name}</td>
                      <td
                        className={`px-4 py-3.5 text-right font-mono tabular-nums ${
                          row.stock <= 15 ? 'text-[#C83E4D] font-extrabold' : 'text-[#5E5468]'
                        }`}
                      >
                        {row.stock}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[#5E5468]">
                        {row.unitsSold}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[#24152F] font-bold">
                        {formatINR(row.revenue)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[#24152F] font-bold">
                        {row.groupParticipants} committed
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono tabular-nums text-[#24152F]">
                        {row.avgRating} ★
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Spec Discrepancies & Flagged Reviews Summary for Seller Action */}
          <div className="space-y-3">
            <h2 className="font-display text-xl font-extrabold text-[#24152F]">
              Customer Rating Insights & Spec Discrepancy Alerts
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {products.map((p) => {
                const gaps = p.insights?.discrepancies || [];
                return (
                  <div
                    key={p.id}
                    className="border-2 border-[#E6D8CB] rounded-2xl p-5 bg-[#FFFFFF] shadow-card space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-display text-base font-extrabold text-[#24152F]">{p.name}</h3>
                        <p className="text-xs text-[#5E5468] mt-0.5">{p.insights?.summaryHeadline}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-[#24152F] text-[#D9F36A] text-xs font-mono font-bold shrink-0 tabular-nums">
                        {p.insights?.verifiedAvgRating ?? 0}★
                      </span>
                    </div>

                    {gaps.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-[#E6D8CB]">
                        {gaps.map((g, i) => (
                          <div key={i} className="space-y-1.5 text-xs text-[#29232F]">
                            <div className="flex items-center gap-1.5 font-extrabold text-[#24152F]">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#FF783D]" strokeWidth={2} />
                              <span>{g.specName}</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div className="p-2 rounded-lg bg-[#F2EBFF] border border-[#C8B6E8] text-[#24152F]">
                                <strong className="text-[#5B3A8C]">Advertised:</strong> {g.advertisedClaim}
                              </div>
                              <div className="p-2 rounded-lg bg-[#E6F6F8] border border-[#A3D5DC] text-[#24152F]">
                                <strong className="text-[#165D68]">Reviews:</strong> {g.verifiedFeedback}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {p.flaggedCount > 0 && (
                      <div className="flex items-center gap-2 text-xs font-semibold text-[#5E5468] pt-1">
                        <ShieldAlert className="w-3.5 h-3.5 text-[#FF783D] shrink-0" strokeWidth={2} />
                        <span>
                          {p.flaggedCount} review(s) flagged for suspicious patterns and excluded from verified average.
                        </span>
                      </div>
                    )}

                    <div className="pt-2 border-t border-[#E6D8CB] flex justify-end">
                      <button
                        type="button"
                        onClick={() => onCompareProduct(p.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] hover:underline cursor-pointer"
                      >
                        <GitCompareArrows className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                        <span>Compare Description vs. Reviews</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* INVENTORY TAB */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#5E5468]">
              Adjust live stock counts, edit advertised specifications, or publish new catalog listings.
            </p>
            <button
              type="button"
              onClick={onOpenAddProduct}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" strokeWidth={2.2} />
              <span>Add Product</span>
            </button>
          </div>

          <div className="divide-y-2 divide-[#E6D8CB] border-2 border-[#E6D8CB] rounded-2xl overflow-hidden bg-[#FFFFFF] shadow-card">
            {products.map((p) => (
              <div
                key={p.id}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <ProductImage
                    src={p.imageUrl}
                    alt={p.name}
                    className="w-20 h-16 rounded-xl shrink-0 border-2 border-[#E6D8CB]"
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-[#5E5468]">
                      {p.category} · {p.brand}
                    </div>
                    <h3 className="font-display text-base font-extrabold text-[#24152F] truncate">{p.name}</h3>
                    <div className="text-xs text-[#5E5468] mt-0.5 font-mono font-bold tabular-nums">
                      {formatINR(p.price)} · {p.specs.length} specs listed
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#5E5468]">Stock:</span>
                    <div className="inline-flex items-center bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl">
                      <button
                        type="button"
                        onClick={() => onUpdateStock(p.id, Math.max(0, p.stock - 1))}
                        className="p-1.5 text-[#24152F] hover:bg-[#BBA5D5] rounded-l-lg transition-colors cursor-pointer"
                        aria-label="Decrease stock"
                      >
                        <Minus className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                      <span className="px-3 text-xs font-mono font-extrabold tabular-nums text-[#24152F]">
                        {p.stock}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateStock(p.id, p.stock + 1)}
                        className="p-1.5 text-[#24152F] hover:bg-[#BBA5D5] rounded-r-lg transition-colors cursor-pointer"
                        aria-label="Increase stock"
                      >
                        <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onEditProduct(p)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-extrabold text-[#24152F] bg-[#FFFFFF] hover:bg-[#BBA5D5] border-2 border-[#24152F] rounded-xl transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>Edit Listing</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* GROUP DEALS & REQUESTS TAB */}
      {activeTab === 'deals' && (
        <div className="space-y-8">
          {/* 1. Threshold Reached — Seller Final Price & Availability Approval */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                Threshold Reached — Approve Final Group Price &amp; Stock
              </h2>
              <span className="px-3 py-1 rounded-xl bg-[#FF783D] text-[#24152F] text-xs font-mono font-extrabold tabular-nums">
                {pendingApprovalDeals.length} awaiting approval
              </span>
            </div>

            {pendingApprovalDeals.length === 0 ? (
              <div className="p-6 rounded-2xl border-2 border-[#E6D8CB] bg-[#FFFFFF] text-sm text-[#5E5468]">
                No group pools are currently waiting for your final price approval. Once any pool meets its commitment threshold, it appears here automatically.
              </div>
            ) : (
              <div className="divide-y-2 divide-[#FF783D] border-2 border-[#FF783D] rounded-2xl overflow-hidden bg-[#FFFFFF] shadow-card">
                {pendingApprovalDeals.map((d) => {
                  const committedCount = d.committedCount ?? d.currentParticipants;
                  const members = (d.members || []).filter((m) => m.memberStatus !== 'Expired');
                  const totalUnits = members.reduce((sum, m) => sum + (m.quantity || 1), 0) || committedCount;
                  const linkedProduct = products.find((p) => p.id === d.productId);
                  const availableStock = linkedProduct?.stock ?? 0;
                  const stockOk = availableStock >= totalUnits;
                  const draft = getApprovalDraft(d);
                  const sharedFee = Number(
                    (INDIVIDUAL_DELIVERY_FEE_INR / Math.max(1, committedCount)).toFixed(2)
                  );
                  const retail = d.productPrice || 0;
                  const maxAllowedUnitPrice = Math.max(1, Math.floor(retail - sharedFee - 1));
                  const defaultFallback = Math.max(
                    1,
                    Math.min(Math.round(retail * (1 - d.discountPercent / 100)), maxAllowedUnitPrice)
                  );
                  const parsedFinalPrice = Math.max(
                    1,
                    Number(draft.finalGroupPrice) || defaultFallback
                  );
                  const groupPriceValid = retail === 0 || parsedFinalPrice + sharedFee < retail;
                  const totalOrderValue = Number((parsedFinalPrice * totalUnits).toFixed(2));
                  const isBusy = busyDealId === d.id;

                  return (
                    <div key={d.id} className="p-5 space-y-4 bg-[#FFEAD9]">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        <div className="flex items-start gap-4 min-w-0">
                          {d.productImage && (
                            <ProductImage
                              src={d.productImage}
                              alt={d.productName || d.title}
                              className="w-20 h-16 rounded-xl shrink-0 border-2 border-[#24152F]"
                            />
                          )}
                          <div className="space-y-1.5">
                            <div className="inline-flex flex-wrap items-center gap-2 text-xs font-extrabold text-[#24152F]">
                              <span className="px-2.5 py-0.5 rounded-md bg-[#24152F] text-[#D9F36A] text-[10px] uppercase tracking-wider">
                                Pending Seller Approval
                              </span>
                              <span>
                                {committedCount} / {d.minParticipants} committed buyers (₹0 collected yet)
                              </span>
                            </div>
                            <h3 className="font-display text-lg font-extrabold text-[#24152F]">
                              {d.productName || d.title}
                            </h3>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#29232F] tabular-nums">
                              <span>
                                Pool: <strong>{d.title}</strong>
                              </span>
                              <span>
                                Requested Units: <strong>{totalUnits}</strong>
                              </span>
                              <span className={stockOk ? 'text-[#2F7D4C] font-bold' : 'text-[#C83E4D] font-extrabold'}>
                                Stock Check: {availableStock} available ({stockOk ? 'In Stock' : 'Insufficient Stock'})
                              </span>
                              <span>
                                Est. Total Value:{' '}
                                <strong className="font-mono text-[#24152F]">
                                  {formatINR(totalOrderValue)}
                                </strong>
                              </span>
                            </div>
                            {members.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {members.map((m) => (
                                  <span
                                    key={m.userId}
                                    className="px-2 py-0.5 rounded-md bg-[#FFFFFF] border border-[#24152F] text-[11px] font-bold text-[#24152F]"
                                  >
                                    {m.name} ({m.quantity}×)
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            disabled={isBusy || !stockOk || !groupPriceValid}
                            onClick={async () => {
                              setBusyDealId(d.id);
                              try {
                                await onApproveGroupDeal(d.id, {
                                  finalGroupPrice: parsedFinalPrice,
                                  paymentWindowHours: draft.paymentWindowHours,
                                });
                              } finally {
                                setBusyDealId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-extrabold text-[#24152F] bg-[#D9F36A] hover:bg-[#C6E548] border-2 border-[#24152F] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                            <span>
                              {isBusy ? 'Approving...' : 'Approve Final Price & Open Payments'}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setRejectingDealId((prev) => (prev === d.id ? null : d.id))
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-extrabold text-[#C83E4D] bg-[#FFFFFF] hover:bg-[#FEE2E2] border-2 border-[#C83E4D] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" strokeWidth={2} />
                            <span>Decline</span>
                          </button>
                        </div>
                      </div>

                      {/* Seller Final Group Price & Payment Window Configuration */}
                      <div className="p-3.5 rounded-xl bg-[#FFFFFF] border-2 border-[#24152F] grid grid-cols-1 sm:grid-cols-3 gap-3 items-end text-xs">
                        <div>
                          <label className="block font-extrabold text-[#24152F] mb-1">
                            Confirmed Group Price (₹/unit · Retail {formatINR(retail)})
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="1"
                            max={maxAllowedUnitPrice}
                            value={draft.finalGroupPrice}
                            onChange={(e) =>
                              setApprovalDrafts((prev) => ({
                                ...prev,
                                [d.id]: { ...draft, finalGroupPrice: e.target.value },
                              }))
                            }
                            className="w-full px-3 py-2 font-mono font-bold bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                          />
                          {!groupPriceValid && (
                            <p className="text-[11px] font-bold text-[#C83E4D] mt-1">
                              Group unit + shared delivery ({formatINR(sharedFee)}) must be less than retail ({formatINR(retail)}). Max unit price: {formatINR(maxAllowedUnitPrice)}.
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block font-extrabold text-[#24152F] mb-1">
                            Buyer Payment Window
                          </label>
                          <select
                            value={draft.paymentWindowHours}
                            onChange={(e) =>
                              setApprovalDrafts((prev) => ({
                                ...prev,
                                [d.id]: {
                                  ...draft,
                                  paymentWindowHours: Number(e.target.value) || 24,
                                },
                              }))
                            }
                            className="w-full px-3 py-2 font-bold bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                          >
                            <option value={0.25}>15 Minutes (Quick Demo)</option>
                            <option value={12}>12 Hours</option>
                            <option value={24}>24 Hours</option>
                            <option value={48}>48 Hours</option>
                            <option value={72}>72 Hours</option>
                          </select>
                        </div>
                        <div className="text-[#5E5468] font-semibold">
                          Shared delivery split:{' '}
                          <strong className="text-[#24152F] font-mono">
                            {formatINR(sharedFee)}/buyer
                          </strong>
                          <span className="block text-[11px] mt-0.5 text-[#2F7D4C]">
                            Buyer total {formatINR(parsedFinalPrice + sharedFee)} vs Normal {formatINR(retail + INDIVIDUAL_DELIVERY_FEE_INR)}
                          </span>
                        </div>
                      </div>

                      {rejectingDealId === d.id && (
                        <div className="p-3.5 rounded-xl bg-[#FFFFFF] border-2 border-[#C83E4D] flex flex-col sm:flex-row gap-2.5">
                          <input
                            type="text"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Optional decline reason shown to participants..."
                            className="flex-1 px-3 py-2 text-xs bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl text-[#29232F] focus:outline-none focus:border-[#C83E4D]"
                          />
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingDealId(null);
                                setRejectReason('');
                              }}
                              className="px-3 py-2 text-xs font-bold text-[#5E5468] hover:text-[#24152F] cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={async () => {
                                setBusyDealId(d.id);
                                try {
                                  await onRejectGroupDeal(d.id, rejectReason);
                                  setRejectingDealId(null);
                                  setRejectReason('');
                                } finally {
                                  setBusyDealId(null);
                                }
                              }}
                              className="px-4 py-2 text-xs font-extrabold text-[#FFFFFF] bg-[#C83E4D] hover:bg-[#9E2A3B] rounded-xl cursor-pointer disabled:opacity-50"
                            >
                              Confirm Decline &amp; Notify All
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Seller Approved — Individual Payment Window Active */}
          {paymentOpenDeals.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                  Approved Groups — Individual Payment Windows Open
                </h2>
                <span className="px-3 py-1 rounded-xl bg-[#24152F] text-[#D9F36A] text-xs font-mono font-extrabold tabular-nums">
                  {paymentOpenDeals.length} active
                </span>
              </div>
              <div className="divide-y-2 divide-[#E6D8CB] border-2 border-[#24152F] rounded-2xl overflow-hidden bg-[#FFFFFF] shadow-card">
                {paymentOpenDeals.map((d) => {
                  const committedCount = d.committedCount ?? d.currentParticipants;
                  const isBusy = busyDealId === d.id;
                  const payTime = d.paymentExpiresAt ? formatTimeRemaining(d.paymentExpiresAt) : null;
                  return (
                    <div key={d.id} className="p-5 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold">
                            <span className="px-2.5 py-0.5 rounded-md bg-[#FF783D] text-[#24152F]">
                              {d.stageLabel}
                            </span>
                            <span className="font-mono text-[#2F7D4C]">
                              Paid: {d.paidCount} / {committedCount}
                            </span>
                            {d.finalGroupPrice && (
                              <span className="font-mono text-[#24152F]">
                                · Confirmed Price: {formatINR(d.finalGroupPrice)}/unit
                              </span>
                            )}
                            {payTime && (
                              <span className="inline-flex items-center gap-1 text-[#5E5468] tabular-nums">
                                <Clock className="w-3 h-3 text-[#FF783D]" strokeWidth={2} />
                                <span>Window: {payTime.label}</span>
                              </span>
                            )}
                          </div>
                          <h3 className="font-display text-base font-extrabold text-[#24152F]">
                            {d.title} — {d.productName}
                          </h3>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {(d.members || []).map((m) => (
                              <span
                                key={m.userId}
                                className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
                                  m.memberStatus === 'Paid'
                                    ? 'bg-[#D9F36A] border-[#24152F] text-[#24152F]'
                                    : m.memberStatus === 'Expired'
                                      ? 'bg-[#C83E4D] border-[#24152F] text-[#FFFFFF]'
                                      : 'bg-[#FFF8F0] border-[#24152F] text-[#24152F]'
                                }`}
                              >
                                {m.name} ({m.quantity}×) · {m.memberStatus === 'Committed' ? 'Awaiting Payment' : m.memberStatus}
                              </span>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={async () => {
                            setBusyDealId(d.id);
                            try {
                              await onExpirePaymentWindowNow(d.id);
                            } finally {
                              setBusyDealId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-extrabold text-[#C83E4D] bg-[#FFFFFF] hover:bg-[#FEE2E2] border-2 border-[#C83E4D] rounded-xl cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                        >
                          <Clock className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>{isBusy ? 'Closing...' : 'Close Payment Window Now'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Waiting for Group Completion */}
          <div className="space-y-3">
            <h2 className="font-display text-xl font-extrabold text-[#24152F]">
              Waiting for Group Completion — Live Commitments (₹0 Paid Yet)
            </h2>
            {waitingDealsList.length === 0 ? (
              <div className="p-6 rounded-2xl border-2 border-[#E6D8CB] bg-[#FFFFFF] text-sm text-[#5E5468]">
                No pools currently waiting for group completion.
              </div>
            ) : (
              <div className="divide-y-2 divide-[#E6D8CB] border-2 border-[#E6D8CB] rounded-2xl overflow-hidden bg-[#FFFFFF] shadow-card">
                {waitingDealsList.map((d) => {
                  const committedCount = d.committedCount ?? d.currentParticipants;
                  const isEditing = editingDealId === d.id;
                  const isBusy = busyDealId === d.id;
                  const timeInfo = formatTimeRemaining(d.expiresAt);
                  return (
                    <div key={d.id} className="p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-extrabold text-[#24152F] flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-md bg-[#FFF8F0] border border-[#24152F] text-[#24152F]">
                              {d.stageLabel}
                            </span>
                            <span>·</span>
                            <span className="tabular-nums text-[#FF783D]">
                              Committed: {committedCount} / {d.minParticipants}
                            </span>
                            <span>·</span>
                            <span className="tabular-nums text-[#5E5468]">
                              Paid: 0 (No payment collected yet)
                            </span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 text-[#5E5468] tabular-nums">
                              <Clock className="w-3 h-3 text-[#FF783D]" strokeWidth={2} />
                              <span>{timeInfo.label}</span>
                            </span>
                          </div>
                          <h3 className="font-display text-base font-extrabold text-[#24152F] mt-1">
                            {d.title} — {d.productName}
                          </h3>
                          <p className="text-xs text-[#5E5468] mt-1 tabular-nums">
                            Threshold: {d.minParticipants} participants → est. {d.discountPercent}% off ({d.remainingConfirmedNeeded} more needed)
                            {d.tier2Min && d.tier2Discount
                              ? ` · Tier 2: ${d.tier2Min} → ${d.tier2Discount}% off`
                              : ''}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyDealId(d.id);
                              try {
                                await onExpireGroupNow(d.id);
                              } finally {
                                setBusyDealId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-extrabold text-[#C83E4D] bg-[#FFFFFF] hover:bg-[#FEE2E2] border-2 border-[#C83E4D] rounded-xl cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            <Clock className="w-3.5 h-3.5" strokeWidth={2} />
                            <span>{isBusy ? 'Expiring...' : 'End Deadline Now'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => (isEditing ? setEditingDealId(null) : startEditDeal(d))}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-extrabold text-[#24152F] bg-[#FFFFFF] hover:bg-[#BBA5D5] border-2 border-[#24152F] rounded-xl cursor-pointer transition-colors whitespace-nowrap"
                          >
                            <Users className="w-3.5 h-3.5" strokeWidth={2} />
                            <span>{isEditing ? 'Cancel' : 'Edit Threshold & Tiers'}</span>
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#E6D8CB] grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
                          <div>
                            <label className="block text-xs font-bold text-[#24152F] mb-1">Tier 1 Buyers</label>
                            <input
                              type="number"
                              min="2"
                              value={tierDraft.minParticipants}
                              onChange={(e) =>
                                setTierDraft((prev) => ({ ...prev, minParticipants: e.target.value }))
                              }
                              className="w-full px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-[#24152F] mb-1">Tier 1 % Off</label>
                            <input
                              type="number"
                              min="5"
                              max="75"
                              value={tierDraft.discountPercent}
                              onChange={(e) =>
                                setTierDraft((prev) => ({ ...prev, discountPercent: e.target.value }))
                              }
                              className="w-full px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-[#24152F] mb-1">Tier 2 Buyers</label>
                            <input
                              type="number"
                              min="3"
                              value={tierDraft.tier2Min}
                              onChange={(e) =>
                                setTierDraft((prev) => ({ ...prev, tier2Min: e.target.value }))
                              }
                              className="w-full px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-[#24152F] mb-1">Tier 2 % Off</label>
                            <input
                              type="number"
                              min="5"
                              max="75"
                              value={tierDraft.tier2Discount}
                              onChange={(e) =>
                                setTierDraft((prev) => ({ ...prev, tier2Discount: e.target.value }))
                              }
                              className="w-full px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => saveDealTiers(d.id)}
                            className="py-2 px-3 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl cursor-pointer transition-colors"
                          >
                            Save Tiers
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {confirmedDealsList.length > 0 && (
            <div className="space-y-2.5">
              <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                Confirmed Group Orders (Payments Completed)
              </h2>
              <div className="divide-y divide-[#E6D8CB] border-2 border-[#24152F] rounded-2xl overflow-hidden bg-[#FFFFFF] shadow-card">
                {confirmedDealsList.map((d) => (
                  <div key={d.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                    <div className="space-y-0.5">
                      <div className="font-extrabold text-[#24152F]">
                        {d.title} · {d.productName}
                      </div>
                      <div className="text-[#5E5468] tabular-nums">
                        {d.paidCount} paid buyers confirmed
                        {d.finalGroupPrice ? ` · ${formatINR(d.finalGroupPrice)}/unit` : ''}
                        {d.sharedDeliveryCostPerMember !== null && d.sharedDeliveryCostPerMember !== undefined
                          ? ` · Shared delivery ${formatINR(d.sharedDeliveryCostPerMember)}/buyer`
                          : ''}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg font-extrabold bg-[#D9F36A] border border-[#24152F] text-[#24152F]">
                      {d.stageLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rejectedDealsList.length > 0 && (
            <div className="space-y-2.5">
              <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                Declined Group Orders
              </h2>
              <div className="divide-y divide-[#E6D8CB] border-2 border-[#E6D8CB] rounded-2xl overflow-hidden bg-[#FFFFFF]">
                {rejectedDealsList.map((d) => (
                  <div key={d.id} className="px-5 py-3.5 flex items-center justify-between gap-4 text-xs">
                    <div>
                      <span className="font-bold text-[#24152F]">{d.title}</span>
                      <span className="text-[#5E5468]"> · {d.productName} (No payment collected)</span>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg font-extrabold bg-[#FEE2E2] text-[#9E2A3B]">
                      Declined
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {expiredDealsList.length > 0 && (
            <div className="space-y-2.5">
              <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                Expired Pools
              </h2>
              <div className="divide-y divide-[#E6D8CB] border-2 border-[#C83E4D] rounded-2xl overflow-hidden bg-[#FFFFFF]">
                {expiredDealsList.map((d) => (
                  <div key={d.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs">
                    <div>
                      <span className="font-bold text-[#24152F]">{d.title}</span>
                      <span className="text-[#5E5468]">
                        {' '}· {d.productName} ({d.committedCount ?? d.currentParticipants}/{d.minParticipants} committed · {d.expiredMembersCount ?? 0} expired · No refund required)
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg font-extrabold bg-[#C83E4D] text-[#FFFFFF]">
                      Expired
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ORDERS TAB */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <p className="text-sm text-[#5E5468]">
            Orders awaiting individual group payment remain locked until the buyer completes payment. Mark confirmed orders &ldquo;Out for Delivery&rdquo; to trigger availability verification.
          </p>

          {orders.length === 0 ? (
            <div className="p-10 text-center border-2 border-[#E6D8CB] rounded-2xl bg-[#FFFFFF] text-sm text-[#5E5468]">
              No customer orders yet for this storefront.
            </div>
          ) : (
            <div className="divide-y-2 divide-[#E6D8CB] border-2 border-[#E6D8CB] rounded-2xl overflow-hidden bg-[#FFFFFF] shadow-card">
              {orders.map((order) => {
                const isCancelled = order.fulfillmentStatus === 'Cancelled';
                const isAwaitingPayment = order.fulfillmentStatus === 'Awaiting Payment';
                return (
                  <div key={order.id} className="p-5 space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-extrabold text-[#24152F]">
                            Order #{order.id}
                          </span>
                          <span className="text-xs text-[#5E5468]">·</span>
                          <span className="text-xs font-bold text-[#24152F]">
                            {order.customerName}
                          </span>
                          <span className="text-xs text-[#5E5468]">·</span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold ${
                              order.deliveryMode === 'combined'
                                ? 'bg-[#D9F36A] text-[#24152F]'
                                : 'bg-[#BBA5D5] text-[#24152F]'
                            }`}
                          >
                            {order.deliveryMode === 'combined'
                              ? `Combined Delivery (${order.combinedGroupId || 'Batch'})`
                              : 'Normal Delivery'}
                          </span>
                          {order.groupApprovalStatus !== 'Not Required' && (
                            <span className="px-2 py-0.5 rounded-md bg-[#24152F] text-[#D9F36A] text-[11px] font-bold">
                              {order.groupApprovalStatus}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-[#5E5468]">
                          <span className="inline-flex items-center gap-1 font-bold text-[#24152F]">
                            <CalendarClock className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                            <span>Customer Window: {order.scheduledWindow}</span>
                          </span>
                          <span>· {order.customerAddress}</span>
                          <span>· Payment: <strong className="text-[#24152F]">{order.paymentStatus}</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {isCancelled ? (
                          <span className="px-3.5 py-2 text-xs font-extrabold bg-[#FEE2E2] text-[#9E2A3B] border-2 border-[#C83E4D] rounded-xl">
                            {order.paymentStatus === 'Payment Window Expired'
                              ? 'Participation Expired'
                              : 'Cancelled'}
                          </span>
                        ) : isAwaitingPayment ? (
                          <span className="px-3.5 py-2 text-xs font-extrabold bg-[#FFEAD9] text-[#24152F] border-2 border-[#FF783D] rounded-xl">
                            Awaiting Buyer Payment
                          </span>
                        ) : (
                          <select
                            value={order.fulfillmentStatus}
                            onChange={(e) =>
                              onUpdateOrderStatus(
                                order.id,
                                e.target.value as Order['fulfillmentStatus']
                              )
                            }
                            aria-label={`Fulfillment status for ${order.id}`}
                            className="px-3.5 py-2 text-xs font-extrabold bg-[#FFF8F0] border-2 border-[#24152F] text-[#24152F] rounded-xl focus:outline-none focus:border-[#FF783D] cursor-pointer"
                          >
                            <option value="Confirmed">Confirmed</option>
                            <option value="Combined & Packed">Combined & Packed</option>
                            <option value="Out for Delivery">Out for Delivery</option>
                            <option value="Delivered">Delivered</option>
                          </select>
                        )}
                      </div>
                    </div>

                    {/* Delivery Availability, Reschedule & Partner Bar */}
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-extrabold ${
                          order.deliveryAvailabilityStatus === 'Availability Confirmed'
                            ? 'bg-[#D9F36A] text-[#24152F]'
                            : order.deliveryAvailabilityStatus === 'Reschedule Requested' ||
                                order.deliveryAvailabilityStatus === 'Delivery Rescheduled'
                              ? 'bg-[#FEE2E2] text-[#9E2A3B]'
                              : order.deliveryAvailabilityStatus === 'Awaiting Customer Response'
                                ? 'bg-[#FFEAD9] text-[#24152F]'
                                : 'bg-[#FFF8F0] border border-[#E6D8CB] text-[#5E5468]'
                        }`}
                      >
                        <Truck className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>Availability: {order.deliveryAvailabilityStatus}</span>
                      </span>

                      {order.rescheduleRequestedWindow && (
                        <span className="text-[#9E2A3B] font-bold">
                          Rescheduled to: <strong>{order.rescheduleRequestedWindow}</strong> (Dispatch paused)
                        </span>
                      )}

                      {order.deliveryPartner && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFF8F0] border border-[#E6D8CB] text-[#24152F] font-bold">
                          Partner: <strong>{order.deliveryPartner.name}</strong> ({order.deliveryPartner.id}) · {order.trackingEta || 'En route'}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-4 pt-2 border-t border-[#E6D8CB] text-xs text-[#5E5468]">
                      {order.items
                        .filter((i) => i.sellerId === seller.id)
                        .map((item) => (
                          <div key={item.id} className="inline-flex items-center gap-2">
                            <Package className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                            <span className="font-bold text-[#24152F]">
                              {item.quantity}× {item.productName}
                            </span>
                            <span className="font-mono tabular-nums text-[#5E5468]">
                              ({formatINR(item.unitPrice * item.quantity)})
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
