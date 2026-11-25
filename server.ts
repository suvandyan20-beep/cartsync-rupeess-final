import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { db, hashPassword, initDatabase, resetDatabaseToFirstStage } from './server/db.ts';
import { detectSuspiciousReviewPattern, runGeminiCameraSearch, runGeminiProductAudit } from './server/ai.ts';
import type {
  AppNotification,
  AvailabilitySlot,
  CartItem,
  DeliveryLifecycleStageKey,
  DeliveryPartner,
  GroupDeal,
  GroupDealMember,
  GroupDealStageLabel,
  GroupMemberProgressStatus,
  NotificationPrefs,
  Order,
  OrderItem,
  Product,
  ProductInsights,
  ProductSpec,
  Review,
  SavedAddress,
  SellerAnalytics,
  SocialGroup,
  SocialGroupActivity,
  SocialGroupCategory,
  SocialGroupInvitation,
  SocialGroupMember,
  SocialGroupMessage,
  SocialGroupSharedProduct,
  SpecDiscrepancy,
  User,
} from './src/types.ts';

initDatabase();
resetDatabaseToFirstStage();

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function insertNotification(params: {
  userId: string;
  type: AppNotification['type'];
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  actionStatus?: AppNotification['actionStatus'];
  dedupeMatch?: string;
  onlyPendingDedupe?: boolean;
}): string | null {
  if (params.dedupeMatch) {
    const dedupeSql = params.onlyPendingDedupe
      ? `SELECT id FROM notifications WHERE user_id = ? AND type = ? AND action_status = 'pending' AND metadata_json LIKE ? LIMIT 1`
      : `SELECT id FROM notifications WHERE user_id = ? AND type = ? AND metadata_json LIKE ? LIMIT 1`;
    const existing = db
      .prepare(dedupeSql)
      .get(params.userId, params.type, `%${params.dedupeMatch}%`) as { id: string } | undefined;
    if (existing) {
      return null;
    }
  }

  const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, message, metadata_json, is_read, action_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    notifId,
    params.userId,
    params.type,
    params.title,
    params.message,
    params.metadata ? JSON.stringify(params.metadata) : null,
    params.actionStatus ?? 'info',
    new Date().toISOString()
  );
  return notifId;
}

const INDIVIDUAL_DELIVERY_FEE = 49;

function formatINRServer(amount: number): string {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '₹0';
  const rounded = Math.round(num * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const formatted = Math.abs(isWhole ? Math.round(rounded) : rounded).toLocaleString('en-IN', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  });
  return rounded < 0 ? `-₹${formatted}` : `₹${formatted}`;
}

function runAllGroupDealSweeps(): number {
  const thresholdExpired = processExpiredGroupDeals();
  const paymentExpired = processExpiredGroupPaymentWindows();
  return thresholdExpired + paymentExpired;
}

function computeStageLabel(
  status: string,
  expiresAt: string,
  committedCount: number,
  paidCount: number,
  minParticipants: number,
  paymentExpiresAt?: string | null
): GroupDealStageLabel {
  if (status === 'rejected') return 'Rejected';
  if (status === 'expired' || status === 'dissolved') return 'Expired';
  if (status === 'confirmed' || status === 'approved' || status === 'completed') {
    if (paidCount > 0 && paidCount >= committedCount) {
      return 'Confirmed';
    }
    if (paymentExpiresAt && !Number.isNaN(Date.parse(paymentExpiresAt)) && Date.parse(paymentExpiresAt) <= Date.now() && paidCount === 0) {
      return 'Expired';
    }
    return 'Approved · Awaiting Payments';
  }
  if (status === 'pending_approval' || status === 'threshold_reached' || status === 'group_full') {
    return 'Pending Seller Approval';
  }
  const expMs = Date.parse(expiresAt);
  if (!Number.isNaN(expMs) && expMs <= Date.now() && committedCount < minParticipants) {
    return 'Expired';
  }
  return 'Waiting for Group Completion';
}

function hydrateGroupDeal(
  dealRow: Record<string, unknown>,
  productPrice: number,
  currentUserId?: string,
  extraProductInfo?: { productName?: string; productImage?: string }
): GroupDeal {
  const dealId = String(dealRow.id);
  const minParticipants = Math.max(1, Number(dealRow.min_participants));

  const memberRows = db
    .prepare(
      `SELECT gdm.user_id, u.name, gdm.quantity, gdm.commitment_status, gdm.confirmed_at, gdm.paid_at
       FROM group_deal_members gdm
       JOIN users u ON gdm.user_id = u.id
       WHERE gdm.deal_id = ?
       ORDER BY gdm.confirmed_at ASC`
    )
    .all(dealId) as Record<string, unknown>[];

  const orderRows = db
    .prepare(
      `SELECT o.id, o.customer_id, o.payment_status, o.fulfillment_status, o.created_at, u.name as customer_name,
              COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id AND oi.deal_id = ?), 1) as deal_qty
       FROM orders o
       JOIN users u ON o.customer_id = u.id
       WHERE o.deal_id = ?
       ORDER BY o.created_at DESC`
    )
    .all(dealId, dealId) as Record<string, unknown>[];

  const orderByCustomer = new Map<
    string,
    {
      orderId: string;
      paymentStatus: string;
      fulfillmentStatus: string;
      customerName: string;
      createdAt: string;
      quantity: number;
    }
  >();
  for (const o of orderRows) {
    const cid = String(o.customer_id);
    if (!orderByCustomer.has(cid)) {
      orderByCustomer.set(cid, {
        orderId: String(o.id),
        paymentStatus: String(o.payment_status),
        fulfillmentStatus: String(o.fulfillment_status),
        customerName: String(o.customer_name),
        createdAt: String(o.created_at),
        quantity: Number(o.deal_qty || 1),
      });
    }
  }

  const seenCustomerIds = new Set<string>();
  const members: GroupDealMember[] = [];

  for (const m of memberRows) {
    const uid = String(m.user_id);
    if (seenCustomerIds.has(uid)) continue;
    seenCustomerIds.add(uid);
    const ord = orderByCustomer.get(uid);
    const rawCommitment = String(m.commitment_status || 'Committed');
    let memberStatus: GroupMemberProgressStatus = 'Committed';
    if (rawCommitment === 'Expired' || ord?.paymentStatus === 'Payment Window Expired') {
      memberStatus = 'Expired';
    } else if (rawCommitment === 'Paid' || ord?.paymentStatus === 'Paid (Simulated)') {
      memberStatus = 'Paid';
    }

    members.push({
      userId: uid,
      name: String(m.name),
      quantity: Math.max(1, Number(m.quantity || ord?.quantity || 1)),
      confirmedAt: String(m.confirmed_at),
      paidAt: m.paid_at ? String(m.paid_at) : null,
      memberStatus,
      orderId: ord && ord.fulfillmentStatus !== 'Cancelled' ? ord.orderId : ord?.orderId ?? null,
      paymentStatus: ord ? ord.paymentStatus : null,
    });
  }

  const activeMembers = members.filter((m) => m.memberStatus !== 'Expired');
  const committedCount = activeMembers.length;
  const paidCount = members.filter((m) => m.memberStatus === 'Paid').length;
  const expiredMembersCount = members.filter((m) => m.memberStatus === 'Expired').length;
  const committedUnpaid = members.filter((m) => m.memberStatus === 'Committed');
  const orderedCount = committedUnpaid.filter((m) => Boolean(m.orderId)).length;
  const joinedCount = committedUnpaid.length;
  const remainingConfirmedNeeded = Math.max(0, minParticipants - committedCount);

  const paymentExpiresAt = dealRow.payment_expires_at ? String(dealRow.payment_expires_at) : null;
  const stageLabel = computeStageLabel(
    String(dealRow.status),
    String(dealRow.expires_at),
    committedCount,
    paidCount,
    minParticipants,
    paymentExpiresAt
  );

  const tier2Min = dealRow.tier2_min !== null && dealRow.tier2_min !== undefined ? Number(dealRow.tier2_min) : null;
  const tier2Discount =
    dealRow.tier2_discount !== null && dealRow.tier2_discount !== undefined
      ? Number(dealRow.tier2_discount)
      : null;
  const discountPercent = Number(dealRow.discount_percent);
  const tier2Active = Boolean(tier2Min && tier2Discount && committedCount >= tier2Min);
  const effectiveDiscount = tier2Active && tier2Discount ? tier2Discount : discountPercent;

  const isSellerApproved =
    stageLabel === 'Approved · Awaiting Payments' || stageLabel === 'Confirmed';
  const storedFinalPrice =
    dealRow.final_group_price !== null && dealRow.final_group_price !== undefined
      ? Number(dealRow.final_group_price)
      : null;
  const rawEst = Number((productPrice * (1 - effectiveDiscount / 100)).toFixed(2));
  const estimatedUnitPrice =
    productPrice > 1 ? Math.min(rawEst, Number((productPrice - 1).toFixed(2))) : rawEst;
  const finalGroupPrice = isSellerApproved ? (storedFinalPrice ?? estimatedUnitPrice) : null;
  const referenceUnitPrice = finalGroupPrice ?? estimatedUnitPrice;
  const productSavingsPerUnit = Number(Math.max(0, productPrice - referenceUnitPrice).toFixed(2));

  const showSharedSplit =
    isSellerApproved || stageLabel === 'Pending Seller Approval';
  const splitDenom = Math.max(1, showSharedSplit ? committedCount : minParticipants);
  const sharedDeliveryCostPerMember = showSharedSplit
    ? Number((INDIVIDUAL_DELIVERY_FEE / splitDenom).toFixed(2))
    : null;
  const deliverySavingsPerMember =
    sharedDeliveryCostPerMember !== null
      ? Number(Math.max(0, INDIVIDUAL_DELIVERY_FEE - sharedDeliveryCostPerMember).toFixed(2))
      : null;
  const totalIndividualSavings = Number(
    (productSavingsPerUnit + (deliverySavingsPerMember ?? 0)).toFixed(2)
  );

  const currentMember = currentUserId
    ? members.find((m) => m.userId === currentUserId) || null
    : null;

  return {
    id: dealId,
    productId: String(dealRow.product_id),
    productName: extraProductInfo?.productName,
    productPrice,
    productImage: extraProductInfo?.productImage,
    sellerId: String(dealRow.seller_id),
    title: String(dealRow.title),
    minParticipants,
    currentParticipants: committedCount,
    committedCount,
    joinedCount,
    orderedCount,
    paidCount,
    expiredMembersCount,
    remainingConfirmedNeeded,
    discountPercent,
    tier2Min,
    tier2Discount,
    finalGroupPrice,
    priceGuaranteed: isSellerApproved,
    status: dealRow.status as GroupDeal['status'],
    stageLabel,
    expiresAt: String(dealRow.expires_at),
    paymentExpiresAt,
    sellerApprovedAt: dealRow.seller_approved_at ? String(dealRow.seller_approved_at) : null,
    paymentWindowHours:
      dealRow.payment_window_hours !== null && dealRow.payment_window_hours !== undefined
        ? Number(dealRow.payment_window_hours)
        : 24,
    confirmedAt: dealRow.confirmed_at ? String(dealRow.confirmed_at) : null,
    sharedDeliveryCostPerMember,
    individualDeliveryFee: INDIVIDUAL_DELIVERY_FEE,
    deliverySavingsPerMember,
    productSavingsPerUnit,
    totalIndividualSavings,
    joinedByCurrentUser: Boolean(currentMember && currentMember.memberStatus !== 'Expired'),
    currentUserMemberStatus: currentMember ? currentMember.memberStatus : null,
    currentUserOrderId: currentMember ? currentMember.orderId ?? null : null,
    requestedByName: dealRow.requested_by_name ? String(dealRow.requested_by_name) : null,
    members,
    shareCode: `CS-${dealId.replace(/^deal_/, '').toUpperCase().slice(-6)}`,
  };
}

function recomputeGroupDealProgress(dealId: string): {
  committedCount: number;
  paidCount: number;
  orderedCount: number;
  joinedCount: number;
  thresholdReachedNow: boolean;
  justConfirmed: boolean;
  status: string;
} | null {
  const deal = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(dealId) as
    | Record<string, unknown>
    | undefined;
  if (!deal) return null;

  const product = db
    .prepare('SELECT id, name, price, stock FROM products WHERE id = ?')
    .get(String(deal.product_id)) as { id: string; name: string; price: number; stock: number } | undefined;
  const productPrice = Number(product?.price || 0);

  const hydrated = hydrateGroupDeal(deal, productPrice);
  const { committedCount, paidCount, orderedCount, joinedCount, minParticipants } = hydrated;
  const currentStatus = String(deal.status);
  const nowIso = new Date().toISOString();
  const isDeadlinePassed =
    !Number.isNaN(Date.parse(String(deal.expires_at))) &&
    Date.parse(String(deal.expires_at)) <= Date.now();

  let nextStatus = currentStatus;
  let thresholdReachedNow = false;
  let justConfirmed = false;

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE group_deals SET current_participants = ? WHERE id = ?').run(committedCount, dealId);

    const isTerminal =
      currentStatus === 'rejected' || currentStatus === 'expired' || currentStatus === 'dissolved';

    if (
      !isTerminal &&
      !isDeadlinePassed &&
      (currentStatus === 'active' || currentStatus === 'collecting_orders') &&
      committedCount >= minParticipants
    ) {
      // Threshold reached -> send to Seller for final group price & availability approval!
      nextStatus = 'pending_approval';
      thresholdReachedNow = true;
      const minReviewExpiry = new Date(Date.now() + 24 * 3600000).toISOString();
      const nextExpiry =
        Date.parse(String(deal.expires_at)) < Date.parse(minReviewExpiry)
          ? minReviewExpiry
          : String(deal.expires_at);

      db.prepare(
        `UPDATE group_deals
         SET status = 'pending_approval',
             threshold_reached_at = COALESCE(threshold_reached_at, ?),
             expires_at = ?
         WHERE id = ?`
      ).run(nowIso, nextExpiry, dealId);

      const estUnit = Number((productPrice * (1 - hydrated.discountPercent / 100)).toFixed(2));
      const totalRequestedUnits = (hydrated.members || [])
        .filter((m) => m.memberStatus !== 'Expired')
        .reduce((sum, m) => sum + m.quantity, 0);

      insertNotification({
        userId: String(deal.seller_id),
        type: 'seller_group_approval_request',
        title: `Action Required: Approve Final Group Price (${committedCount}/${minParticipants})`,
        message: `"${hydrated.title}" for ${product?.name || 'Product'} reached its ${minParticipants}-participant threshold (${totalRequestedUnits} units committed; ${product?.stock ?? 0} in stock). Approve final group price (est. ${formatINRServer(estUnit)}) & stock availability to open the individual payment window.`,
        metadata: {
          dealId,
          productId: deal.product_id,
          productName: product?.name || hydrated.title,
          committedCount,
          minParticipants,
          totalRequestedUnits,
          estimatedUnitPrice: estUnit,
          discountPercent: hydrated.discountPercent,
        },
        actionStatus: 'pending',
        dedupeMatch: `"dealId":"${dealId}"`,
        onlyPendingDedupe: true,
      });

      for (const mem of hydrated.members || []) {
        if (mem.memberStatus === 'Expired') continue;
        insertNotification({
          userId: mem.userId,
          type: 'group_threshold_reached',
          title: `Threshold Reached (${committedCount}/${minParticipants}): Pending Seller Approval`,
          message: `"${hydrated.title}" reached all ${minParticipants} commitments! Waiting for seller approval of final group price and stock availability. No payment is required until the seller approves.`,
          metadata: {
            dealId,
            productId: deal.product_id,
            productName: product?.name || hydrated.title,
            committedCount,
            minParticipants,
          },
          actionStatus: 'info',
          dedupeMatch: `"dealId":"${dealId}"`,
        });
      }
    } else if (
      !isTerminal &&
      (currentStatus === 'pending_approval' ||
        currentStatus === 'threshold_reached' ||
        currentStatus === 'group_full') &&
      committedCount < minParticipants
    ) {
      // A committed buyer withdrew before seller approved
      nextStatus = 'active';
      db.prepare(
        `UPDATE group_deals
         SET status = 'active', threshold_reached_at = NULL
         WHERE id = ?`
      ).run(dealId);
      db.prepare(
        `UPDATE notifications
         SET action_status = 'info', is_read = 1
         WHERE type = 'seller_group_approval_request' AND action_status = 'pending' AND metadata_json LIKE ?`
      ).run(`%"dealId":"${dealId}"%`);
    } else if (!isTerminal && (currentStatus === 'approved' || currentStatus === 'confirmed')) {
      if (committedCount === 0) {
        nextStatus = 'expired';
        db.prepare(`UPDATE group_deals SET status = 'expired' WHERE id = ?`).run(dealId);
      } else if (paidCount > 0 && paidCount >= committedCount) {
        if (currentStatus !== 'confirmed') {
          justConfirmed = true;
        }
        nextStatus = 'confirmed';
        db.prepare(
          `UPDATE group_deals
           SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?)
           WHERE id = ?`
        ).run(nowIso, dealId);
      } else {
        nextStatus = 'approved';
        if (currentStatus === 'confirmed') {
          db.prepare(`UPDATE group_deals SET status = 'approved' WHERE id = ?`).run(dealId);
        }
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    committedCount,
    paidCount,
    orderedCount,
    joinedCount,
    thresholdReachedNow,
    justConfirmed,
    status: nextStatus,
  };
}

function processExpiredGroupDeals(): number {
  const candidates = db
    .prepare(
      `SELECT gd.*, p.name as product_name, p.price as product_price
       FROM group_deals gd
       JOIN products p ON gd.product_id = p.id
       WHERE gd.status IN ('pending_approval', 'active', 'collecting_orders', 'unlocked', 'group_full', 'threshold_reached')`
    )
    .all() as Record<string, unknown>[];

  const nowMs = Date.now();
  const expiredDeals = candidates.filter((d) => {
    const expMs = Date.parse(String(d.expires_at));
    return !Number.isNaN(expMs) && expMs <= nowMs;
  });

  if (expiredDeals.length === 0) return 0;

  let expiredCount = 0;

  for (const deal of expiredDeals) {
    const dealId = String(deal.id);
    const hydrated = hydrateGroupDeal(deal, Number(deal.product_price || 0));

    // Expire unfilled groups (or unapproved past deadline); since NO payment was collected, NO refund is needed!
    expiredCount++;
    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE group_deals SET status = 'expired', current_participants = ? WHERE id = ?`).run(
        hydrated.committedCount,
        dealId
      );
      db.prepare(
        `UPDATE group_deal_members
         SET commitment_status = 'Expired'
         WHERE deal_id = ? AND commitment_status = 'Committed'`
      ).run(dealId);
      db.prepare(`DELETE FROM cart_items WHERE deal_id = ?`).run(dealId);

      // Cancel any unpaid pending orders if any existed (no payment was collected, so no refund needed)
      db.prepare(
        `UPDATE orders
         SET fulfillment_status = 'Cancelled',
             payment_status = 'Group Expired (No Charge)',
             tracking_stage = 'Group Expired · No Payment Was Collected',
             tracking_eta = 'Closed'
         WHERE deal_id = ? AND fulfillment_status != 'Cancelled' AND payment_status != 'Paid (Simulated)'`
      ).run(dealId);

      db.prepare(
        `UPDATE notifications
         SET action_status = 'rejected', is_read = 1
         WHERE type = 'seller_group_approval_request' AND action_status = 'pending' AND metadata_json LIKE ?`
      ).run(`%"dealId":"${dealId}"%`);

      for (const mem of hydrated.members || []) {
        insertNotification({
          userId: mem.userId,
          type: 'group_expired',
          title: `Group Order Expired: ${String(deal.product_name)}`,
          message: `"${String(deal.title)}" did not reach ${hydrated.minParticipants} participants before the deadline (${hydrated.committedCount}/${hydrated.minParticipants} committed) and has expired. Since no payment was collected, no refund is necessary.`,
          metadata: {
            dealId,
            productId: deal.product_id,
            productName: deal.product_name,
            committedCount: hydrated.committedCount,
            minParticipants: hydrated.minParticipants,
            noPaymentCollected: true,
          },
          actionStatus: 'info',
          dedupeMatch: `"dealId":"${dealId}"`,
        });
      }

      insertNotification({
        userId: String(deal.seller_id),
        type: 'group_expired',
        title: `Group Pool Expired (${hydrated.committedCount}/${hydrated.minParticipants}): ${String(deal.product_name)}`,
        message: `"${String(deal.title)}" expired before confirmation with ${hydrated.committedCount}/${hydrated.minParticipants} commitments. No payments were collected, so no refunds are required.`,
        metadata: {
          dealId,
          productId: deal.product_id,
          productName: deal.product_name,
          committedCount: hydrated.committedCount,
          minParticipants: hydrated.minParticipants,
        },
        actionStatus: 'info',
        dedupeMatch: `"dealId":"${dealId}"`,
      });

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return expiredCount;
}

function processExpiredGroupPaymentWindows(): number {
  const candidates = db
    .prepare(
      `SELECT gd.*, p.name as product_name, p.price as product_price
       FROM group_deals gd
       JOIN products p ON gd.product_id = p.id
       WHERE gd.status IN ('approved', 'confirmed') AND gd.payment_expires_at IS NOT NULL`
    )
    .all() as Record<string, unknown>[];

  const nowMs = Date.now();
  const pastWindowDeals = candidates.filter((d) => {
    const payExpMs = Date.parse(String(d.payment_expires_at));
    return !Number.isNaN(payExpMs) && payExpMs <= nowMs;
  });

  if (pastWindowDeals.length === 0) return 0;

  let processedCount = 0;

  for (const deal of pastWindowDeals) {
    const dealId = String(deal.id);
    const unpaidMembers = db
      .prepare(
        `SELECT gdm.id, gdm.user_id, u.name
         FROM group_deal_members gdm
         JOIN users u ON gdm.user_id = u.id
         WHERE gdm.deal_id = ? AND gdm.commitment_status = 'Committed'`
      )
      .all(dealId) as { id: string; user_id: string; name: string }[];

    if (unpaidMembers.length === 0) continue;
    processedCount++;

    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE group_deal_members
         SET commitment_status = 'Expired'
         WHERE deal_id = ? AND commitment_status = 'Committed'`
      ).run(dealId);

      for (const mem of unpaidMembers) {
        const unpaidOrder = db
          .prepare(
            `SELECT id FROM orders
             WHERE customer_id = ? AND deal_id = ? AND fulfillment_status != 'Cancelled' AND payment_status != 'Paid (Simulated)'`
          )
          .get(mem.user_id, dealId) as { id: string } | undefined;

        if (unpaidOrder) {
          db.prepare(
            `UPDATE orders
             SET fulfillment_status = 'Cancelled',
                 payment_status = 'Payment Window Expired',
                 tracking_stage = 'Participation Expired · Payment Deadline Missed',
                 tracking_eta = 'Expired'
             WHERE id = ?`
          ).run(unpaidOrder.id);
        }

        db.prepare(
          `UPDATE notifications
           SET action_status = 'rejected', is_read = 1
           WHERE user_id = ? AND type = 'group_approved' AND metadata_json LIKE ?`
        ).run(mem.user_id, `%"dealId":"${dealId}"%`);

        insertNotification({
          userId: mem.user_id,
          type: 'group_payment_expired',
          title: `Payment Window Expired: ${String(deal.product_name)}`,
          message: `You did not complete payment within the approved payment window for "${String(deal.title)}". Your group participation${unpaidOrder ? ` and pending Order #${unpaidOrder.id}` : ''} have been marked as expired.`,
          metadata: {
            dealId,
            orderId: unpaidOrder?.id || null,
            productId: deal.product_id,
            productName: deal.product_name,
          },
          actionStatus: 'info',
          dedupeMatch: `"dealId":"${dealId}"`,
        });
      }

      const paidRow = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM group_deal_members WHERE deal_id = ? AND commitment_status = 'Paid'`
        )
        .get(dealId) as { cnt: number };
      const paidCount = Number(paidRow?.cnt || 0);
      const nowIso = new Date().toISOString();

      if (paidCount > 0) {
        db.prepare(
          `UPDATE group_deals
           SET status = 'confirmed', current_participants = ?, confirmed_at = COALESCE(confirmed_at, ?)
           WHERE id = ?`
        ).run(paidCount, nowIso, dealId);
      } else {
        db.prepare(
          `UPDATE group_deals SET status = 'expired', current_participants = 0 WHERE id = ?`
        ).run(dealId);
      }

      insertNotification({
        userId: String(deal.seller_id),
        type: 'group_payment_expired',
        title: `Payment Window Closed: ${String(deal.product_name)}`,
        message: `Payment deadline passed for "${String(deal.title)}". ${unpaidMembers.length} unpaid commitment(s) expired; ${paidCount} paid group order(s) remain confirmed.`,
        metadata: {
          dealId,
          productId: deal.product_id,
          productName: deal.product_name,
          expiredParticipants: unpaidMembers.length,
          paidCount,
        },
        actionStatus: 'info',
        dedupeMatch: `"dealId":"${dealId}"`,
      });

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return processedCount;
}

function dissolveExpiredGroupDeals(): number {
  return runAllGroupDealSweeps();
}

runAllGroupDealSweeps();
const expirySweepTimer = setInterval(() => {
  runAllGroupDealSweeps();
}, 15 * 1000);
expirySweepTimer.unref();

const app = express();
app.use(express.json({ limit: '8mb' }));

function computeEstimatedDeliveryDate(days: number): string {
  const target = new Date(Date.now() + Math.max(1, days) * 86400000);
  return target.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getNextAvailableWindowOnOrAfter(customerId: string, minDaysFromNow: number): string {
  const slots = db
    .prepare(
      `SELECT day_of_week, slot_label FROM availability_slots
       WHERE user_id = ? AND status = 'available'`
    )
    .all(customerId) as { day_of_week: string; slot_label: string }[];

  const baseDate = new Date(Date.now() + Math.max(1, minDaysFromNow) * 86400000);
  const dateLabel = baseDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  if (slots.length === 0) {
    return `${dateLabel} · Standard (12pm–4pm)`;
  }

  // Look up to 7 days starting from minDaysFromNow for the earliest matching customer-available slot
  const weekdayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(baseDate.getTime() + offset * 86400000);
    const dayName = weekdayMap[candidate.getDay()];
    const matching = slots.find((s) => s.day_of_week === dayName);
    if (matching) {
      const formatted = candidate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      return `${formatted} · ${matching.slot_label}`;
    }
  }

  return `${dateLabel} · ${slots[0].slot_label}`;
}

// Helper: hydrate full Product objects from SQLite
function getEnrichedProducts(filters?: {
  search?: string;
  category?: string;
  sellerId?: string;
  userId?: string;
  productId?: string;
}): Product[] {
  dissolveExpiredGroupDeals();

  let sql = `
    SELECT p.*, u.name as seller_name
    FROM products p
    JOIN users u ON p.seller_id = u.id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (filters?.productId) {
    sql += ' AND p.id = ?';
    params.push(filters.productId);
  }
  if (filters?.sellerId) {
    sql += ' AND p.seller_id = ?';
    params.push(filters.sellerId);
  }
  if (filters?.category && filters.category !== 'All') {
    sql += ' AND p.category = ?';
    params.push(filters.category);
  }
  if (filters?.search) {
    const tokens = filters.search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    for (const token of tokens) {
      const q = `%${token}%`;
      sql +=
        ' AND (LOWER(p.name) LIKE ? OR LOWER(p.brand) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.category) LIKE ? OR LOWER(p.specs_json) LIKE ?)';
      params.push(q, q, q, q, q);
    }
  }

  sql += ' ORDER BY p.created_at DESC, p.name ASC';
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const productId = String(row.id);

    // Active / latest deal for product
    const dealRow = db
      .prepare(
        `SELECT * FROM group_deals
         WHERE product_id = ? AND status IN ('active', 'collecting_orders', 'threshold_reached', 'confirmed', 'expired', 'unlocked', 'pending_approval', 'group_full', 'approved', 'rejected')
         ORDER BY CASE status
           WHEN 'confirmed' THEN 1
           WHEN 'threshold_reached' THEN 2
           WHEN 'group_full' THEN 3
           WHEN 'active' THEN 4
           WHEN 'collecting_orders' THEN 5
           WHEN 'pending_approval' THEN 6
           WHEN 'approved' THEN 7
           WHEN 'expired' THEN 8
           WHEN 'rejected' THEN 9
           ELSE 10
         END, created_at DESC LIMIT 1`
      )
      .get(productId) as Record<string, unknown> | undefined;

    const activeDeal: GroupDeal | null = dealRow
      ? hydrateGroupDeal(dealRow, Number(row.price), filters?.userId, {
          productName: String(row.name),
          productImage: String(row.image_url),
        })
      : null;

    // Reviews
    const reviewRows = db
      .prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC')
      .all(productId) as Record<string, unknown>[];

    const reviews: Review[] = reviewRows.map((r) => ({
      id: String(r.id),
      productId: String(r.product_id),
      userId: String(r.user_id),
      authorName: String(r.author_name),
      rating: Number(r.rating),
      title: String(r.title),
      body: String(r.body),
      verifiedPurchase: Boolean(r.verified_purchase),
      createdAt: String(r.created_at),
      aiTrustFlag: r.ai_trust_flag as Review['aiTrustFlag'],
      aiFlagReason: r.ai_flag_reason ? String(r.ai_flag_reason) : null,
    }));

    const trustedReviews = reviews.filter((r) => r.aiTrustFlag === 'trusted');
    const flaggedCount = reviews.filter((r) => r.aiTrustFlag === 'flagged_suspicious').length;

    const rawAvgRating =
      reviews.length > 0
        ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1))
        : 0;
    const verifiedAvgRating =
      trustedReviews.length > 0
        ? Number((trustedReviews.reduce((sum, r) => sum + r.rating, 0) / trustedReviews.length).toFixed(1))
        : rawAvgRating;

    const ratingBreakdown = [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: trustedReviews.filter((r) => r.rating === stars).length,
    }));

    // Insights
    const insightRow = db
      .prepare('SELECT * FROM product_ai_insights WHERE product_id = ?')
      .get(productId) as Record<string, unknown> | undefined;

    const insights: ProductInsights | null = insightRow
      ? {
          productId,
          pros: JSON.parse(String(insightRow.pros_json)) as string[],
          cons: JSON.parse(String(insightRow.cons_json)) as string[],
          discrepancies: JSON.parse(String(insightRow.discrepancies_json)) as SpecDiscrepancy[],
          summaryHeadline: String(insightRow.summary_headline),
          verifiedAvgRating,
          rawAvgRating,
          analyzedAt: String(insightRow.analyzed_at),
          source: (insightRow.source as 'seeded' | 'gemini') || 'seeded',
        }
      : {
          productId,
          pros: [],
          cons: [],
          discrepancies: [],
          summaryHeadline: 'No reviews analyzed yet.',
          verifiedAvgRating,
          rawAvgRating,
          analyzedAt: String(row.created_at),
          source: 'seeded',
        };

    return {
      id: productId,
      sellerId: String(row.seller_id),
      sellerName: String(row.seller_name),
      name: String(row.name),
      brand: String(row.brand),
      category: String(row.category),
      price: Number(row.price),
      stock: Number(row.stock),
      imageUrl: String(row.image_url),
      description: String(row.description),
      specs: JSON.parse(String(row.specs_json)) as ProductSpec[],
      deliveryDays: Number(row.delivery_days ?? 2),
      estimatedDeliveryDate: computeEstimatedDeliveryDate(Number(row.delivery_days ?? 2)),
      createdAt: String(row.created_at),
      activeDeal,
      insights,
      reviews,
      ratingBreakdown,
      reviewCount: reviews.length,
      flaggedCount,
    };
  });
}

