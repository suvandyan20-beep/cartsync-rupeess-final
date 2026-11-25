import { useCallback, useEffect, useRef, useState } from 'react';
import { formatINR, INDIVIDUAL_DELIVERY_FEE_INR } from './utils/currency.ts';
import {
  BellRing,
  CheckCircle2,
  Clock,
  LogIn,
  Navigation,
  ShoppingBag,
  Store,
  UserCheck,
  X,
} from 'lucide-react';
import { TopBar, type CustomerTab, type SellerTab } from './components/TopBar.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { HomeView } from './components/HomeView.tsx';
import { CategoriesView } from './components/CategoriesView.tsx';
import { CustomerCatalog, type SearchSortOption } from './components/CustomerCatalog.tsx';
import { ProductDetailView } from './components/ProductDetailView.tsx';
import { GroupDealsView } from './components/GroupDealsView.tsx';
import { CartView } from './components/CartView.tsx';
import { CustomerOrdersView } from './components/CustomerOrdersView.tsx';
import { NotificationsView } from './components/NotificationsView.tsx';
import { ProfileView } from './components/ProfileView.tsx';
import { AvailabilityScheduler } from './components/AvailabilityScheduler.tsx';
import { SellerDashboard } from './components/SellerDashboard.tsx';
import { ProductFormModal } from './components/ProductFormModal.tsx';
import { SpecComparisonModal } from './components/SpecComparisonModal.tsx';
import { CameraSearchModal } from './components/CameraSearchModal.tsx';
import type {
  AppNotification,
  AvailabilitySlot,
  CartItem,
  GroupDeal,
  NotificationPrefs,
  Order,
  Product,
  ProductSpec,
  SavedAddress,
  SellerAnalytics,
  User,
  VisualSearchResult,
} from './types.ts';

const WISHLIST_STORAGE_KEY = 'cartsync_wishlist';
const RECENT_STORAGE_KEY = 'cartsync_recent';
let initialResetPromise: Promise<void> | null = null;

