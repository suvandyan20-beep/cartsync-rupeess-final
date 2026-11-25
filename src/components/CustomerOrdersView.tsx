import { useState } from 'react';
import {
  PackageCheck,
  Truck,
  CalendarClock,
  Layers,
  CheckCircle2,
  Clock,
  Phone,
  ShieldCheck,
  CreditCard,
  AlertTriangle,
  MapPin,
  Star,
  KeyRound,
  ClipboardCheck,
  Navigation,
  X,
  ChevronRight,
  XCircle,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import { OrderDeliveryLifecycle } from './OrderDeliveryLifecycle.tsx';
import { formatINR, INDIVIDUAL_DELIVERY_FEE_INR } from '../utils/currency.ts';
import type { Order } from '../types.ts';

interface CustomerOrdersViewProps {
  orders: Order[];
  customerAddress?: string;
  confirmedOrderId?: string | null;
  trackedOrderId?: string | null;
  onTrackOrder: (orderId: string | null) => void;
  onDismissConfirmedBanner?: () => void;
  onCombineOrders: (orderIds: string[]) => Promise<void>;
  onRespondAvailability: (
    orderId: string,
    available: boolean,
    rescheduleWindow?: string
  ) => Promise<void>;
  onConfirmReceipt: (
    orderId: string,
    payload: {
      verificationPin: string;
      parcelIntact: boolean;
      itemsVerified: boolean;
      receiverNote?: string;
    }
  ) => Promise<void>;
  onRateDelivery: (orderId: string, rating: number, feedback?: string) => Promise<void>;
  onPayPendingOrder: (orderId: string) => Promise<void>;
  onCancelOrder: (orderId: string) => Promise<void>;
  onResolveExpiredOrder: (
    orderId: string,
    action: 'continue_individual' | 'cancel_refund'
  ) => Promise<void>;
  onSelectProduct: (productId: string) => void;
  onBackHome: () => void;
}

interface ReceiptDraft {
  pin: string;
  parcelIntact: boolean;
  itemsVerified: boolean;
  receiverNote: string;
  error: string | null;
}

const RESCHEDULE_SLOTS = [
  'Tomorrow · Morning (8am–12pm)',
  'Tomorrow · Afternoon (12pm–4pm)',
  'Tomorrow · Evening (4pm–8pm)',
  'Sat · Morning (8am–12pm)',
  'Sun · Afternoon (12pm–4pm)',
];

const TRACKING_STEPS = [
  'Order Confirmed',
  'Out for Delivery',
  'Availability Confirmed',
  'Partner Assigned',
  'Delivered',
] as const;

type OrderFilterTab = 'all' | 'processing' | 'out_for_delivery' | 'delivered' | 'cancelled';

function getTrackingStepIndex(order: Order): number {
  if (order.fulfillmentStatus === 'Delivered') return 4;
  if (order.deliveryPartner && order.deliveryAvailabilityStatus === 'Availability Confirmed') {
    return 3;
  }
  if (order.deliveryAvailabilityStatus === 'Availability Confirmed') return 2;
  if (order.fulfillmentStatus === 'Out for Delivery') return 1;
  return 0;
}

function isOrderCancelled(order: Order): boolean {
  return (
    order.fulfillmentStatus === 'Cancelled' ||
    order.groupApprovalStatus === 'Rejected by Seller'
  );
}

export function CustomerOrdersView({
  orders,
  customerAddress,
  confirmedOrderId,
  trackedOrderId,
  onTrackOrder,
  onDismissConfirmedBanner,
  onCombineOrders,
  onRespondAvailability,
  onConfirmReceipt,
  onRateDelivery,
  onPayPendingOrder,
  onCancelOrder,
  onResolveExpiredOrder,
  onSelectProduct,
  onBackHome,
}: CustomerOrdersViewProps) {
  const [statusFilter, setStatusFilter] = useState<OrderFilterTab>('all');
  const [selectedToCombine, setSelectedToCombine] = useState<string[]>([]);
  const [combining, setCombining] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [rescheduleOpenId, setRescheduleOpenId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string>(RESCHEDULE_SLOTS[0]);
  const [customSlot, setCustomSlot] = useState<string>('');
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});

  function getReceiptDraft(order: Order): ReceiptDraft {
    return (
      receiptDrafts[order.id] || {
        pin: order.handoverPin || '',
        parcelIntact: false,
        itemsVerified: false,
        receiverNote: '',
        error: null,
      }
    );
  }

  function updateReceiptDraft(order: Order, patch: Partial<ReceiptDraft>) {
    setReceiptDrafts((prev) => ({
      ...prev,
      [order.id]: {
        ...(prev[order.id] || {
          pin: order.handoverPin || '',
          parcelIntact: false,
          itemsVerified: false,
          receiverNote: '',
          error: null,
        }),
        ...patch,
      },
    }));
  }

  const counts = {
    all: orders.length,
    processing: orders.filter(
      (o) =>
        !isOrderCancelled(o) &&
        o.fulfillmentStatus !== 'Out for Delivery' &&
        o.fulfillmentStatus !== 'Delivered'
    ).length,
    out_for_delivery: orders.filter(
      (o) => !isOrderCancelled(o) && o.fulfillmentStatus === 'Out for Delivery'
    ).length,
    delivered: orders.filter(
      (o) => !isOrderCancelled(o) && o.fulfillmentStatus === 'Delivered'
    ).length,
    cancelled: orders.filter((o) => isOrderCancelled(o)).length,
  };

  const filteredOrders = orders.filter((o) => {
    if (statusFilter === 'processing') {
      return (
        !isOrderCancelled(o) &&
        o.fulfillmentStatus !== 'Out for Delivery' &&
        o.fulfillmentStatus !== 'Delivered'
      );
    }
    if (statusFilter === 'out_for_delivery') {
      return !isOrderCancelled(o) && o.fulfillmentStatus === 'Out for Delivery';
    }
    if (statusFilter === 'delivered') {
      return !isOrderCancelled(o) && o.fulfillmentStatus === 'Delivered';
    }
    if (statusFilter === 'cancelled') {
      return isOrderCancelled(o);
    }
    return true;
  });

  const combinableOrders = orders.filter(
    (o) =>
      !isOrderCancelled(o) &&
      o.fulfillmentStatus !== 'Awaiting Payment' &&
      o.paymentStatus !== 'Awaiting Payment' &&
      o.paymentStatus !== 'Pending Checkout' &&
      o.paymentStatus !== 'Pending Payment' &&
      o.expiredResolutionStatus !== 'pending_choice' &&
      (o.fulfillmentStatus === 'Confirmed' || o.fulfillmentStatus === 'Combined & Packed')
  );

  function toggleOrderSelection(id: string) {
    setSelectedToCombine((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleCombineSelected() {
    if (selectedToCombine.length < 2) return;
    setCombining(true);
    try {
      await onCombineOrders(selectedToCombine);
      setSelectedToCombine([]);
    } finally {
      setCombining(false);
    }
  }

  async function handleAvailabilityAction(
    orderId: string,
    available: boolean,
    rescheduleWindow?: string
  ) {
    setBusyOrderId(orderId);
    try {
      await onRespondAvailability(orderId, available, rescheduleWindow);
      if (!available) {
        setRescheduleOpenId(null);
        setCustomSlot('');
      }
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handlePayOrder(orderId: string) {
    setBusyOrderId(orderId);
    try {
      await onPayPendingOrder(orderId);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleCancelClick(orderId: string) {
    setBusyOrderId(orderId);
    try {
      await onCancelOrder(orderId);
      setConfirmCancelId(null);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleExpiredResolution(
    orderId: string,
    action: 'continue_individual' | 'cancel_refund'
  ) {
    setBusyOrderId(orderId);
    try {
      await onResolveExpiredOrder(orderId, action);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleCompleteReceiving(order: Order) {
    const draft = getReceiptDraft(order);
    if (!draft.parcelIntact || !draft.itemsVerified) {
      updateReceiptDraft(order, {
        error: 'Please check both doorstep verification boxes before confirming receipt.',
      });
      return;
    }
    if (order.handoverPin && draft.pin.trim() !== order.handoverPin) {
      updateReceiptDraft(order, {
        error: `Handover PIN does not match order PIN (${order.handoverPin}).`,
      });
      return;
    }
    setBusyOrderId(order.id);
    updateReceiptDraft(order, { error: null });
    try {
      await onConfirmReceipt(order.id, {
        verificationPin: draft.pin.trim() || order.handoverPin || '',
        parcelIntact: draft.parcelIntact,
        itemsVerified: draft.itemsVerified,
        receiverNote: draft.receiverNote.trim() || undefined,
      });
    } catch (err) {
      updateReceiptDraft(order, {
        error: err instanceof Error ? err.message : 'Unable to confirm delivery receipt.',
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  const trackedOrder = trackedOrderId
    ? orders.find((o) => o.id === trackedOrderId) || null
    : null;
  const confirmedOrder = confirmedOrderId
    ? orders.find((o) => o.id === confirmedOrderId) || null
    : null;

  if (trackedOrder) {
    return (
      <OrderDeliveryLifecycle
        order={trackedOrder}
        onBack={() => onTrackOrder(null)}
        onRespondAvailability={onRespondAvailability}
        onConfirmReceipt={onConfirmReceipt}
        onRateDelivery={onRateDelivery}
        onSelectProduct={onSelectProduct}
      />
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Newly Confirmed Order Banner */}
      {confirmedOrder && (
        <section
          aria-label="Order Confirmation"
          className="border-2 border-[#24152F] rounded-2xl bg-[#D9F36A] text-[#24152F] p-6 shadow-card space-y-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-[#24152F] text-[#D9F36A] flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" strokeWidth={2} />
              </div>
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider">
                  Checkout Complete · Live Tracking Active
                </div>
                <h2 className="font-display text-2xl font-extrabold mt-0.5">
                  Order Confirmed — #{confirmedOrder.id}
                </h2>
                <p className="text-xs font-medium mt-0.5">
                  Thank you for ordering with CartSync. Open live tracking to monitor every stage through final delivery.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onDismissConfirmedBanner?.();
                  onTrackOrder(confirmedOrder.id);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-extrabold text-[#FFFFFF] bg-[#24152F] hover:bg-[#352145] rounded-xl cursor-pointer"
              >
                <Navigation className="w-4 h-4 text-[#FF783D]" strokeWidth={2} />
                <span>Track My Order</span>
              </button>
              {onDismissConfirmedBanner && (
                <button
                  type="button"
                  onClick={onDismissConfirmedBanner}
                  aria-label="Dismiss order confirmation"
                  className="p-2 text-[#24152F] hover:bg-[#FFFFFF] rounded-xl cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-[#24152F]/20 text-xs">
            <div>
              <span className="font-semibold block opacity-80">Product &amp; Quantity</span>
              <span className="font-extrabold mt-0.5 block">
                {confirmedOrder.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}
              </span>
            </div>
            <div>
              <span className="font-semibold block opacity-80">Payment Method</span>
              <span className="font-extrabold mt-0.5 block">
                {confirmedOrder.paymentMethod || 'Card ending in 4242 (Simulated)'}
              </span>
            </div>
            <div>
              <span className="font-semibold block opacity-80">Delivery Address</span>
              <span className="font-extrabold mt-0.5 block">
                {confirmedOrder.customerAddress || customerAddress}
              </span>
            </div>
            <div>
              <span className="font-semibold block opacity-80">Scheduled Delivery</span>
              <span className="font-extrabold mt-0.5 block">{confirmedOrder.scheduledWindow}</span>
            </div>
          </div>
        </section>
      )}

      {/* Header & Breadcrumbs */}
      <div className="space-y-4 border-b-2 border-[#E6D8CB] pb-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-[#5E5468]">
          <button type="button" onClick={onBackHome} className="hover:text-[#FF783D] cursor-pointer">
            Home
          </button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#24152F] font-bold">My Orders</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-[#FF783D]">
              Order Fulfillment & Live Tracking
            </div>
            <h1 className="font-display text-3xl font-extrabold text-[#24152F]">
              My Orders & Delivery Tracker
            </h1>
            <p className="text-sm text-[#5E5468] mt-1">
              Organize orders by stage, confirm delivery availability, cancel unshipped orders, or combine open orders.
            </p>
          </div>

          {combinableOrders.length >= 2 && (
            <button
              type="button"
              disabled={selectedToCombine.length < 2 || combining}
              onClick={handleCombineSelected}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Layers className="w-4 h-4" strokeWidth={2} />
              <span>
                {combining
                  ? 'Consolidating...'
                  : selectedToCombine.length >= 2
                    ? `Combine ${selectedToCombine.length} Orders into 1 Delivery`
                    : 'Select 2+ Open Orders to Combine'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Order Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'all', label: `All Orders (${counts.all})` },
            { id: 'processing', label: `Processing (${counts.processing})` },
            { id: 'out_for_delivery', label: `Out for Delivery (${counts.out_for_delivery})` },
            { id: 'delivered', label: `Delivered (${counts.delivered})` },
            { id: 'cancelled', label: `Cancelled (${counts.cancelled})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold border-2 transition-colors cursor-pointer ${
              statusFilter === tab.id
                ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                : 'bg-[#FFFFFF] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="p-12 text-center border-2 border-[#E6D8CB] rounded-2xl bg-[#FFFFFF] text-sm font-semibold text-[#5E5468]">
          {orders.length === 0
            ? 'You have not placed any orders yet. Add products from the catalog or join a Group Order to get started.'
            : 'No orders match this status filter.'}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredOrders.map((order) => {
            const cancelled = isOrderCancelled(order);
            const isCombined = order.deliveryMode === 'combined';
            const isAwaitingPayment =
              order.fulfillmentStatus === 'Awaiting Payment' ||
              order.paymentStatus === 'Awaiting Payment';
            const isUnpaid =
              isAwaitingPayment ||
              order.paymentStatus === 'Pending Checkout' ||
              order.paymentStatus === 'Pending Payment';
            const canSelectCombine =
              !cancelled &&
              combinableOrders.length >= 2 &&
              !isUnpaid &&
              order.expiredResolutionStatus !== 'pending_choice' &&
              (order.fulfillmentStatus === 'Confirmed' ||
                order.fulfillmentStatus === 'Combined & Packed');
            const canCancel =
              !cancelled &&
              (order.fulfillmentStatus === 'Confirmed' ||
                order.fulfillmentStatus === 'Combined & Packed' ||
                order.fulfillmentStatus === 'Awaiting Payment');
            const checked = selectedToCombine.includes(order.id);
            const isAwaitingAvailability =
              !cancelled &&
              order.fulfillmentStatus === 'Out for Delivery' &&
              order.deliveryAvailabilityStatus === 'Awaiting Customer Response';
            const isRescheduled =
              order.deliveryAvailabilityStatus === 'Reschedule Requested' ||
              order.deliveryAvailabilityStatus === 'Delivery Rescheduled';
            const stepIndex = getTrackingStepIndex(order);
            const isBusy = busyOrderId === order.id;

            return (
              <div
                key={order.id}
                className="border-2 border-[#24152F] rounded-2xl bg-[#FFFFFF] shadow-card overflow-hidden"
              >
                {/* Order Header */}
                <div className="px-6 py-4 bg-[#24152F] text-[#FFFFFF] flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {canSelectCombine && (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOrderSelection(order.id)}
                        aria-label={`Select order ${order.id} to combine`}
                        className="w-4 h-4 accent-[#FF783D] rounded cursor-pointer"
                      />
                    )}
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-sm font-extrabold text-[#D9F36A]">
                          Order #{order.id}
                        </span>
                        <span className="text-xs text-[#BBA5D5]">·</span>
                        <span className="text-xs text-[#BBA5D5] font-mono tabular-nums">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs">
                        <span className="inline-flex items-center gap-1 font-bold text-[#FF783D]">
                          {isCombined ? (
                            <PackageCheck className="w-3.5 h-3.5" strokeWidth={2} />
                          ) : (
                            <Truck className="w-3.5 h-3.5" strokeWidth={2} />
                          )}
                          <span>
                            {isCombined
                              ? `Combined Delivery (${order.combinedGroupId || 'Batch'})`
                              : 'Normal Delivery'}
                          </span>
                        </span>
                        <span className="text-[#BBA5D5]">|</span>
                        <span className="inline-flex items-center gap-1 text-[#FFFFFF]">
                          <CalendarClock className="w-3.5 h-3.5 text-[#D9F36A]" strokeWidth={2} />
                          <span>Window: {order.scheduledWindow}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs text-[#BBA5D5]">{order.paymentStatus}</div>
                      <div className="text-base font-mono font-extrabold tabular-nums text-[#FFFFFF]">
                        {formatINR(order.totalAmount)}
                      </div>
                    </div>

                    {!isAwaitingPayment && !cancelled && (
                      <button
                        type="button"
                        onClick={() => onTrackOrder(order.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold text-[#24152F] bg-[#D9F36A] hover:bg-[#cce856] cursor-pointer whitespace-nowrap"
                      >
                        <Navigation className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>Track Order</span>
                      </button>
                    )}

                    {isUnpaid &&
                      !cancelled &&
                      order.groupStageLabel !== 'Expired' &&
                      order.paymentStatus !== 'Payment Window Expired' &&
                      order.expiredResolutionStatus !== 'pending_choice' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handlePayOrder(order.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          <CreditCard className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>
                            {isBusy
                              ? 'Processing...'
                              : `Complete Individual Payment (${formatINR(order.totalAmount)})`}
                          </span>
                        </button>
                      )}

                    {canCancel && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setConfirmCancelId((prev) => (prev === order.id ? null : order.id))
                        }
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-[#FFFFFF] bg-[#352145] hover:bg-[#C83E4D] border border-[#BBA5D5] cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>{isAwaitingPayment ? 'Withdraw' : 'Cancel Order'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline Cancel Confirmation */}
                {confirmCancelId === order.id && (
                  <div className="px-6 py-3.5 bg-[#C83E4D] text-[#FFFFFF] flex flex-wrap items-center justify-between gap-3 text-xs">
                    <span className="font-bold">
                      {isAwaitingPayment
                        ? `Withdraw & close unpaid order #${order.id}? No payment has been collected.`
                        : `Cancel Order #${order.id}? Any reserved stock will be restored immediately.`}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmCancelId(null)}
                        className="px-3 py-1.5 rounded-lg bg-[#FFFFFF] text-[#24152F] font-bold cursor-pointer"
                      >
                        Keep Order
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleCancelClick(order.id)}
                        className="px-3.5 py-1.5 rounded-lg bg-[#24152F] text-[#D9F36A] font-extrabold cursor-pointer"
                      >
                        {isBusy ? 'Updating...' : isAwaitingPayment ? 'Confirm Withdraw' : 'Confirm Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Four Distinct Status Indicators */}
                <div className="px-6 py-3.5 bg-[#FFF8F0] border-b border-[#E6D8CB] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#E6D8CB]">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-[#5E5468] block">
                      Group Approval
                    </span>
                    <span
                      className={`font-extrabold mt-0.5 block ${
                        order.groupApprovalStatus === 'Approved by Seller'
                          ? 'text-[#2F7D4C]'
                          : order.groupApprovalStatus === 'Rejected by Seller'
                            ? 'text-[#C83E4D]'
                            : 'text-[#24152F]'
                      }`}
                    >
                      {order.groupApprovalStatus}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#E6D8CB]">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-[#5E5468] block">
                      Payment Status
                    </span>
                    <span
                      className={`font-extrabold mt-0.5 block ${
                        isUnpaid
                          ? 'text-[#FF783D]'
                          : cancelled
                            ? 'text-[#C83E4D]'
                            : 'text-[#2F7D4C]'
                      }`}
                    >
                      {order.paymentStatus}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#E6D8CB]">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-[#5E5468] block">
                      Delivery Availability
                    </span>
                    <span
                      className={`font-extrabold mt-0.5 block ${
                        order.deliveryAvailabilityStatus === 'Availability Confirmed'
                          ? 'text-[#2F7D4C]'
                          : isRescheduled
                            ? 'text-[#C83E4D]'
                            : order.deliveryAvailabilityStatus === 'Awaiting Customer Response'
                              ? 'text-[#FF783D]'
                              : 'text-[#24152F]'
                      }`}
                    >
                      {order.deliveryAvailabilityStatus}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#E6D8CB]">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-[#5E5468] block">
                      Delivery Tracking
                    </span>
                    <span
                      className={`font-extrabold mt-0.5 block ${
                        cancelled
                          ? 'text-[#C83E4D]'
                          : order.fulfillmentStatus === 'Delivered'
                            ? 'text-[#2F7D4C]'
                            : 'text-[#24152F]'
                      }`}
                    >
                      {order.fulfillmentStatus}
                    </span>
                  </div>
                </div>

                {/* Individual Payment Required Callout (Seller-Approved Group Order) */}
                {isAwaitingPayment &&
                  !cancelled &&
                  order.paymentStatus !== 'Payment Window Expired' && (
                    <div className="mx-6 mt-4 p-4 rounded-2xl bg-[#D9F36A] border-2 border-[#24152F] flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-1.5 font-extrabold text-[#24152F] uppercase tracking-wider text-[11px]">
                          <CreditCard className="w-3.5 h-3.5" strokeWidth={2.2} />
                          <span>Seller Approved · Individual Payment Window Open</span>
                        </div>
                        <p className="text-[#24152F] font-semibold">
                          {order.finalGroupPrice
                            ? `Confirmed group price: ${formatINR(order.finalGroupPrice)}/unit · `
                            : ''}
                          Total due: <strong className="font-mono">{formatINR(order.totalAmount)}</strong>
                          {order.paymentDeadline && (
                            <>
                              {' '}· Pay before{' '}
                              <strong className="font-mono">
                                {new Date(order.paymentDeadline).toLocaleString()}
                              </strong>
                            </>
                          )}
                        </p>
                        <p className="text-[11px] font-medium text-[#24152F]">
                          Your individual order is marked Confirmed only after your payment succeeds. Missing the deadline expires your participation.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handlePayOrder(order.id)}
                        className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-extrabold text-[#FFFFFF] bg-[#24152F] hover:bg-[#352145] cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                      >
                        <CreditCard className="w-4 h-4 text-[#FF783D]" strokeWidth={2} />
                        <span>
                          {isBusy
                            ? 'Processing Payment...'
                            : `Complete Individual Payment (${formatINR(order.totalAmount)})`}
                        </span>
                      </button>
                    </div>
                  )}

                {/* Smart Group Order Progress & Shared Savings Strip */}
                {order.dealId && (
                  <div className="mx-6 mt-4 p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#E6D8CB] flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-[#24152F]">
                          Group Pool: {order.groupDealTitle || 'Group Order'}
                        </span>
                        {order.groupStageLabel && (
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                              order.groupStageLabel === 'Confirmed'
                                ? 'bg-[#D9F36A] text-[#24152F] border border-[#24152F]'
                                : order.groupStageLabel === 'Approved · Awaiting Payments'
                                  ? 'bg-[#FF783D] text-[#24152F] border border-[#24152F]'
                                  : order.groupStageLabel === 'Expired' ||
                                      order.groupStageLabel === 'Rejected'
                                    ? 'bg-[#C83E4D] text-[#FFFFFF]'
                                    : 'bg-[#BBA5D5] text-[#24152F]'
                            }`}
                          >
                            {order.groupStageLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[#5E5468] font-medium tabular-nums">
                        Committed:{' '}
                        <strong className="text-[#24152F]">
                          {order.groupCommittedCount ?? 0} / {order.groupMinParticipants ?? 5}
                        </strong>
                        {' · '}
                        Paid:{' '}
                        <strong className="text-[#24152F]">
                          {order.groupPaidCount ?? 0} / {order.groupMinParticipants ?? 5}
                        </strong>
                        {order.finalGroupPrice && (
                          <span>
                            {' · '}Confirmed price:{' '}
                            <strong className="font-mono text-[#24152F]">
                              {formatINR(order.finalGroupPrice)}/unit
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>

                    {order.sharedDeliveryCost !== null &&
                      order.sharedDeliveryCost !== undefined &&
                      !cancelled && (
                        <div className="flex flex-wrap items-center gap-3 text-xs font-mono font-extrabold text-[#24152F] bg-[#D9F36A] border-2 border-[#24152F] px-3 py-2 rounded-xl tabular-nums">
                          <span>Shared Delivery: {formatINR(order.sharedDeliveryCost)}/buyer</span>
                          <span>·</span>
                          <span>
                            Total Saved:{' '}
                            {formatINR(
                              order.discountTotal +
                                Math.max(0, INDIVIDUAL_DELIVERY_FEE_INR - order.sharedDeliveryCost)
                            )}
                          </span>
                        </div>
                      )}
                  </div>
                )}

                {order.paymentStatus === 'Payment Window Expired' && (
                  <div className="mx-6 mt-4 p-4 rounded-2xl bg-[#FFEAD9] border-2 border-[#C83E4D] flex items-start gap-3 text-xs">
                    <AlertTriangle className="w-5 h-5 text-[#C83E4D] shrink-0 mt-0.5" strokeWidth={2.2} />
                    <div className="space-y-0.5">
                      <div className="font-extrabold text-[#C83E4D]">
                        Participation Expired — Payment Deadline Missed
                      </div>
                      <p className="text-[#29232F]">
                        Individual payment was not completed within the seller&apos;s payment window. Your participation and pending order were closed; no payment was collected.
                      </p>
                    </div>
                  </div>
                )}

                {order.paymentStatus === 'Group Expired (No Charge)' && (
                  <div className="mx-6 mt-4 p-4 rounded-2xl bg-[#FFEAD9] border-2 border-[#C83E4D] flex items-start gap-3 text-xs">
                    <AlertTriangle className="w-5 h-5 text-[#C83E4D] shrink-0 mt-0.5" strokeWidth={2.2} />
                    <div className="space-y-0.5">
                      <div className="font-extrabold text-[#C83E4D]">
                        Group Expired Before Threshold — No Refund Needed
                      </div>
                      <p className="text-[#29232F]">
                        This group pool did not reach its minimum commitment threshold before the deadline. Since no upfront payment was collected, no refund is necessary.
                      </p>
                    </div>
                  </div>
                )}

                {/* Expired Group Order Resolution Card */}
                {order.expiredResolutionStatus === 'pending_choice' && !cancelled && (
                  <div className="mx-6 mt-4 p-4 rounded-2xl bg-[#FFEAD9] border-2 border-[#C83E4D] space-y-3">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-[#C83E4D] shrink-0 mt-0.5" strokeWidth={2.2} />
                      <div className="space-y-1 text-xs">
                        <h3 className="text-sm font-extrabold text-[#24152F]">
                          Group Threshold Not Met Before Deadline — Choose Next Step
                        </h3>
                        <p className="text-[#29232F]">
                          Only {order.groupPaidCount ?? 0} of {order.groupMinParticipants ?? 5} required buyers completed payment before expiration. Select whether to continue with normal individual delivery or cancel your order.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleExpiredResolution(order.id, 'continue_individual')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        <Truck className="w-4 h-4" strokeWidth={2} />
                        <span>
                          Continue Individual Delivery (+
                          {formatINR(order.individualDeliveryOptionFee ?? INDIVIDUAL_DELIVERY_FEE_INR)}{' '}
                          shipping)
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleExpiredResolution(order.id, 'cancel_refund')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#FFFFFF] bg-[#C83E4D] hover:bg-[#9E2A3B] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        <XCircle className="w-4 h-4" strokeWidth={2} />
                        <span>
                          {order.paymentStatus === 'Paid (Simulated)'
                            ? 'Cancel Order & Receive Full Refund'
                            : 'Cancel Unpaid Order'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {order.expiredResolutionStatus === 'continued_individual' && !cancelled && (
                  <div className="mx-6 mt-4 p-3 rounded-xl bg-[#FFF8F0] border border-[#24152F] text-xs font-semibold text-[#24152F]">
                    Converted from expired group pool to Normal Individual Delivery ({formatINR(order.shippingFee)} shipping).
                  </div>
                )}

                {/* Delivery Availability Confirmation Prompt */}
                {isAwaitingAvailability && (
                  <div className="mx-6 mt-4 p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#FF783D] space-y-3">
                    <div className="flex items-start gap-3">
                      <Truck className="w-5 h-5 text-[#FF783D] shrink-0 mt-0.5" strokeWidth={2} />
                      <div className="flex-1">
                        <h3 className="text-sm font-extrabold text-[#24152F]">
                          Your Order is Out for Delivery — Please Confirm Availability
                        </h3>
                        <p className="text-xs text-[#5E5468] mt-0.5">
                          Scheduled for <strong className="text-[#24152F]">{order.scheduledWindow}</strong>. Confirm you are available or choose another delivery window.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleAvailabilityAction(order.id, true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#D9F36A] hover:bg-[#cce856] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                        <span>{isBusy ? 'Confirming...' : "I'm Available"}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setRescheduleOpenId((prev) => (prev === order.id ? null : order.id))
                        }
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#C83E4D] bg-[#FFFFFF] border-2 border-[#C83E4D] rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <Clock className="w-4 h-4" strokeWidth={2} />
                        <span>Not Available</span>
                      </button>
                    </div>

                    {rescheduleOpenId === order.id && (
                      <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E6D8CB] space-y-2.5">
                        <label className="block text-xs font-extrabold text-[#24152F]">
                          Choose a suitable delivery time to reschedule:
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <select
                            value={selectedSlot}
                            onChange={(e) => setSelectedSlot(e.target.value)}
                            className="flex-1 px-3 py-2 text-xs font-semibold bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                          >
                            {RESCHEDULE_SLOTS.map((slot) => (
                              <option key={slot} value={slot}>
                                {slot}
                              </option>
                            ))}
                            <option value="__custom__">Enter custom delivery window...</option>
                          </select>
                          <button
                            type="button"
                            disabled={
                              isBusy || (selectedSlot === '__custom__' && !customSlot.trim())
                            }
                            onClick={() =>
                              handleAvailabilityAction(
                                order.id,
                                false,
                                selectedSlot === '__custom__' ? customSlot.trim() : selectedSlot
                              )
                            }
                            className="px-4 py-2 text-xs font-extrabold text-[#FFFFFF] bg-[#C83E4D] rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            Request Reschedule
                          </button>
                        </div>
                        {selectedSlot === '__custom__' && (
                          <input
                            type="text"
                            value={customSlot}
                            onChange={(e) => setCustomSlot(e.target.value)}
                            placeholder="e.g. Thursday · After 6:00 PM"
                            className="w-full px-3 py-2 text-xs bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}

                {isRescheduled && !cancelled && (
                  <div className="mx-6 mt-4 p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#C83E4D] flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-[#C83E4D] shrink-0 mt-0.5" strokeWidth={2} />
                    <div className="text-xs space-y-0.5">
                      <div className="font-extrabold text-[#C83E4D]">
                        Delivery Not Confirmed — Reschedule Requested
                      </div>
                      <p className="text-[#29232F]">
                        Preferred window requested: <strong>{order.rescheduleRequestedWindow}</strong>. Dispatch is paused until the rescheduled window.
                      </p>
                    </div>
                  </div>
                )}

                {order.deliveryPartner && !cancelled && (
                  <div className="mx-6 mt-4 p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#24152F] space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5">
                        <img
                          src={order.deliveryPartner.avatarUrl}
                          alt={order.deliveryPartner.name}
                          className="w-12 h-12 rounded-full object-cover border-2 border-[#FF783D] bg-[#FFFFFF] shrink-0"
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-extrabold text-[#24152F]">
                              {order.deliveryPartner.name}
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-[#24152F] text-[#D9F36A] text-[11px] font-mono font-bold">
                              ID: {order.deliveryPartner.id}
                            </span>
                            <span className="inline-flex items-center gap-0.5 text-xs font-mono font-bold text-[#24152F]">
                              <Star className="w-3 h-3 fill-[#FF783D] text-[#FF783D]" />
                              {order.deliveryPartner.rating.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#5E5468] mt-1">
                            <span className="inline-flex items-center gap-1 text-[#24152F] font-bold">
                              <Phone className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                              <span>{order.deliveryPartner.phone}</span>
                            </span>
                            <span>· {order.deliveryPartner.vehicle}</span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-[#FF783D]" />
                              {order.deliveryPartner.hubZone}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <div className="text-[11px] uppercase tracking-wider font-extrabold text-[#FF783D]">
                          Estimated Delivery Time
                        </div>
                        <div className="text-sm font-mono font-extrabold text-[#24152F] mt-0.5">
                          {order.trackingEta || 'Today · Est. 25–40 mins'}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-extrabold text-[#24152F] inline-flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-[#2F7D4C]" strokeWidth={2} />
                          <span>Status: {order.trackingStage}</span>
                        </span>
                        <span className="text-[11px] text-[#5E5468]">
                          {order.liveTrackingConfigured
                            ? 'Live carrier GPS telemetry connected'
                            : 'Simulated dispatch tracking'}
                        </span>
                      </div>

                      <div className="grid grid-cols-5 gap-1.5">
                        {TRACKING_STEPS.map((label, idx) => {
                          const completed = idx <= stepIndex;
                          return (
                            <div key={label} className="space-y-1">
                              <div
                                className={`h-2 rounded-full ${
                                  completed ? 'bg-[#FF783D]' : 'bg-[#E6D8CB]'
                                }`}
                              />
                              <div
                                className={`text-[10px] leading-tight ${
                                  completed ? 'text-[#24152F] font-extrabold' : 'text-[#5E5468]'
                                }`}
                              >
                                {label}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {order.fulfillmentStatus === 'Out for Delivery' && (() => {
                      const draft = getReceiptDraft(order);
                      return (
                        <div className="pt-3 border-t border-[#E6D8CB] space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <ClipboardCheck className="w-4 h-4 text-[#24152F]" strokeWidth={2} />
                              <span className="text-xs font-extrabold text-[#24152F]">
                                Doorstep Handover Verification
                              </span>
                            </div>
                            {order.handoverPin && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#D9F36A] border border-[#24152F] text-xs font-mono font-extrabold text-[#24152F]">
                                <KeyRound className="w-3.5 h-3.5" strokeWidth={2} />
                                <span>PIN: {order.handoverPin}</span>
                              </span>
                            )}
                          </div>

                          <div className="space-y-1.5 text-xs">
                            <label className="flex items-center gap-2 cursor-pointer text-[#24152F] font-semibold">
                              <input
                                type="checkbox"
                                checked={draft.parcelIntact}
                                onChange={(e) =>
                                  updateReceiptDraft(order, {
                                    parcelIntact: e.target.checked,
                                    error: null,
                                  })
                                }
                                className="w-4 h-4 accent-[#24152F] rounded cursor-pointer"
                              />
                              <span>Outer packaging &amp; security seal intact</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer text-[#24152F] font-semibold">
                              <input
                                type="checkbox"
                                checked={draft.itemsVerified}
                                onChange={(e) =>
                                  updateReceiptDraft(order, {
                                    itemsVerified: e.target.checked,
                                    error: null,
                                  })
                                }
                                className="w-4 h-4 accent-[#24152F] rounded cursor-pointer"
                              />
                              <span>Items &amp; quantity match order manifest</span>
                            </label>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={draft.pin}
                              onChange={(e) =>
                                updateReceiptDraft(order, { pin: e.target.value, error: null })
                              }
                              placeholder="4-digit PIN"
                              className="sm:w-32 px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                            />
                            <input
                              type="text"
                              value={draft.receiverNote}
                              onChange={(e) =>
                                updateReceiptDraft(order, { receiverNote: e.target.value })
                              }
                              placeholder="Optional receiver note"
                              className="flex-1 px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                            />
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleCompleteReceiving(order)}
                              className="px-4 py-2 rounded-xl text-xs font-extrabold bg-[#FF783D] text-[#24152F] border-2 border-[#24152F] cursor-pointer shrink-0 disabled:opacity-50"
                            >
                              {isBusy ? 'Recording...' : 'Confirm Package Received'}
                            </button>
                          </div>

                          {draft.error && (
                            <p className="text-[11px] font-bold text-[#C83E4D]">{draft.error}</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Order Items */}
                <div className="divide-y divide-[#E6D8CB] mt-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="px-6 py-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <ProductImage
                          src={item.productImage}
                          alt={item.productName}
                          className="w-16 h-12 rounded-xl shrink-0 border border-[#E6D8CB]"
                        />
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onSelectProduct(item.productId)}
                            className="font-display text-sm font-extrabold text-[#24152F] hover:text-[#FF783D] truncate block cursor-pointer"
                          >
                            {item.productName}
                          </button>
                          <div className="text-xs text-[#5E5468] mt-0.5">
                            {item.sellerName} · Qty {item.quantity}
                            {item.dealId && ' · Group Deal Price'}
                            {item.deliveryDate && ` · Scheduled ${item.deliveryDate}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-mono font-extrabold tabular-nums text-[#24152F] shrink-0">
                        {formatINR(item.unitPrice * item.quantity)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