function getNextAvailableWindow(customerId: string): string {
  const slots = db
    .prepare(
      `SELECT day_of_week, slot_label FROM availability_slots
       WHERE user_id = ? AND status = 'available'`
    )
    .all(customerId) as { day_of_week: string; slot_label: string }[];

  if (slots.length === 0) {
    return 'Next Standard Window (Mon–Fri, 12pm–4pm)';
  }
  const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  slots.sort((a, b) => dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week));
  return `${slots[0].day_of_week} · ${slots[0].slot_label}`;
}

// --- AUTH & DEMO ACCOUNTS ---
function hydrateUser(u: Record<string, unknown>): User {
  const defaultAddress = String(u.address || 'Seattle, WA 98101');
  let savedAddresses: SavedAddress[] = [];
  if (typeof u.saved_addresses_json === 'string' && u.saved_addresses_json.trim()) {
    try {
      const parsed = JSON.parse(u.saved_addresses_json);
      if (Array.isArray(parsed)) savedAddresses = parsed as SavedAddress[];
    } catch {
      savedAddresses = [];
    }
  }
  if (savedAddresses.length === 0) {
    savedAddresses = [
      {
        id: `addr_default_${String(u.id)}`,
        label: 'Primary Home',
        recipientName: String(u.name),
        line1: defaultAddress,
        cityStateZip: '',
        phone: u.phone ? String(u.phone) : '(206) 555-0140',
        isDefault: true,
      },
    ];
  }

  let notificationPrefs: NotificationPrefs = {
    orderUpdates: true,
    groupDeals: true,
    deliveryAlerts: true,
    promotions: false,
  };
  if (typeof u.notification_prefs_json === 'string' && u.notification_prefs_json.trim()) {
    try {
      notificationPrefs = { ...notificationPrefs, ...(JSON.parse(u.notification_prefs_json) as Partial<NotificationPrefs>) };
    } catch {
      // keep defaults
    }
  }

  return {
    id: String(u.id),
    name: String(u.name),
    email: String(u.email),
    role: u.role as User['role'],
    avatarInitials: String(u.avatar_initials),
    address: defaultAddress,
    phone: u.phone ? String(u.phone) : '',
    savedAddresses,
    paymentPreference: u.payment_preference
      ? String(u.payment_preference)
      : 'Card ending in 4242 (Simulated)',
    notificationPrefs,
  };
}

app.get('/api/users/demo', (_req, res) => {
  const rows = db
    .prepare(
      'SELECT id, name, email, role, avatar_initials, address, phone, saved_addresses_json, payment_preference, notification_prefs_json FROM users ORDER BY role ASC, name ASC'
    )
    .all() as Record<string, unknown>[];
  res.json({ users: rows.map(hydrateUser) });
});

app.post('/api/demo/reset', (_req, res) => {
  resetDatabaseToFirstStage();
  res.json({ ok: true });
});