export default function App() {
  const [demoUsers, setDemoUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Navigation state
  const [customerTab, setCustomerTab] = useState<CustomerTab>('home');
  const [sellerTab, setSellerTab] = useState<SellerTab>('overview');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // Data state
  const [products, setProducts] = useState<Product[]>([]);
  const [sellerProducts, setSellerProducts] = useState<Product[]>([]);
  const [sellerDeals, setSellerDeals] = useState<GroupDeal[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>([]);
  const [recommendedWindow, setRecommendedWindow] = useState<string>('Mon · Evening (4pm–8pm)');
  const [sellerAnalytics, setSellerAnalytics] = useState<SellerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  // Cart, Notifications & Modals
  const [cart, setCart] = useState<CartItem[]>([]);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);
  const [trackedOrderId, setTrackedOrderId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [comparisonProductId, setComparisonProductId] = useState<string | null>(null);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [visualSearch, setVisualSearch] = useState<VisualSearchResult | null>(null);

  // Persistent Customer Search, Category, Sort, Wishlist & Recently Viewed
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<SearchSortOption>('featured');
  const [wishlistIds, setWishlistIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  // Feedback banner & automatic delivery lifecycle progression
  const [toast, setToast] = useState<string | null>(null);
  const [autoSimulatingOrderIds, setAutoSimulatingOrderIds] = useState<string[]>([]);
  const inFlightAdvanceRef = useRef<Set<string>>(new Set());
  const [floatingRescheduleOpenId, setFloatingRescheduleOpenId] = useState<string | null>(null);
  const [floatingRescheduleSlot, setFloatingRescheduleSlot] = useState(
    'Tomorrow · Morning (8am–12pm)'
  );
  const [floatingBusyOrderId, setFloatingBusyOrderId] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadWorkspaceData = useCallback(async (user: User): Promise<CartItem[]> => {
    if (user.role === 'customer') {
      const [prodRes, orderRes, availRes, cartRes, notifRes] = await Promise.all([
        fetch(`/api/products?userId=${encodeURIComponent(user.id)}`),
        fetch(`/api/orders?customerId=${encodeURIComponent(user.id)}`),
        fetch(`/api/availability/${encodeURIComponent(user.id)}`),
        fetch(`/api/cart/${encodeURIComponent(user.id)}`),
        fetch(`/api/notifications/${encodeURIComponent(user.id)}`),
      ]);
      const prodData = await prodRes.json();
      const orderData = await orderRes.json();
      const availData = await availRes.json();
      const cartData = await cartRes.json();
      const notifData = await notifRes.json();
      const loadedCart: CartItem[] = cartData.items || [];
      setProducts(prodData.products || []);
      setOrders(orderData.orders || []);
      setAvailabilitySlots(availData.slots || []);
      setRecommendedWindow(availData.recommendedWindow || 'Mon · Evening (4pm–8pm)');
      setCart(loadedCart);
      setNotifications(notifData.notifications || []);
      setUnreadNotificationCount(Number(notifData.unreadCount || 0));
      return loadedCart;
    } else {
      const [prodRes, dealsRes, orderRes, analyticsRes, notifRes] = await Promise.all([
        fetch(`/api/products?sellerId=${encodeURIComponent(user.id)}`),
        fetch(`/api/group-deals?sellerId=${encodeURIComponent(user.id)}`),
        fetch(`/api/orders?sellerId=${encodeURIComponent(user.id)}`),
        fetch(`/api/seller/${encodeURIComponent(user.id)}/analytics`),
        fetch(`/api/notifications/${encodeURIComponent(user.id)}`),
      ]);
      const prodData = await prodRes.json();
      const dealsData = await dealsRes.json();
      const orderData = await orderRes.json();
      const analyticsData = await analyticsRes.json();
      const notifData = await notifRes.json();
      setSellerProducts(prodData.products || []);
      setSellerDeals(dealsData.deals || []);
      setOrders(orderData.orders || []);
      setSellerAnalytics(analyticsData.analytics || null);
      setNotifications(notifData.notifications || []);
      setUnreadNotificationCount(Number(notifData.unreadCount || 0));
      setCart([]);
      return [];
    }
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        if (!initialResetPromise) {
          initialResetPromise = (async () => {
            try {
              localStorage.removeItem(WISHLIST_STORAGE_KEY);
              localStorage.removeItem(RECENT_STORAGE_KEY);
              localStorage.removeItem('cartsync_delivery_method');
            } catch {
              // ignore storage errors
            }
            await fetch('/api/demo/reset', { method: 'POST' });
          })();
        }
        await initialResetPromise;
        setWishlistIds([]);
        setRecentlyViewedIds([]);

        const res = await fetch('/api/users/demo');
        const data = await res.json();
        const users: User[] = data.users || [];
        setDemoUsers(users);
        const defaultUser = users.find((u) => u.role === 'customer') || users[0] || null;
        if (defaultUser) {
          setCurrentUser(defaultUser);
          await loadWorkspaceData(defaultUser);
        }
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, [loadWorkspaceData]);

  const openProductDetail = useCallback((productId: string) => {
    setSelectedProductId(productId);
    setRecentlyViewedIds((prev) => {
      const next = [productId, ...prev.filter((id) => id !== productId)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleToggleWishlist = useCallback(
    (productId: string) => {
      setWishlistIds((prev) => {
        const exists = prev.includes(productId);
        const next = exists ? prev.filter((id) => id !== productId) : [productId, ...prev];
        try {
          localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        showToast(exists ? 'Removed from saved favorites.' : 'Saved to your favorites.');
        return next;
      });
    },
    [showToast]
  );

  async function handleSwitchUser(user: User) {
    setCurrentUser(user);
    setSelectedProductId(null);
    setVisualSearch(null);
    setConfirmedOrderId(null);
    setTrackedOrderId(null);
    setAutoSimulatingOrderIds([]);
    setFloatingRescheduleOpenId(null);
    if (user.role === 'customer') {
      setCustomerTab('home');
    } else {
      setSellerTab('overview');
    }
    setDemoUsers((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.map((u) => (u.id === user.id ? user : u))
        : [...prev, user]
    );
    const loadedCart = await loadWorkspaceData(user);
    const autoAddedItem = loadedCart.find((i) => Boolean(i.autoAddedReason));
    if (autoAddedItem) {
      showToast(
        `Switched to ${user.name} · ${autoAddedItem.product.name} was automatically added to cart from seller approval.`
      );
    } else {
      showToast(
        `Signed in as ${user.name} (${user.role === 'customer' ? 'Customer' : 'Seller'} Account)`
      );
    }
  }

  function handleQuickRoleToggle() {
    if (!currentUser || demoUsers.length === 0) return;
    const targetRole = currentUser.role === 'customer' ? 'seller' : 'customer';
    const nextUser = demoUsers.find((u) => u.role === targetRole);
    if (nextUser) {
      void handleSwitchUser(nextUser);
    }
  }

  function handleLogout() {
    setCurrentUser(null);
    setCart([]);
    setOrders([]);
    setNotifications([]);
    setUnreadNotificationCount(0);
    setSelectedProductId(null);
    setTrackedOrderId(null);
    setConfirmedOrderId(null);
    setAutoSimulatingOrderIds([]);
    setFloatingRescheduleOpenId(null);
    showToast('Signed out of CartSync.');
  }

  // Automatic 1-second delivery lifecycle progression after order confirmation;
  // pauses only when customer response ("I'm Available" or "I'm Not Available") is needed,
  // and continues automatically after they respond.
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'customer' || autoSimulatingOrderIds.length === 0) {
      return;
    }

    const activeTargets = autoSimulatingOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter((o): o is Order => Boolean(o));

    const finishedIds = autoSimulatingOrderIds.filter((id) => {
      const match = orders.find((o) => o.id === id);
      return (
        match &&
        (match.lifecycleStage === 'delivered' ||
          match.fulfillmentStatus === 'Delivered' ||
          match.fulfillmentStatus === 'Cancelled')
      );
    });

    if (finishedIds.length > 0) {
      setAutoSimulatingOrderIds((prev) => prev.filter((id) => !finishedIds.includes(id)));
      return;
    }

    const ordersToAdvance = activeTargets.filter((order) => {
      if (
        order.lifecycleStage === 'delivered' ||
        order.fulfillmentStatus === 'Delivered' ||
        order.fulfillmentStatus === 'Cancelled' ||
        order.fulfillmentStatus === 'Awaiting Payment'
      ) {
        return false;
      }
      if (
        order.lifecycleStage === 'availability_confirmation' &&
        order.deliveryAvailabilityStatus === 'Awaiting Customer Response'
      ) {
        return false;
      }
      return true;
    });

    if (ordersToAdvance.length === 0) {
      return;
    }

    const timer = setTimeout(async () => {
      let updatedAny = false;
      let justDeliveredId: string | null = null;

      for (const order of ordersToAdvance) {
        if (inFlightAdvanceRef.current.has(order.id)) continue;
        inFlightAdvanceRef.current.add(order.id);
        try {
          const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/demo-advance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, action: 'next_stage' }),
          });
          if (res.ok) {
            updatedAny = true;
            const data = await res.json();
            if (data.order?.lifecycleStage === 'delivered') {
              justDeliveredId = order.id;
            }
          }
        } finally {
          inFlightAdvanceRef.current.delete(order.id);
        }
      }

      if (updatedAny) {
        await loadWorkspaceData(currentUser);
        if (justDeliveredId) {
          showToast(`Order #${justDeliveredId} has been delivered!`);
        }
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoSimulatingOrderIds, currentUser, loadWorkspaceData, orders, showToast]);

  async function handleAddToCart(
    product: Product,
    useGroupPrice: boolean,
    quantity = 1
  ): Promise<boolean> {
    const qtyToAdd = Math.max(1, Math.min(product.stock || 1, quantity));
    const deal = product.activeDeal;
    const tier2Active =
      deal && deal.tier2Min && deal.tier2Discount && deal.paidCount >= deal.tier2Min;
    const discountPct =
      useGroupPrice && deal
        ? tier2Active && deal.tier2Discount
          ? deal.tier2Discount
          : deal.discountPercent
        : 0;
    const discountedUnitPrice = Number((product.price * (1 - discountPct / 100)).toFixed(2));
    const dealId = useGroupPrice && deal ? deal.id : null;

    const prevCart = cart;
    const nextCart = (() => {
      const existing = cart.find((i) => i.product.id === product.id);
      if (existing) {
        return cart.map((i) =>
          i.product.id === product.id
            ? {
                ...i,
                quantity: Math.min(product.stock, i.quantity + qtyToAdd),
                discountedUnitPrice,
                dealId: dealId ?? i.dealId,
              }
            : i
        );
      }
      return [
        ...cart,
        {
          product,
          quantity: qtyToAdd,
          dealId,
          discountedUnitPrice,
        },
      ];
    })();

    setCart(nextCart);

    if (currentUser && currentUser.role === 'customer') {
      try {
        const res = await fetch(`/api/cart/${encodeURIComponent(currentUser.id)}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: product.id,
            quantity: qtyToAdd,
            dealId,
            discountedUnitPrice,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setCart(prevCart);
          showToast(data.error || 'Unable to add item to cart.');
          return false;
        }
        setCart(data.items || nextCart);
      } catch {
        // Optimistic cart already updated
      }
    }

    const distinctDates = new Set(nextCart.map((i) => i.product.estimatedDeliveryDate));
    if (nextCart.length >= 2 && distinctDates.size > 1) {
      showToast(
        `Added ${qtyToAdd}× ${product.name}. Cart has multiple delivery dates — select Combined or Normal Delivery in Cart.`
      );
    } else {
      showToast(`Added ${qtyToAdd}× ${product.name} to cart.`);
    }
    return true;
  }

  async function handleBuyNow(product: Product, useGroupPrice: boolean, quantity: number) {
    const added = await handleAddToCart(product, useGroupPrice, quantity);
    if (!added) return;
    setSelectedProductId(null);
    setCustomerTab('cart');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleUpdateCartQty(productId: string, qty: number) {
    setCart((prev) =>
      prev.map((i) => (i.product.id === productId ? { ...i, quantity: qty } : i))
    );
    if (currentUser && currentUser.role === 'customer') {
      await fetch(
        `/api/cart/${encodeURIComponent(currentUser.id)}/items/${encodeURIComponent(productId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: qty }),
        }
      );
    }
  }

  async function handleRemoveCartItem(productId: string) {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
    if (currentUser && currentUser.role === 'customer') {
      await fetch(
        `/api/cart/${encodeURIComponent(currentUser.id)}/items/${encodeURIComponent(productId)}`,
        { method: 'DELETE' }
      );
    }
  }

  async function handleJoinGroupDeal(dealId: string, quantity = 1) {
    if (!currentUser) return;
    const res = await fetch(`/api/group-deals/${dealId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, quantity }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not join group order.');
      return;
    }
    await loadWorkspaceData(currentUser);
    if (data.thresholdReached) {
      showToast(
        `Commitment confirmed (${quantity}×, ₹0 charged now). Threshold reached — sent to seller for final price & stock approval!`
      );
    } else {
      showToast(
        `Commitment recorded (${quantity}×, ₹0 charged now). Waiting for Group Completion — no payment required yet.`
      );
    }
  }

  async function handleWithdrawGroupDeal(dealId: string) {
    if (!currentUser) return;
    const res = await fetch(`/api/group-deals/${dealId}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not withdraw from group order.');
      return;
    }
    await loadWorkspaceData(currentUser);
    showToast('Withdrew from group pool with no charge.');
  }

  async function handleRequestGroupDeal(
    productId: string,
    targetParticipants: number,
    desiredDiscount: number,
    quantity = 1,
    deadlineHours = 72,
    paymentWindowHours = 24
  ) {
    if (!currentUser) return;
    const res = await fetch('/api/group-deals/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        userId: currentUser.id,
        userName: currentUser.name,
        targetParticipants,
        desiredDiscount,
        quantity,
        deadlineHours,
        paymentWindowHours,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Unable to create group order.');
      return;
    }
    await loadWorkspaceData(currentUser);
    showToast(
      `Group pool created (1/${targetParticipants} committed). Waiting for Group Completion — no payment required yet.`
    );
  }

  async function handleCreateGroupOrder(payload: {
    productId: string;
    quantity: number;
    targetParticipants: number;
    desiredDiscount: number;
    deadlineHours: number;
    paymentWindowHours?: number;
    title: string;
  }) {
    if (!currentUser) return;
    const res = await fetch('/api/group-deals/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        userId: currentUser.id,
        userName: currentUser.name,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Unable to create group order.');
    }
    await loadWorkspaceData(currentUser);
    showToast(
      `Group order "${payload.title || 'New Pool'}" launched (1/${payload.targetParticipants} committed · No payment required yet).`
    );
  }

  async function handleSubmitReview(
    productId: string,
    payload: { rating: number; title: string; body: string }
  ) {
    if (!currentUser) return { flagged: false };
    const res = await fetch(`/api/products/${productId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        authorName: currentUser.name,
        ...payload,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to post review.');
    }
    await loadWorkspaceData(currentUser);
    return { flagged: Boolean(data.flagged) };
  }

  async function handleRunAiAudit(productId: string) {
    if (!currentUser) return;
    const res = await fetch(`/api/products/${productId}/ai-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Gemini audit failed.');
    }
    await loadWorkspaceData(currentUser);
  }

  async function handleSaveAvailability(
    updated: { dayOfWeek: string; slotLabel: string; status: 'available' | 'unavailable'; note: string }[]
  ) {
    if (!currentUser) return;
    const res = await fetch(`/api/availability/${encodeURIComponent(currentUser.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: updated }),
    });
    const data = await res.json();
    if (res.ok) {
      setAvailabilitySlots(data.slots || []);
      setRecommendedWindow(data.recommendedWindow || recommendedWindow);
    }
  }

  async function handleUpdateProfile(patch: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    savedAddresses?: SavedAddress[];
    paymentPreference?: string;
    notificationPrefs?: NotificationPrefs;
  }) {
    if (!currentUser) return;
    const res = await fetch(`/api/users/${encodeURIComponent(currentUser.id)}/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update profile.');
    }
    const updatedUser: User = data.user;
    setCurrentUser(updatedUser);
    setDemoUsers((prev) => prev.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
    showToast('Profile settings saved.');
  }

  async function handlePlaceOrder(payload: {
    deliveryMode: 'combined' | 'express_separate';
    deliveryScheduleChoice: 'same_day' | 'as_shown';
    combineWithOrderId: string | null;
    shippingAddress: string;
    paymentMethod: string;
    paymentMode: 'pay_now' | 'pay_later';
  }) {
    if (!currentUser) return;
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: currentUser.id,
        deliveryMode: payload.deliveryMode,
        deliveryScheduleChoice: payload.deliveryScheduleChoice,
        combineWithOrderId: payload.combineWithOrderId,
        shippingAddress: payload.shippingAddress,
        paymentMethod: payload.paymentMethod,
        paymentMode: payload.paymentMode,
        items: cart.map((c) => ({
          productId: c.product.id,
          quantity: c.quantity,
          dealId: c.dealId,
          unitPrice: c.discountedUnitPrice,
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Order failed.');
    }
    setCart([]);
    await loadWorkspaceData(currentUser);
    setConfirmedOrderId(data.order.id);
    setTrackedOrderId(null);
    setCustomerTab('orders');
    setSelectedProductId(null);

    const isPaid = payload.paymentMode === 'pay_now';
    const orderDealId = data.order?.dealId;
    const isGroupConfirmed = data.order?.groupStageLabel === 'Confirmed' || Boolean(data.groupUpdate?.justConfirmed);
    if (isPaid && (!orderDealId || isGroupConfirmed)) {
      setAutoSimulatingOrderIds((prev) =>
        prev.includes(data.order.id) ? prev : [...prev, data.order.id]
      );
    }

    if (!isPaid) {
      showToast(
        orderDealId
          ? `Order #${data.order.id} placed (Ordered · Payment Pending). Complete payment to count toward the group threshold.`
          : `Order #${data.order.id} placed (Payment Pending). Complete payment from My Orders.`
      );
    } else if (data.groupUpdate?.justConfirmed) {
      showToast(
        `Order #${data.order.id} paid! Group threshold reached and confirmed with shared delivery.`
      );
    } else {
      showToast(
        `Order #${data.order.id} paid & confirmed (${
          payload.deliveryScheduleChoice === 'same_day'
            ? 'Combined Delivery'
            : 'Normal Delivery'
        }).`
      );
    }
  }

  async function handleCancelOrder(orderId: string) {
    if (!currentUser) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Unable to cancel order.');
      return;
    }
    setAutoSimulatingOrderIds((prev) => prev.filter((id) => id !== orderId));
    await loadWorkspaceData(currentUser);
    showToast(`Order #${orderId} cancelled and inventory restored.`);
  }

  async function handleCombineOrders(orderIds: string[]) {
    if (!currentUser) return;
    const res = await fetch('/api/orders/combine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: currentUser.id, orderIds }),
    });
    const data = await res.json();
    if (res.ok) {
      setOrders(data.orders || []);
      showToast(
        `Consolidated ${orderIds.length} orders into batch ${data.combinedGroupId} for ${data.scheduledWindow}.`
      );
    }
  }

  // Seller handlers
  async function handleSaveProduct(payload: {
    id?: string;
    name: string;
    brand: string;
    category: string;
    price: number;
    stock: number;
    imageUrl: string;
    description: string;
    specs: ProductSpec[];
    deliveryDays: number;
    enableGroupDeal: boolean;
    dealTitle: string;
    minParticipants: number;
    discountPercent: number;
    tier2Min: number | null;
    tier2Discount: number | null;
  }) {
    if (!currentUser) return;
    if (payload.id) {
      const res = await fetch(`/api/products/${payload.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update product.');
      showToast(`Updated ${payload.name}.`);
    } else {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: currentUser.id, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to publish product.');
      showToast(`Published ${payload.name} to CartSync marketplace.`);
    }
    await loadWorkspaceData(currentUser);
  }

  async function handleUpdateStock(productId: string, nextStock: number) {
    if (!currentUser) return;
    await fetch(`/api/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: nextStock }),
    });
    await loadWorkspaceData(currentUser);
  }

  async function handleUpdateDealSeller(
    dealId: string,
    payload: {
      approve?: boolean;
      minParticipants?: number;
      discountPercent?: number;
      finalGroupPrice?: number;
      paymentWindowHours?: number;
      tier2Min?: number | null;
      tier2Discount?: number | null;
    }
  ) {
    if (!currentUser) return;
    const res = await fetch(`/api/group-deals/${dealId}/seller`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerId: currentUser.id, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not update group deal.');
      await loadWorkspaceData(currentUser);
      return;
    }
    await loadWorkspaceData(currentUser);
    if (payload.approve) {
      const count = Number(data.ordersCreatedCount || 0);
      const priceLabel =
        typeof data.deal?.finalGroupPrice === 'number'
          ? ` at ${formatINR(data.deal.finalGroupPrice)}/unit`
          : '';
      showToast(
        `Final group price approved${priceLabel}! ${count} participant${count === 1 ? '' : 's'} notified with payment deadline.`
      );
    } else {
      showToast('Group discount tiers updated.');
    }
  }

  async function handleUpdateOrderStatus(orderId: string, status: Order['fulfillmentStatus']) {
    if (!currentUser) return;
    await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fulfillmentStatus: status }),
    });
    await loadWorkspaceData(currentUser);
    showToast(
      status === 'Out for Delivery'
        ? `Order #${orderId} marked Out for Delivery · Availability prompt sent to customer.`
        : `Order #${orderId} updated to ${status}.`
    );
  }

  async function handleApproveGroupDeal(
    dealId: string,
    overrides?: {
      finalDiscountPercent?: number;
      finalGroupPrice?: number;
      paymentWindowHours?: number;
      title?: string;
      minParticipants?: number;
    }
  ) {
    if (!currentUser) return;
    const res = await fetch(`/api/group-deals/${dealId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerId: currentUser.id, ...overrides }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not approve group order.');
      return;
    }
    await loadWorkspaceData(currentUser);
    if (data.alreadyProcessed || data.alreadyApproved) {
      showToast('Group order was already approved (no duplicate orders or notifications created).');
    } else {
      const count = Number(data.ordersCreatedCount || 0);
      const priceLabel =
        typeof data.deal?.finalGroupPrice === 'number'
          ? `${formatINR(data.deal.finalGroupPrice)}/unit`
          : 'final price';
      showToast(
        `Group approved at ${priceLabel}! ${count} participant${count === 1 ? '' : 's'} notified to pay within the deadline.`
      );
    }
  }

  async function handleRejectGroupDeal(dealId: string, reason?: string) {
    if (!currentUser) return;
    const res = await fetch(`/api/group-deals/${dealId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerId: currentUser.id, reason }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not reject group order.');
      return;
    }
    await loadWorkspaceData(currentUser);
    showToast('Group order declined · Participants notified (no payment collected, no refund needed).');
  }

  async function handleRespondAvailability(
    orderId: string,
    available: boolean,
    rescheduleWindow?: string
  ) {
    if (!currentUser) return;
    const res = await fetch(`/api/orders/${orderId}/availability-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, available, rescheduleWindow }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Unable to update delivery availability.');
      return;
    }
    await loadWorkspaceData(currentUser);
    if (available) {
      const partnerName = data.order?.deliveryPartner?.name;
      showToast(
        partnerName
          ? `Availability confirmed! Delivery partner ${partnerName} assigned to Order #${orderId}.`
          : `Delivery availability confirmed for Order #${orderId}.`
      );
    } else {
      showToast(
        `Delivery rescheduled to ${rescheduleWindow || 'selected window'} · Simulated schedule notification sent.`
      );
    }
  }

  async function handleRateDelivery(orderId: string, rating: number, feedback?: string) {
    if (!currentUser) return;
    const res = await fetch(`/api/orders/${orderId}/rate-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, rating, feedback }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Unable to save delivery rating.');
      return;
    }
    await loadWorkspaceData(currentUser);
    showToast(`Thank you for rating Order #${orderId} delivery (${rating}/5 stars).`);
  }

  async function handleConfirmOrderReceipt(
    orderId: string,
    payload: {
      verificationPin: string;
      parcelIntact: boolean;
      itemsVerified: boolean;
      receiverNote?: string;
    }
  ) {
    if (!currentUser) return;
    const res = await fetch(`/api/orders/${orderId}/confirm-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Could not confirm package receipt.');
    }
    await loadWorkspaceData(currentUser);
    showToast(`Order #${orderId} doorstep handover completed and marked Delivered.`);
  }

  async function handlePayPendingOrder(orderId: string) {
    if (!currentUser) return;
    const res = await fetch(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Payment failed.');
      return;
    }
    await loadWorkspaceData(currentUser);
    setConfirmedOrderId(orderId);
    setTrackedOrderId(null);
    setCustomerTab('orders');
    if (data.order?.fulfillmentStatus === 'Confirmed') {
      setAutoSimulatingOrderIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
    }
    showToast(
      data.order?.dealId
        ? `Payment completed! Order #${orderId} is now Confirmed (${data.groupUpdate?.paidCount ?? 1}/${data.groupUpdate?.committedCount ?? 1} group members paid).`
        : `Payment completed for Order #${orderId} and marked Confirmed.`
    );
  }

  async function handleResolveExpiredOrder(
    orderId: string,
    action: 'continue_individual' | 'cancel_refund'
  ) {
    if (!currentUser) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/expired-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, action }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Unable to update expired group order.');
      return;
    }
    if (action === 'cancel_refund') {
      setAutoSimulatingOrderIds((prev) => prev.filter((id) => id !== orderId));
    } else {
      setAutoSimulatingOrderIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
    }
    await loadWorkspaceData(currentUser);
    showToast(
      action === 'continue_individual'
        ? `Order #${orderId} converted to Normal Individual Delivery (${formatINR(INDIVIDUAL_DELIVERY_FEE_INR)} shipping).`
        : `Order #${orderId} cancelled${data.order?.paymentStatus === 'Refunded (Simulated)' ? ' with full simulated refund' : ''}.`
    );
  }

  async function handleExpireGroupNow(dealId: string) {
    if (!currentUser) return;
    const res = await fetch(`/api/group-deals/${encodeURIComponent(dealId)}/expire-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Unable to expire group pool.');
      return;
    }
    await loadWorkspaceData(currentUser);
    showToast(
      `Pool "${data.deal?.title || dealId}" expired before threshold. Participants notified (no payment was collected, no refund needed).`
    );
  }

  async function handleExpirePaymentWindowNow(dealId: string) {
    if (!currentUser) return;
    const res = await fetch(
      `/api/group-deals/${encodeURIComponent(dealId)}/expire-payment-window`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Unable to expire payment window.');
      return;
    }
    await loadWorkspaceData(currentUser);
    showToast(
      `Payment deadline closed for "${data.deal?.title || dealId}". Unpaid participants marked Expired; paid orders remain Confirmed.`
    );
  }

  async function handleMarkNotificationRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadNotificationCount((prev) => Math.max(0, prev - 1));
    await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  }

  async function handleMarkAllNotificationsRead() {
    if (!currentUser) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadNotificationCount(0);
    await fetch(`/api/notifications/${encodeURIComponent(currentUser.id)}/read-all`, {
      method: 'POST',
    });
  }

  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const selectedProduct = selectedProductId
    ? products.find((p) => p.id === selectedProductId) || null
    : null;
  const comparisonProduct = comparisonProductId
    ? (currentUser?.role === 'seller' ? sellerProducts : products).find(
        (p) => p.id === comparisonProductId
      ) || null
    : null;
  const openConfirmedOrders = orders.filter(
    (o) => o.fulfillmentStatus === 'Confirmed' || o.fulfillmentStatus === 'Combined & Packed'
  );

  const recentlyViewedProducts = recentlyViewedIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));

  const floatingAvailabilityOrder =
    currentUser?.role === 'customer'
      ? autoSimulatingOrderIds
          .map((id) => orders.find((o) => o.id === id))
          .find(
            (o) =>
              o &&
              o.deliveryAvailabilityStatus === 'Awaiting Customer Response' &&
              (o.lifecycleStage === 'out_for_delivery' ||
                o.lifecycleStage === 'availability_confirmation' ||
                o.fulfillmentStatus === 'Out for Delivery') &&
              !(customerTab === 'orders' && trackedOrderId === o.id)
          ) || null
      : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] px-4 sm:px-6 py-10">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="h-16 rounded-2xl skeleton-cream" />
          <div className="h-72 rounded-2xl skeleton-cream" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
            <div className="h-80 rounded-2xl skeleton-cream" />
            <div className="h-80 rounded-2xl skeleton-cream" />
            <div className="h-80 rounded-2xl skeleton-cream" />
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] text-[#29232F] flex flex-col justify-center items-center px-4 py-12">
        <div className="w-full max-w-xl bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl shadow-card-lg overflow-hidden">
          <div className="bg-[#24152F] text-[#FFFFFF] p-7 border-b-2 border-[#FF783D]">
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-xl bg-[#FF783D] text-[#24152F] font-display font-extrabold text-xl flex items-center justify-center border-2 border-[#D9F36A]">
                CS
              </span>
              <div>
                <h1 className="font-display text-2xl font-extrabold">
                  Cart<span className="text-[#FF783D]">Sync</span>
                </h1>
                <p className="text-xs text-[#BBA5D5]">
                  Collaborative Group Orders · Synced Deliveries · Verified Specs
                </p>
              </div>
            </div>
          </div>

          <div className="p-7 space-y-6">
            <div>
              <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                Choose an Account to Continue
              </h2>
              <p className="text-sm text-[#5E5468] mt-1">
                Pick a customer or seller demo account below, or sign in with your own credentials.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {demoUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void handleSwitchUser(u)}
                  className="p-4 rounded-xl border-2 border-[#E6D8CB] hover:border-[#24152F] bg-[#FFF8F0] hover:bg-[#ECFCCB] text-left flex items-center gap-3 transition-colors cursor-pointer"
                >
                  <span
                    className={`w-9 h-9 rounded-xl font-extrabold text-xs flex items-center justify-center shrink-0 ${
                      u.role === 'seller'
                        ? 'bg-[#FF783D] text-[#24152F]'
                        : 'bg-[#24152F] text-[#D9F36A]'
                    }`}
                  >
                    {u.avatarInitials}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-[#24152F] truncate">{u.name}</div>
                    <div className="text-[11px] font-bold text-[#5E5468] flex items-center gap-1">
                      {u.role === 'seller' ? (
                        <Store className="w-3 h-3 text-[#FF783D]" />
                      ) : (
                        <UserCheck className="w-3 h-3 text-[#24152F]" />
                      )}
                      <span>{u.role === 'seller' ? 'Seller Store' : 'Customer'}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] border-2 border-[#24152F] text-sm font-extrabold cursor-pointer"
            >
              <LogIn className="w-4 h-4" strokeWidth={2.2} />
              <span>Sign In or Create New Account</span>
            </button>
          </div>
        </div>

        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          currentUser={currentUser}
          demoUsers={demoUsers}
          onSwitchUser={handleSwitchUser}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF8F0] text-[#29232F] flex flex-col">
      <TopBar
        role={currentUser.role}
        currentUser={currentUser}
        customerTab={customerTab}
        sellerTab={sellerTab}
        onSelectCustomerTab={(tab) => {
          setCustomerTab(tab);
          setSelectedProductId(null);
          setTrackedOrderId(null);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onSelectSellerTab={(tab) => {
          setSellerTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        cartCount={cartCount}
        unreadNotificationCount={unreadNotificationCount}
        searchQuery={searchQuery}
        onSearchSubmit={(query) => {
          setSearchQuery(query);
          setSelectedProductId(null);
          setCustomerTab('search');
        }}
        onOpenCameraSearch={() => setCameraModalOpen(true)}
        onOpenAddProduct={() => {
          setEditingProduct(null);
          setProductModalOpen(true);
        }}
        onQuickRoleToggle={handleQuickRoleToggle}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-7 sm:py-9 pb-24 md:pb-12">
        {currentUser.role === 'customer' ? (
          selectedProduct ? (
            <ProductDetailView
              product={selectedProduct}
              currentUser={currentUser}
              onBack={() => setSelectedProductId(null)}
              onAddToCart={handleAddToCart}
              onBuyNow={handleBuyNow}
              onJoinGroupDeal={handleJoinGroupDeal}
              onWithdrawGroupDeal={handleWithdrawGroupDeal}
              onPayPendingOrder={handlePayPendingOrder}
              onResolveExpiredOrder={handleResolveExpiredOrder}
              onOpenCart={() => {
                setSelectedProductId(null);
                setCustomerTab('cart');
              }}
              onOpenOrders={() => {
                setSelectedProductId(null);
                setCustomerTab('orders');
              }}
              onRequestGroupDeal={handleRequestGroupDeal}
              onSubmitReview={handleSubmitReview}
              onRunAiAudit={handleRunAiAudit}
              onOpenComparison={() => setComparisonProductId(selectedProduct.id)}
            />
          ) : customerTab === 'home' ? (
            <HomeView
              products={products}
              recentlyViewedProducts={recentlyViewedProducts}
              wishlistIds={wishlistIds}
              onToggleWishlist={handleToggleWishlist}
              onSelectProduct={openProductDetail}
              onCompareProduct={(id) => setComparisonProductId(id)}
              onAddToCart={handleAddToCart}
              onSearchSubmit={(query) => {
                setSearchQuery(query);
                setCustomerTab('search');
              }}
              onOpenCategory={(cat) => {
                setSelectedCategory(cat);
                setCustomerTab('categories');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenGroupOrders={() => {
                setCustomerTab('deals');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onOpenCameraSearch={() => setCameraModalOpen(true)}
            />
          ) : customerTab === 'categories' ? (
            <CategoriesView
              products={products}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              wishlistIds={wishlistIds}
              onToggleWishlist={handleToggleWishlist}
              onSelectProduct={openProductDetail}
              onCompareProduct={(id) => setComparisonProductId(id)}
              onAddToCart={handleAddToCart}
              onOpenFullSearch={(cat) => {
                setSelectedCategory(cat);
                setCustomerTab('search');
              }}
              onBackHome={() => setCustomerTab('home')}
            />
          ) : customerTab === 'search' ? (
            <CustomerCatalog
              products={products}
              search={searchQuery}
              onSearchChange={setSearchQuery}
              category={selectedCategory}
              onCategoryChange={setSelectedCategory}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              onResetFilters={() => {
                setSearchQuery('');
                setSelectedCategory('All');
                setSortBy('featured');
                setVisualSearch(null);
              }}
              visualSearch={visualSearch}
              onClearVisualSearch={() => setVisualSearch(null)}
              onOpenCameraSearch={() => setCameraModalOpen(true)}
              wishlistIds={wishlistIds}
              onToggleWishlist={handleToggleWishlist}
              onSelectProduct={openProductDetail}
              onCompareProduct={(id) => setComparisonProductId(id)}
              onAddToCart={handleAddToCart}
              onBackHome={() => setCustomerTab('home')}
            />
          ) : customerTab === 'deals' ? (
            <GroupDealsView
              products={products}
              search={searchQuery}
              category={selectedCategory}
              sortBy={sortBy}
              onJoinGroupDeal={handleJoinGroupDeal}
              onWithdrawGroupDeal={handleWithdrawGroupDeal}
              onCreateGroupOrder={handleCreateGroupOrder}
              onAddToCart={handleAddToCart}
              onPayPendingOrder={handlePayPendingOrder}
              onResolveExpiredOrder={handleResolveExpiredOrder}
              onOpenCart={() => {
                setSelectedProductId(null);
                setCustomerTab('cart');
              }}
              onOpenOrders={() => {
                setSelectedProductId(null);
                setCustomerTab('orders');
              }}
              onSelectProduct={openProductDetail}
              onBackHome={() => setCustomerTab('home')}
            />
          ) : customerTab === 'cart' ? (
            <CartView
              currentUser={currentUser}
              items={cart}
              onUpdateQty={handleUpdateCartQty}
              onRemoveItem={handleRemoveCartItem}
              recommendedWindow={recommendedWindow}
              openConfirmedOrders={openConfirmedOrders}
              onOpenAvailability={() => setCustomerTab('availability')}
              onSelectProduct={openProductDetail}
              onContinueShopping={() => setCustomerTab('home')}
              onSaveAddress={(savedAddresses, primaryAddress) =>
                handleUpdateProfile({ savedAddresses, address: primaryAddress })
              }
              onPlaceOrder={handlePlaceOrder}
            />
          ) : customerTab === 'orders' ? (
            <CustomerOrdersView
              orders={orders}
              customerAddress={currentUser.address}
              confirmedOrderId={confirmedOrderId}
              trackedOrderId={trackedOrderId}
              onTrackOrder={(orderId) => setTrackedOrderId(orderId)}
              onDismissConfirmedBanner={() => setConfirmedOrderId(null)}
              onCombineOrders={handleCombineOrders}
              onRespondAvailability={handleRespondAvailability}
              onConfirmReceipt={handleConfirmOrderReceipt}
              onRateDelivery={handleRateDelivery}
              onPayPendingOrder={handlePayPendingOrder}
              onCancelOrder={handleCancelOrder}
              onResolveExpiredOrder={handleResolveExpiredOrder}
              onSelectProduct={openProductDetail}
              onBackHome={() => setCustomerTab('home')}
            />
          ) : customerTab === 'notifications' ? (
            <NotificationsView
              role={currentUser.role}
              notifications={notifications}
              onMarkRead={handleMarkNotificationRead}
              onMarkAllRead={handleMarkAllNotificationsRead}
              onApproveGroupDeal={handleApproveGroupDeal}
              onRejectGroupDeal={handleRejectGroupDeal}
              onPayPendingOrder={handlePayPendingOrder}
              onRespondAvailability={handleRespondAvailability}
              onResolveExpiredOrder={handleResolveExpiredOrder}
              onGoToOrders={() => {
                setSelectedProductId(null);
                setCustomerTab('orders');
              }}
              onGoToGroupOrders={() => {
                setSelectedProductId(null);
                setCustomerTab('deals');
              }}
              onGoToCart={() => {
                setSelectedProductId(null);
                setCustomerTab('cart');
              }}
              onBackHome={() => setCustomerTab('home')}
            />
          ) : customerTab === 'profile' ? (
            <ProfileView
              currentUser={currentUser}
              orders={orders}
              onUpdateProfile={handleUpdateProfile}
              onOpenAvailability={() => setCustomerTab('availability')}
              onOpenOrders={() => setCustomerTab('orders')}
              onTrackOrder={(orderId) => {
                setTrackedOrderId(orderId);
                setCustomerTab('orders');
              }}
              onQuickRoleToggle={handleQuickRoleToggle}
              onOpenAccountSwitcher={() => setAuthModalOpen(true)}
              onLogout={handleLogout}
              onBackHome={() => setCustomerTab('home')}
            />
          ) : (
            <AvailabilityScheduler
              slots={availabilitySlots}
              recommendedWindow={recommendedWindow}
              onSaveSlots={handleSaveAvailability}
              onBack={() => setCustomerTab('profile')}
            />
          )
        ) : (
          <SellerDashboard
            seller={currentUser}
            activeTab={sellerTab}
            onChangeTab={setSellerTab}
            products={sellerProducts}
            deals={sellerDeals}
            orders={orders}
            notifications={notifications}
            analytics={sellerAnalytics}
            onOpenAddProduct={() => {
              setEditingProduct(null);
              setProductModalOpen(true);
            }}
            onEditProduct={(product) => {
              setEditingProduct(product);
              setProductModalOpen(true);
            }}
            onUpdateStock={handleUpdateStock}
            onUpdateDealSeller={handleUpdateDealSeller}
            onApproveGroupDeal={handleApproveGroupDeal}
            onRejectGroupDeal={handleRejectGroupDeal}
            onExpireGroupNow={handleExpireGroupNow}
            onExpirePaymentWindowNow={handleExpirePaymentWindowNow}
            onUpdateOrderStatus={handleUpdateOrderStatus}
            onRunAiAudit={handleRunAiAudit}
            onCompareProduct={(id) => setComparisonProductId(id)}
          />
        )}
      </main>

      {/* Midnight Plum Footer */}
      <footer className="bg-[#24152F] text-[#FFFFFF] mt-16 border-t-4 border-[#FF783D] pb-16 md:pb-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
            <span className="font-display text-base font-extrabold text-[#FFFFFF]">
              Cart<span className="text-[#FF783D]">Sync</span>
            </span>
            <span aria-hidden="true" className="text-[#BBA5D5]">·</span>
            <span className="text-[#BBA5D5]">Smarter Shopping. Seamless Deliveries.</span>
          </div>
          <div className="font-semibold text-[#D9F36A]">
            Collaborative Group Buying · Combined Shipments · AI Review & Spec Verification
          </div>
        </div>
      </footer>

      {/* Automatic Live Availability In-App Notification */}
      {floatingAvailabilityOrder && (
        <div
          role="region"
          aria-label="Live Delivery Availability Notification"
          className="fixed bottom-20 md:bottom-5 right-5 z-40 w-[calc(100vw-2.5rem)] max-w-md bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl shadow-card-lg p-5 space-y-3.5 animate-fade-in"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FF783D] text-[#24152F] flex items-center justify-center shrink-0">
              <BellRing className="w-4 h-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#FF783D]">
                Simulated In-App Notification · Order #{floatingAvailabilityOrder.id}
              </div>
              <div className="font-display text-base font-extrabold text-[#24152F] mt-0.5">
                Your order is out for delivery! Are you available to receive it?
              </div>
              <p className="text-xs text-[#5E5468] mt-0.5">
                Scheduled window:{' '}
                <strong className="text-[#24152F]">
                  {floatingAvailabilityOrder.scheduledWindow}
                </strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={floatingBusyOrderId === floatingAvailabilityOrder.id}
              onClick={async () => {
                setFloatingBusyOrderId(floatingAvailabilityOrder.id);
                try {
                  await handleRespondAvailability(floatingAvailabilityOrder.id, true);
                  setFloatingRescheduleOpenId(null);
                } finally {
                  setFloatingBusyOrderId(null);
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#D9F36A] hover:bg-[#C6E548] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2.2} />
              <span>
                {floatingBusyOrderId === floatingAvailabilityOrder.id
                  ? 'Confirming...'
                  : "I'm Available"}
              </span>
            </button>

            <button
              type="button"
              disabled={floatingBusyOrderId === floatingAvailabilityOrder.id}
              onClick={() =>
                setFloatingRescheduleOpenId((prev) =>
                  prev === floatingAvailabilityOrder.id ? null : floatingAvailabilityOrder.id
                )
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#C83E4D] bg-[#FFFFFF] hover:bg-[#FEE2E2] border-2 border-[#C83E4D] rounded-xl cursor-pointer disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5" strokeWidth={2.2} />
              <span>I&apos;m Not Available</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedProductId(null);
                setConfirmedOrderId(null);
                setCustomerTab('orders');
                setTrackedOrderId(floatingAvailabilityOrder.id);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] cursor-pointer ml-auto"
            >
              <Navigation className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Track Order</span>
            </button>
          </div>

          {floatingRescheduleOpenId === floatingAvailabilityOrder.id && (
            <div className="p-3 rounded-xl bg-[#FFF8F0] border-2 border-[#E6D8CB] space-y-2">
              <div className="text-xs font-extrabold text-[#24152F]">
                Choose a suitable alternative delivery time:
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={floatingRescheduleSlot}
                  onChange={(e) => setFloatingRescheduleSlot(e.target.value)}
                  className="flex-1 px-2.5 py-2 text-xs font-semibold bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl text-[#29232F] focus:outline-none focus:border-[#FF783D]"
                >
                  <option value="Tomorrow · Morning (8am–12pm)">Tomorrow · Morning (8am–12pm)</option>
                  <option value="Tomorrow · Afternoon (12pm–4pm)">
                    Tomorrow · Afternoon (12pm–4pm)
                  </option>
                  <option value="Tomorrow · Evening (4pm–8pm)">Tomorrow · Evening (4pm–8pm)</option>
                  <option value="Sat · Morning (8am–12pm)">Sat · Morning (8am–12pm)</option>
                  <option value="Sun · Afternoon (12pm–4pm)">Sun · Afternoon (12pm–4pm)</option>
                </select>
                <button
                  type="button"
                  disabled={floatingBusyOrderId === floatingAvailabilityOrder.id}
                  onClick={async () => {
                    setFloatingBusyOrderId(floatingAvailabilityOrder.id);
                    try {
                      await handleRespondAvailability(
                        floatingAvailabilityOrder.id,
                        false,
                        floatingRescheduleSlot
                      );
                      setFloatingRescheduleOpenId(null);
                    } finally {
                      setFloatingBusyOrderId(null);
                    }
                  }}
                  className="px-3.5 py-2 text-xs font-extrabold text-[#FFFFFF] bg-[#C83E4D] hover:bg-[#9E2A3B] rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
                >
                  Confirm Reschedule
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toast && !floatingAvailabilityOrder && (
        <div className="fixed bottom-20 md:bottom-5 right-5 z-40 max-w-sm bg-[#24152F] text-[#FFFFFF] px-4 py-3.5 rounded-2xl shadow-card-lg border-2 border-[#FF783D] flex items-center gap-3 text-xs font-bold animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-[#D9F36A] shrink-0" strokeWidth={2.2} />
          <span className="flex-1">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[#BBA5D5] hover:text-[#FFFFFF] cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Modals */}
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        currentUser={currentUser}
        demoUsers={demoUsers}
        onSwitchUser={handleSwitchUser}
      />

      {productModalOpen && (
        <ProductFormModal
          open={productModalOpen}
          onClose={() => {
            setProductModalOpen(false);
            setEditingProduct(null);
          }}
          editingProduct={editingProduct}
          onSave={handleSaveProduct}
        />
      )}

      <SpecComparisonModal
        product={comparisonProduct}
        onClose={() => setComparisonProductId(null)}
        onViewFullProduct={
          currentUser.role === 'customer'
            ? (id) => openProductDetail(id)
            : undefined
        }
        onRunAiAudit={handleRunAiAudit}
      />

      <CameraSearchModal
        open={cameraModalOpen}
        userId={currentUser.id}
        onClose={() => setCameraModalOpen(false)}
        onApplyVisualResults={(result) => {
          setVisualSearch(result);
          setCustomerTab('search');
          setSelectedProductId(null);
        }}
        onSelectProduct={(id) => {
          openProductDetail(id);
        }}
      />
    </div>
  );
}
