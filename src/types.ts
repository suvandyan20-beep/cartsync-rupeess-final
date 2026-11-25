export type UserRole = 'customer' | 'seller';

export interface SavedAddress {
  id: string;
  label: string;
  recipientName: string;
  line1: string;
  cityStateZip: string;
  phone?: string;
  isDefault: boolean;
}

export interface NotificationPrefs {
  orderUpdates: boolean;
  groupDeals: boolean;
  deliveryAlerts: boolean;
  promotions: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarInitials: string;
  address: string;
  phone?: string;
  savedAddresses?: SavedAddress[];
  paymentPreference?: string;
  notificationPrefs?: NotificationPrefs;
}

export interface ProductSpec {
  label: string;
  value: string;
}

export interface SpecDiscrepancy {
  specName: string;
  advertisedClaim: string;
  verifiedFeedback: string;
  severity: 'minor' | 'notable';
  evidenceCount: number;
}

export interface ProductInsights {
  productId: string;
  pros: string[];
  cons: string[];
  discrepancies: SpecDiscrepancy[];
  summaryHeadline: string;
  verifiedAvgRating: number;
  rawAvgRating: number;
  analyzedAt: string;
  source: 'seeded' | 'gemini';
}

export type GroupMemberProgressStatus = 'Committed' | 'Paid' | 'Expired';

export type GroupDealStageLabel =
  | 'Waiting for Group Completion'
  | 'Pending Seller Approval'
  | 'Approved · Awaiting Payments'
  | 'Confirmed'
  | 'Expired'
  | 'Rejected';

export interface GroupDealMember {
  userId: string;
  name: string;
  quantity: number;
  confirmedAt: string;
  paidAt?: string | null;
  memberStatus: GroupMemberProgressStatus;
  orderId?: string | null;
  paymentStatus?: string | null;
}

export interface GroupDeal {
  id: string;
  productId: string;
  productName?: string;
  productPrice?: number;
  productImage?: string;
  sellerId: string;
  title: string;
  minParticipants: number;
  currentParticipants: number;
  committedCount: number;
  joinedCount: number;
  orderedCount: number;
  paidCount: number;
  expiredMembersCount: number;
  remainingConfirmedNeeded: number;
  discountPercent: number;
  tier2Min: number | null;
  tier2Discount: number | null;
  finalGroupPrice?: number | null;
  priceGuaranteed: boolean;
  status:
    | 'pending_approval'
    | 'active'
    | 'collecting_orders'
    | 'threshold_reached'
    | 'confirmed'
    | 'expired'
    | 'group_full'
    | 'approved'
    | 'rejected'
    | 'unlocked'
    | 'completed'
    | 'dissolved';
  stageLabel: GroupDealStageLabel;
  expiresAt: string;
  paymentExpiresAt?: string | null;
  sellerApprovedAt?: string | null;
  paymentWindowHours?: number | null;
  confirmedAt?: string | null;
  sharedDeliveryCostPerMember?: number | null;
  individualDeliveryFee?: number;
  deliverySavingsPerMember?: number | null;
  productSavingsPerUnit?: number | null;
  totalIndividualSavings?: number | null;
  joinedByCurrentUser?: boolean;
  currentUserMemberStatus?: GroupMemberProgressStatus | null;
  currentUserOrderId?: string | null;
  requestedByName?: string | null;
  members?: GroupDealMember[];
  shareCode?: string;
}

export interface Review {
  id: string;
  productId: string;
  userId: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  createdAt: string;
  aiTrustFlag: 'trusted' | 'flagged_suspicious';
  aiFlagReason: string | null;
}

export interface Product {
  id: string;
  sellerId: string;
  sellerName?: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  stock: number;
  imageUrl: string;
  description: string;
  specs: ProductSpec[];
  deliveryDays: number;
  estimatedDeliveryDate: string;
  createdAt: string;
  activeDeal: GroupDeal | null;
  insights: ProductInsights | null;
  reviews: Review[];
  ratingBreakdown: { stars: number; count: number }[];
  reviewCount: number;
  flaggedCount: number;
}