app.patch('/api/users/:id/profile', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  const { name, email, phone, address, savedAddresses, paymentPreference, notificationPrefs } =
    req.body as {
      name?: string;
      email?: string;
      phone?: string;
      address?: string;
      savedAddresses?: SavedAddress[];
      paymentPreference?: string;
      notificationPrefs?: NotificationPrefs;
    };

  const nextName = name?.trim() || String(existing.name);
  const nextEmail = email?.trim().toLowerCase() || String(existing.email);

  if (nextEmail !== String(existing.email).toLowerCase()) {
    const conflict = db
      .prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?')
      .get(nextEmail, id);
    if (conflict) {
      res.status(409).json({ error: 'Another account already uses this email.' });
      return;
    }
  }

  const nextInitials =
    nextName
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || String(existing.avatar_initials);

  let nextAddressesJson = existing.saved_addresses_json
    ? String(existing.saved_addresses_json)
    : null;
  let nextPrimaryAddress = address?.trim() || String(existing.address);

  if (Array.isArray(savedAddresses) && savedAddresses.length > 0) {
    const cleanAddresses = savedAddresses.map((a, idx) => ({
      id: String(a.id || `addr_${Date.now()}_${idx}`),
      label: String(a.label || 'Address').trim().slice(0, 40),
      recipientName: String(a.recipientName || nextName).trim().slice(0, 80),
      line1: String(a.line1 || '').trim().slice(0, 140),
      cityStateZip: String(a.cityStateZip || '').trim().slice(0, 80),
      phone: String(a.phone || '').trim().slice(0, 30),
      isDefault: Boolean(a.isDefault),
    }));
    const defaultEntry = cleanAddresses.find((a) => a.isDefault) || cleanAddresses[0];
    if (defaultEntry && !cleanAddresses.some((a) => a.isDefault)) {
      defaultEntry.isDefault = true;
    }
    if (defaultEntry?.line1) {
      nextPrimaryAddress = defaultEntry.cityStateZip
        ? `${defaultEntry.line1}, ${defaultEntry.cityStateZip}`
        : defaultEntry.line1;
    }
    nextAddressesJson = JSON.stringify(cleanAddresses);
  }

  const nextPaymentPref =
    paymentPreference?.trim() ||
    (existing.payment_preference ? String(existing.payment_preference) : 'Card ending in 4242 (Simulated)');

  const nextNotifJson = notificationPrefs
    ? JSON.stringify({
        orderUpdates: Boolean(notificationPrefs.orderUpdates),
        groupDeals: Boolean(notificationPrefs.groupDeals),
        deliveryAlerts: Boolean(notificationPrefs.deliveryAlerts),
        promotions: Boolean(notificationPrefs.promotions),
      })
    : existing.notification_prefs_json
      ? String(existing.notification_prefs_json)
      : null;

  const nextPhone = phone !== undefined ? phone.trim().slice(0, 30) : String(existing.phone || '');

  db.prepare(
    `UPDATE users
     SET name = ?, email = ?, avatar_initials = ?, address = ?, phone = ?, saved_addresses_json = ?, payment_preference = ?, notification_prefs_json = ?
     WHERE id = ?`
  ).run(
    nextName,
    nextEmail,
    nextInitials,
    nextPrimaryAddress,
    nextPhone,
    nextAddressesJson,
    nextPaymentPref,
    nextNotifJson,
    id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;
  res.json({ user: hydrateUser(updated) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  const row = db
    .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
    .get(email.trim()) as Record<string, unknown> | undefined;

  if (!row || String(row.password_hash) !== hashPassword(password)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  res.json({ user: hydrateUser(row) });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role, address } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: 'customer' | 'seller';
    address?: string;
  };
  if (!name?.trim() || !email?.trim() || !password || !role) {
    res.status(400).json({ error: 'Name, email, password, and account role are required.' });
    return;
  }
  if (!['customer', 'seller'].includes(role)) {
    res.status(400).json({ error: 'Invalid account role.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const id = `${role === 'seller' ? 'sell' : 'cust'}_${Date.now()}`;
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || 'CS';
  const now = new Date().toISOString();
  const primaryAddress = address?.trim() || 'Seattle, WA 98101';
  const initialAddresses: SavedAddress[] = [
    {
      id: `addr_default_${id}`,
      label: 'Primary Home',
      recipientName: name.trim(),
      line1: primaryAddress,
      cityStateZip: '',
      phone: '',
      isDefault: true,
    },
  ];

  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, avatar_initials, address, saved_addresses_json, payment_preference, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Card ending in 4242 (Simulated)', ?)`
  ).run(
    id,
    name.trim(),
    email.trim().toLowerCase(),
    hashPassword(password),
    role,
    initials,
    primaryAddress,
    JSON.stringify(initialAddresses),
    now
  );

  // Initialize default availability slots for new customers
  if (role === 'customer') {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const slots = ['Morning (8am–12pm)', 'Afternoon (12pm–4pm)', 'Evening (4pm–8pm)'];
    const stmt = db.prepare(
      `INSERT INTO availability_slots (id, user_id, day_of_week, slot_label, status, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const day of days) {
      for (const slot of slots) {
        const isAvailable = slot === 'Evening (4pm–8pm)' || ['Sat', 'Sun'].includes(day);
        stmt.run(
          `slot_${id}_${day}_${slot.slice(0, 4)}`,
          id,
          day,
          slot,
          isAvailable ? 'available' : 'unavailable',
          ''
        );
      }
    }
  }

  const createdRow = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json({ user: hydrateUser(createdRow) });
});

// --- PRODUCTS & CAMERA SEARCH ---
app.get('/api/products', (req, res) => {
  const { search, category, sellerId, userId } = req.query as Record<string, string | undefined>;
  const products = getEnrichedProducts({ search, category, sellerId, userId });
  res.json({ products });
});

app.post('/api/products/camera-search', async (req, res) => {
  const { imageDataUrl, userId } = req.body as { imageDataUrl?: string; userId?: string };
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    res.status(400).json({ error: 'Please capture or upload a product photo to search.' });
    return;
  }

  const match = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(
    imageDataUrl.trim()
  );
  if (!match) {
    res.status(400).json({ error: 'Unsupported image format. Please use JPEG, PNG, or WebP.' });
    return;
  }

  const rawMime = match[1].toLowerCase();
  const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
  const imageBase64 = match[2];
  const approxBytes = Math.floor((imageBase64.length * 3) / 4);
  if (approxBytes > 5 * 1024 * 1024) {
    res.status(413).json({ error: 'Image is too large. Please keep uploads under 5 MB.' });
    return;
  }

  const catalog = getEnrichedProducts({ userId });
  try {
    const aiResult = await runGeminiCameraSearch({
      imageBase64,
      mimeType,
      catalogProducts: catalog.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        price: p.price,
        description: p.description,
        specs: p.specs,
      })),
    });

    const catalogMap = new Map(catalog.map((p) => [p.id, p]));
    const matchedProducts = aiResult.matchedProductIds
      .map((id) => catalogMap.get(id))
      .filter((p): p is Product => Boolean(p));

    res.json({
      detectedItemSummary: aiResult.detectedItemSummary,
      searchKeywords: aiResult.searchKeywords,
      reasoning: aiResult.reasoning,
      products: matchedProducts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Camera product search failed.';
    const status =
      message.includes('GEMINI_API_KEY') || message.includes('503') || message.includes('UNAVAILABLE')
        ? 503
        : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/api/products', (req, res) => {
  const {
    sellerId,
    name,
    brand,
    category,
    price,
    stock,
    imageUrl,
    description,
    specs,
    deliveryDays,
    enableGroupDeal,
    dealTitle,
    minParticipants,
    discountPercent,
    tier2Min,
    tier2Discount,
  } = req.body as {
    sellerId: string;
    name: string;
    brand: string;
    category: string;
    price: number;
    stock: number;
    imageUrl?: string;
    description: string;
    specs: ProductSpec[];
    deliveryDays?: number;
    enableGroupDeal?: boolean;
    dealTitle?: string;
    minParticipants?: number;
    discountPercent?: number;
    tier2Min?: number | null;
    tier2Discount?: number | null;
  };

  if (!sellerId || !name?.trim() || !brand?.trim() || !category?.trim() || Number(price) <= 0) {
    res.status(400).json({ error: 'Seller, product name, brand, category, and valid price are required.' });
    return;
  }

  const productId = `prod_${Date.now()}`;
  const now = new Date().toISOString();
  const fallbackImage = '/src/assets/images/product_anc_headphones_1795505379219.jpg';
  const leadDays = Math.max(1, Math.min(30, Number(deliveryDays) || 2));

  db.prepare(
    `INSERT INTO products (id, seller_id, name, brand, category, price, stock, image_url, description, specs_json, delivery_days, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    productId,
    sellerId,
    name.trim(),
    brand.trim(),
    category.trim(),
    Number(price),
    Math.max(0, Number(stock) || 0),
    imageUrl?.trim() || fallbackImage,
    description?.trim() || 'Quality product listed on CartSync.',
    JSON.stringify(Array.isArray(specs) ? specs : []),
    leadDays,
    now
  );

  db.prepare(
    `INSERT INTO product_ai_insights (product_id, pros_json, cons_json, discrepancies_json, summary_headline, analyzed_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    productId,
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    'New listing — insights will populate once verified buyers submit feedback.',
    now,
    'seeded'
  );

  if (enableGroupDeal) {
    const dealId = `deal_${Date.now()}`;
    const in3Days = new Date(Date.now() + THREE_DAYS_MS).toISOString();
    db.prepare(
      `INSERT INTO group_deals (id, product_id, seller_id, title, min_participants, current_participants, discount_percent, tier2_min, tier2_discount, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'active', ?, ?)`
    ).run(
      dealId,
      productId,
      sellerId,
      dealTitle?.trim() || `${name.trim()} Group Pool`,
      Math.max(2, Number(minParticipants) || 5),
      Math.min(70, Math.max(5, Number(discountPercent) || 10)),
      tier2Min ? Number(tier2Min) : null,
      tier2Discount ? Number(tier2Discount) : null,
      in3Days,
      now
    );
  }

  const [created] = getEnrichedProducts({ productId });
  res.status(201).json({ product: created });
});

app.patch('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const { name, brand, category, price, stock, description, specs, deliveryDays } = req.body as {
    name?: string;
    brand?: string;
    category?: string;
    price?: number;
    stock?: number;
    description?: string;
    specs?: ProductSpec[];
    deliveryDays?: number;
  };

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  db.prepare(
    `UPDATE products
     SET name = ?, brand = ?, category = ?, price = ?, stock = ?, description = ?, specs_json = ?, delivery_days = ?
     WHERE id = ?`
  ).run(
    name?.trim() || String(existing.name),
    brand?.trim() || String(existing.brand),
    category?.trim() || String(existing.category),
    price !== undefined ? Math.max(1, Number(price)) : Number(existing.price),
    stock !== undefined ? Math.max(0, Number(stock)) : Number(existing.stock),
    description?.trim() || String(existing.description),
    specs ? JSON.stringify(specs) : String(existing.specs_json),
    deliveryDays !== undefined ? Math.max(1, Math.min(30, Number(deliveryDays))) : Number(existing.delivery_days ?? 2),
    id
  );

  const [updated] = getEnrichedProducts({ productId: id });
  res.json({ product: updated });
});

// --- GROUP DEALS ---
app.get('/api/group-deals', (req, res) => {
  runAllGroupDealSweeps();
  const { userId, sellerId } = req.query as Record<string, string | undefined>;
  let sql = `
    SELECT gd.*, p.name as product_name, p.price as product_price, p.image_url as product_image
    FROM group_deals gd
    JOIN products p ON gd.product_id = p.id
    WHERE 1=1
  `;
  const params: string[] = [];
  if (sellerId) {
    sql += ' AND gd.seller_id = ?';
    params.push(sellerId);
  } else {
    sql += ` AND gd.status != 'dissolved'`;
  }
  sql += ' ORDER BY gd.created_at DESC';
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  const deals: GroupDeal[] = rows.map((d) =>
    hydrateGroupDeal(d, Number(d.product_price), userId, {
      productName: String(d.product_name),
      productImage: String(d.product_image),
    })
  );

  res.json({ deals });
});

app.post('/api/group-deals/request', (req, res) => {
  runAllGroupDealSweeps();
  const {
    productId,
    userId,
    userName,
    targetParticipants,
    desiredDiscount,
    quantity,
    title,
    deadlineHours,
    paymentWindowHours,
  } = req.body as {
    productId: string;
    userId: string;
    userName: string;
    targetParticipants?: number;
    desiredDiscount?: number;
    quantity?: number;
    title?: string;
    deadlineHours?: number;
    paymentWindowHours?: number;
  };
  if (!productId || !userId || !userName?.trim()) {
    res.status(400).json({ error: 'Product, user ID, and user name are required.' });
    return;
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as
    | Record<string, unknown>
    | undefined;
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  if (Number(product.stock) <= 0) {
    res.status(400).json({ error: 'This product is currently out of stock.' });
    return;
  }

  const existing = db
    .prepare(
      `SELECT id FROM group_deals WHERE product_id = ? AND status IN ('pending_approval', 'active', 'collecting_orders', 'threshold_reached', 'approved', 'unlocked', 'group_full')`
    )
    .get(productId);
  if (existing) {
    res.status(409).json({
      error: 'An open group order already exists for this product. Commit to the existing pool instead of creating a duplicate.',
    });
    return;
  }

  const dealId = `deal_${Date.now()}`;
  const now = new Date().toISOString();
  const requestedHours =
    deadlineHours !== undefined && Number.isFinite(Number(deadlineHours))
      ? Math.min(72, Math.max(0.02, Number(deadlineHours)))
      : 72;
  const payWinHours =
    paymentWindowHours !== undefined && Number.isFinite(Number(paymentWindowHours))
      ? Math.min(72, Math.max(0.02, Number(paymentWindowHours)))
      : 24;
  const expires = new Date(Date.now() + requestedHours * 3600000).toISOString();
  const minP = Math.min(25, Math.max(2, Number(targetParticipants) || 5));
  const disc = Math.min(40, Math.max(5, Number(desiredDiscount) || 12));
  const qty = Math.min(Number(product.stock), Math.max(1, Number(quantity) || 1));
  const dealTitle = title?.trim() || `${String(product.name)} Group Pool`;

  db.exec('BEGIN');
  try {
    // Creator commits with 0 payment collected; threshold tracks committed participants
    db.prepare(
      `INSERT INTO group_deals (id, product_id, seller_id, title, min_participants, current_participants, discount_percent, tier2_min, tier2_discount, status, expires_at, payment_window_hours, requested_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'active', ?, ?, ?, ?)`
    ).run(
      dealId,
      productId,
      String(product.seller_id),
      dealTitle,
      minP,
      disc,
      Math.max(minP + 2, 8),
      Math.min(45, disc + 7),
      expires,
      payWinHours,
      userName.trim(),
      now
    );

    db.prepare(
      `INSERT INTO group_deal_members (id, deal_id, user_id, quantity, commitment_status, confirmed_at)
       VALUES (?, ?, ?, ?, 'Committed', ?)`
    ).run(`gdm_${Date.now()}`, dealId, userId, qty, now);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  recomputeGroupDealProgress(dealId);

  res.status(201).json({
    dealId,
    expiresAt: expires,
    shareCode: `CS-${dealId.replace(/^deal_/, '').toUpperCase().slice(-6)}`,
  });
});

app.post('/api/group-deals/:id/join', (req, res) => {
  runAllGroupDealSweeps();
  const { id } = req.params;
  const { userId, quantity = 1 } = req.body as { userId: string; quantity?: number };
  if (!userId) {
    res.status(400).json({ error: 'User ID is required to commit to a group deal.' });
    return;
  }

  const deal = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!deal) {
    res.status(404).json({ error: 'Group deal not found.' });
    return;
  }
  if (
    deal.status === 'expired' ||
    deal.status === 'dissolved' ||
    Date.parse(String(deal.expires_at)) <= Date.now()
  ) {
    res.status(410).json({ error: 'This group order has passed its deadline and expired.' });
    return;
  }
  if (deal.status === 'rejected') {
    res.status(409).json({ error: 'This group pool was rejected by the seller.' });
    return;
  }
  if (deal.status === 'approved' || deal.status === 'confirmed' || deal.status === 'completed') {
    res.status(409).json({ error: 'This group pool is already seller-approved and in its payment window.' });
    return;
  }

  const existingMember = db
    .prepare('SELECT id, commitment_status FROM group_deal_members WHERE deal_id = ? AND user_id = ?')
    .get(id, userId) as { id: string; commitment_status: string } | undefined;
  if (existingMember) {
    res.status(409).json({
      error:
        existingMember.commitment_status === 'Paid'
          ? 'You have already paid for this group order.'
          : 'Duplicate commitment prevented: you have already committed to this group order.',
    });
    return;
  }

  const prod = db
    .prepare('SELECT price, name, image_url, stock FROM products WHERE id = ?')
    .get(String(deal.product_id)) as { price: number; name: string; image_url: string; stock: number } | undefined;
  if (!prod) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  const qty = Math.max(1, Number(quantity) || 1);
  if (prod.stock < qty) {
    res.status(400).json({ error: `Insufficient stock for ${prod.name} (${prod.stock} available).` });
    return;
  }

  const now = new Date().toISOString();

  // Commit Now, Pay After Group Confirmation: records commitment with ₹0 payment collected!
  db.prepare(
    `INSERT INTO group_deal_members (id, deal_id, user_id, quantity, commitment_status, confirmed_at)
     VALUES (?, ?, ?, ?, 'Committed', ?)`
  ).run(
    `gdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    id,
    userId,
    qty,
    now
  );

  const progress = recomputeGroupDealProgress(id);

  const hydrated = hydrateGroupDeal(
    db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown>,
    Number(prod.price || 0),
    userId,
    { productName: prod.name, productImage: prod.image_url }
  );
  res.json({
    deal: hydrated,
    memberStatus: 'Committed',
    thresholdReached: Boolean(progress?.thresholdReachedNow || hydrated.stageLabel === 'Pending Seller Approval'),
    unlocked: hydrated.stageLabel === 'Confirmed' || hydrated.stageLabel === 'Approved · Awaiting Payments',
    groupFull:
      hydrated.stageLabel === 'Pending Seller Approval' ||
      hydrated.stageLabel === 'Approved · Awaiting Payments' ||
      hydrated.stageLabel === 'Confirmed',
  });
});

app.post('/api/group-deals/:id/withdraw', (req, res) => {
  runAllGroupDealSweeps();
  const { id } = req.params;
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    res.status(400).json({ error: 'User ID is required to leave a group order.' });
    return;
  }

  const deal = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!deal) {
    res.status(404).json({ error: 'Group deal not found.' });
    return;
  }
  if (deal.status === 'expired' || deal.status === 'dissolved' || deal.status === 'rejected') {
    res.status(410).json({ error: 'This group pool is already closed.' });
    return;
  }

  const existingMember = db
    .prepare('SELECT id, commitment_status FROM group_deal_members WHERE deal_id = ? AND user_id = ?')
    .get(id, userId) as { id: string; commitment_status: string } | undefined;
  const activeOrder = db
    .prepare(
      `SELECT id, payment_status, total_amount, fulfillment_status FROM orders WHERE customer_id = ? AND deal_id = ? AND fulfillment_status != 'Cancelled'`
    )
    .get(userId, id) as
    | { id: string; payment_status: string; total_amount: number; fulfillment_status: string }
    | undefined;

  if (!existingMember && !activeOrder) {
    res.status(404).json({ error: 'You are not currently a member of this group pool.' });
    return;
  }
  if (
    activeOrder &&
    (activeOrder.fulfillment_status === 'Out for Delivery' ||
      activeOrder.fulfillment_status === 'Delivered')
  ) {
    res.status(400).json({ error: 'Orders already out for delivery or delivered cannot be withdrawn.' });
    return;
  }

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM group_deal_members WHERE deal_id = ? AND user_id = ?').run(id, userId);

    if (activeOrder) {
      const wasPaid = activeOrder.payment_status === 'Paid (Simulated)';
      if (wasPaid) {
        const items = db
          .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
          .all(activeOrder.id) as { product_id: string; quantity: number }[];
        const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        for (const item of items) {
          restoreStock.run(item.quantity, item.product_id);
        }
      }

      db.prepare(
        `UPDATE orders
         SET fulfillment_status = 'Cancelled',
             payment_status = ?,
             tracking_stage = 'Left Group Pool · Commitment Withdrawn',
             tracking_eta = 'Cancelled'
         WHERE id = ?`
      ).run(wasPaid ? 'Refunded (Simulated)' : 'Cancelled', activeOrder.id);

      insertNotification({
        userId,
        type: 'info',
        title: `Withdrew from Group Pool · Order #${activeOrder.id} Cancelled`,
        message: wasPaid
          ? `You left the group order. Order #${activeOrder.id} was cancelled with a simulated refund of ${formatINRServer(Number(activeOrder.total_amount))}.`
          : `You withdrew from the group order and your unpaid Order #${activeOrder.id} was closed with no charge.`,
        metadata: { dealId: id, orderId: activeOrder.id, simulated: true },
        actionStatus: 'info',
      });
    }

    db.prepare(`DELETE FROM cart_items WHERE user_id = ? AND deal_id = ?`).run(userId, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  recomputeGroupDealProgress(id);
  const updatedRow = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown>;
  const prod = db.prepare('SELECT price, name, image_url FROM products WHERE id = ?').get(String(deal.product_id)) as
    | { price: number; name: string; image_url: string }
    | undefined;
  const hydrated = hydrateGroupDeal(
    updatedRow,
    Number(prod?.price || 0),
    userId,
    prod ? { productName: prod.name, productImage: prod.image_url } : undefined
  );
  res.json({ deal: hydrated, withdrawn: true });
});

app.post('/api/group-deals/:id/expire-now', (req, res) => {
  const { id } = req.params;
  const deal = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!deal) {
    res.status(404).json({ error: 'Group deal not found.' });
    return;
  }
  const pastIso = new Date(Date.now() - 1000).toISOString();
  db.prepare('UPDATE group_deals SET expires_at = ? WHERE id = ?').run(pastIso, id);
  runAllGroupDealSweeps();
  const updatedRow = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown>;
  const prod = db.prepare('SELECT price, name, image_url FROM products WHERE id = ?').get(String(deal.product_id)) as
    | { price: number; name: string; image_url: string }
    | undefined;
  const hydrated = hydrateGroupDeal(
    updatedRow,
    Number(prod?.price || 0),
    undefined,
    prod ? { productName: prod.name, productImage: prod.image_url } : undefined
  );
  res.json({ deal: hydrated });
});

app.post('/api/group-deals/:id/expire-payment-window', (req, res) => {
  const { id } = req.params;
  const deal = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!deal) {
    res.status(404).json({ error: 'Group deal not found.' });
    return;
  }
  if (deal.status !== 'approved' && deal.status !== 'confirmed') {
    res.status(400).json({ error: 'Payment window only exists after seller approval.' });
    return;
  }
  const pastIso = new Date(Date.now() - 1000).toISOString();
  db.prepare('UPDATE group_deals SET payment_expires_at = ? WHERE id = ?').run(pastIso, id);
  processExpiredGroupPaymentWindows();
  const updatedRow = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown>;
  const prod = db.prepare('SELECT price, name, image_url FROM products WHERE id = ?').get(String(deal.product_id)) as
    | { price: number; name: string; image_url: string }
    | undefined;
  const hydrated = hydrateGroupDeal(
    updatedRow,
    Number(prod?.price || 0),
    undefined,
    prod ? { productName: prod.name, productImage: prod.image_url } : undefined
  );
  res.json({ deal: hydrated });
});

function executeSellerGroupApproval(
  deal: Record<string, unknown>,
  overrides?: {
    sellerId?: string;
    title?: string;
    minParticipants?: number;
    discountPercent?: number;
    finalGroupPrice?: number;
    paymentWindowHours?: number;
    tier2Min?: number | null;
    tier2Discount?: number | null;
  }
) {
  const id = String(deal.id);
  const currentStatus = String(deal.status);
  if (overrides?.sellerId && String(deal.seller_id) !== overrides.sellerId) {
    throw new Error('FORBIDDEN_SELLER');
  }
  if (currentStatus === 'approved' || currentStatus === 'confirmed') {
    return { deal, alreadyProcessed: true, ordersCreatedCount: 0 };
  }
  if (currentStatus === 'rejected') {
    throw new Error('ALREADY_REJECTED');
  }
  if (currentStatus === 'expired' || currentStatus === 'dissolved') {
    throw new Error('ALREADY_EXPIRED');
  }

  const product = db
    .prepare('SELECT id, name, seller_id, price, stock, delivery_days, image_url FROM products WHERE id = ?')
    .get(String(deal.product_id)) as
    | {
        id: string;
        name: string;
        seller_id: string;
        price: number;
        stock: number;
        delivery_days: number;
        image_url: string;
      }
    | undefined;
  if (!product) {
    throw new Error('PRODUCT_NOT_FOUND');
  }

  const nextMin =
    overrides?.minParticipants !== undefined
      ? Math.max(2, Number(overrides.minParticipants))
      : Number(deal.min_participants);

  const activeMembers = db
    .prepare(
      `SELECT user_id, quantity FROM group_deal_members
       WHERE deal_id = ? AND commitment_status IN ('Committed', 'Paid')
       ORDER BY confirmed_at ASC`
    )
    .all(id) as { user_id: string; quantity: number }[];

  if (activeMembers.length < nextMin) {
    throw new Error(`THRESHOLD_NOT_MET:${activeMembers.length}:${nextMin}`);
  }

  const totalCommittedUnits = activeMembers.reduce((sum, m) => sum + Math.max(1, Number(m.quantity) || 1), 0);
  if (product.stock < totalCommittedUnits) {
    throw new Error(`INSUFFICIENT_STOCK:${product.stock}:${totalCommittedUnits}`);
  }

  let nextDiscount =
    overrides?.discountPercent !== undefined
      ? Math.min(75, Math.max(1, Number(overrides.discountPercent)))
      : Number(deal.discount_percent);
  const nextTier2Min =
    overrides?.tier2Min !== undefined
      ? overrides.tier2Min
        ? Number(overrides.tier2Min)
        : null
      : (deal.tier2_min as number | null);
  const nextTier2Discount =
    overrides?.tier2Discount !== undefined
      ? overrides.tier2Discount
        ? Number(overrides.tier2Discount)
        : null
      : (deal.tier2_discount as number | null);

  const tier2Active = nextTier2Min && nextTier2Discount && activeMembers.length >= nextTier2Min;
  const effectiveDiscount = tier2Active && nextTier2Discount ? nextTier2Discount : nextDiscount;

  const sharedDeliveryCost = Number((INDIVIDUAL_DELIVERY_FEE / Math.max(1, activeMembers.length)).toFixed(2));
  const maxAllowedUnitPrice =
    Number(product.price) > sharedDeliveryCost + 1
      ? Number((Number(product.price) - sharedDeliveryCost - 1).toFixed(2))
      : Number(Math.max(0.5, Number(product.price) - 0.01).toFixed(2));

  let confirmedUnitPrice = Number((Number(product.price) * (1 - effectiveDiscount / 100)).toFixed(2));
  if (overrides?.finalGroupPrice !== undefined) {
    const requestedPrice = Number(overrides.finalGroupPrice);
    if (!Number.isFinite(requestedPrice) || requestedPrice <= 0 || requestedPrice >= Number(product.price)) {
      throw new Error(`GROUP_PRICE_NOT_LOWER:${product.price}:${maxAllowedUnitPrice}`);
    }
    if (Number(product.price) > sharedDeliveryCost + 1 && requestedPrice + sharedDeliveryCost >= Number(product.price)) {
      throw new Error(`GROUP_TOTAL_NOT_LOWER:${product.price}:${maxAllowedUnitPrice}:${sharedDeliveryCost}`);
    }
    confirmedUnitPrice = Number(requestedPrice.toFixed(2));
    nextDiscount = Number((((Number(product.price) - confirmedUnitPrice) / Number(product.price)) * 100).toFixed(1));
  } else if (confirmedUnitPrice > maxAllowedUnitPrice) {
    confirmedUnitPrice = maxAllowedUnitPrice;
    nextDiscount = Number((((Number(product.price) - confirmedUnitPrice) / Number(product.price)) * 100).toFixed(1));
  }

  const payWinHours =
    overrides?.paymentWindowHours !== undefined && Number.isFinite(Number(overrides.paymentWindowHours))
      ? Math.min(72, Math.max(0.02, Number(overrides.paymentWindowHours)))
      : Number(deal.payment_window_hours || 24);
  const nowIso = new Date().toISOString();
  const paymentExpiresAt = new Date(Date.now() + payWinHours * 3600000).toISOString();

  const deliverySavings = Number(Math.max(0, INDIVIDUAL_DELIVERY_FEE - sharedDeliveryCost).toFixed(2));
  const productSavingsPerUnit = Number(Math.max(0, Number(product.price) - confirmedUnitPrice).toFixed(2));

  let ordersCreatedCount = 0;

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE group_deals
       SET title = ?,
           min_participants = ?,
           current_participants = ?,
           discount_percent = ?,
           tier2_min = ?,
           tier2_discount = ?,
           final_group_price = ?,
           status = 'approved',
           seller_approved_at = ?,
           payment_window_hours = ?,
           payment_expires_at = ?,
           confirmed_at = COALESCE(confirmed_at, ?)
       WHERE id = ?`
    ).run(
      overrides?.title?.trim() || String(deal.title),
      nextMin,
      activeMembers.length,
      nextDiscount,
      nextTier2Min,
      nextTier2Discount,
      confirmedUnitPrice,
      nowIso,
      payWinHours,
      paymentExpiresAt,
      nowIso,
      id
    );

    db.prepare(
      `UPDATE notifications
       SET action_status = 'approved', is_read = 1
       WHERE type = 'seller_group_approval_request' AND metadata_json LIKE ?`
    ).run(`%"dealId":"${id}"%`);

    for (const mem of activeMembers) {
      const qty = Math.max(1, Number(mem.quantity) || 1);
      const existingOrder = db
        .prepare(
          `SELECT id FROM orders WHERE customer_id = ? AND deal_id = ? AND fulfillment_status != 'Cancelled'`
        )
        .get(mem.user_id, id) as { id: string } | undefined;

      let orderId: string;
      const subtotal = Number((confirmedUnitPrice * qty).toFixed(2));
      const discountTotal = Number((productSavingsPerUnit * qty).toFixed(2));
      const totalAmount = Number((subtotal + sharedDeliveryCost).toFixed(2));
      const totalIndividualSavings = Number((discountTotal + deliverySavings).toFixed(2));

      if (!existingOrder) {
        orderId = `CS-GRP-${Math.floor(1000 + Math.random() * 8900)}`;
        const scheduledWindow = getNextAvailableWindowOnOrAfter(
          mem.user_id,
          Number(product.delivery_days || 2)
        );
        const deliveryDate = computeEstimatedDeliveryDate(Number(product.delivery_days || 2));

        // IMPORTANT: Order starts as 'Awaiting Payment' (NOT 'Confirmed') until participant completes individual payment!
        db.prepare(
          `INSERT INTO orders (
            id, customer_id, deal_id, delivery_mode, combined_group_id, scheduled_window,
            shipping_fee, shared_delivery_cost, payment_deadline, subtotal, discount_total, total_amount,
            payment_status, fulfillment_status, group_approval_status, delivery_availability_status,
            tracking_stage, created_at
          ) VALUES (?, ?, ?, 'combined', ?, ?, ?, ?, ?, ?, ?, ?, 'Awaiting Payment', 'Awaiting Payment', 'Approved by Seller', 'Not Dispatched', ?, ?)`
        ).run(
          orderId,
          mem.user_id,
          id,
          `GRP-${id.slice(-6).toUpperCase()}`,
          scheduledWindow,
          sharedDeliveryCost,
          sharedDeliveryCost,
          paymentExpiresAt,
          subtotal,
          discountTotal,
          totalAmount,
          `Seller Approved (${formatINRServer(confirmedUnitPrice)}/unit) · Complete Payment Before Deadline`,
          nowIso
        );

        db.prepare(
          `INSERT INTO order_items (id, order_id, product_id, seller_id, quantity, unit_price, deal_id, delivery_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `oi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          orderId,
          product.id,
          product.seller_id,
          qty,
          confirmedUnitPrice,
          id,
          deliveryDate
        );
        ordersCreatedCount++;
      } else {
        orderId = existingOrder.id;
      }

      insertNotification({
        userId: mem.user_id,
        type: 'group_approved',
        title: `Seller Approved Group Price: ${product.name}`,
        message: `Your "${String(deal.title)}" group is approved! Confirmed group price: ${formatINRServer(confirmedUnitPrice)}/unit (Save ${formatINRServer(totalIndividualSavings)} total incl. ${formatINRServer(sharedDeliveryCost)} shared delivery). Complete payment before ${new Date(paymentExpiresAt).toLocaleString()} to confirm Order #${orderId}.`,
        metadata: {
          dealId: id,
          orderId,
          productId: product.id,
          productName: product.name,
          finalGroupPrice: confirmedUnitPrice,
          totalSavings: totalIndividualSavings,
          sharedDeliveryCostPerMember: sharedDeliveryCost,
          paymentExpiresAt,
        },
        actionStatus: 'pending',
        dedupeMatch: `"dealId":"${id}"`,
      });
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const updatedRow = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown>;
  const hydrated = hydrateGroupDeal(updatedRow, Number(product.price), undefined, {
    productName: product.name,
    productImage: product.image_url,
  });
  return { deal: hydrated, alreadyProcessed: false, ordersCreatedCount };
}

function executeSellerGroupRejection(deal: Record<string, unknown>, reason?: string) {
  const id = String(deal.id);
  const currentStatus = String(deal.status);
  if (currentStatus === 'rejected') {
    return { deal, alreadyProcessed: true };
  }
  if (currentStatus === 'approved' || currentStatus === 'confirmed') {
    throw new Error('ALREADY_APPROVED');
  }

  const product = db
    .prepare('SELECT id, name, price, image_url FROM products WHERE id = ?')
    .get(String(deal.product_id)) as { id: string; name: string; price: number; image_url: string } | undefined;

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE group_deals SET status = 'rejected' WHERE id = ?`).run(id);
    db.prepare(
      `UPDATE group_deal_members SET commitment_status = 'Expired' WHERE deal_id = ? AND commitment_status = 'Committed'`
    ).run(id);

    db.prepare(
      `UPDATE notifications
       SET action_status = 'rejected', is_read = 1
       WHERE type = 'seller_group_approval_request' AND metadata_json LIKE ?`
    ).run(`%"dealId":"${id}"%`);

    db.prepare(`DELETE FROM cart_items WHERE deal_id = ?`).run(id);
    db.prepare(
      `UPDATE orders SET fulfillment_status = 'Cancelled', group_approval_status = 'Rejected by Seller', tracking_stage = 'Group Order Rejected by Seller' WHERE deal_id = ? AND fulfillment_status != 'Cancelled'`
    ).run(id);

    const members = db
      .prepare('SELECT user_id FROM group_deal_members WHERE deal_id = ?')
      .all(id) as { user_id: string }[];

    for (const mem of members) {
      insertNotification({
        userId: mem.user_id,
        type: 'group_rejected',
        title: `Group Order Declined: ${product?.name || String(deal.title)}`,
        message: reason?.trim()
          ? `The seller declined "${String(deal.title)}": ${reason.trim()}. Since no payment was collected, no refund is needed.`
          : `The seller declined the group order request for "${String(deal.title)}". Since no payment was collected, no refund is needed.`,
        metadata: {
          dealId: id,
          productId: deal.product_id,
          productName: product?.name || String(deal.title),
        },
        actionStatus: 'info',
        dedupeMatch: `"dealId":"${id}"`,
      });
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const updated = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown>;
  const hydrated = product
    ? hydrateGroupDeal(updated, Number(product.price), undefined, {
        productName: product.name,
        productImage: product.image_url,
      })
    : updated;
  return { deal: hydrated, alreadyProcessed: false };
}

app.post('/api/group-deals/:id/approve', (req, res) => {
  runAllGroupDealSweeps();
  const { id } = req.params;
  const { sellerId, finalDiscountPercent, finalGroupPrice, paymentWindowHours, title, minParticipants } =
    (req.body || {}) as {
      sellerId?: string;
      finalDiscountPercent?: number;
      finalGroupPrice?: number;
      paymentWindowHours?: number;
      title?: string;
      minParticipants?: number;
    };
  const deal = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!deal) {
    res.status(404).json({ error: 'Group deal not found.' });
    return;
  }

  try {
    const result = executeSellerGroupApproval(deal, {
      sellerId,
      discountPercent: finalDiscountPercent,
      finalGroupPrice,
      paymentWindowHours,
      title,
      minParticipants,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'FORBIDDEN_SELLER') {
        res.status(403).json({ error: 'Only the listing seller can approve this group order.' });
        return;
      }
      if (err.message === 'ALREADY_REJECTED') {
        res.status(409).json({ error: 'This group deal was already rejected.' });
        return;
      }
      if (err.message === 'ALREADY_EXPIRED') {
        res.status(410).json({ error: 'This group pool has already expired.' });
        return;
      }
      if (err.message.startsWith('THRESHOLD_NOT_MET:')) {
        const [, committed, needed] = err.message.split(':');
        res.status(400).json({
          error: `Group threshold has not been reached yet (${committed}/${needed} committed).`,
        });
        return;
      }
      if (err.message.startsWith('INSUFFICIENT_STOCK:')) {
        const [, available, needed] = err.message.split(':');
        res.status(400).json({
          error: `Insufficient stock (${available} available, ${needed} committed units needed). Restock product before approving.`,
        });
        return;
      }
      if (err.message.startsWith('GROUP_PRICE_NOT_LOWER:')) {
        const [, retail, maxAllowed] = err.message.split(':');
        res.status(400).json({
          error: `Confirmed group price must be strictly lower than normal retail (${formatINRServer(Number(retail))}). Set ${formatINRServer(Number(maxAllowed))} or less.`,
        });
        return;
      }
      if (err.message.startsWith('GROUP_TOTAL_NOT_LOWER:')) {
        const [, retail, maxAllowed, sharedDel] = err.message.split(':');
        res.status(400).json({
          error: `Group unit price + shared delivery (${formatINRServer(Number(sharedDel))}) must stay below normal price (${formatINRServer(Number(retail))}). Set ${formatINRServer(Number(maxAllowed))} or less.`,
        });
        return;
      }
    }
    throw err;
  }
});

app.post('/api/group-deals/:id/reject', (req, res) => {
  runAllGroupDealSweeps();
  const { id } = req.params;
  const { reason } = (req.body || {}) as { reason?: string };
  const deal = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!deal) {
    res.status(404).json({ error: 'Group deal not found.' });
    return;
  }

  try {
    const result = executeSellerGroupRejection(deal, reason);
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'ALREADY_APPROVED') {
      res.status(409).json({ error: 'This group deal has already been approved.' });
      return;
    }
    throw err;
  }
});

app.patch('/api/group-deals/:id/seller', (req, res) => {
  runAllGroupDealSweeps();
  const { id } = req.params;
  const {
    approve,
    reject,
    reason,
    sellerId,
    minParticipants,
    discountPercent,
    finalGroupPrice,
    paymentWindowHours,
    tier2Min,
    tier2Discount,
    title,
  } = req.body as {
    approve?: boolean;
    reject?: boolean;
    reason?: string;
    sellerId?: string;
    minParticipants?: number;
    discountPercent?: number;
    finalGroupPrice?: number;
    paymentWindowHours?: number;
    tier2Min?: number | null;
    tier2Discount?: number | null;
    title?: string;
  };

  const deal = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!deal) {
    res.status(404).json({ error: 'Group deal not found.' });
    return;
  }
  if (deal.status === 'expired' || deal.status === 'dissolved') {
    res.status(410).json({ error: 'This group pool has expired.' });
    return;
  }

  if (approve) {
    try {
      const result = executeSellerGroupApproval(deal, {
        sellerId,
        title,
        minParticipants,
        discountPercent,
        finalGroupPrice,
        paymentWindowHours,
        tier2Min,
        tier2Discount,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'ALREADY_REJECTED') {
          res.status(409).json({ error: 'This group deal was already rejected.' });
          return;
        }
        if (err.message.startsWith('THRESHOLD_NOT_MET:')) {
          const [, committed, needed] = err.message.split(':');
          res.status(400).json({
            error: `Group threshold has not been reached yet (${committed}/${needed} committed).`,
          });
          return;
        }
        if (err.message.startsWith('INSUFFICIENT_STOCK:')) {
          const [, available, needed] = err.message.split(':');
          res.status(400).json({
            error: `Insufficient stock (${available} available, ${needed} committed units needed).`,
          });
          return;
        }
        if (err.message.startsWith('GROUP_PRICE_NOT_LOWER:')) {
          const [, retail, maxAllowed] = err.message.split(':');
          res.status(400).json({
            error: `Confirmed group price must be strictly lower than normal retail (${formatINRServer(Number(retail))}). Set ${formatINRServer(Number(maxAllowed))} or less.`,
          });
          return;
        }
        if (err.message.startsWith('GROUP_TOTAL_NOT_LOWER:')) {
          const [, retail, maxAllowed, sharedDel] = err.message.split(':');
          res.status(400).json({
            error: `Group unit price + shared delivery (${formatINRServer(Number(sharedDel))}) must stay below normal price (${formatINRServer(Number(retail))}). Set ${formatINRServer(Number(maxAllowed))} or less.`,
          });
          return;
        }
      }
      throw err;
    }
    return;
  }

  if (reject) {
    try {
      const result = executeSellerGroupRejection(deal, reason);
      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === 'ALREADY_APPROVED') {
        res.status(409).json({ error: 'This group deal has already been approved.' });
        return;
      }
      throw err;
    }
    return;
  }

  const nextMin = minParticipants !== undefined ? Math.max(2, Number(minParticipants)) : Number(deal.min_participants);
  const nextDiscount =
    discountPercent !== undefined ? Math.min(75, Math.max(5, Number(discountPercent))) : Number(deal.discount_percent);
  const nextTier2Min = tier2Min !== undefined ? (tier2Min ? Number(tier2Min) : null) : (deal.tier2_min as number | null);
  const nextTier2Discount =
    tier2Discount !== undefined ? (tier2Discount ? Number(tier2Discount) : null) : (deal.tier2_discount as number | null);
  const nextStatus = String(deal.status) === 'unlocked' ? 'active' : String(deal.status);

  db.prepare(
    `UPDATE group_deals
     SET title = ?, min_participants = ?, discount_percent = ?, tier2_min = ?, tier2_discount = ?, status = ?
     WHERE id = ?`
  ).run(
    title?.trim() || String(deal.title),
    nextMin,
    nextDiscount,
    nextTier2Min,
    nextTier2Discount,
    nextStatus,
    id
  );

  const updated = db.prepare('SELECT * FROM group_deals WHERE id = ?').get(id);
  res.json({ deal: updated, autoAddedCount: 0 });
});

// --- PERSISTENT CART ---
function getHydratedCart(userId: string): CartItem[] {
  dissolveExpiredGroupDeals();
  const rows = db
    .prepare(
      `SELECT * FROM cart_items WHERE user_id = ? ORDER BY created_at ASC`
    )
    .all(userId) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const allProducts = getEnrichedProducts({ userId });
  const productMap = new Map(allProducts.map((p) => [p.id, p]));

  const items: CartItem[] = [];
  for (const r of rows) {
    const prod = productMap.get(String(r.product_id));
    if (!prod || prod.stock <= 0) continue;
    items.push({
      product: prod,
      quantity: Math.min(prod.stock, Math.max(1, Number(r.quantity) || 1)),
      dealId: r.deal_id ? String(r.deal_id) : null,
      discountedUnitPrice: Number(r.discounted_unit_price),
      autoAddedReason: r.auto_added_reason ? String(r.auto_added_reason) : null,
    });
  }
  return items;
}

app.get('/api/cart/:userId', (req, res) => {
  const { userId } = req.params;
  res.json({ items: getHydratedCart(userId) });
});

app.post('/api/cart/:userId/items', (req, res) => {
  processExpiredGroupDeals();
  const { userId } = req.params;
  const { productId, quantity = 1, dealId = null, discountedUnitPrice } = req.body as {
    productId?: string;
    quantity?: number;
    dealId?: string | null;
    discountedUnitPrice?: number;
  };
  if (!productId) {
    res.status(400).json({ error: 'Product ID is required.' });
    return;
  }

  const prod = db.prepare('SELECT id, price, stock FROM products WHERE id = ?').get(productId) as
    | { id: string; price: number; stock: number }
    | undefined;
  if (!prod) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  if (prod.stock <= 0) {
    res.status(400).json({ error: 'Product is out of stock.' });
    return;
  }

  if (dealId) {
    const dealRow = db
      .prepare('SELECT status, expires_at, payment_expires_at FROM group_deals WHERE id = ?')
      .get(dealId) as { status: string; expires_at: string; payment_expires_at: string | null } | undefined;
    if (
      !dealRow ||
      dealRow.status === 'expired' ||
      dealRow.status === 'dissolved' ||
      dealRow.status === 'rejected'
    ) {
      res.status(410).json({ error: 'This group order is no longer open for checkout.' });
      return;
    }
    if (dealRow.status !== 'approved' && dealRow.status !== 'confirmed') {
      res.status(409).json({
        error: 'Group price is not guaranteed yet. Commit to the group pool with ₹0 due now and wait for threshold + seller approval.',
      });
      return;
    }
    if (dealRow.payment_expires_at && Date.parse(dealRow.payment_expires_at) <= Date.now()) {
      res.status(410).json({ error: 'The payment window for this group order has expired.' });
      return;
    }

    const existingOrder = db
      .prepare(
        `SELECT id, payment_status FROM orders WHERE customer_id = ? AND deal_id = ? AND fulfillment_status != 'Cancelled'`
      )
      .get(userId, dealId) as { id: string; payment_status: string } | undefined;
    if (existingOrder && existingOrder.payment_status === 'Paid (Simulated)') {
      res.status(409).json({
        error: `You have already paid Order #${existingOrder.id} for this group deal. Duplicate payments are prevented.`,
      });
      return;
    }
  }

  let unitPrice =
    discountedUnitPrice !== undefined && Number(discountedUnitPrice) > 0
      ? Number(Number(discountedUnitPrice).toFixed(2))
      : Number(prod.price);
  if (dealId) {
    const dealPriceRow = db
      .prepare('SELECT final_group_price, discount_percent FROM group_deals WHERE id = ?')
      .get(dealId) as { final_group_price: number | null; discount_percent: number } | undefined;
    const maxDealPrice = Number(prod.price) > 1 ? Number((Number(prod.price) - 1).toFixed(2)) : Number(prod.price);
    const derivedDealPrice =
      dealPriceRow?.final_group_price !== null && dealPriceRow?.final_group_price !== undefined
        ? Number(dealPriceRow.final_group_price)
        : Number((Number(prod.price) * (1 - Number(dealPriceRow?.discount_percent || 10) / 100)).toFixed(2));
    unitPrice = Math.min(unitPrice, derivedDealPrice, maxDealPrice);
  }
  const existing = db
    .prepare('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?')
    .get(userId, productId) as { id: string; quantity: number } | undefined;

  if (existing) {
    const nextQty = dealId
      ? Math.min(prod.stock, Math.max(1, Number(quantity) || 1))
      : Math.min(prod.stock, existing.quantity + Math.max(1, Number(quantity) || 1));
    db.prepare(
      `UPDATE cart_items SET quantity = ?, deal_id = COALESCE(?, deal_id), discounted_unit_price = ? WHERE id = ?`
    ).run(nextQty, dealId, unitPrice, existing.id);
  } else {
    db.prepare(
      `INSERT INTO cart_items (id, user_id, product_id, quantity, deal_id, discounted_unit_price, auto_added_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      `ci_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      productId,
      Math.min(prod.stock, Math.max(1, Number(quantity) || 1)),
      dealId,
      unitPrice,
      new Date().toISOString()
    );
  }

  res.json({ items: getHydratedCart(userId) });
});

