import { useState } from 'react';
import {
  ArrowLeft,
  Award,
  BellRing,
  Box,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  KeyRound,
  MapPin,
  Navigation,
  PackageCheck,
  Phone,
  ShieldCheck,
  ShoppingBag,
  Star,
  Truck,
  UserCheck,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import { formatINR } from '../utils/currency.ts';
import type { DeliveryLifecycleStageKey, Order } from '../types.ts';

interface OrderDeliveryLifecycleProps {
  order: Order;
  onBack?: () => void;
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
  onSelectProduct: (productId: string) => void;
}

interface StageConfig {
  key: DeliveryLifecycleStageKey;
  title: string;
  description: string;
  icon: typeof ShoppingBag;
}

const DELIVERY_STAGES: StageConfig[] = [
  {
    key: 'order_confirmed',
    title: 'Order Confirmed',
    description: 'Order successfully placed.',
    icon: ShoppingBag,
  },
  {
    key: 'order_processed',
    title: 'Order Processed',
    description: 'Seller has accepted and packed the order.',
    icon: PackageCheck,
  },
  {
    key: 'ready_for_dispatch',
    title: 'Ready for Dispatch',
    description: 'Package is ready to leave the seller.',
    icon: Box,
  },
  {
    key: 'out_for_delivery',
    title: 'Out for Delivery',
    description: 'Delivery partner has collected the package.',
    icon: Truck,
  },
  {
    key: 'availability_confirmation',
    title: 'Delivery Availability Confirmation',
    description: 'Customer receives a notification asking whether they are available.',
    icon: BellRing,
  },
  {
    key: 'partner_assigned',
    title: 'Delivery Partner Assigned',
    description: 'Show delivery partner details.',
    icon: UserCheck,
  },
  {
    key: 'delivered',
    title: 'Delivered',
    description: 'Order successfully delivered.',
    icon: Award,
  },
];

const RESCHEDULE_SLOTS = [
  'Tomorrow · Morning (8am–12pm)',
  'Tomorrow · Afternoon (12pm–4pm)',
  'Tomorrow · Evening (4pm–8pm)',
  'Sat · Morning (8am–12pm)',
  'Sun · Afternoon (12pm–4pm)',
];

function formatTimestamp(iso?: string): string {
  if (!iso) return 'Pending';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Pending';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OrderDeliveryLifecycle({
  order,
  onBack,
  onRespondAvailability,
  onConfirmReceipt,
  onRateDelivery,
  onSelectProduct,
}: OrderDeliveryLifecycleProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(RESCHEDULE_SLOTS[0]);
  const [customSlot, setCustomSlot] = useState('');
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);

  // Doorstep handover verification state
  const [pinInput, setPinInput] = useState(order.handoverPin || '');
  const [parcelIntact, setParcelIntact] = useState(false);
  const [itemsVerified, setItemsVerified] = useState(false);
  const [receiverNote, setReceiverNote] = useState('');
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // Delivery rating state
  const [ratingDraft, setRatingDraft] = useState<number>(order.deliveryRating || 5);
  const [feedbackDraft, setFeedbackDraft] = useState<string>(order.deliveryFeedback || '');
  const [ratingSavedMsg, setRatingSavedMsg] = useState<string | null>(null);

  const stageOrderKeys = DELIVERY_STAGES.map((s) => s.key);
  const activeStageIndex = Math.max(0, stageOrderKeys.indexOf(order.lifecycleStage));

  const isRescheduled =
    order.deliveryAvailabilityStatus === 'Delivery Rescheduled' ||
    order.deliveryAvailabilityStatus === 'Reschedule Requested';
  const isAvailableConfirmed = order.deliveryAvailabilityStatus === 'Availability Confirmed';
  const isDelivered = order.lifecycleStage === 'delivered' || order.fulfillmentStatus === 'Delivered';
  const isCancelled = order.fulfillmentStatus === 'Cancelled';

  const showAvailabilityNotificationCard =
    !isDelivered &&
    !isCancelled &&
    (order.lifecycleStage === 'out_for_delivery' ||
      order.lifecycleStage === 'availability_confirmation' ||
      order.fulfillmentStatus === 'Out for Delivery' ||
      isRescheduled);

  const mapProgressPct =
    isDelivered
      ? 100
      : order.deliveryPartner
        ? 78
        : order.lifecycleStage === 'out_for_delivery' ||
            order.lifecycleStage === 'availability_confirmation'
          ? 52
          : order.lifecycleStage === 'ready_for_dispatch'
            ? 32
            : order.lifecycleStage === 'order_processed'
              ? 18
              : 8;

  async function handleConfirmAvailable() {
    setBusyAction('available');
    try {
      await onRespondAvailability(order.id, true);
      setRescheduleOpen(false);
      setAvailabilityMessage(
        'Availability confirmed! A CartSync delivery partner has been assigned and is en route.'
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmReschedule() {
    const chosen = selectedSlot === '__custom__' ? customSlot.trim() : selectedSlot;
    if (!chosen) return;
    setBusyAction('reschedule');
    try {
      await onRespondAvailability(order.id, false, chosen);
      setRescheduleOpen(false);
      setCustomSlot('');
      setAvailabilityMessage(
        `Delivery Rescheduled to "${chosen}". A simulated schedule confirmation notification has been added.`
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDoorstepConfirm() {
    if (!parcelIntact || !itemsVerified) {
      setReceiptError('Please check both doorstep verification boxes first.');
      return;
    }
    if (order.handoverPin && pinInput.trim() !== order.handoverPin) {
      setReceiptError(`Handover PIN mismatch. Expected ${order.handoverPin}.`);
      return;
    }
    setBusyAction('confirm_receipt');
    setReceiptError(null);
    try {
      await onConfirmReceipt(order.id, {
        verificationPin: pinInput.trim() || order.handoverPin || '',
        parcelIntact,
        itemsVerified,
        receiverNote: receiverNote.trim() || undefined,
      });
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : 'Unable to confirm package receipt.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRateSubmit() {
    setBusyAction('rate');
    setRatingSavedMsg(null);
    try {
      await onRateDelivery(order.id, ratingDraft, feedbackDraft.trim() || undefined);
      setRatingSavedMsg(`Thank you! Your ${ratingDraft}-star delivery rating has been saved.`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Bar */}
      <div className="border-2 border-[#24152F] rounded-2xl bg-[#FFFFFF] p-6 shadow-card space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FFF8F0] border border-[#24152F] text-xs font-extrabold text-[#24152F] hover:bg-[#D9F36A] mb-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                <span>All Orders</span>
              </button>
            )}
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-[#5E5468]">
              <span className="font-mono font-extrabold text-[#24152F]">Order #{order.id}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Placed {formatTimestamp(order.createdAt)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-extrabold text-[#FF783D]">
                {order.deliveryMode === 'combined' ? 'Combined Delivery' : 'Normal Delivery'}
              </span>
            </div>
            <h2 className="font-display text-2xl font-extrabold text-[#24152F]">
              Live Order &amp; Delivery Lifecycle Tracker
            </h2>
          </div>

          <div className="text-left sm:text-right">
            <div className="text-xs font-semibold text-[#5E5468]">{order.paymentStatus}</div>
            <div className="font-mono text-2xl font-extrabold text-[#24152F] tabular-nums">
              {formatINR(order.totalAmount)}
            </div>
          </div>
        </div>

        {/* Key Order Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-[#E6D8CB] text-xs">
          <div>
            <span className="text-[#5E5468] block">Payment Method</span>
            <span className="font-extrabold text-[#24152F] mt-0.5 block">
              {order.paymentMethod || 'Card ending in 4242 (Simulated)'}
            </span>
          </div>
          <div>
            <span className="text-[#5E5468] block">Delivery Address</span>
            <span className="font-extrabold text-[#24152F] mt-0.5 block">
              {order.customerAddress || '418 Pine St, Apt 4B, Seattle, WA'}
            </span>
          </div>
          <div>
            <span className="text-[#5E5468] block">Estimated Delivery Date</span>
            <span className="font-extrabold text-[#24152F] mt-0.5 block">{order.scheduledWindow}</span>
          </div>
          <div>
            <span className="text-[#5E5468] block">Current Delivery Status</span>
            <span
              className={`font-extrabold mt-0.5 block ${
                isCancelled
                  ? 'text-[#C83E4D]'
                  : isDelivered
                    ? 'text-[#2F7D4C]'
                    : isRescheduled
                      ? 'text-[#C83E4D]'
                      : 'text-[#FF783D]'
              }`}
            >
              {isCancelled ? 'Cancelled' : order.trackingStage}
            </span>
          </div>
        </div>

        {/* Ordered Products Row */}
        <div className="pt-3 border-t border-[#E6D8CB] flex flex-wrap gap-3">
          {order.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectProduct(item.productId)}
              className="flex items-center gap-3 p-2.5 pr-4 rounded-xl bg-[#FFF8F0] border-2 border-[#E6D8CB] hover:border-[#24152F] transition-colors text-left cursor-pointer"
            >
              <ProductImage
                src={item.productImage}
                alt={item.productName}
                className="w-12 h-10 rounded-lg shrink-0 border border-[#E6D8CB]"
              />
              <div className="text-xs">
                <div className="font-extrabold text-[#24152F]">{item.productName}</div>
                <div className="text-[#5E5468] font-mono tabular-nums">
                  Qty {item.quantity} · {formatINR(item.unitPrice * item.quantity)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Simulated Real-Time In-App Notification Card */}
      {showAvailabilityNotificationCard && (
        <section
          aria-label="Simulated Delivery Notification"
          className="border-2 border-[#FF783D] rounded-2xl bg-[#24152F] text-[#FFFFFF] p-5 shadow-card space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FF783D] text-[#24152F] flex items-center justify-center shrink-0">
                <BellRing className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[#D9F36A]">
                  Simulated In-App Notification (not live SMS/carrier push)
                </div>
                <h3 className="font-display text-lg font-extrabold text-[#FFFFFF] mt-0.5">
                  Your order is out for delivery! Are you available to receive it?
                </h3>
                <p className="text-xs text-[#BBA5D5] mt-1">
                  Scheduled window: <strong className="text-[#FFFFFF]">{order.scheduledWindow}</strong>
                </p>
              </div>
            </div>

            {isAvailableConfirmed && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#D9F36A] text-[#24152F] text-xs font-extrabold">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                <span>Availability Confirmed</span>
              </span>
            )}
            {isRescheduled && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#C83E4D] text-[#FFFFFF] text-xs font-extrabold">
                <CalendarClock className="w-4 h-4" strokeWidth={2} />
                <span>Delivery Rescheduled</span>
              </span>
            )}
          </div>

          {!isAvailableConfirmed && !isRescheduled && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleConfirmAvailable}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-[#24152F] bg-[#D9F36A] hover:bg-[#cce856] rounded-xl cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" strokeWidth={2.2} />
                <span>{busyAction === 'available' ? 'Confirming...' : "I'm Available"}</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => setRescheduleOpen((v) => !v)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-[#FFFFFF] bg-[#352145] hover:bg-[#C83E4D] border-2 border-[#BBA5D5] rounded-xl cursor-pointer disabled:opacity-50"
              >
                <Clock className="w-4 h-4" strokeWidth={2} />
                <span>I&apos;m Not Available</span>
              </button>
            </div>
          )}

          {availabilityMessage && (
            <div className="p-3 rounded-xl bg-[#D9F36A] text-xs font-bold text-[#24152F]">
              {availabilityMessage}
            </div>
          )}

          {isRescheduled && (
            <div className="p-3.5 rounded-xl bg-[#C83E4D] text-xs space-y-1 text-[#FFFFFF]">
              <div className="font-extrabold">Delivery Rescheduled — Notification Confirmed</div>
              <p>
                New delivery schedule confirmed for{' '}
                <strong>{order.rescheduleRequestedWindow || order.scheduledWindow}</strong>.
              </p>
            </div>
          )}

          {rescheduleOpen && (
            <div className="p-4 rounded-xl bg-[#FFF8F0] text-[#29232F] space-y-3">
              <div className="text-xs font-extrabold text-[#24152F]">
                Choose a suitable alternative delivery time
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <select
                  value={selectedSlot}
                  onChange={(e) => setSelectedSlot(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs font-semibold bg-[#FFFFFF] border-2 border-[#24152F] rounded-xl text-[#24152F]"
                >
                  {RESCHEDULE_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                  <option value="__custom__">Enter custom delivery time...</option>
                </select>
                <button
                  type="button"
                  disabled={
                    busyAction !== null || (selectedSlot === '__custom__' && !customSlot.trim())
                  }
                  onClick={handleConfirmReschedule}
                  className="px-4 py-2 text-xs font-extrabold text-[#FFFFFF] bg-[#C83E4D] rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {busyAction === 'reschedule' ? 'Updating...' : 'Confirm Reschedule'}
                </button>
              </div>
              {selectedSlot === '__custom__' && (
                <input
                  type="text"
                  value={customSlot}
                  onChange={(e) => setCustomSlot(e.target.value)}
                  placeholder="e.g. Friday · After 5:30 PM"
                  className="w-full px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                />
              )}
            </div>
          )}
        </section>
      )}

      {/* Main 2-Column Grid: 7-Stage Timeline + Map / Partner / Completion */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-6 border-2 border-[#24152F] rounded-2xl bg-[#FFFFFF] p-6 shadow-card space-y-5">
          <div>
            <h3 className="font-display text-lg font-extrabold text-[#24152F]">
              Delivery Status Timeline
            </h3>
            <p className="text-xs text-[#5E5468] mt-0.5">
              Sequential tracking from confirmation through final doorstep delivery
            </p>
          </div>

          <ol className="space-y-4">
            {DELIVERY_STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const isCompleted = index < activeStageIndex || (index === 6 && isDelivered);
              const isCurrent = index === activeStageIndex && !isDelivered && !isCancelled;
              const isRescheduledHere =
                stage.key === 'availability_confirmation' && isRescheduled;
              const recordedAt = order.stageTimestamps?.[stage.key];

              const statusText = isRescheduledHere
                ? 'Delivery Rescheduled'
                : isCompleted
                  ? 'Completed'
                  : isCurrent
                    ? stage.key === 'availability_confirmation'
                      ? 'Awaiting Response'
                      : 'Current Stage'
                    : 'Pending';

              return (
                <li key={stage.key} className="relative flex gap-3.5">
                  {index < DELIVERY_STAGES.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={`absolute left-[17px] top-9 bottom-[-16px] w-0.5 ${
                        index < activeStageIndex ? 'bg-[#FF783D]' : 'bg-[#E6D8CB]'
                      }`}
                    />
                  )}

                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border-2 ${
                      isRescheduledHere
                        ? 'bg-[#C83E4D] border-[#24152F] text-[#FFFFFF]'
                        : isCompleted
                          ? 'bg-[#D9F36A] border-[#24152F] text-[#24152F]'
                          : isCurrent
                            ? 'bg-[#24152F] border-[#FF783D] text-[#FF783D]'
                            : 'bg-[#FFF8F0] border-[#E6D8CB] text-[#5E5468]'
                    }`}
                  >
                    <Icon className="w-4 h-4" strokeWidth={2} />
                  </div>

                  <div className="flex-1 pb-2 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`text-sm font-extrabold ${
                          isCompleted || isCurrent ? 'text-[#24152F]' : 'text-[#5E5468]'
                        }`}
                      >
                        {stage.title}
                      </span>
                      <span
                        className={`text-[11px] font-extrabold ${
                          isRescheduledHere
                            ? 'text-[#C83E4D]'
                            : isCompleted
                              ? 'text-[#2F7D4C]'
                              : isCurrent
                                ? 'text-[#FF783D]'
                                : 'text-[#5E5468]'
                        }`}
                      >
                        {statusText}
                      </span>
                    </div>
                    <p className="text-xs text-[#5E5468] mt-0.5">{stage.description}</p>
                    <div className="text-[11px] font-mono tabular-nums text-[#24152F] mt-1">
                      {isCompleted || isCurrent ? formatTimestamp(recordedAt) : 'Pending'}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="lg:col-span-6 space-y-6">
          {/* Simulated Live Route Map */}
          <section className="border-2 border-[#24152F] rounded-2xl bg-[#FFFFFF] p-6 shadow-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-extrabold text-[#24152F]">
                  Simulated Live Delivery Map
                </h3>
                <p className="text-xs text-[#5E5468] mt-0.5">
                  {order.liveTrackingConfigured
                    ? 'Connected to carrier dispatch API telemetry'
                    : 'Simulated courier route progression'}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-[#D9F36A] border border-[#24152F] font-mono text-xs font-extrabold tabular-nums text-[#24152F]">
                {mapProgressPct}% complete
              </span>
            </div>

            <div className="rounded-2xl border-2 border-[#E6D8CB] bg-[#FFF8F0] p-4 space-y-3">
              <div className="relative h-32 w-full">
                <svg
                  viewBox="0 0 420 110"
                  className="w-full h-full"
                  role="img"
                  aria-label="Simulated delivery route map"
                >
                  <line x1="20" y1="25" x2="400" y2="25" stroke="#E6D8CB" strokeWidth="1" />
                  <line x1="20" y1="55" x2="400" y2="55" stroke="#E6D8CB" strokeWidth="1" />
                  <line x1="20" y1="85" x2="400" y2="85" stroke="#E6D8CB" strokeWidth="1" />

                  <path
                    d="M 38 72 C 110 72, 130 34, 210 38 C 285 42, 305 72, 382 44"
                    fill="none"
                    stroke="#BBA5D5"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 38 72 C 110 72, 130 34, 210 38 C 285 42, 305 72, 382 44"
                    fill="none"
                    stroke="#FF783D"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray="380"
                    strokeDashoffset={380 - (380 * mapProgressPct) / 100}
                  />

                  <circle cx="38" cy="72" r="7" fill="#24152F" />
                  <circle cx="210" cy="38" r="7" fill={mapProgressPct >= 32 ? '#FF783D' : '#BBA5D5'} />
                  <circle cx="382" cy="44" r="8" fill={isDelivered ? '#D9F36A' : '#24152F'} stroke="#24152F" strokeWidth="2" />

                  {(() => {
                    const cx = 38 + ((382 - 38) * mapProgressPct) / 100;
                    const cy =
                      mapProgressPct < 50
                        ? 72 - ((72 - 38) * mapProgressPct) / 50
                        : 38 + ((44 - 38) * (mapProgressPct - 50)) / 50;
                    return (
                      <g transform={`translate(${cx}, ${cy})`}>
                        <circle r="13" fill="#24152F" stroke="#D9F36A" strokeWidth="2.5" />
                        <circle r="4" fill="#FF783D" />
                      </g>
                    );
                  })()}
                </svg>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 border-t border-[#E6D8CB]">
                <div>
                  <span className="font-extrabold text-[#24152F] block">Seller Studio</span>
                  <span className="text-[#5E5468]">Packed &amp; Verified</span>
                </div>
                <div className="text-center">
                  <span className="font-extrabold text-[#24152F] block">Dispatch Hub</span>
                  <span className="text-[#5E5468]">Seattle Sorting</span>
                </div>
                <div className="text-right">
                  <span className="font-extrabold text-[#24152F] block">Your Doorstep</span>
                  <span className="text-[#FF783D] font-bold">
                    {order.trackingEta || order.scheduledWindow}
                  </span>
                </div>
              </div>
            </div>

            {order.deliveryPartner ? (
              <div className="p-4 rounded-2xl bg-[#FFF8F0] border-2 border-[#24152F] space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-[#24152F]">
                  <span className="inline-flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                    <span>Delivery Partner Assigned</span>
                  </span>
                  <span className="font-mono">{order.trackingEta || 'Est. 25–40 mins'}</span>
                </div>

                <div className="flex items-center gap-3.5">
                  <img
                    src={order.deliveryPartner.avatarUrl}
                    alt={order.deliveryPartner.name}
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 rounded-full object-cover border-2 border-[#FF783D] bg-[#FFFFFF] shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-extrabold text-[#24152F]">
                        {order.deliveryPartner.name}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-[#24152F] text-[#D9F36A] text-[11px] font-mono font-bold">
                        {order.deliveryPartner.id}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-xs font-mono font-bold text-[#24152F]">
                        <Star className="w-3 h-3 fill-[#FF783D] text-[#FF783D]" />
                        {order.deliveryPartner.rating.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#29232F]">
                      <span className="inline-flex items-center gap-1 font-bold">
                        <Phone className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                        <span>{order.deliveryPartner.phone}</span>
                      </span>
                      <span>· {order.deliveryPartner.vehicle}</span>
                    </div>
                    <div className="text-xs text-[#5E5468] inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#FF783D]" />
                      <span>{order.deliveryPartner.hubZone}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB] text-xs text-[#5E5468]">
                A delivery partner will be assigned once you confirm &ldquo;I&apos;m Available&rdquo; at the Delivery Availability Confirmation stage.
              </div>
            )}
          </section>

          {order.deliveryPartner && !isDelivered && !isCancelled && (
            <section className="border-2 border-[#24152F] rounded-2xl bg-[#FFFFFF] p-6 shadow-card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-[#FF783D]" strokeWidth={2} />
                  <h3 className="font-display text-base font-extrabold text-[#24152F]">
                    Doorstep Receiving &amp; Handover Verification
                  </h3>
                </div>
                {order.handoverPin && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#D9F36A] border border-[#24152F] text-xs font-mono font-extrabold text-[#24152F]">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Handover PIN: {order.handoverPin}</span>
                  </span>
                )}
              </div>

              <div className="space-y-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-[#24152F] font-semibold">
                  <input
                    type="checkbox"
                    checked={parcelIntact}
                    onChange={(e) => {
                      setParcelIntact(e.target.checked);
                      setReceiptError(null);
                    }}
                    className="w-4 h-4 accent-[#24152F] rounded cursor-pointer"
                  />
                  <span>Outer packaging &amp; security seal intact</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[#24152F] font-semibold">
                  <input
                    type="checkbox"
                    checked={itemsVerified}
                    onChange={(e) => {
                      setItemsVerified(e.target.checked);
                      setReceiptError(null);
                    }}
                    className="w-4 h-4 accent-[#24152F] rounded cursor-pointer"
                  />
                  <span>Items &amp; quantity match order manifest</span>
                </label>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <input
                  type="text"
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setReceiptError(null);
                  }}
                  placeholder="4-digit PIN"
                  className="sm:w-32 px-3 py-2 text-xs font-mono bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                />
                <input
                  type="text"
                  value={receiverNote}
                  onChange={(e) => setReceiverNote(e.target.value)}
                  placeholder="Optional doorstep note"
                  className="flex-1 px-3 py-2 text-xs bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                />
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={handleDoorstepConfirm}
                  className="px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FF783D] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {busyAction === 'confirm_receipt' ? 'Saving...' : 'Confirm Package Received'}
                </button>
              </div>

              {receiptError && <p className="text-xs font-bold text-[#C83E4D]">{receiptError}</p>}
            </section>
          )}

          {isDelivered && (
            <section className="border-2 border-[#24152F] rounded-2xl bg-[#D9F36A] text-[#24152F] p-6 shadow-card space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#24152F] text-[#D9F36A] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6" strokeWidth={2} />
                </div>
                <div>
                  <h3 className="font-display text-xl font-extrabold">
                    Your Order Has Been Delivered!
                  </h3>
                  <p className="text-xs font-bold mt-0.5">
                    Delivered on {formatTimestamp(order.stageTimestamps?.delivered || order.createdAt)}
                  </p>
                  <p className="text-xs font-medium mt-1">
                    Order #{order.id} · {order.items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')}
                    {order.deliveryPartner ? ` · Courier: ${order.deliveryPartner.name}` : ''}
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-[#24152F]/20 space-y-3 bg-[#FFFFFF] p-4 rounded-xl border-2 border-[#24152F]">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-extrabold text-[#24152F]">Rate Your Delivery</h4>
                  {order.deliveryRating && (
                    <span className="text-xs font-extrabold text-[#2F7D4C]">
                      Rated {order.deliveryRating}/5 stars
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5" role="group" aria-label="Rate Your Delivery">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRatingDraft(star)}
                      aria-label={`Rate ${star} out of 5 stars`}
                      className="p-1.5 rounded-lg hover:bg-[#FFF8F0] cursor-pointer"
                    >
                      <Star
                        className={`w-6 h-6 ${
                          star <= ratingDraft ? 'fill-[#FF783D] text-[#FF783D]' : 'text-[#BBA5D5]'
                        }`}
                        strokeWidth={1.8}
                      />
                    </button>
                  ))}
                  <span className="ml-2 text-xs font-mono font-extrabold text-[#24152F] tabular-nums">
                    {ratingDraft} / 5
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={feedbackDraft}
                    onChange={(e) => setFeedbackDraft(e.target.value)}
                    placeholder="Share feedback on delivery speed or courier service (optional)"
                    className="flex-1 px-3.5 py-2 text-xs bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                  />
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleRateSubmit}
                    className="px-4 py-2 text-xs font-extrabold text-[#FFFFFF] bg-[#24152F] hover:bg-[#352145] rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {busyAction === 'rate'
                      ? 'Submitting...'
                      : order.deliveryRating
                        ? 'Update Delivery Rating'
                        : 'Submit Delivery Rating'}
                  </button>
                </div>

                {ratingSavedMsg && (
                  <p className="text-xs font-extrabold text-[#2F7D4C]">{ratingSavedMsg}</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