export interface AvailabilitySlot {
  id: string;
  userId: string;
  dayOfWeek: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  slotLabel: 'Morning (8am–12pm)' | 'Afternoon (12pm–4pm)' | 'Evening (4pm–8pm)';
  status: 'available' | 'unavailable';
  note: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  productImage: string;
  sellerId: string;
  sellerName: string;
  quantity: number;
  unitPrice: number;
  dealId: string | null;
  deliveryDate?: string | null;
}

export interface DeliveryPartner {
  id: string;
  name: string;
  phone: string;
  avatarUrl: string;
  vehicle: string;
  hubZone: string;
  rating: number;
}

export type DeliveryLifecycleStageKey =
  | 'order_confirmed'
  | 'order_processed'
  | 'ready_for_dispatch'
  | 'out_for_delivery'
  | 'availability_confirmation'
  | 'partner_assigned'
  | 'delivered';

export interface Order {
  id: string;
  customerId: string;
  customerName?: string;
  customerAddress?: string;
  dealId?: string | null;
  groupStageLabel?: GroupDealStageLabel | null;
  groupDealTitle?: string | null;
  groupPaidCount?: number | null;
  groupCommittedCount?: number | null;
  groupMinParticipants?: number | null;
  sharedDeliveryCost?: number | null;
  finalGroupPrice?: number | null;
  paymentDeadline?: string | null;
  individualDeliveryOptionFee?: number;
  expiredResolutionStatus?: 'none' | 'pending_choice' | 'continued_individual' | 'cancelled_refunded';
  deliveryMode: 'combined' | 'express_separate';
  combinedGroupId: string | null;
  scheduledWindow: string;
  shippingFee: number;
  subtotal: number;
  discountTotal: number;
  totalAmount: number;
  paymentMethod?: string;
  paymentStatus: string;
  fulfillmentStatus:
    | 'Awaiting Payment'
    | 'Confirmed'
    | 'Combined & Packed'
    | 'Out for Delivery'
    | 'Delivered'
    | 'Cancelled';
  groupApprovalStatus: 'Not Required' | 'Group Full - Pending Seller' | 'Approved by Seller' | 'Rejected by Seller';
  deliveryAvailabilityStatus:
    | 'Not Dispatched'
    | 'Awaiting Customer Response'
    | 'Availability Confirmed'
    | 'Delivery Rescheduled'
    | 'Reschedule Requested';
  rescheduleRequestedWindow?: string | null;
  deliveryPartner?: DeliveryPartner | null;
  lifecycleStage: DeliveryLifecycleStageKey;
  stageTimestamps: Partial<Record<DeliveryLifecycleStageKey, string>>;
  trackingStage: string;
  trackingEta?: string | null;
  handoverPin?: string;
  deliveryRating?: number | null;
  deliveryFeedback?: string | null;
  liveTrackingConfigured?: boolean;
  createdAt: string;
  items: OrderItem[];
}

export interface AppNotification {
  id: string;
  userId: string;
  type:
    | 'seller_group_approval_request'
    | 'group_approved'
    | 'group_rejected'
    | 'group_threshold_reached'
    | 'group_confirmed'
    | 'group_expired'
    | 'group_payment_expired'
    | 'delivery_availability_request'
    | 'delivery_partner_assigned'
    | 'delivery_reschedule_requested'
    | 'delivery_rescheduled_confirmed'
    | 'info';
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  actionStatus: 'pending' | 'approved' | 'rejected' | 'confirmed' | 'unavailable' | 'info';
  createdAt: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  dealId: string | null;
  discountedUnitPrice: number;
  autoAddedReason?: string | null;
}

export interface VisualSearchResult {
  detectedItemSummary: string;
  searchKeywords: string[];
  reasoning: string;
  products: Product[];
}

export interface SellerAnalytics {
  totalRevenue: number;
  totalOrders: number;
  combinedOrdersRate: number;
  activeGroupDeals: number;
  pendingGroupRequests: number;
  lowStockProducts: number;
  flaggedReviewsCount: number;
  averageVerifiedRating: number;
  demandByCategory: { category: string; unitsSold: number; revenue: number }[];
  productDemand: {
    productId: string;
    name: string;
    stock: number;
    unitsSold: number;
    revenue: number;
    groupParticipants: number;
    avgRating: number;
    flaggedCount: number;
  }[];
}