app.patch('/api/cart/:userId/items/:productId', (req, res) => {
  const { userId, productId } = req.params;
  const { quantity } = req.body as { quantity?: number };
  const prod = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as
    | { stock: number }
    | undefined;
  if (!prod) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  const nextQty = Math.min(prod.stock, Math.max(1, Number(quantity) || 1));
  db.prepare('UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?').run(
    nextQty,
    userId,
    productId
  );
  res.json({ items: getHydratedCart(userId) });
});

app.delete('/api/cart/:userId/items/:productId', (req, res) => {
  const { userId, productId } = req.params;
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(userId, productId);
  res.json({ items: getHydratedCart(userId) });
});

// --- AVAILABILITY SCHEDULING ---
app.get('/api/availability/:userId', (req, res) => {
  const { userId } = req.params;
  const rows = db
    .prepare('SELECT * FROM availability_slots WHERE user_id = ?')
    .all(userId) as Record<string, unknown>[];

  const slots: AvailabilitySlot[] = rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    dayOfWeek: r.day_of_week as AvailabilitySlot['dayOfWeek'],
    slotLabel: r.slot_label as AvailabilitySlot['slotLabel'],
    status: r.status as AvailabilitySlot['status'],
    note: String(r.note || ''),
  }));

  res.json({ slots, recommendedWindow: getNextAvailableWindow(userId) });
});

app.put('/api/availability/:userId', (req, res) => {
  const { userId } = req.params;
  const { slots } = req.body as {
    slots: { dayOfWeek: string; slotLabel: string; status: 'available' | 'unavailable'; note?: string }[];
  };
  if (!Array.isArray(slots)) {
    res.status(400).json({ error: 'Slots array is required.' });
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO availability_slots (id, user_id, day_of_week, slot_label, status, note)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, day_of_week, slot_label)
    DO UPDATE SET status = excluded.status, note = excluded.note
  `);

  db.exec('BEGIN');
  try {
    for (const s of slots) {
      upsert.run(
        `slot_${userId}_${s.dayOfWeek}_${s.slotLabel.slice(0, 4)}`,
        userId,
        s.dayOfWeek,
        s.slotLabel,
        s.status,
        s.note ?? ''
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const updatedRows = db
    .prepare('SELECT * FROM availability_slots WHERE user_id = ?')
    .all(userId) as Record<string, unknown>[];

  res.json({
    slots: updatedRows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      dayOfWeek: r.day_of_week,
      slotLabel: r.slot_label,
      status: r.status,
      note: String(r.note || ''),
    })),
    recommendedWindow: getNextAvailableWindow(userId),
  });
});

// --- ORDERS & COMBINED DELIVERY ---
const LIFECYCLE_ORDER: DeliveryLifecycleStageKey[] = [
  'order_confirmed',
  'order_processed',
  'ready_for_dispatch',
  'out_for_delivery',
  'availability_confirmation',
  'partner_assigned',
  'delivered',
];

function parseStageTimestamps(
  rawJson: unknown,
  createdAt: string,
  stage: DeliveryLifecycleStageKey
): Partial<Record<DeliveryLifecycleStageKey, string>> {
  let map: Partial<Record<DeliveryLifecycleStageKey, string>> = {};
  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      map = JSON.parse(rawJson) as Partial<Record<DeliveryLifecycleStageKey, string>>;
    } catch {
      map = {};
    }
  }
  if (!map.order_confirmed) {
    map.order_confirmed = createdAt;
  }
  if (!map[stage]) {
    map[stage] = createdAt;
  }
  return map;
}

function mergeStageTimestamps(
  rawJson: unknown,
  createdAt: string,
  stage: DeliveryLifecycleStageKey,
  atIso = new Date().toISOString()
): string {
  const existing = parseStageTimestamps(rawJson, createdAt, stage);
  const idx = LIFECYCLE_ORDER.indexOf(stage);
  for (let i = 0; i <= idx; i++) {
    const k = LIFECYCLE_ORDER[i];
    if (!existing[k]) {
      existing[k] = i === idx ? atIso : existing.order_confirmed || createdAt;
    }
  }
  existing[stage] = atIso;
  return JSON.stringify(existing);
}

function pickDeliveryPartnerForOrder(orderId: string): Record<string, unknown> | null {
  const partners = db.prepare('SELECT * FROM delivery_partners ORDER BY id ASC').all() as Record<
    string,
    unknown
  >[];
  if (partners.length === 0) return null;
  const hashVal = orderId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return partners[hashVal % partners.length];
}

function hydrateOrders(orderRows: Record<string, unknown>[]): Order[] {
  return orderRows.map((o) => {
    const itemsRows = db
      .prepare(
        `SELECT oi.*, p.name as product_name, p.image_url as product_image, u.name as seller_name
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         JOIN users u ON oi.seller_id = u.id
         WHERE oi.order_id = ?`
      )
      .all(String(o.id)) as Record<string, unknown>[];

    const items: OrderItem[] = itemsRows.map((i) => ({
      id: String(i.id),
      orderId: String(i.order_id),
      productId: String(i.product_id),
      productName: String(i.product_name),
      productImage: String(i.product_image),
      sellerId: String(i.seller_id),
      sellerName: String(i.seller_name),
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      dealId: i.deal_id ? String(i.deal_id) : null,
      deliveryDate: i.delivery_date ? String(i.delivery_date) : null,
    }));

    let deliveryPartner: DeliveryPartner | null = null;
    if (o.delivery_partner_id) {
      const pRow = db
        .prepare('SELECT * FROM delivery_partners WHERE id = ?')
        .get(String(o.delivery_partner_id)) as Record<string, unknown> | undefined;
      if (pRow) {
        deliveryPartner = {
          id: String(pRow.id),
          name: String(pRow.name),
          phone: String(pRow.phone),
          avatarUrl: String(pRow.avatar_url),
          vehicle: String(pRow.vehicle),
          hubZone: String(pRow.hub_zone),
          rating: Number(pRow.rating),
        };
      }
    }

    const createdAt = String(o.created_at);
    const fulfillment = o.fulfillment_status as Order['fulfillmentStatus'];
    const rawStage = String(o.lifecycle_stage || '');
    const fallbackStage: DeliveryLifecycleStageKey =
      fulfillment === 'Delivered'
        ? 'delivered'
        : deliveryPartner
          ? 'partner_assigned'
          : fulfillment === 'Out for Delivery'
            ? 'availability_confirmation'
            : fulfillment === 'Combined & Packed'
              ? 'ready_for_dispatch'
              : 'order_confirmed';
    const lifecycleStage: DeliveryLifecycleStageKey = LIFECYCLE_ORDER.includes(
      rawStage as DeliveryLifecycleStageKey
    )
      ? (rawStage as DeliveryLifecycleStageKey)
      : fallbackStage;

    let groupStageLabel: GroupDealStageLabel | null = null;
    let groupDealTitle: string | null = null;
    let groupPaidCount: number | null = null;
    let groupCommittedCount: number | null = null;
    let groupMinParticipants: number | null = null;
    let finalGroupPrice: number | null = null;
    let paymentDeadline: string | null = o.payment_deadline ? String(o.payment_deadline) : null;
    if (o.deal_id) {
      const dealMeta = db
        .prepare(
          'SELECT status, expires_at, payment_expires_at, final_group_price, title, current_participants, min_participants FROM group_deals WHERE id = ?'
        )
        .get(String(o.deal_id)) as
        | {
            status: string;
            expires_at: string;
            payment_expires_at: string | null;
            final_group_price: number | null;
            title: string;
            current_participants: number;
            min_participants: number;
          }
        | undefined;
      if (dealMeta) {
        const paidRow = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM group_deal_members WHERE deal_id = ? AND commitment_status = 'Paid'`
          )
          .get(String(o.deal_id)) as { cnt: number };
        groupCommittedCount = Number(dealMeta.current_participants);
        groupPaidCount = Number(paidRow?.cnt || 0);
        groupMinParticipants = Number(dealMeta.min_participants);
        groupDealTitle = String(dealMeta.title);
        finalGroupPrice =
          dealMeta.final_group_price !== null && dealMeta.final_group_price !== undefined
            ? Number(dealMeta.final_group_price)
            : null;
        if (!paymentDeadline && dealMeta.payment_expires_at) {
          paymentDeadline = String(dealMeta.payment_expires_at);
        }
        groupStageLabel = computeStageLabel(
          dealMeta.status,
          dealMeta.expires_at,
          groupCommittedCount,
          groupPaidCount,
          groupMinParticipants,
          dealMeta.payment_expires_at
        );
      }
    }

    return {
      id: String(o.id),
      customerId: String(o.customer_id),
      customerName: o.customer_name ? String(o.customer_name) : undefined,
      customerAddress: o.shipping_address
        ? String(o.shipping_address)
        : o.customer_address
          ? String(o.customer_address)
          : undefined,
      dealId: o.deal_id ? String(o.deal_id) : null,
      groupStageLabel,
      groupDealTitle,
      groupPaidCount,
      groupCommittedCount,
      groupMinParticipants,
      sharedDeliveryCost:
        o.shared_delivery_cost !== null && o.shared_delivery_cost !== undefined
          ? Number(o.shared_delivery_cost)
          : null,
      finalGroupPrice,
      paymentDeadline,
      individualDeliveryOptionFee: INDIVIDUAL_DELIVERY_FEE,
      expiredResolutionStatus:
        (o.expired_resolution_status as Order['expiredResolutionStatus']) || 'none',
      deliveryMode: o.delivery_mode as Order['deliveryMode'],
      combinedGroupId: o.combined_group_id ? String(o.combined_group_id) : null,
      scheduledWindow: String(o.scheduled_window),
      shippingFee: Number(o.shipping_fee),
      subtotal: Number(o.subtotal),
      discountTotal: Number(o.discount_total),
      totalAmount: Number(o.total_amount),
      paymentMethod: o.payment_method
        ? String(o.payment_method)
        : 'Card ending in 4242 (Simulated)',
      paymentStatus: String(o.payment_status),
      fulfillmentStatus: fulfillment,
      groupApprovalStatus:
        (o.group_approval_status as Order['groupApprovalStatus']) || 'Not Required',
      deliveryAvailabilityStatus:
        (o.delivery_availability_status as Order['deliveryAvailabilityStatus']) || 'Not Dispatched',
      rescheduleRequestedWindow: o.reschedule_requested_window
        ? String(o.reschedule_requested_window)
        : null,
      deliveryPartner,
      lifecycleStage,
      stageTimestamps: parseStageTimestamps(o.stage_timestamps_json, createdAt, lifecycleStage),
      trackingStage: o.tracking_stage ? String(o.tracking_stage) : String(o.fulfillment_status),
      trackingEta: o.tracking_eta ? String(o.tracking_eta) : null,
      handoverPin: computeHandoverPin(String(o.id)),
      deliveryRating: o.delivery_rating !== null && o.delivery_rating !== undefined ? Number(o.delivery_rating) : null,
      deliveryFeedback: o.delivery_feedback ? String(o.delivery_feedback) : null,
      liveTrackingConfigured: Boolean(process.env.COURIER_DISPATCH_API_URL),
      createdAt,
      items,
    };
  });
}

