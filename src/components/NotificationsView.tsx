import { useState } from 'react';
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  PackageCheck,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import { formatINR } from '../utils/currency.ts';
import type { AppNotification, UserRole } from '../types.ts';

interface NotificationsViewProps {
  role: UserRole;
  notifications: AppNotification[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onApproveGroupDeal: (dealId: string) => Promise<void>;
  onRejectGroupDeal: (dealId: string, reason?: string) => Promise<void>;
  onPayPendingOrder: (orderId: string) => Promise<void>;
  onRespondAvailability: (
    orderId: string,
    available: boolean,
    rescheduleWindow?: string
  ) => Promise<void>;
  onResolveExpiredOrder?: (
    orderId: string,
    action: 'continue_individual' | 'cancel_refund'
  ) => Promise<void>;
  onGoToOrders: () => void;
  onGoToGroupOrders?: () => void;
  onGoToCart?: () => void;
  onBackHome: () => void;
}

const RESCHEDULE_SLOTS = [
  'Tomorrow · Morning (8am–12pm)',
  'Tomorrow · Afternoon (12pm–4pm)',
  'Tomorrow · Evening (4pm–8pm)',
  'Sat · Morning (8am–12pm)',
  'Sun · Afternoon (12pm–4pm)',
];

export function NotificationsView({
  role,
  notifications,
  onMarkRead,
  onMarkAllRead,
  onApproveGroupDeal,
  onRejectGroupDeal,
  onPayPendingOrder,
  onRespondAvailability,
  onGoToOrders,
  onGoToGroupOrders,
  onBackHome,
}: NotificationsViewProps) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'groups' | 'delivery'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingDealId, setRejectingDealId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reschedulingOrderId, setReschedulingOrderId] = useState<string | null>(null);
  const [selectedWindow, setSelectedWindow] = useState(RESCHEDULE_SLOTS[0]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const filtered = notifications.filter((n) => {
    if (filter === 'unread') return !n.isRead;
    if (filter === 'groups') {
      return (
        n.type === 'seller_group_approval_request' ||
        n.type === 'group_approved' ||
        n.type === 'group_rejected' ||
        n.type === 'group_threshold_reached' ||
        n.type === 'group_confirmed' ||
        n.type === 'group_expired' ||
        n.type === 'group_payment_expired'
      );
    }
    if (filter === 'delivery') {
      return (
        n.type === 'delivery_availability_request' ||
        n.type === 'delivery_partner_assigned' ||
        n.type === 'delivery_reschedule_requested' ||
        n.type === 'delivery_rescheduled_confirmed'
      );
    }
    return true;
  });

  async function runAction(notifId: string, fn: () => Promise<void>) {
    setBusyId(notifId);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-3 border-b-2 border-[#E6D8CB] pb-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-[#5E5468]">
          <button type="button" onClick={onBackHome} className="hover:text-[#FF783D] cursor-pointer">
            Home
          </button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#24152F] font-bold">Notifications</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-[#FF783D]">
              Notification Centre (Simulated In-App Alerts)
            </div>
            <h1 className="font-display text-3xl font-extrabold text-[#24152F]">
              Order, Group &amp; Delivery Updates
            </h1>
            <p className="text-sm text-[#5E5468] mt-1">
              {unreadCount > 0
                ? `${unreadCount} unread update${unreadCount === 1 ? '' : 's'} synced with your account.`
                : 'All notifications are caught up.'}
            </p>
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="px-4 py-2.5 rounded-xl bg-[#24152F] text-[#D9F36A] text-xs font-extrabold hover:bg-[#352145] cursor-pointer self-start"
            >
              Mark All as Read
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'all', label: `All (${notifications.length})` },
            { id: 'unread', label: `Unread (${unreadCount})` },
            { id: 'groups', label: 'Group Orders' },
            { id: 'delivery', label: 'Delivery & Tracking' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold border-2 transition-colors cursor-pointer ${
              filter === tab.id
                ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                : 'bg-[#FFFFFF] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      {filtered.length === 0 ? (
        <div className="p-12 text-center border-2 border-[#E6D8CB] rounded-2xl bg-[#FFFFFF] space-y-2">
          <Bell className="w-8 h-8 text-[#FF783D] mx-auto" strokeWidth={2} />
          <h2 className="font-display text-lg font-extrabold text-[#24152F]">
            No notifications in this view
          </h2>
          <p className="text-xs text-[#5E5468] max-w-md mx-auto">
            {role === 'seller'
              ? 'Threshold-reached group approvals and customer reschedule requests appear here.'
              : 'Group price approvals, individual payment windows, availability prompts, and order updates appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((n) => {
            const meta = (n.metadata || {}) as Record<string, unknown>;
            const dealId = typeof meta.dealId === 'string' ? meta.dealId : null;
            const orderId = typeof meta.orderId === 'string' ? meta.orderId : null;
            const finalGroupPrice =
              typeof meta.finalGroupPrice === 'number' ? meta.finalGroupPrice : null;
            const paymentExpiresAt =
              typeof meta.paymentExpiresAt === 'string' ? meta.paymentExpiresAt : null;
            const isSellerReq = n.type === 'seller_group_approval_request';
            const isAvailReq = n.type === 'delivery_availability_request';
            const isPendingAction = n.actionStatus === 'pending';
            const isBusy = busyId === n.id;

            const isPositive =
              n.type === 'group_approved' ||
              n.type === 'group_confirmed' ||
              n.type === 'group_threshold_reached' ||
              n.type === 'delivery_partner_assigned';
            const isNegative =
              n.type === 'group_rejected' ||
              n.type === 'group_expired' ||
              n.type === 'group_payment_expired';

            return (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.isRead && !isPendingAction) {
                    onMarkRead(n.id);
                  }
                }}
                className={`p-5 rounded-2xl border-2 transition-colors space-y-3 ${
                  !n.isRead
                    ? 'bg-[#FFFFFF] border-[#FF783D] shadow-card'
                    : 'bg-[#FFFFFF] border-[#E6D8CB]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isPositive
                          ? 'bg-[#D9F36A] text-[#24152F]'
                          : isNegative
                            ? 'bg-[#C83E4D] text-[#FFFFFF]'
                            : 'bg-[#24152F] text-[#FF783D]'
                      }`}
                    >
                      {isPositive ? (
                        <CheckCircle2 className="w-4 h-4" strokeWidth={2.2} />
                      ) : isNegative ? (
                        <XCircle className="w-4 h-4" strokeWidth={2.2} />
                      ) : n.type === 'delivery_availability_request' ? (
                        <Truck className="w-4 h-4" strokeWidth={2.2} />
                      ) : n.type === 'delivery_reschedule_requested' ||
                          n.type === 'delivery_rescheduled_confirmed' ? (
                        <CalendarClock className="w-4 h-4" strokeWidth={2.2} />
                      ) : (
                        <Users className="w-4 h-4" strokeWidth={2.2} />
                      )}
                    </span>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-extrabold text-[#24152F]">{n.title}</h3>
                        {!n.isRead && (
                          <span className="px-2 py-0.5 rounded-md bg-[#FF783D] text-[#24152F] text-[10px] font-extrabold uppercase">
                            Unread
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-[#5E5468] block mt-0.5">
                        {new Date(n.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkRead(n.id);
                      }}
                      className="text-xs font-bold text-[#24152F] hover:text-[#FF783D] underline shrink-0 cursor-pointer"
                    >
                      Mark Read
                    </button>
                  )}
                </div>

                <p className="text-xs text-[#29232F] leading-relaxed">{n.message}</p>

                {n.type === 'group_approved' && (finalGroupPrice !== null || paymentExpiresAt) && (
                  <div className="p-3 rounded-xl bg-[#FFF8F0] border border-[#24152F] flex flex-wrap items-center gap-3 text-xs text-[#24152F]">
                    {finalGroupPrice !== null && (
                      <span className="font-mono font-extrabold">
                        Confirmed Price: {formatINR(finalGroupPrice)}/unit
                      </span>
                    )}
                    {paymentExpiresAt && (
                      <span className="font-semibold">
                        Pay before: {new Date(paymentExpiresAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                )}

                {n.type === 'group_expired' && (
                  <div className="text-[11px] font-semibold text-[#5E5468]">
                    No payment was collected when you joined, so no refund is needed.
                  </div>
                )}

                {isSellerReq && dealId && isPendingAction && (
                  <div className="space-y-2.5 pt-1" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => runAction(n.id, () => onApproveGroupDeal(dealId))}
                        className="px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#D9F36A] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        {isBusy ? 'Approving...' : 'Approve Final Group Price'}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setRejectingDealId((prev) => (prev === dealId ? null : dealId))
                        }
                        className="px-4 py-2 text-xs font-bold text-[#C83E4D] bg-[#FFFFFF] border-2 border-[#C83E4D] rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                    {rejectingDealId === dealId && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Optional decline note..."
                          className="flex-1 px-3 py-2 text-xs bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            runAction(n.id, async () => {
                              await onRejectGroupDeal(dealId, rejectReason);
                              setRejectingDealId(null);
                              setRejectReason('');
                            })
                          }
                          className="px-4 py-2 text-xs font-extrabold bg-[#C83E4D] text-[#FFFFFF] rounded-xl cursor-pointer"
                        >
                          Confirm Decline
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {n.type === 'group_approved' && orderId && isPendingAction && (
                  <div className="flex flex-wrap items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => runAction(n.id, () => onPayPendingOrder(orderId))}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <CreditCard className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>{isBusy ? 'Processing Payment...' : 'Complete Payment Now'}</span>
                    </button>
                  </div>
                )}

                {isAvailReq && orderId && isPendingAction && (
                  <div className="space-y-2.5 pt-1" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          runAction(n.id, () => onRespondAvailability(orderId, true))
                        }
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FF783D] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>{isBusy ? 'Confirming...' : "I'm Available"}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setReschedulingOrderId((prev) => (prev === orderId ? null : orderId))
                        }
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#C83E4D] bg-[#FFFFFF] border-2 border-[#C83E4D] rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <Clock className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>I&apos;m Not Available</span>
                      </button>
                    </div>

                    {reschedulingOrderId === orderId && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select
                          value={selectedWindow}
                          onChange={(e) => setSelectedWindow(e.target.value)}
                          className="flex-1 px-3 py-2 text-xs font-semibold bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-xl"
                        >
                          {RESCHEDULE_SLOTS.map((slot) => (
                            <option key={slot} value={slot}>
                              {slot}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(n.id, async () => {
                              await onRespondAvailability(orderId, false, selectedWindow);
                              setReschedulingOrderId(null);
                            })
                          }
                          className="px-4 py-2 text-xs font-extrabold bg-[#C83E4D] text-[#FFFFFF] rounded-xl cursor-pointer"
                        >
                          Reschedule Delivery
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {onGoToGroupOrders &&
                    (n.type === 'group_approved' ||
                      n.type === 'group_confirmed' ||
                      n.type === 'group_threshold_reached' ||
                      n.type === 'group_expired' ||
                      n.type === 'group_payment_expired' ||
                      n.type === 'group_rejected') && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMarkRead(n.id);
                          onGoToGroupOrders();
                        }}
                        className="inline-flex items-center gap-1 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] underline cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>View Group Orders</span>
                      </button>
                    )}

                  {(n.type === 'group_approved' ||
                    n.type === 'group_confirmed' ||
                    n.type === 'group_payment_expired' ||
                    n.type === 'delivery_partner_assigned' ||
                    n.type === 'delivery_availability_request') && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkRead(n.id);
                        onGoToOrders();
                      }}
                      className="inline-flex items-center gap-1 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] underline cursor-pointer"
                    >
                      <PackageCheck className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>View My Orders</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