app.get('/api/orders', (req, res) => {
  runAllGroupDealSweeps();
  const { customerId, sellerId } = req.query as Record<string, string | undefined>;
  if (customerId) {
    const rows = db
      .prepare(
        `SELECT o.*, u.name as customer_name, u.address as customer_address
         FROM orders o JOIN users u ON o.customer_id = u.id
         WHERE o.customer_id = ? ORDER BY o.created_at DESC`
      )
      .all(customerId) as Record<string, unknown>[];
    res.json({ orders: hydrateOrders(rows) });
    return;
  }
  if (sellerId) {
    const rows = db
      .prepare(
        `SELECT DISTINCT o.*, u.name as customer_name, u.address as customer_address
         FROM orders o
         JOIN order_items oi ON o.id = oi.order_id
         JOIN users u ON o.customer_id = u.id
         WHERE oi.seller_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(sellerId) as Record<string, unknown>[];
    res.json({ orders: hydrateOrders(rows) });
    return;
  }
  res.status(400).json({ error: 'customerId or sellerId query parameter required.' });
});

app.post('/api/orders', (req, res) => {
  processExpiredGroupDeals();
  const {
    customerId,
    items,
    deliveryMode,
    deliveryScheduleChoice,
    combineWithOrderId,
    preferredWindow,
    paymentMethod,
    shippingAddress,
    paymentMode = 'pay_now',
  } = req.body as {
    customerId: string;
    items: { productId: string; quantity: number; dealId?: string | null; unitPrice: number }[];
    deliveryMode: 'combined' | 'express_separate';
    deliveryScheduleChoice?: 'same_day' | 'as_shown';
    combineWithOrderId?: string | null;
    preferredWindow?: string;
    paymentMethod?: string;
    shippingAddress?: string;
    paymentMode?: 'pay_now' | 'pay_later';
  };

  if (!customerId || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Customer ID and at least one cart item are required.' });
    return;
  }

  const now = new Date().toISOString();
  const orderId = `CS-${Math.floor(1050 + Math.random() * 8900)}`;
  let linkedDealId: string | null = null;
  let errorStatusCode = 400;

  db.exec('BEGIN');
  try {
    let subtotal = 0;
    let discountTotal = 0;
    let maxDeliveryDays = 2;
    const preparedItems: {
      productId: string;
      sellerId: string;
      quantity: number;
      unitPrice: number;
      dealId: string | null;
      deliveryDays: number;
      individualDate: string;
    }[] = [];

    for (const item of items) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(item.productId) as
        | Record<string, unknown>
        | undefined;
      if (!prod) {
        throw new Error(`Product ${item.productId} not found.`);
      }
      const stock = Number(prod.stock);
      const qty = Math.max(1, Number(item.quantity));
      if (stock < qty) {
        throw new Error(`Insufficient stock for ${String(prod.name)} (${stock} remaining).`);
      }

      if (item.dealId) {
        const dealCheck = db
          .prepare('SELECT id, status, expires_at, payment_expires_at FROM group_deals WHERE id = ?')
          .get(item.dealId) as
          | { id: string; status: string; expires_at: string; payment_expires_at: string | null }
          | undefined;
        if (
          !dealCheck ||
          dealCheck.status === 'expired' ||
          dealCheck.status === 'dissolved' ||
          dealCheck.status === 'rejected'
        ) {
          errorStatusCode = 410;
          throw new Error(`Group order for ${String(prod.name)} has expired or closed.`);
        }
        if (dealCheck.status !== 'approved' && dealCheck.status !== 'confirmed') {
          errorStatusCode = 409;
          throw new Error(
            `Group order for ${String(prod.name)} has not been approved by the seller yet. Commit to the pool with ₹0 payment instead.`
          );
        }
        if (dealCheck.payment_expires_at && Date.parse(dealCheck.payment_expires_at) <= Date.now()) {
          errorStatusCode = 410;
          throw new Error(`Payment window for ${String(prod.name)} group order has expired.`);
        }
      }

      // Decrement inventory atomically
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, item.productId);

      const basePrice = Number(prod.price);
      let unitPrice = Number(item.unitPrice) || basePrice;
      if (item.dealId) {
        const dealPriceRow = db
          .prepare('SELECT final_group_price, discount_percent FROM group_deals WHERE id = ?')
          .get(item.dealId) as { final_group_price: number | null; discount_percent: number } | undefined;
        const maxDealPrice = basePrice > 1 ? Number((basePrice - 1).toFixed(2)) : basePrice;
        const derivedDealPrice =
          dealPriceRow?.final_group_price !== null && dealPriceRow?.final_group_price !== undefined
            ? Number(dealPriceRow.final_group_price)
            : Number((basePrice * (1 - Number(dealPriceRow?.discount_percent || 10) / 100)).toFixed(2));
        unitPrice = Math.min(unitPrice, derivedDealPrice, maxDealPrice);
      }
      const itemLeadDays = Number(prod.delivery_days ?? 2);
      if (itemLeadDays > maxDeliveryDays) {
        maxDeliveryDays = itemLeadDays;
      }

      subtotal += unitPrice * qty;
      if (unitPrice < basePrice) {
        discountTotal += (basePrice - unitPrice) * qty;
      }

      preparedItems.push({
        productId: item.productId,
        sellerId: String(prod.seller_id),
        quantity: qty,
        unitPrice,
        dealId: item.dealId || null,
        deliveryDays: itemLeadDays,
        individualDate: computeEstimatedDeliveryDate(itemLeadDays),
      });
    }

    const effectiveScheduleChoice =
      deliveryScheduleChoice || (deliveryMode === 'combined' ? 'same_day' : 'as_shown');
    const resolvedMode: 'combined' | 'express_separate' =
      effectiveScheduleChoice === 'same_day' ? 'combined' : 'express_separate';

    const distinctDates = Array.from(new Set(preparedItems.map((i) => i.individualDate)));
    const sameDayWindow = getNextAvailableWindowOnOrAfter(customerId, maxDeliveryDays);

    let combinedGroupId: string | null = null;
    let scheduledWindow =
      preferredWindow?.trim() ||
      (effectiveScheduleChoice === 'same_day'
        ? sameDayWindow
        : distinctDates.length > 1
          ? `As shown: ${distinctDates.join(' & ')}`
          : sameDayWindow);

    let shippingFee =
      resolvedMode === 'combined'
        ? 0
        : INDIVIDUAL_DELIVERY_FEE * Math.max(1, distinctDates.length, new Set(preparedItems.map((i) => i.sellerId)).size);

    if (resolvedMode === 'combined') {
      if (combineWithOrderId) {
        const existingOrder = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(
          combineWithOrderId,
          customerId
        ) as Record<string, unknown> | undefined;
        if (existingOrder) {
          combinedGroupId = existingOrder.combined_group_id
            ? String(existingOrder.combined_group_id)
            : `CMB-SEA-${Math.floor(100 + Math.random() * 899)}`;
          scheduledWindow = String(existingOrder.scheduled_window);
          db.prepare(
            `UPDATE orders SET delivery_mode = 'combined', combined_group_id = ?, fulfillment_status = 'Combined & Packed' WHERE id = ?`
          ).run(combinedGroupId, combineWithOrderId);
        }
      }
      if (!combinedGroupId) {
        combinedGroupId = `CMB-SEA-${Math.floor(100 + Math.random() * 899)}`;
      }
      shippingFee = 0;
    }

    const totalAmount = Number((subtotal + shippingFee).toFixed(2));
    const initialStatus =
      resolvedMode === 'combined' && combineWithOrderId ? 'Combined & Packed' : 'Confirmed';

    // Deduplicate & prevent duplicate group deal purchases per customer
    const dealIdsInCart = Array.from(
      new Set(preparedItems.map((pi) => pi.dealId).filter((d): d is string => Boolean(d)))
    );
    let groupApprovalStatus: Order['groupApprovalStatus'] = 'Not Required';

    for (const dId of dealIdsInCart) {
      const existingGroupOrder = db
        .prepare(
          `SELECT id, payment_status, group_approval_status
           FROM orders
           WHERE customer_id = ? AND deal_id = ? AND fulfillment_status != 'Cancelled'`
        )
        .get(customerId, dId) as
        | { id: string; payment_status: string; group_approval_status: string }
        | undefined;
      if (existingGroupOrder) {
        if (existingGroupOrder.payment_status === 'Pending Checkout') {
          db.prepare('DELETE FROM orders WHERE id = ?').run(existingGroupOrder.id);
          linkedDealId = dId;
          groupApprovalStatus = 'Approved by Seller';
        } else {
          errorStatusCode = 409;
          throw new Error(
            `Duplicate group purchase blocked: you already placed Order #${existingGroupOrder.id} for this group deal.`
          );
        }
      }
    }
    if (!linkedDealId && dealIdsInCart.length > 0) {
      linkedDealId = dealIdsInCart[0];
      const dealRow = db
        .prepare('SELECT status FROM group_deals WHERE id = ?')
        .get(linkedDealId) as { status?: string } | undefined;
      if (dealRow?.status === 'approved' || dealRow?.status === 'confirmed') {
        groupApprovalStatus = 'Approved by Seller';
      }
    }

    // Ensure group membership row exists for linked group deal
    if (linkedDealId) {
      const matchedItem = preparedItems.find((pi) => pi.dealId === linkedDealId);
      db.prepare(
        `INSERT OR IGNORE INTO group_deal_members (id, deal_id, user_id, quantity, confirmed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        `gdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        linkedDealId,
        customerId,
        matchedItem?.quantity || 1,
        now
      );
    }

    const isPayLater = paymentMode === 'pay_later';
    const paymentStatus = isPayLater ? 'Pending Payment' : 'Paid (Simulated)';

    const trackingStage = isPayLater
      ? linkedDealId
        ? 'Ordered · Complete Payment to Count Toward Group'
        : 'Ordered · Payment Pending'
      : linkedDealId
        ? 'Paid · Syncing Group Threshold Progress'
        : initialStatus === 'Combined & Packed'
          ? 'Combined & Packed · Ready for Dispatch'
          : 'Order Confirmed · Successfully Placed';
    const initialLifecycle: DeliveryLifecycleStageKey =
      initialStatus === 'Combined & Packed' ? 'ready_for_dispatch' : 'order_confirmed';
    const initialTimestamps = mergeStageTimestamps(null, now, initialLifecycle, now);

    const chosenPaymentMethod =
      paymentMethod?.trim() || 'Card ending in 4242 (Simulated)';
    const customerRow = db
      .prepare('SELECT address FROM users WHERE id = ?')
      .get(customerId) as { address?: string } | undefined;
    const chosenShippingAddress =
      shippingAddress?.trim() || customerRow?.address || '418 Pine St, Apt 4B, Seattle, WA';

    db.prepare(
      `INSERT INTO orders (
        id, customer_id, deal_id, delivery_mode, combined_group_id, scheduled_window,
        shipping_fee, subtotal, discount_total, total_amount, payment_method, payment_status, fulfillment_status,
        group_approval_status, delivery_availability_status, lifecycle_stage, stage_timestamps_json, tracking_stage, shipping_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Dispatched', ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      customerId,
      linkedDealId,
      resolvedMode,
      combinedGroupId,
      scheduledWindow,
      Number(shippingFee.toFixed(2)),
      Number(subtotal.toFixed(2)),
      Number(discountTotal.toFixed(2)),
      totalAmount,
      chosenPaymentMethod,
      paymentStatus,
      initialStatus,
      groupApprovalStatus,
      initialLifecycle,
      initialTimestamps,
      trackingStage,
      chosenShippingAddress,
      now
    );

    const sameDayDateOnly = computeEstimatedDeliveryDate(maxDeliveryDays);
    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, seller_id, quantity, unit_price, deal_id, delivery_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const pi of preparedItems) {
      insertItem.run(
        `oi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        orderId,
        pi.productId,
        pi.sellerId,
        pi.quantity,
        pi.unitPrice,
        pi.dealId,
        effectiveScheduleChoice === 'same_day' ? sameDayDateOnly : pi.individualDate
      );
    }

    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(customerId);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(errorStatusCode).json({ error: err instanceof Error ? err.message : 'Order creation failed.' });
    return;
  }

  let groupUpdate: ReturnType<typeof recomputeGroupDealProgress> = null;
  if (linkedDealId) {
    groupUpdate = recomputeGroupDealProgress(linkedDealId);
  }

  const orderRow = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
    )
    .get(orderId) as Record<string, unknown>;
  const [order] = hydrateOrders([orderRow]);
  res.status(201).json({ order, groupUpdate });
});

app.post('/api/orders/combine', (req, res) => {
  const { customerId, orderIds } = req.body as { customerId: string; orderIds: string[] };
  if (!customerId || !Array.isArray(orderIds) || orderIds.length < 2) {
    res.status(400).json({ error: 'Select at least 2 confirmed orders to combine into one delivery.' });
    return;
  }

  const batchId = `CMB-SEA-${Math.floor(100 + Math.random() * 899)}`;
  const window = getNextAvailableWindow(customerId);

  const stmt = db.prepare(
    `UPDATE orders
     SET delivery_mode = 'combined', combined_group_id = ?, scheduled_window = ?, shipping_fee = 0, fulfillment_status = 'Combined & Packed'
     WHERE id = ? AND customer_id = ? AND fulfillment_status IN ('Confirmed', 'Combined & Packed')`
  );

  db.exec('BEGIN');
  try {
    for (const oid of orderIds) {
      stmt.run(batchId, window, oid, customerId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const rows = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id
       WHERE o.customer_id = ? ORDER BY o.created_at DESC`
    )
    .all(customerId) as Record<string, unknown>[];
  res.json({ orders: hydrateOrders(rows), combinedGroupId: batchId, scheduledWindow: window });
});

app.post('/api/orders/:id/cancel', (req, res) => {
  const { id } = req.params;
  const { userId, reason } = (req.body || {}) as { userId?: string; reason?: string };

  const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (userId && String(existingRow.customer_id) !== userId) {
    res.status(403).json({ error: 'You can only cancel your own order.' });
    return;
  }

  const currentStatus = String(existingRow.fulfillment_status);
  if (currentStatus === 'Cancelled') {
    res.status(409).json({ error: 'Order is already cancelled.' });
    return;
  }
  if (currentStatus === 'Out for Delivery' || currentStatus === 'Delivered') {
    res.status(400).json({ error: 'Orders already out for delivery or delivered cannot be cancelled.' });
    return;
  }

  const wasPaid = String(existingRow.payment_status) === 'Paid (Simulated)';
  const stockReserved = String(existingRow.payment_status) !== 'Pending Checkout';
  const itemRows = db
    .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
    .all(id) as { product_id: string; quantity: number }[];

  db.exec('BEGIN');
  try {
    if (stockReserved) {
      const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
      for (const item of itemRows) {
        restoreStock.run(item.quantity, item.product_id);
      }
    }

    db.prepare(
      `UPDATE orders
       SET fulfillment_status = 'Cancelled',
           payment_status = ?,
           tracking_stage = ?,
           tracking_eta = 'Cancelled'
       WHERE id = ?`
    ).run(
      wasPaid ? 'Refunded (Simulated)' : 'Cancelled',
      reason?.trim() ? `Order Cancelled (${reason.trim()})` : 'Order Cancelled by Customer',
      id
    );

    insertNotification({
      userId: String(existingRow.customer_id),
      type: 'info',
      title: `Order #${id} Cancelled`,
      message: wasPaid
        ? `Your order #${id} has been cancelled and a simulated refund of ${formatINRServer(Number(existingRow.total_amount))} has been recorded.`
        : `Your unpaid order #${id} has been cancelled.`,
      metadata: { orderId: id, simulated: true },
      actionStatus: 'info',
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  if (existingRow.deal_id) {
    recomputeGroupDealProgress(String(existingRow.deal_id));
  }

  const row = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown>;
  const [order] = hydrateOrders([row]);
  res.json({ order });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { fulfillmentStatus } = req.body as { fulfillmentStatus: Order['fulfillmentStatus'] };
  const allowed = ['Confirmed', 'Combined & Packed', 'Out for Delivery', 'Delivered', 'Cancelled'];
  if (!allowed.includes(fulfillmentStatus)) {
    res.status(400).json({ error: 'Invalid fulfillment status.' });
    return;
  }

  const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN');
  try {
    if (fulfillmentStatus === 'Out for Delivery') {
      const alreadyConfirmed =
        String(existingRow.delivery_availability_status) === 'Availability Confirmed';
      const nextAvailability = alreadyConfirmed
        ? 'Availability Confirmed'
        : 'Awaiting Customer Response';
      const nextLifecycle: DeliveryLifecycleStageKey = alreadyConfirmed
        ? 'partner_assigned'
        : 'availability_confirmation';
      const nextTimestamps = mergeStageTimestamps(
        existingRow.stage_timestamps_json,
        String(existingRow.created_at),
        nextLifecycle,
        nowIso
      );
      const nextStage = alreadyConfirmed
        ? 'Delivery Partner Assigned & En Route'
        : 'Out for Delivery · Awaiting Availability Confirmation';

      db.prepare(
        `UPDATE orders
         SET fulfillment_status = ?, delivery_availability_status = ?, lifecycle_stage = ?, stage_timestamps_json = ?, tracking_stage = ?
         WHERE id = ?`
      ).run(fulfillmentStatus, nextAvailability, nextLifecycle, nextTimestamps, nextStage, id);

      if (!alreadyConfirmed) {
        const orderItems = db
          .prepare(
            `SELECT p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`
          )
          .all(id) as { name: string }[];
        const itemNames = orderItems.map((i) => i.name);

        insertNotification({
          userId: String(existingRow.customer_id),
          type: 'delivery_availability_request',
          title: `Order #${id} — Confirm Delivery Availability`,
          message: `Your order is out for delivery! Are you available to receive it? (${itemNames.join(', ') || 'items'} · Window: ${String(
            existingRow.scheduled_window
          )})`,
          metadata: {
            orderId: id,
            scheduledWindow: String(existingRow.scheduled_window),
            productNames: itemNames,
            simulated: true,
          },
          actionStatus: 'pending',
          dedupeMatch: `"orderId":"${id}"`,
          onlyPendingDedupe: true,
        });
      }
    } else if (fulfillmentStatus === 'Delivered') {
      const nextTimestamps = mergeStageTimestamps(
        existingRow.stage_timestamps_json,
        String(existingRow.created_at),
        'delivered',
        nowIso
      );
      db.prepare(
        `UPDATE orders
         SET fulfillment_status = ?, delivery_availability_status = 'Availability Confirmed', lifecycle_stage = 'delivered', stage_timestamps_json = ?, tracking_stage = 'Your Order Has Been Delivered!', tracking_eta = 'Delivered'
         WHERE id = ?`
      ).run(fulfillmentStatus, nextTimestamps, id);

      db.prepare(
        `UPDATE notifications
         SET action_status = 'confirmed', is_read = 1
         WHERE user_id = ? AND type = 'delivery_availability_request' AND action_status = 'pending' AND metadata_json LIKE ?`
      ).run(String(existingRow.customer_id), `%"orderId":"${id}"%`);
    } else {
      const nextLifecycle: DeliveryLifecycleStageKey =
        fulfillmentStatus === 'Combined & Packed' ? 'ready_for_dispatch' : 'order_confirmed';
      const nextTimestamps = mergeStageTimestamps(
        existingRow.stage_timestamps_json,
        String(existingRow.created_at),
        nextLifecycle,
        nowIso
      );
      const nextStage =
        fulfillmentStatus === 'Combined & Packed'
          ? 'Ready for Dispatch · Package Packed'
          : 'Order Confirmed · Preparing Order';
      db.prepare(
        'UPDATE orders SET fulfillment_status = ?, lifecycle_stage = ?, stage_timestamps_json = ?, tracking_stage = ? WHERE id = ?'
      ).run(fulfillmentStatus, nextLifecycle, nextTimestamps, nextStage, id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const row = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown>;
  const [order] = hydrateOrders([row]);
  res.json({ order });
});

app.post('/api/orders/:id/pay', (req, res) => {
  runAllGroupDealSweeps();
  const { id } = req.params;
  const { userId, paymentMethod } = (req.body || {}) as { userId?: string; paymentMethod?: string };
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (userId && String(row.customer_id) !== userId) {
    res.status(403).json({ error: 'Unauthorized order payment.' });
    return;
  }
  if (String(row.fulfillment_status) === 'Cancelled') {
    res.status(409).json({ error: 'Cancelled or expired orders cannot be paid.' });
    return;
  }
  if (String(row.payment_status) === 'Paid (Simulated)') {
    res.status(409).json({
      error: 'Duplicate payment prevented: this order has already been paid and confirmed.',
      alreadyPaid: true,
    });
    return;
  }

  if (row.deal_id) {
    const dealId = String(row.deal_id);
    const dealRow = db
      .prepare('SELECT status, expires_at, payment_expires_at, title FROM group_deals WHERE id = ?')
      .get(dealId) as
      | { status: string; expires_at: string; payment_expires_at: string | null; title: string }
      | undefined;

    if (!dealRow || dealRow.status === 'expired' || dealRow.status === 'dissolved' || dealRow.status === 'rejected') {
      res.status(410).json({
        error: 'This group order has expired or been declined. Since no payment was collected, no refund is needed.',
      });
      return;
    }
    if (dealRow.status !== 'approved' && dealRow.status !== 'confirmed') {
      res.status(409).json({
        error: 'Payment is not open yet: waiting for group threshold completion and seller final price approval.',
      });
      return;
    }
    if (dealRow.payment_expires_at && Date.parse(dealRow.payment_expires_at) <= Date.now()) {
      processExpiredGroupPaymentWindows();
      res.status(410).json({
        error: 'The individual payment deadline for this group order has expired. Your participation has been marked expired.',
      });
      return;
    }

    const memberRow = db
      .prepare('SELECT commitment_status FROM group_deal_members WHERE deal_id = ? AND user_id = ?')
      .get(dealId, String(row.customer_id)) as { commitment_status: string } | undefined;
    if (!memberRow || memberRow.commitment_status === 'Expired') {
      res.status(410).json({ error: 'Your participation in this group pool has expired.' });
      return;
    }
    if (memberRow.commitment_status === 'Paid') {
      res.status(409).json({ error: 'Duplicate payment prevented: you already paid for this group order.' });
      return;
    }
  }

  const needsStockDecrement =
    String(row.payment_status) === 'Awaiting Payment' || String(row.payment_status) === 'Pending Checkout';
  const nowIso = new Date().toISOString();

  db.exec('BEGIN');
  try {
    if (needsStockDecrement) {
      const items = db
        .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
        .all(id) as { product_id: string; quantity: number }[];
      for (const item of items) {
        const prod = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(item.product_id) as
          | { stock: number; name: string }
          | undefined;
        if (!prod || prod.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${prod?.name || item.product_id}.`);
        }
        const upd = db
          .prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?')
          .run(item.quantity, item.product_id, item.quantity);
        if (upd.changes === 0) {
          throw new Error(`Insufficient stock for ${prod.name}.`);
        }
      }
    }

    const nextMethod = paymentMethod?.trim() || String(row.payment_method || 'Card ending in 4242 (Simulated)');
    const nextTimestamps = mergeStageTimestamps(
      row.stage_timestamps_json,
      String(row.created_at),
      'order_confirmed',
      nowIso
    );

    // ONLY NOW after successful payment is the individual order marked 'Confirmed'!
    db.prepare(
      `UPDATE orders
       SET payment_status = 'Paid (Simulated)',
           fulfillment_status = 'Confirmed',
           payment_method = ?,
           lifecycle_stage = 'order_confirmed',
           stage_timestamps_json = ?,
           tracking_stage = ?
       WHERE id = ?`
    ).run(
      nextMethod,
      nextTimestamps,
      row.deal_id ? 'Order Confirmed · Group Payment Completed' : 'Order Confirmed · Payment Completed',
      id
    );

    if (row.deal_id) {
      const dealId = String(row.deal_id);
      db.prepare(
        `UPDATE group_deal_members
         SET commitment_status = 'Paid', paid_at = ?
         WHERE deal_id = ? AND user_id = ?`
      ).run(nowIso, dealId, String(row.customer_id));

      db.prepare('DELETE FROM cart_items WHERE user_id = ? AND deal_id = ?').run(
        String(row.customer_id),
        dealId
      );

      db.prepare(
        `UPDATE notifications
         SET action_status = 'confirmed', is_read = 1
         WHERE user_id = ? AND type = 'group_approved' AND metadata_json LIKE ?`
      ).run(String(row.customer_id), `%"dealId":"${dealId}"%`);

      insertNotification({
        userId: String(row.customer_id),
        type: 'group_confirmed',
        title: `Order #${id} Confirmed · Payment Completed`,
        message: `Your payment of ${formatINRServer(Number(row.total_amount))} succeeded! Your individual group order #${id} is now confirmed for delivery.`,
        metadata: { dealId, orderId: id, totalAmount: Number(row.total_amount) },
        actionStatus: 'info',
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: err instanceof Error ? err.message : 'Payment failed.' });
    return;
  }

  let groupUpdate: ReturnType<typeof recomputeGroupDealProgress> = null;
  if (row.deal_id) {
    groupUpdate = recomputeGroupDealProgress(String(row.deal_id));
  }

  const updatedRow = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown>;
  const [order] = hydrateOrders([updatedRow]);
  res.json({ order, groupUpdate });
});

app.post('/api/group-deals/:id/pay', (req, res) => {
  runAllGroupDealSweeps();
  const { id } = req.params;
  const { userId, paymentMethod } = (req.body || {}) as { userId?: string; paymentMethod?: string };
  if (!userId) {
    res.status(400).json({ error: 'User ID is required to complete group payment.' });
    return;
  }

  const dealRow = db
    .prepare('SELECT status, payment_expires_at FROM group_deals WHERE id = ?')
    .get(id) as { status: string; payment_expires_at: string | null } | undefined;
  if (!dealRow) {
    res.status(404).json({ error: 'Group order not found.' });
    return;
  }
  if (dealRow.status !== 'approved' && dealRow.status !== 'confirmed') {
    res.status(409).json({ error: 'Seller approval is required before payment can be completed.' });
    return;
  }

  const ord = db
    .prepare(
      `SELECT id, payment_status, fulfillment_status FROM orders
       WHERE customer_id = ? AND deal_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId, id) as { id: string; payment_status: string; fulfillment_status: string } | undefined;

  if (!ord) {
    res.status(404).json({
      error: 'No approved payment order exists for this user.',
    });
    return;
  }
  if (ord.payment_status === 'Paid (Simulated)') {
    res.status(409).json({ error: 'Duplicate payment prevented: you have already paid for this group order.' });
    return;
  }
  if (ord.fulfillment_status === 'Cancelled') {
    res.status(410).json({ error: 'This participation has expired or was cancelled.' });
    return;
  }

  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(ord.id) as Record<string, unknown>;
  if (dealRow.payment_expires_at && Date.parse(dealRow.payment_expires_at) <= Date.now()) {
    processExpiredGroupPaymentWindows();
    res.status(410).json({ error: 'The payment window for this group order has expired.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const items = db
      .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
      .all(ord.id) as { product_id: string; quantity: number }[];
    for (const item of items) {
      const prod = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(item.product_id) as
        | { stock: number; name: string }
        | undefined;
      if (!prod || prod.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${prod?.name || item.product_id}.`);
      }
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(
        item.quantity,
        item.product_id,
        item.quantity
      );
    }

    const nextMethod = paymentMethod?.trim() || String(row.payment_method || 'Card ending in 4242 (Simulated)');
    const nextTimestamps = mergeStageTimestamps(
      row.stage_timestamps_json,
      String(row.created_at),
      'order_confirmed',
      nowIso
    );
    db.prepare(
      `UPDATE orders
       SET payment_status = 'Paid (Simulated)',
           fulfillment_status = 'Confirmed',
           payment_method = ?,
           lifecycle_stage = 'order_confirmed',
           stage_timestamps_json = ?,
           tracking_stage = 'Order Confirmed · Group Payment Completed'
       WHERE id = ?`
    ).run(nextMethod, nextTimestamps, ord.id);

    db.prepare(
      `UPDATE group_deal_members
       SET commitment_status = 'Paid', paid_at = ?
       WHERE deal_id = ? AND user_id = ?`
    ).run(nowIso, id, userId);

    db.prepare(
      `UPDATE notifications
       SET action_status = 'confirmed', is_read = 1
       WHERE user_id = ? AND type = 'group_approved' AND metadata_json LIKE ?`
    ).run(userId, `%"dealId":"${id}"%`);

    insertNotification({
      userId,
      type: 'group_confirmed',
      title: `Order #${ord.id} Confirmed · Payment Completed`,
      message: `Your payment of ${formatINRServer(Number(row.total_amount))} succeeded! Your individual group order #${ord.id} is now confirmed for delivery.`,
      metadata: { dealId: id, orderId: ord.id, totalAmount: Number(row.total_amount) },
      actionStatus: 'info',
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: err instanceof Error ? err.message : 'Payment failed.' });
    return;
  }

  const groupUpdate = recomputeGroupDealProgress(id);
  const updatedRow = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
    )
    .get(ord.id) as Record<string, unknown>;
  const [order] = hydrateOrders([updatedRow]);
  res.json({ order, groupUpdate });
});

app.post('/api/orders/:id/expired-resolution', (req, res) => {
  const { id } = req.params;
  const { userId, action } = req.body as {
    userId?: string;
    action?: 'continue_individual' | 'cancel_refund';
  };

  if (action !== 'continue_individual' && action !== 'cancel_refund') {
    res.status(400).json({ error: 'Invalid resolution action. Use continue_individual or cancel_refund.' });
    return;
  }

  const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (userId && String(existingRow.customer_id) !== userId) {
    res.status(403).json({ error: 'You can only update your own order.' });
    return;
  }
  if (String(existingRow.fulfillment_status) === 'Cancelled') {
    res.status(409).json({ error: 'Order is already cancelled.' });
    return;
  }

  const customerId = String(existingRow.customer_id);
  const wasPaid = String(existingRow.payment_status) === 'Paid (Simulated)';
  const stockReserved = String(existingRow.payment_status) !== 'Pending Checkout';

  db.exec('BEGIN');
  try {
    if (action === 'continue_individual') {
      const nextShippingFee = Math.max(Number(existingRow.shipping_fee || 0), INDIVIDUAL_DELIVERY_FEE);
      const nextTotal = Number((Number(existingRow.subtotal) + nextShippingFee).toFixed(2));
      db.prepare(
        `UPDATE orders
         SET delivery_mode = 'express_separate',
             combined_group_id = NULL,
             shipping_fee = ?,
             total_amount = ?,
             group_approval_status = 'Not Required',
             expired_resolution_status = 'continued_individual',
             shared_delivery_cost = NULL,
             tracking_stage = ?
         WHERE id = ?`
      ).run(
        nextShippingFee,
        nextTotal,
        `Confirmed · Normal Individual Delivery (${formatINRServer(nextShippingFee)})`,
        id
      );

      db.prepare(
        `UPDATE notifications
         SET action_status = 'confirmed', is_read = 1
         WHERE user_id = ? AND type = 'group_expired' AND metadata_json LIKE ?`
      ).run(customerId, `%"orderId":"${id}"%`);

      insertNotification({
        userId: customerId,
        type: 'info',
        title: `Order #${id} Switched to Individual Delivery`,
        message: `Your order #${id} will proceed via Normal Individual Delivery with a ${formatINRServer(nextShippingFee)} delivery fee (New Total: ${formatINRServer(nextTotal)}).`,
        metadata: { orderId: id, shippingFee: nextShippingFee, totalAmount: nextTotal },
        actionStatus: 'info',
      });
    } else {
      if (stockReserved) {
        const items = db
          .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
          .all(id) as { product_id: string; quantity: number }[];
        const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        for (const item of items) {
          restoreStock.run(item.quantity, item.product_id);
        }
      }

      db.prepare(
        `UPDATE orders
         SET fulfillment_status = 'Cancelled',
             payment_status = ?,
             expired_resolution_status = 'cancelled_refunded',
             tracking_stage = ?,
             tracking_eta = 'Cancelled'
         WHERE id = ?`
      ).run(
        wasPaid ? 'Refunded (Simulated)' : 'Cancelled',
        wasPaid ? 'Order Cancelled · Refund Processed' : 'Order Cancelled (Expired Group)',
        id
      );

      db.prepare(
        `UPDATE notifications
         SET action_status = 'rejected', is_read = 1
         WHERE user_id = ? AND type = 'group_expired' AND metadata_json LIKE ?`
      ).run(customerId, `%"orderId":"${id}"%`);

      insertNotification({
        userId: customerId,
        type: 'info',
        title: `Order #${id} Cancelled${wasPaid ? ' & Refunded' : ''}`,
        message: wasPaid
          ? `Order #${id} from the expired group pool was cancelled and a simulated refund of ${formatINRServer(Number(existingRow.total_amount))} has been issued.`
          : `Unpaid Order #${id} from the expired group pool was cancelled.`,
        metadata: { orderId: id, refunded: wasPaid, simulated: true },
        actionStatus: 'info',
      });
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const updatedRow = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown>;
  const [order] = hydrateOrders([updatedRow]);
  res.json({ order, action });
});

app.post('/api/orders/:id/availability-response', (req, res) => {
  const { id } = req.params;
  const { userId, available, rescheduleWindow } = req.body as {
    userId?: string;
    available?: boolean;
    rescheduleWindow?: string;
  };

  if (typeof available !== 'boolean') {
    res.status(400).json({ error: 'Please specify whether you are available (true or false).' });
    return;
  }

  const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (userId && String(existingRow.customer_id) !== userId) {
    res.status(403).json({ error: 'You can only update availability for your own order.' });
    return;
  }

  const customerId = String(existingRow.customer_id);
  const customerUser = db.prepare('SELECT name FROM users WHERE id = ?').get(customerId) as
    | { name?: string }
    | undefined;

  const nowIso = new Date().toISOString();

  if (available) {
    if (
      String(existingRow.delivery_availability_status) === 'Availability Confirmed' &&
      existingRow.delivery_partner_id
    ) {
      const currentRow = db
        .prepare(
          `SELECT o.*, u.name as customer_name, u.address as customer_address
           FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
        )
        .get(id) as Record<string, unknown>;
      const [order] = hydrateOrders([currentRow]);
      res.json({ order, alreadyConfirmed: true });
      return;
    }

    const chosenPartner = pickDeliveryPartnerForOrder(id);
    if (!chosenPartner) {
      res.status(500).json({ error: 'No delivery partners available in dispatch pool.' });
      return;
    }
    const partnerId = String(chosenPartner.id);
    const partnerName = String(chosenPartner.name);
    const eta = 'Today · Est. 25–40 mins';
    const nextTimestamps = mergeStageTimestamps(
      existingRow.stage_timestamps_json,
      String(existingRow.created_at),
      'partner_assigned',
      nowIso
    );

    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE orders
         SET fulfillment_status = 'Out for Delivery',
             delivery_availability_status = 'Availability Confirmed',
             delivery_partner_id = ?,
             lifecycle_stage = 'partner_assigned',
             stage_timestamps_json = ?,
             tracking_stage = 'Delivery Partner Assigned & En Route',
             tracking_eta = ?
         WHERE id = ?`
      ).run(partnerId, nextTimestamps, eta, id);

      db.prepare(
        `UPDATE notifications
         SET action_status = 'confirmed', is_read = 1
         WHERE user_id = ? AND type = 'delivery_availability_request' AND metadata_json LIKE ?`
      ).run(customerId, `%"orderId":"${id}"%`);

      insertNotification({
        userId: customerId,
        type: 'delivery_partner_assigned',
        title: `Delivery Partner Assigned for Order #${id}`,
        message: `[Simulated In-App Notification] Availability confirmed! ${partnerName} (ID: ${partnerId} · ${String(
          chosenPartner.vehicle
        )}) is assigned to Order #${id}. Est. arrival: ${eta}. Contact: ${String(
          chosenPartner.phone
        )}.`,
        metadata: {
          orderId: id,
          partnerId,
          partnerName,
          eta,
          simulated: true,
        },
        actionStatus: 'info',
        dedupeMatch: `"orderId":"${id}"`,
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } else {
    const chosenWindow = rescheduleWindow?.trim() || getNextAvailableWindowOnOrAfter(customerId, 1);
    const nextTimestamps = mergeStageTimestamps(
      existingRow.stage_timestamps_json,
      String(existingRow.created_at),
      'availability_confirmation',
      nowIso
    );

    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE orders
         SET fulfillment_status = 'Out for Delivery',
             delivery_availability_status = 'Delivery Rescheduled',
             reschedule_requested_window = ?,
             scheduled_window = ?,
             delivery_partner_id = NULL,
             lifecycle_stage = 'availability_confirmation',
             stage_timestamps_json = ?,
             tracking_stage = ?,
             tracking_eta = ?
         WHERE id = ?`
      ).run(
        chosenWindow,
        chosenWindow,
        nextTimestamps,
        `Delivery Rescheduled · ${chosenWindow}`,
        `Rescheduled: ${chosenWindow}`,
        id
      );

      db.prepare(
        `UPDATE notifications
         SET action_status = 'unavailable', is_read = 1
         WHERE user_id = ? AND type = 'delivery_availability_request' AND metadata_json LIKE ?`
      ).run(customerId, `%"orderId":"${id}"%`);

      insertNotification({
        userId: customerId,
        type: 'delivery_rescheduled_confirmed',
        title: `Delivery Rescheduled — Order #${id}`,
        message: `[Simulated In-App Notification] Your delivery has been rescheduled to "${chosenWindow}". You will receive a new dispatch alert before arrival.`,
        metadata: {
          orderId: id,
          rescheduledWindow: chosenWindow,
          simulated: true,
        },
        actionStatus: 'info',
        dedupeMatch: `"rescheduledWindow":"${chosenWindow}"`,
      });

      const sellerRows = db
        .prepare('SELECT DISTINCT seller_id FROM order_items WHERE order_id = ?')
        .all(id) as { seller_id: string }[];

      for (const s of sellerRows) {
        insertNotification({
          userId: s.seller_id,
          type: 'delivery_reschedule_requested',
          title: `Delivery Rescheduled · Order #${id}`,
          message: `${customerUser?.name || 'Customer'} was unavailable for immediate delivery on Order #${id} and rescheduled to: ${chosenWindow}.`,
          metadata: {
            orderId: id,
            customerName: customerUser?.name || 'Customer',
            requestedWindow: chosenWindow,
            simulated: true,
          },
          actionStatus: 'info',
          dedupeMatch: `"requestedWindow":"${chosenWindow}"`,
        });
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const updatedRow = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown>;
  const [order] = hydrateOrders([updatedRow]);
  res.json({ order });
});

function computeHandoverPin(orderId: string): string {
  let acc = 17;
  for (let i = 0; i < orderId.length; i++) {
    acc = (acc * 31 + orderId.charCodeAt(i)) % 10000;
  }
  return String((acc % 9000) + 1000);
}

app.post('/api/orders/:id/confirm-receipt', (req, res) => {
  const { id } = req.params;
  const { userId, verificationPin, parcelIntact, itemsVerified, receiverNote } = (req.body || {}) as {
    userId?: string;
    verificationPin?: string;
    parcelIntact?: boolean;
    itemsVerified?: boolean;
    receiverNote?: string;
  };

  const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (userId && String(existingRow.customer_id) !== userId) {
    res.status(403).json({ error: 'You can only confirm delivery receipt for your own order.' });
    return;
  }

  if (String(existingRow.fulfillment_status) === 'Delivered') {
    const currentRow = db
      .prepare(
        `SELECT o.*, u.name as customer_name, u.address as customer_address
         FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
      )
      .get(id) as Record<string, unknown>;
    const [order] = hydrateOrders([currentRow]);
    res.json({ order, alreadyDelivered: true });
    return;
  }

  const expectedPin = computeHandoverPin(id);
  if (verificationPin && verificationPin.trim() !== expectedPin) {
    res.status(400).json({ error: `Handover PIN mismatch. Expected PIN ${expectedPin} for Order #${id}.` });
    return;
  }

  if (parcelIntact === false || itemsVerified === false) {
    res.status(400).json({ error: 'Please complete the doorstep parcel & item verification checklist first.' });
    return;
  }

  const customerId = String(existingRow.customer_id);
  const customerUser = db.prepare('SELECT name FROM users WHERE id = ?').get(customerId) as
    | { name?: string }
    | undefined;
  const trimmedNote = receiverNote?.trim();
  const stageText = trimmedNote
    ? `Package Received & Verified (${trimmedNote})`
    : 'Package Received & Verified by Customer';

  const nextTimestamps = mergeStageTimestamps(
    existingRow.stage_timestamps_json,
    String(existingRow.created_at),
    'delivered'
  );

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE orders
       SET fulfillment_status = 'Delivered',
           delivery_availability_status = 'Availability Confirmed',
           lifecycle_stage = 'delivered',
           stage_timestamps_json = ?,
           tracking_stage = ?,
           tracking_eta = 'Delivered'
       WHERE id = ?`
    ).run(nextTimestamps, stageText, id);

    db.prepare(
      `UPDATE notifications
       SET action_status = 'confirmed', is_read = 1
       WHERE user_id = ? AND type = 'delivery_availability_request' AND metadata_json LIKE ?`
    ).run(customerId, `%"orderId":"${id}"%`);

    const sellerRows = db
      .prepare('SELECT DISTINCT seller_id FROM order_items WHERE order_id = ?')
      .all(id) as { seller_id: string }[];

    for (const s of sellerRows) {
      insertNotification({
        userId: s.seller_id,
        type: 'info',
        title: `Order #${id} Delivered & Received`,
        message: `${customerUser?.name || 'Customer'} completed doorstep receiving verification (PIN ${expectedPin})${
          trimmedNote ? ` · Note: "${trimmedNote}"` : ''
        }.`,
        metadata: {
          orderId: id,
          handoverPin: expectedPin,
          receiverNote: trimmedNote || null,
        },
        actionStatus: 'info',
        dedupeMatch: `"handoverPin":"${expectedPin}"`,
      });
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const updatedRow = db
    .prepare(
      `SELECT o.*, u.name as customer_name, u.address as customer_address
       FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
    )
    .get(id) as Record<string, unknown>;
  const [order] = hydrateOrders([updatedRow]);
  res.json({ order });
});

app.post('/api/orders/:id/demo-advance', (req, res) => {
  const { id } = req.params;
  const { userId, action = 'next_stage' } = (req.body || {}) as {
    userId?: string;
    action?:
      | 'next_stage'
      | 'trigger_availability_notification'
      | 'complete_delivery'
      | 'reset_demo';
  };

  const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (userId && String(existingRow.customer_id) !== userId) {
    res.status(403).json({ error: 'Unauthorized order simulation action.' });
    return;
  }

  const customerId = String(existingRow.customer_id);
  const createdAt = String(existingRow.created_at);
  const nowIso = new Date().toISOString();
  const [currentOrder] = hydrateOrders([
    db
      .prepare(
        `SELECT o.*, u.name as customer_name, u.address as customer_address
         FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
      )
      .get(id) as Record<string, unknown>,
  ]);

  const itemNames = currentOrder.items.map((i) => i.productName);

  const ensureAvailabilityNotification = () => {
    insertNotification({
      userId: customerId,
      type: 'delivery_availability_request',
      title: `Order #${id} — Confirm Delivery Availability`,
      message: `Your order is out for delivery! Are you available to receive it? (${itemNames.join(', ') || 'items'} · Window: ${String(
        existingRow.scheduled_window
      )})`,
      metadata: {
        orderId: id,
        scheduledWindow: String(existingRow.scheduled_window),
        productNames: itemNames,
        simulated: true,
      },
      actionStatus: 'pending',
      dedupeMatch: `"orderId":"${id}"`,
      onlyPendingDedupe: true,
    });
  };

  if (action === 'reset_demo') {
    const resetTs = JSON.stringify({ order_confirmed: nowIso });
    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE orders
         SET fulfillment_status = 'Confirmed',
             delivery_availability_status = 'Not Dispatched',
             reschedule_requested_window = NULL,
             delivery_partner_id = NULL,
             lifecycle_stage = 'order_confirmed',
             stage_timestamps_json = ?,
             delivery_rating = NULL,
             delivery_feedback = NULL,
             tracking_stage = 'Order Confirmed · Successfully Placed',
             tracking_eta = NULL
         WHERE id = ?`
      ).run(resetTs, id);

      db.prepare(
        `DELETE FROM notifications WHERE user_id = ? AND metadata_json LIKE ?`
      ).run(customerId, `%"orderId":"${id}"%`);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const [order] = hydrateOrders([
      db
        .prepare(
          `SELECT o.*, u.name as customer_name, u.address as customer_address
           FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
        )
        .get(id) as Record<string, unknown>,
    ]);
    res.json({ order, reset: true });
    return;
  }

  if (action === 'trigger_availability_notification') {
    const nextStage: DeliveryLifecycleStageKey =
      currentOrder.lifecycleStage === 'delivered' || currentOrder.lifecycleStage === 'partner_assigned'
        ? currentOrder.lifecycleStage
        : 'availability_confirmation';
    const nextTs = mergeStageTimestamps(
      existingRow.stage_timestamps_json,
      createdAt,
      nextStage,
      nowIso
    );
    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE orders
         SET fulfillment_status = CASE WHEN fulfillment_status = 'Delivered' THEN 'Delivered' ELSE 'Out for Delivery' END,
             delivery_availability_status = CASE WHEN delivery_partner_id IS NOT NULL THEN delivery_availability_status ELSE 'Awaiting Customer Response' END,
             lifecycle_stage = ?,
             stage_timestamps_json = ?,
             tracking_stage = 'Out for Delivery · Confirm Availability'
         WHERE id = ?`
      ).run(nextStage, nextTs, id);
      ensureAvailabilityNotification();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const [order] = hydrateOrders([
      db
        .prepare(
          `SELECT o.*, u.name as customer_name, u.address as customer_address
           FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
        )
        .get(id) as Record<string, unknown>,
    ]);
    res.json({ order, notificationTriggered: true });
    return;
  }

  if (action === 'complete_delivery') {
    if (!currentOrder.deliveryPartner) {
      res.status(409).json({
        error:
          'Customer interaction required first: confirm "I\'m Available" so a delivery partner is assigned before completing delivery.',
        requiresCustomerAction: true,
        order: currentOrder,
      });
      return;
    }
    const nextTs = mergeStageTimestamps(
      existingRow.stage_timestamps_json,
      createdAt,
      'delivered',
      nowIso
    );
    db.prepare(
      `UPDATE orders
       SET fulfillment_status = 'Delivered',
           delivery_availability_status = 'Availability Confirmed',
           lifecycle_stage = 'delivered',
           stage_timestamps_json = ?,
           tracking_stage = 'Your Order Has Been Delivered!',
           tracking_eta = 'Delivered'
       WHERE id = ?`
    ).run(nextTs, id);

    const [order] = hydrateOrders([
      db
        .prepare(
          `SELECT o.*, u.name as customer_name, u.address as customer_address
           FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
        )
        .get(id) as Record<string, unknown>,
    ]);
    res.json({ order });
    return;
  }

  // Default: sequential 'next_stage' progression (never skips customer interaction step!)
  const curr = currentOrder.lifecycleStage;
  if (curr === 'delivered') {
    res.json({ order: currentOrder, alreadyDelivered: true });
    return;
  }

  if (
    curr === 'availability_confirmation' &&
    currentOrder.deliveryAvailabilityStatus === 'Awaiting Customer Response'
  ) {
    // Pause until customer clicks "I'm Available" or confirms reschedule ("I'm Not Available")
    ensureAvailabilityNotification();
    res.json({
      order: currentOrder,
      requiresCustomerAction: true,
      message: 'Please select "I\'m Available" or "I\'m Not Available" in the notification prompt.',
    });
    return;
  }

  const stageTransition: Record<
    DeliveryLifecycleStageKey,
    {
      next: DeliveryLifecycleStageKey;
      fulfillment: Order['fulfillmentStatus'];
      avail: Order['deliveryAvailabilityStatus'];
      trackingStage: string;
      eta: string | null;
      assignPartner?: boolean;
      sendAvailabilityNotif?: boolean;
    }
  > = {
    order_confirmed: {
      next: 'order_processed',
      fulfillment: 'Confirmed',
      avail: 'Not Dispatched',
      trackingStage: 'Order Processed · Seller Accepted & Packed',
      eta: null,
    },
    order_processed: {
      next: 'ready_for_dispatch',
      fulfillment: 'Combined & Packed',
      avail: 'Not Dispatched',
      trackingStage: 'Ready for Dispatch · Awaiting Courier Pickup',
      eta: null,
    },
    ready_for_dispatch: {
      next: 'out_for_delivery',
      fulfillment: 'Out for Delivery',
      avail: 'Awaiting Customer Response',
      trackingStage: 'Out for Delivery · Package Collected by Courier',
      eta: 'Today · Pending Availability Confirmation',
      sendAvailabilityNotif: true,
    },
    out_for_delivery: {
      next: 'availability_confirmation',
      fulfillment: 'Out for Delivery',
      avail: 'Awaiting Customer Response',
      trackingStage: 'Delivery Availability Confirmation · Awaiting Response',
      eta: 'Today · Pending Availability Confirmation',
      sendAvailabilityNotif: true,
    },
    availability_confirmation: {
      next: 'partner_assigned',
      fulfillment: 'Out for Delivery',
      avail:
        currentOrder.deliveryAvailabilityStatus === 'Delivery Rescheduled'
          ? 'Delivery Rescheduled'
          : 'Availability Confirmed',
      trackingStage:
        currentOrder.deliveryAvailabilityStatus === 'Delivery Rescheduled'
          ? `Delivery Partner Assigned for Rescheduled Window (${currentOrder.rescheduleRequestedWindow || currentOrder.scheduledWindow})`
          : 'Delivery Partner Assigned & En Route',
      eta:
        currentOrder.deliveryAvailabilityStatus === 'Delivery Rescheduled'
          ? currentOrder.rescheduleRequestedWindow || currentOrder.scheduledWindow
          : 'Today · Est. 25–40 mins',
      assignPartner: true,
    },
    partner_assigned: {
      next: 'delivered',
      fulfillment: 'Delivered',
      avail:
        currentOrder.deliveryAvailabilityStatus === 'Delivery Rescheduled'
          ? 'Delivery Rescheduled'
          : 'Availability Confirmed',
      trackingStage: 'Your Order Has Been Delivered!',
      eta: 'Delivered',
    },
    delivered: {
      next: 'delivered',
      fulfillment: 'Delivered',
      avail:
        currentOrder.deliveryAvailabilityStatus === 'Delivery Rescheduled'
          ? 'Delivery Rescheduled'
          : 'Availability Confirmed',
      trackingStage: 'Your Order Has Been Delivered!',
      eta: 'Delivered',
    },
  };

  const plan = stageTransition[curr];
  const nextTs = mergeStageTimestamps(existingRow.stage_timestamps_json, createdAt, plan.next, nowIso);
  const assignedPartner =
    plan.assignPartner && !existingRow.delivery_partner_id
      ? pickDeliveryPartnerForOrder(id)
      : null;

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE orders
       SET fulfillment_status = ?,
           delivery_availability_status = ?,
           delivery_partner_id = COALESCE(?, delivery_partner_id),
           lifecycle_stage = ?,
           stage_timestamps_json = ?,
           tracking_stage = ?,
           tracking_eta = ?
       WHERE id = ?`
    ).run(
      plan.fulfillment,
      plan.avail,
      assignedPartner ? String(assignedPartner.id) : null,
      plan.next,
      nextTs,
      plan.trackingStage,
      plan.eta,
      id
    );

    if (plan.sendAvailabilityNotif) {
      ensureAvailabilityNotification();
    }
    if (assignedPartner) {
      insertNotification({
        userId: customerId,
        type: 'delivery_partner_assigned',
        title: `Delivery Partner Assigned for Order #${id}`,
        message: `[Simulated In-App Notification] ${String(assignedPartner.name)} (ID: ${String(
          assignedPartner.id
        )} · ${String(assignedPartner.vehicle)}) has been assigned for Order #${id} (${plan.eta}). Contact: ${String(
          assignedPartner.phone
        )}.`,
        metadata: {
          orderId: id,
          partnerId: String(assignedPartner.id),
          partnerName: String(assignedPartner.name),
          eta: plan.eta,
          simulated: true,
        },
        actionStatus: 'info',
        dedupeMatch: `"orderId":"${id}"`,
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const [order] = hydrateOrders([
    db
      .prepare(
        `SELECT o.*, u.name as customer_name, u.address as customer_address
         FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
      )
      .get(id) as Record<string, unknown>,
  ]);
  res.json({ order, notificationTriggered: Boolean(plan.sendAvailabilityNotif) });
});

app.post('/api/orders/:id/rate-delivery', (req, res) => {
  const { id } = req.params;
  const { userId, rating, feedback } = (req.body || {}) as {
    userId?: string;
    rating?: number;
    feedback?: string;
  };
  const numericRating = Math.round(Number(rating));
  if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
    res.status(400).json({ error: 'Please select a delivery rating between 1 and 5 stars.' });
    return;
  }

  const existingRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (userId && String(existingRow.customer_id) !== userId) {
    res.status(403).json({ error: 'You can only rate delivery for your own order.' });
    return;
  }

  db.prepare(`UPDATE orders SET delivery_rating = ?, delivery_feedback = ? WHERE id = ?`).run(
    numericRating,
    feedback?.trim() || null,
    id
  );

  const [order] = hydrateOrders([
    db
      .prepare(
        `SELECT o.*, u.name as customer_name, u.address as customer_address
         FROM orders o JOIN users u ON o.customer_id = u.id WHERE o.id = ?`
      )
      .get(id) as Record<string, unknown>,
  ]);
  res.json({ order });
});

// --- NOTIFICATIONS ---
app.get('/api/notifications/:userId', (req, res) => {
  const { userId } = req.params;
  const rows = db
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`
    )
    .all(userId) as Record<string, unknown>[];

  const notifications: AppNotification[] = rows.map((n) => ({
    id: String(n.id),
    userId: String(n.user_id),
    type: n.type as AppNotification['type'],
    title: String(n.title),
    message: String(n.message),
    metadata: n.metadata_json ? (JSON.parse(String(n.metadata_json)) as Record<string, unknown>) : null,
    isRead: Boolean(n.is_read),
    actionStatus: n.action_status as AppNotification['actionStatus'],
    createdAt: String(n.created_at),
  }));

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  res.json({ notifications, unreadCount });
});

app.patch('/api/notifications/:id/read', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/notifications/:userId/read-all', (req, res) => {
  const { userId } = req.params;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
  res.json({ ok: true });
});

// --- REVIEWS & AI ANALYSIS ---
app.post('/api/products/:id/reviews', (req, res) => {
  const { id } = req.params;
  const { userId, authorName, rating, title, body } = req.body as {
    userId: string;
    authorName: string;
    rating: number;
    title: string;
    body: string;
  };

  if (!userId || !authorName?.trim() || !title?.trim() || !body?.trim() || !rating) {
    res.status(400).json({ error: 'Rating, review title, and feedback text are required.' });
    return;
  }

  const [product] = getEnrichedProducts({ productId: id, userId });
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  // Check if user actually purchased this product on CartSync
  const purchaseCheck = db
    .prepare(
      `SELECT oi.id FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.customer_id = ? AND oi.product_id = ? LIMIT 1`
    )
    .get(userId, id);
  const verifiedPurchase = Boolean(purchaseCheck);

  const patternResult = detectSuspiciousReviewPattern(
    {
      rating: Math.min(5, Math.max(1, Number(rating))),
      title: title.trim(),
      body: body.trim(),
      verifiedPurchase,
    },
    product.reviews,
    {
      name: product.name,
      category: product.category,
      description: product.description,
      specs: product.specs,
    }
  );

  const reviewId = `rev_${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);

  db.prepare(
    `INSERT INTO reviews (id, product_id, user_id, author_name, rating, title, body, verified_purchase, created_at, ai_trust_flag, ai_flag_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    reviewId,
    id,
    userId,
    authorName.trim(),
    Math.min(5, Math.max(1, Number(rating))),
    title.trim(),
    body.trim(),
    verifiedPurchase ? 1 : 0,
    today,
    patternResult.aiTrustFlag,
    patternResult.aiFlagReason
  );

  const [updated] = getEnrichedProducts({ productId: id, userId });
  res.status(201).json({ product: updated, flagged: patternResult.aiTrustFlag === 'flagged_suspicious' });
});

app.post('/api/products/:id/ai-analyze', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body as { userId?: string };

  const [product] = getEnrichedProducts({ productId: id, userId });
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  try {
    const audit = await runGeminiProductAudit({
      productName: product.name,
      description: product.description,
      specs: product.specs,
      reviews: product.reviews,
    });

    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO product_ai_insights (product_id, pros_json, cons_json, discrepancies_json, summary_headline, analyzed_at, source)
         VALUES (?, ?, ?, ?, ?, ?, 'gemini')
         ON CONFLICT(product_id) DO UPDATE SET
           pros_json = excluded.pros_json,
           cons_json = excluded.cons_json,
           discrepancies_json = excluded.discrepancies_json,
           summary_headline = excluded.summary_headline,
           analyzed_at = excluded.analyzed_at,
           source = 'gemini'`
      ).run(
        id,
        JSON.stringify(audit.pros),
        JSON.stringify(audit.cons),
        JSON.stringify(audit.discrepancies),
        audit.summaryHeadline,
        now
      );

      const updateReview = db.prepare(
        `UPDATE reviews SET ai_trust_flag = ?, ai_flag_reason = ? WHERE id = ? AND product_id = ?`
      );
      for (const flag of audit.reviewFlags) {
        updateReview.run(flag.aiTrustFlag, flag.aiFlagReason, flag.reviewId, id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const [updated] = getEnrichedProducts({ productId: id, userId });
    res.json({ product: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gemini review audit failed.';
    const status = message.includes('GEMINI_API_KEY') ? 503 : 500;
    res.status(status).json({ error: message });
  }
});

// --- SELLER ANALYTICS ---
app.get('/api/seller/:sellerId/analytics', (req, res) => {
  runAllGroupDealSweeps();
  const { sellerId } = req.params;
  const sellerProducts = getEnrichedProducts({ sellerId });

  const orderItemsRows = db
    .prepare(
      `SELECT oi.*, o.delivery_mode, p.category, p.name as product_name
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE oi.seller_id = ? AND o.fulfillment_status NOT IN ('Cancelled', 'Awaiting Payment')`
    )
    .all(sellerId) as Record<string, unknown>[];

  const distinctOrderIds = new Set(orderItemsRows.map((r) => String(r.order_id)));
  const combinedOrderIds = new Set(
    orderItemsRows.filter((r) => r.delivery_mode === 'combined').map((r) => String(r.order_id))
  );

  const totalRevenue = orderItemsRows.reduce(
    (sum, r) => sum + Number(r.unit_price) * Number(r.quantity),
    0
  );
  const totalOrders = distinctOrderIds.size;
  const combinedOrdersRate = totalOrders > 0 ? Math.round((combinedOrderIds.size / totalOrders) * 100) : 0;

  const activeGroupDeals = sellerProducts.filter(
    (p) =>
      p.activeDeal &&
      (p.activeDeal.stageLabel === 'Waiting for Group Completion' ||
        p.activeDeal.stageLabel === 'Pending Seller Approval' ||
        p.activeDeal.stageLabel === 'Approved · Awaiting Payments' ||
        p.activeDeal.stageLabel === 'Confirmed')
  ).length;
  const pendingGroupRequests = sellerProducts.filter(
    (p) =>
      p.activeDeal && p.activeDeal.stageLabel === 'Pending Seller Approval'
  ).length;
  const lowStockProducts = sellerProducts.filter((p) => p.stock <= 15).length;
  const flaggedReviewsCount = sellerProducts.reduce((sum, p) => sum + p.flaggedCount, 0);

  const ratedProducts = sellerProducts.filter((p) => p.insights && p.insights.verifiedAvgRating > 0);
  const averageVerifiedRating =
    ratedProducts.length > 0
      ? Number(
          (
            ratedProducts.reduce((sum, p) => sum + (p.insights?.verifiedAvgRating || 0), 0) /
            ratedProducts.length
          ).toFixed(1)
        )
      : 0;

  const categoryMap = new Map<string, { unitsSold: number; revenue: number }>();
  for (const r of orderItemsRows) {
    const cat = String(r.category);
    const prev = categoryMap.get(cat) || { unitsSold: 0, revenue: 0 };
    categoryMap.set(cat, {
      unitsSold: prev.unitsSold + Number(r.quantity),
      revenue: Number((prev.revenue + Number(r.unit_price) * Number(r.quantity)).toFixed(2)),
    });
  }

  const productDemand = sellerProducts.map((p) => {
    const pRows = orderItemsRows.filter((r) => String(r.product_id) === p.id);
    const unitsSold = pRows.reduce((s, r) => s + Number(r.quantity), 0);
    const revenue = Number(
      pRows.reduce((s, r) => s + Number(r.unit_price) * Number(r.quantity), 0).toFixed(2)
    );
    return {
      productId: p.id,
      name: p.name,
      stock: p.stock,
      unitsSold,
      revenue,
      groupParticipants: p.activeDeal ? p.activeDeal.currentParticipants : 0,
      avgRating: p.insights?.verifiedAvgRating || 0,
      flaggedCount: p.flaggedCount,
    };
  });

  const analytics: SellerAnalytics = {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalOrders,
    combinedOrdersRate,
    activeGroupDeals,
    pendingGroupRequests,
    lowStockProducts,
    flaggedReviewsCount,
    averageVerifiedRating,
    demandByCategory: Array.from(categoryMap.entries()).map(([category, vals]) => ({
      category,
      ...vals,
    })),
    productDemand,
  };

  res.json({ analytics });
});

// ============================================================
// My Groups (Private Family, Friends & Roommates Groups)
// ============================================================

const VALID_SOCIAL_CATEGORIES: SocialGroupCategory[] = [
  'Family',
  'Friends',
  'Roommates',
  'Colleagues',
  'Neighbors',
  'Other',
];

function extractInviteCode(rawInput: string): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('://') || trimmed.startsWith('?') || trimmed.includes('invite=') || trimmed.includes('mygroup=')) {
      const normalizedUrl = trimmed.startsWith('http')
        ? trimmed
        : trimmed.startsWith('?')
        ? `https://cartsync.local/${trimmed}`
        : `https://cartsync.local/?${trimmed.replace(/^\/+/, '')}`;
      const url = new URL(normalizedUrl);
      const paramCode =
        url.searchParams.get('invite') ||
        url.searchParams.get('mygroup') ||
        url.searchParams.get('code');
      if (paramCode && paramCode.trim()) {
        return paramCode.trim().toUpperCase();
      }
    }
  } catch {
    // Fallback to regex/text normalization
  }
  const codeMatch = trimmed.toUpperCase().match(/[A-Z]{2,8}-[A-Z0-9]{3,8}/);
  if (codeMatch) return codeMatch[0];
  return trimmed.toUpperCase();
}

function generateGroupInviteCode(category: SocialGroupCategory): string {
  const prefixMap: Record<SocialGroupCategory, string> = {
    Family: 'FAM',
    Friends: 'FRND',
    Roommates: 'ROOM',
    Colleagues: 'TEAM',
    Neighbors: 'NEIGH',
    Other: 'GRP',
  };
  const prefix = prefixMap[category] || 'GRP';
  for (let i = 0; i < 10; i++) {
    const num = Math.floor(1000 + Math.random() * 9000);
    const candidate = `${prefix}-${num}`;
    const existing = db
      .prepare('SELECT id FROM social_groups WHERE invite_code = ?')
      .get(candidate) as { id: string } | undefined;
    if (!existing) return candidate;
  }
  return `${prefix}-${Date.now().toString().slice(-4)}`;
}

function hydrateSocialGroupsForUser(userId: string): {
  groups: SocialGroup[];
  invitations: SocialGroupInvitation[];
  totalUnreadCount: number;
} {
  const allProducts = getEnrichedProducts({ userId });
  const productMap = new Map<string, Product>(allProducts.map((p) => [p.id, p]));

  const membershipRows = db
    .prepare(
      `SELECT sg.id, sg.name, sg.category, sg.description, sg.invite_code, sg.owner_id, sg.created_at,
              owner.name as owner_name, sgm.last_read_at
       FROM social_group_members sgm
       JOIN social_groups sg ON sgm.group_id = sg.id
       JOIN users owner ON sg.owner_id = owner.id
       WHERE sgm.user_id = ?
       ORDER BY sg.created_at DESC`
    )
    .all(userId) as Record<string, unknown>[];

  const groups: SocialGroup[] = membershipRows.map((row) => {
    const groupId = String(row.id);
    const lastReadAt = row.last_read_at ? String(row.last_read_at) : null;

    const memberRows = db
      .prepare(
        `SELECT sgm.user_id, u.name, u.email, u.avatar_initials, sgm.role, sgm.joined_at
         FROM social_group_members sgm
         JOIN users u ON sgm.user_id = u.id
         WHERE sgm.group_id = ?
         ORDER BY CASE WHEN sgm.role = 'Owner' THEN 0 ELSE 1 END, sgm.joined_at ASC`
      )
      .all(groupId) as Record<string, unknown>[];

    const members: SocialGroupMember[] = memberRows.map((m) => ({
      userId: String(m.user_id),
      name: String(m.name),
      email: String(m.email),
      avatarInitials: String(m.avatar_initials),
      role: String(m.role) === 'Owner' ? 'Owner' : 'Member',
      joinedAt: String(m.joined_at),
    }));

    const sharedRows = db
      .prepare(
        `SELECT sgp.id, sgp.group_id, sgp.product_id, sgp.shared_by_user_id, u.name as shared_by_name,
                sgp.note, sgp.upvotes_json, sgp.created_at
         FROM social_group_products sgp
         JOIN users u ON sgp.shared_by_user_id = u.id
         WHERE sgp.group_id = ?
         ORDER BY sgp.created_at DESC`
      )
      .all(groupId) as Record<string, unknown>[];

    const sharedProducts: SocialGroupSharedProduct[] = [];
    for (const sp of sharedRows) {
      const product = productMap.get(String(sp.product_id));
      if (!product) continue;
      let upvotes: string[] = [];
      try {
        upvotes = JSON.parse(String(sp.upvotes_json || '[]')) as string[];
      } catch {
        upvotes = [];
      }
      sharedProducts.push({
        id: String(sp.id),
        groupId,
        productId: String(sp.product_id),
        product,
        sharedByUserId: String(sp.shared_by_user_id),
        sharedByName: String(sp.shared_by_name),
        note: String(sp.note || ''),
        upvotes,
        createdAt: String(sp.created_at),
      });
    }

    const msgRows = db
      .prepare(
        `SELECT m.id, m.group_id, m.sender_id, u.name as sender_name, u.avatar_initials as sender_initials,
                m.body, m.product_id, m.created_at
         FROM social_group_messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.group_id = ?
         ORDER BY m.created_at ASC`
      )
      .all(groupId) as Record<string, unknown>[];

    const messages: SocialGroupMessage[] = msgRows.map((msg) => {
      const attachedProduct = msg.product_id ? productMap.get(String(msg.product_id)) : undefined;
      return {
        id: String(msg.id),
        groupId,
        senderId: String(msg.sender_id),
        senderName: String(msg.sender_name),
        senderInitials: String(msg.sender_initials),
        body: String(msg.body),
        productId: msg.product_id ? String(msg.product_id) : null,
        productName: attachedProduct ? attachedProduct.name : null,
        productPrice: attachedProduct
          ? attachedProduct.activeDeal
            ? Number(
                (
                  attachedProduct.price *
                  (1 - attachedProduct.activeDeal.discountPercent / 100)
                ).toFixed(2)
              )
            : attachedProduct.price
          : null,
        productImage: attachedProduct ? attachedProduct.imageUrl : null,
        createdAt: String(msg.created_at),
      };
    });

    const unreadCount = msgRows.filter((msg) => {
      if (String(msg.sender_id) === userId) return false;
      if (!lastReadAt) return true;
      return Date.parse(String(msg.created_at)) > Date.parse(lastReadAt);
    }).length;

    const actRows = db
      .prepare(
        `SELECT id, group_id, actor_name, action_type, summary, created_at
         FROM social_group_activities
         WHERE group_id = ?
         ORDER BY created_at DESC
         LIMIT 40`
      )
      .all(groupId) as Record<string, unknown>[];

    const activities: SocialGroupActivity[] = actRows.map((a) => ({
      id: String(a.id),
      groupId,
      actorName: String(a.actor_name),
      actionType: String(a.action_type) as SocialGroupActivity['actionType'],
      summary: String(a.summary),
      createdAt: String(a.created_at),
    }));

    const cat = String(row.category) as SocialGroupCategory;
    return {
      id: groupId,
      name: String(row.name),
      category: VALID_SOCIAL_CATEGORIES.includes(cat) ? cat : 'Other',
      description: String(row.description || ''),
      inviteCode: String(row.invite_code),
      ownerId: String(row.owner_id),
      ownerName: String(row.owner_name),
      createdAt: String(row.created_at),
      unreadCount,
      members,
      sharedProducts,
      messages,
      activities,
    };
  });

  // Sort groups so the most recently active (or created) appear first
  groups.sort((a, b) => {
    const aLatest = Math.max(
      Date.parse(a.createdAt) || 0,
      a.messages.length ? Date.parse(a.messages[a.messages.length - 1].createdAt) || 0 : 0,
      a.activities.length ? Date.parse(a.activities[0].createdAt) || 0 : 0
    );
    const bLatest = Math.max(
      Date.parse(b.createdAt) || 0,
      b.messages.length ? Date.parse(b.messages[b.messages.length - 1].createdAt) || 0 : 0,
      b.activities.length ? Date.parse(b.activities[0].createdAt) || 0 : 0
    );
    return bLatest - aLatest;
  });

  const invRows = db
    .prepare(
      `SELECT inv.id, inv.group_id, inv.status, inv.created_at,
              sg.name as group_name, sg.category as group_category, sg.invite_code,
              u.name as invited_by_name,
              (SELECT COUNT(*) FROM social_group_members m WHERE m.group_id = sg.id) as member_count
       FROM social_group_invitations inv
       JOIN social_groups sg ON inv.group_id = sg.id
       JOIN users u ON inv.invited_by_user_id = u.id
       WHERE inv.invited_user_id = ? AND inv.status = 'pending'
       ORDER BY inv.created_at DESC`
    )
    .all(userId) as Record<string, unknown>[];

  const invitations: SocialGroupInvitation[] = invRows.map((r) => {
    const cat = String(r.group_category) as SocialGroupCategory;
    return {
      id: String(r.id),
      groupId: String(r.group_id),
      groupName: String(r.group_name),
      groupCategory: VALID_SOCIAL_CATEGORIES.includes(cat) ? cat : 'Other',
      inviteCode: String(r.invite_code),
      invitedByName: String(r.invited_by_name),
      memberCount: Number(r.member_count || 1),
      status: 'pending',
      createdAt: String(r.created_at),
    };
  });

  const totalUnreadCount =
    groups.reduce((sum, g) => sum + g.unreadCount, 0) + invitations.length;

  return { groups, invitations, totalUnreadCount };
}

app.get('/api/my-groups/:userId', (req, res) => {
  const { userId } = req.params;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as
    | { id: string }
    | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  const payload = hydrateSocialGroupsForUser(userId);
  res.json(payload);
});

app.post('/api/my-groups', (req, res) => {
  const { userId, name, category, description } = req.body as {
    userId?: string;
    name?: string;
    category?: SocialGroupCategory;
    description?: string;
  };
  if (!userId || !name || !name.trim()) {
    return res.status(400).json({ error: 'Group name and user are required.' });
  }
  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string }
    | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const safeCategory: SocialGroupCategory =
    category && VALID_SOCIAL_CATEGORIES.includes(category) ? category : 'Friends';
  const groupId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const inviteCode = generateGroupInviteCode(safeCategory);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO social_groups (id, name, category, description, invite_code, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    groupId,
    name.trim(),
    safeCategory,
    (description || '').trim() || `Private ${safeCategory.toLowerCase()} shopping group on CartSync.`,
    inviteCode,
    userId,
    now
  );

  db.prepare(
    `INSERT INTO social_group_members (id, group_id, user_id, role, last_read_at, joined_at)
     VALUES (?, ?, ?, 'Owner', ?, ?)`
  ).run(`sgm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, groupId, userId, now, now);

  db.prepare(
    `INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
     VALUES (?, ?, ?, 'created', ?, ?)`
  ).run(
    `sga_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId,
    user.name,
    `Created ${name.trim()} (${inviteCode})`,
    now
  );

  const payload = hydrateSocialGroupsForUser(userId);
  res.status(201).json({ createdGroupId: groupId, ...payload });
});

app.post('/api/my-groups/join', (req, res) => {
  const { userId, codeOrLink } = req.body as {
    userId?: string;
    codeOrLink?: string;
  };
  if (!userId || !codeOrLink || !codeOrLink.trim()) {
    return res.status(400).json({ error: 'Please enter a group invite code or invitation link.' });
  }
  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string }
    | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const normalizedCode = extractInviteCode(codeOrLink);
  const group = db
    .prepare('SELECT id, name, invite_code FROM social_groups WHERE UPPER(invite_code) = ?')
    .get(normalizedCode) as { id: string; name: string; invite_code: string } | undefined;

  if (!group) {
    return res.status(404).json({
      error: `No shopping group found matching code "${normalizedCode}". Check the invite link or code and try again.`,
    });
  }

  const existingMember = db
    .prepare('SELECT id FROM social_group_members WHERE group_id = ? AND user_id = ?')
    .get(group.id, userId) as { id: string } | undefined;

  const now = new Date().toISOString();
  if (!existingMember) {
    db.prepare(
      `INSERT INTO social_group_members (id, group_id, user_id, role, last_read_at, joined_at)
       VALUES (?, ?, ?, 'Member', ?, ?)`
    ).run(`sgm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, group.id, userId, now, now);

    db.prepare(
      `UPDATE social_group_invitations
       SET status = 'accepted'
       WHERE group_id = ? AND invited_user_id = ? AND status = 'pending'`
    ).run(group.id, userId);

    db.prepare(
      `INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
       VALUES (?, ?, ?, 'joined', ?, ?)`
    ).run(
      `sga_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      group.id,
      user.name,
      `${user.name} joined via invite code ${group.invite_code}`,
      now
    );
  }

  const payload = hydrateSocialGroupsForUser(userId);
  res.json({
    joinedGroupId: group.id,
    groupName: group.name,
    alreadyMember: Boolean(existingMember),
    ...payload,
  });
});

app.post('/api/my-groups/invitations/:invitationId/respond', (req, res) => {
  const { invitationId } = req.params;
  const { userId, action } = req.body as {
    userId?: string;
    action?: 'accept' | 'decline';
  };
  if (!userId || (action !== 'accept' && action !== 'decline')) {
    return res.status(400).json({ error: 'Valid userId and action (accept or decline) are required.' });
  }

  const inv = db
    .prepare(
      `SELECT inv.id, inv.group_id, inv.invited_user_id, inv.status, sg.name as group_name
       FROM social_group_invitations inv
       JOIN social_groups sg ON inv.group_id = sg.id
       WHERE inv.id = ? AND inv.invited_user_id = ?`
    )
    .get(invitationId, userId) as
    | { id: string; group_id: string; invited_user_id: string; status: string; group_name: string }
    | undefined;

  if (!inv) {
    return res.status(404).json({ error: 'Invitation not found.' });
  }

  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string }
    | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const nextStatus = action === 'accept' ? 'accepted' : 'declined';
  db.prepare('UPDATE social_group_invitations SET status = ? WHERE id = ?').run(nextStatus, invitationId);

  const now = new Date().toISOString();
  if (action === 'accept') {
    const existing = db
      .prepare('SELECT id FROM social_group_members WHERE group_id = ? AND user_id = ?')
      .get(inv.group_id, userId) as { id: string } | undefined;
    if (!existing) {
      db.prepare(
        `INSERT INTO social_group_members (id, group_id, user_id, role, last_read_at, joined_at)
         VALUES (?, ?, ?, 'Member', ?, ?)`
      ).run(
        `sgm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        inv.group_id,
        userId,
        now,
        now
      );
      db.prepare(
        `INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
         VALUES (?, ?, ?, 'joined', ?, ?)`
      ).run(
        `sga_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        inv.group_id,
        user.name,
        `${user.name} accepted the invitation and joined ${inv.group_name}`,
        now
      );
    }
  }

  const payload = hydrateSocialGroupsForUser(userId);
  res.json({
    acceptedGroupId: action === 'accept' ? inv.group_id : null,
    ...payload,
  });
});

app.post('/api/my-groups/:groupId/invite', (req, res) => {
  const { groupId } = req.params;
  const { userId, targetUserId, email } = req.body as {
    userId?: string;
    targetUserId?: string;
    email?: string;
  };
  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }
  const membership = db
    .prepare('SELECT id FROM social_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as { id: string } | undefined;
  if (!membership) {
    return res.status(403).json({ error: 'Only group members can invite others.' });
  }

  const inviter = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string }
    | undefined;
  if (!inviter) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const targetUser = targetUserId
    ? (db.prepare('SELECT id, name, email FROM users WHERE id = ? AND role = ?').get(targetUserId, 'customer') as
        | { id: string; name: string; email: string }
        | undefined)
    : email
    ? (db
        .prepare('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?) AND role = ?')
        .get(email.trim(), 'customer') as
        | { id: string; name: string; email: string }
        | undefined)
    : undefined;

  if (!targetUser) {
    return res.status(404).json({
      error: 'No customer account found with that email. Share the invite link or group code instead!',
    });
  }

  const alreadyMember = db
    .prepare('SELECT id FROM social_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, targetUser.id) as { id: string } | undefined;
  if (alreadyMember) {
    return res.status(400).json({ error: `${targetUser.name} is already a member of this group.` });
  }

  const pendingInv = db
    .prepare(
      `SELECT id FROM social_group_invitations
       WHERE group_id = ? AND invited_user_id = ? AND status = 'pending'`
    )
    .get(groupId, targetUser.id) as { id: string } | undefined;
  if (pendingInv) {
    return res.status(400).json({ error: `${targetUser.name} already has a pending invitation.` });
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO social_group_invitations (id, group_id, invited_user_id, invited_by_user_id, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(
    `sgi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId,
    targetUser.id,
    userId,
    now
  );

  db.prepare(
    `INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
     VALUES (?, ?, ?, 'invited', ?, ?)`
  ).run(
    `sga_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId,
    inviter.name,
    `Invited ${targetUser.name} to join the group`,
    now
  );

  const payload = hydrateSocialGroupsForUser(userId);
  res.status(201).json({ invitedName: targetUser.name, ...payload });
});

app.post('/api/my-groups/:groupId/read', (req, res) => {
  const { groupId } = req.params;
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE social_group_members SET last_read_at = ? WHERE group_id = ? AND user_id = ?'
  ).run(now, groupId, userId);

  const payload = hydrateSocialGroupsForUser(userId);
  res.json(payload);
});

app.post('/api/my-groups/:groupId/messages', (req, res) => {
  const { groupId } = req.params;
  const { userId, body, productId } = req.body as {
    userId?: string;
    body?: string;
    productId?: string | null;
  };
  if (!userId || (!body?.trim() && !productId)) {
    return res.status(400).json({ error: 'Message text or attached product is required.' });
  }

  const membership = db
    .prepare('SELECT id FROM social_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as { id: string } | undefined;
  if (!membership) {
    return res.status(403).json({ error: 'Join this group before sending messages.' });
  }

  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string }
    | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  let validProductId: string | null = null;
  let productName: string | null = null;
  if (productId) {
    const prod = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as
      | { id: string; name: string }
      | undefined;
    if (prod) {
      validProductId = prod.id;
      productName = prod.name;
    }
  }

  const now = new Date().toISOString();
  const messageText =
    body?.trim() || (productName ? `Shared ${productName} in chat` : '');

  db.prepare(
    `INSERT INTO social_group_messages (id, group_id, sender_id, body, product_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    `sgmsg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId,
    userId,
    messageText,
    validProductId,
    now
  );

  db.prepare(
    'UPDATE social_group_members SET last_read_at = ? WHERE group_id = ? AND user_id = ?'
  ).run(now, groupId, userId);

  if (productName) {
    db.prepare(
      `INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
       VALUES (?, ?, ?, 'message', ?, ?)`
    ).run(
      `sga_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      groupId,
      user.name,
      `Shared ${productName} in group chat`,
      now
    );
  }

  const payload = hydrateSocialGroupsForUser(userId);
  res.status(201).json(payload);
});

app.post('/api/my-groups/:groupId/products', (req, res) => {
  const { groupId } = req.params;
  const { userId, productId, note } = req.body as {
    userId?: string;
    productId?: string;
    note?: string;
  };
  if (!userId || !productId) {
    return res.status(400).json({ error: 'userId and productId are required.' });
  }

  const membership = db
    .prepare('SELECT id FROM social_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as { id: string } | undefined;
  if (!membership) {
    return res.status(403).json({ error: 'Join this group before sharing products.' });
  }

  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string }
    | undefined;
  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as
    | { id: string; name: string }
    | undefined;

  if (!user || !product) {
    return res.status(404).json({ error: 'User or product not found.' });
  }

  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id, upvotes_json FROM social_group_products WHERE group_id = ? AND product_id = ?')
    .get(groupId, productId) as { id: string; upvotes_json: string } | undefined;

  if (existing) {
    let upvotes: string[] = [];
    try {
      upvotes = JSON.parse(existing.upvotes_json || '[]') as string[];
    } catch {
      upvotes = [];
    }
    if (!upvotes.includes(userId)) upvotes.push(userId);
    db.prepare(
      `UPDATE social_group_products
       SET note = ?, shared_by_user_id = ?, upvotes_json = ?, created_at = ?
       WHERE id = ?`
    ).run(
      (note || '').trim() || `Recommended by ${user.name}`,
      userId,
      JSON.stringify(upvotes),
      now,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO social_group_products (id, group_id, product_id, shared_by_user_id, note, upvotes_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `sgp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      groupId,
      productId,
      userId,
      (note || '').trim() || `Shared for group review`,
      JSON.stringify([userId]),
      now
    );
  }

  db.prepare(
    `INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
     VALUES (?, ?, ?, 'shared_product', ?, ?)`
  ).run(
    `sga_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId,
    user.name,
    `Shared ${product.name}`,
    now
  );

  const payload = hydrateSocialGroupsForUser(userId);
  res.status(201).json(payload);
});

app.post('/api/my-groups/:groupId/products/:productId/vote', (req, res) => {
  const { groupId, productId } = req.params;
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }

  const membership = db
    .prepare('SELECT id FROM social_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as { id: string } | undefined;
  if (!membership) {
    return res.status(403).json({ error: 'Join this group to vote on products.' });
  }

  const shared = db
    .prepare('SELECT id, upvotes_json FROM social_group_products WHERE group_id = ? AND product_id = ?')
    .get(groupId, productId) as { id: string; upvotes_json: string } | undefined;
  if (!shared) {
    return res.status(404).json({ error: 'Shared product not found in this group.' });
  }

  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string }
    | undefined;
  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as
    | { id: string; name: string }
    | undefined;

  let upvotes: string[] = [];
  try {
    upvotes = JSON.parse(shared.upvotes_json || '[]') as string[];
  } catch {
    upvotes = [];
  }

  const alreadyVoted = upvotes.includes(userId);
  upvotes = alreadyVoted ? upvotes.filter((id) => id !== userId) : [...upvotes, userId];

  db.prepare('UPDATE social_group_products SET upvotes_json = ? WHERE id = ?').run(
    JSON.stringify(upvotes),
    shared.id
  );

  if (!alreadyVoted && user && product) {
    db.prepare(
      `INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
       VALUES (?, ?, ?, 'voted', ?, ?)`
    ).run(
      `sga_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      groupId,
      user.name,
      `Marked interest in ${product.name}`,
      new Date().toISOString()
    );
  }

  const payload = hydrateSocialGroupsForUser(userId);
  res.json(payload);
});

app.post('/api/my-groups/:groupId/activity', (req, res) => {
  const { groupId } = req.params;
  const { userId, actionType, summary } = req.body as {
    userId?: string;
    actionType?: SocialGroupActivity['actionType'];
    summary?: string;
  };
  if (!userId || !summary?.trim()) {
    return res.status(400).json({ error: 'userId and summary are required.' });
  }

  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string }
    | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  db.prepare(
    `INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    `sga_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupId,
    user.name,
    actionType || 'added_to_cart',
    summary.trim(),
    new Date().toISOString()
  );

  const payload = hydrateSocialGroupsForUser(userId);
  res.status(201).json(payload);
});

async function startServer() {
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build artifacts not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CartSync server running at http://localhost:${PORT}`);
  });
}

startServer();
