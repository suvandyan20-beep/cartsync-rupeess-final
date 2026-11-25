import { useEffect, useState, type FormEvent } from 'react';
import {
  Minus,
  Plus,
  Trash2,
  PackageCheck,
  Truck,
  CalendarClock,
  CreditCard,
  CalendarRange,
  CheckCircle2,
  MapPin,
  ShoppingBag,
  ArrowRight,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { ProductImage } from './ProductImage.tsx';
import { formatINR, INDIVIDUAL_DELIVERY_FEE_INR } from '../utils/currency.ts';
import type { CartItem, Order, SavedAddress, User } from '../types.ts';

interface CartViewProps {
  currentUser: User;
  items: CartItem[];
  onUpdateQty: (productId: string, qty: number) => void;
  onRemoveItem: (productId: string) => void;
  recommendedWindow: string;
  openConfirmedOrders: Order[];
  onOpenAvailability: () => void;
  onSelectProduct: (productId: string) => void;
  onContinueShopping: () => void;
  onSaveAddress: (addresses: SavedAddress[], primaryAddress: string) => Promise<void>;
  onPlaceOrder: (payload: {
    deliveryMode: 'combined' | 'express_separate';
    deliveryScheduleChoice: 'same_day' | 'as_shown';
    combineWithOrderId: string | null;
    shippingAddress: string;
    paymentMethod: string;
    paymentMode: 'pay_now' | 'pay_later';
  }) => Promise<void>;
}

const DELIVERY_METHOD_STORAGE_KEY = 'cartsync_delivery_method';

const PAYMENT_OPTIONS = [
  {
    id: 'Card ending in 4242 (Simulated)',
    title: 'Credit / Debit Card · •••• 4242',
    subtitle: 'Simulated checkout card authorization',
  },
  {
    id: 'UPI / Instant Pay (Simulated)',
    title: 'Instant Wallet / UPI Pay',
    subtitle: 'Simulated instant wallet settlement',
  },
  {
    id: 'Cash on Delivery (Simulated)',
    title: 'Cash on Delivery',
    subtitle: 'Simulated pay-at-doorstep with PIN handover',
  },
];

export function CartView({
  currentUser,
  items,
  onUpdateQty,
  onRemoveItem,
  recommendedWindow,
  openConfirmedOrders,
  onOpenAvailability,
  onSelectProduct,
  onContinueShopping,
  onSaveAddress,
  onPlaceOrder,
}: CartViewProps) {
  const [deliveryMode, setDeliveryMode] = useState<'combined' | 'express_separate'>(() => {
    try {
      const saved = window.localStorage.getItem(DELIVERY_METHOD_STORAGE_KEY);
      return saved === 'express_separate' ? 'express_separate' : 'combined';
    } catch {
      return 'combined';
    }
  });
  const [combineWithOrderId, setCombineWithOrderId] = useState<string | null>(
    openConfirmedOrders[0]?.id ?? null
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(
    currentUser.paymentPreference || PAYMENT_OPTIONS[0].id
  );
  const [paymentMode, setPaymentMode] = useState<'pay_now' | 'pay_later'>('pay_now');

  const savedAddresses = currentUser.savedAddresses || [];
  const defaultAddrObj =
    savedAddresses.find((a) => a.isDefault) || savedAddresses[0] || null;
  const [selectedAddressId, setSelectedAddressId] = useState<string>(
    defaultAddrObj?.id || '__primary__'
  );
  const [addingAddress, setAddingAddress] = useState(false);
  const [newLabel, setNewLabel] = useState('Home');
  const [newLine1, setNewLine1] = useState('');
  const [newCityZip, setNewCityZip] = useState('');

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasGroupDealItems = items.some((i) => Boolean(i.dealId));

  useEffect(() => {
    try {
      window.localStorage.setItem(DELIVERY_METHOD_STORAGE_KEY, deliveryMode);
    } catch {
      // ignore storage errors
    }
  }, [deliveryMode]);

  const activeAddressText = (() => {
    if (selectedAddressId === '__primary__') {
      return currentUser.address || '';
    }
    const found = savedAddresses.find((a) => a.id === selectedAddressId);
    return found ? `${found.line1}, ${found.cityStateZip}` : currentUser.address || '';
  })();

  const subtotal = items.reduce((sum, i) => sum + i.discountedUnitPrice * i.quantity, 0);
  const retailTotal = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  const groupSavings = Math.max(0, retailTotal - subtotal);

  const distinctDates = Array.from(new Set(items.map((i) => i.product.estimatedDeliveryDate)));
  const hasDifferentDeliveryDates = items.length >= 2 && distinctDates.length > 1;
  const latestItem = items.reduce<CartItem | null>((latest, curr) => {
    if (!latest) return curr;
    return curr.product.deliveryDays > latest.product.deliveryDays ? curr : latest;
  }, null);
  const latestDeliveryDate = latestItem?.product.estimatedDeliveryDate || recommendedWindow;

  const scheduleChoice: 'same_day' | 'as_shown' =
    deliveryMode === 'combined' ? 'same_day' : 'as_shown';
  const uniqueSellers = Math.max(1, new Set(items.map((i) => i.product.sellerId)).size);
  const separateShipmentsCount = Math.max(1, distinctDates.length, uniqueSellers);
  const shippingFee = deliveryMode === 'combined' ? 0 : INDIVIDUAL_DELIVERY_FEE_INR * separateShipmentsCount;
  const grandTotal = subtotal + shippingFee;

  const selectedCombineOrder = openConfirmedOrders.find((o) => o.id === combineWithOrderId) || null;
  const activeDeliveryWindow =
    deliveryMode === 'combined' && selectedCombineOrder
      ? selectedCombineOrder.scheduledWindow
      : hasDifferentDeliveryDates
        ? scheduleChoice === 'same_day'
          ? `${latestDeliveryDate} · Synced (${recommendedWindow.split('·')[1]?.trim() || 'Preferred slot'})`
          : `Split across ${distinctDates.join(' & ')}`
        : recommendedWindow;

  async function handleAddAddressSubmit(e: FormEvent) {
    e.preventDefault();
    if (!newLine1.trim() || !newCityZip.trim()) return;
    const newAddr: SavedAddress = {
      id: `addr_${Date.now()}`,
      label: newLabel.trim() || 'Address',
      recipientName: currentUser.name,
      line1: newLine1.trim(),
      cityStateZip: newCityZip.trim(),
      phone: currentUser.phone,
      isDefault: savedAddresses.length === 0,
    };
    const nextList = [...savedAddresses, newAddr];
    await onSaveAddress(nextList, `${newAddr.line1}, ${newAddr.cityStateZip}`);
    setSelectedAddressId(newAddr.id);
    setAddingAddress(false);
    setNewLine1('');
    setNewCityZip('');
  }

  async function handleCheckout() {
    setError(null);
    if (items.length === 0) {
      setError('Your cart is empty.');
      return;
    }
    if (!activeAddressText.trim()) {
      setError('Please select or add a delivery address before placing your order.');
      return;
    }
    if (!paymentMethod.trim()) {
      setError('Please select a payment method.');
      return;
    }
    for (const item of items) {
      if (item.quantity > item.product.stock) {
        setError(`Only ${item.product.stock} units left for ${item.product.name}.`);
        return;
      }
    }

    setPlacing(true);
    try {
      await onPlaceOrder({
        deliveryMode,
        deliveryScheduleChoice: scheduleChoice,
        combineWithOrderId: deliveryMode === 'combined' ? combineWithOrderId : null,
        shippingAddress: activeAddressText.trim(),
        paymentMethod,
        paymentMode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete checkout.');
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="space-y-3 border-b-2 border-[#E6D8CB] pb-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-[#5E5468]">
          <button type="button" onClick={onContinueShopping} className="hover:text-[#FF783D] cursor-pointer">
            Home
          </button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#24152F] font-bold">Cart & Checkout</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-[#FF783D]">
              Checkout & Delivery Planner
            </div>
            <h1 className="font-display text-3xl font-extrabold text-[#24152F]">
              Your Shopping Cart ({items.reduce((s, i) => s + i.quantity, 0)})
            </h1>
          </div>
          <button
            type="button"
            onClick={onContinueShopping}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FFFFFF] border-2 border-[#24152F] text-xs font-bold text-[#24152F] hover:bg-[#BBA5D5] cursor-pointer self-start"
          >
            <span>Continue Shopping</span>
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-14 text-center rounded-2xl bg-[#FFFFFF] border-2 border-[#E6D8CB] space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-[#FFF8F0] border-2 border-[#24152F] mx-auto flex items-center justify-center">
            <ShoppingBag className="w-6 h-6 text-[#FF783D]" strokeWidth={2} />
          </div>
          <div className="space-y-1">
            <h2 className="font-display text-xl font-extrabold text-[#24152F]">
              Your CartSync bag is empty
            </h2>
            <p className="text-sm text-[#5E5468] max-w-md mx-auto">
              Add items from Home, Search, or join a Collaborative Group Order to unlock pool discounts and free combined delivery.
            </p>
          </div>
          <button
            type="button"
            onClick={onContinueShopping}
            className="px-6 py-3 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] border-2 border-[#24152F] text-xs font-extrabold cursor-pointer"
          >
            Explore Products
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
          {/* Left Column: Items, Delivery Address, Delivery Method */}
          <div className="lg:col-span-7 space-y-6">
            {/* Cart Items */}
            <section className="border-2 border-[#24152F] rounded-2xl overflow-hidden bg-[#FFFFFF] shadow-card divide-y divide-[#E6D8CB]">
              {items.map((item) => {
                const hasDiscount = item.discountedUnitPrice < item.product.price;
                return (
                  <div key={item.product.id} className="p-5 flex flex-col sm:flex-row gap-4">
                    <button
                      type="button"
                      onClick={() => onSelectProduct(item.product.id)}
                      className="shrink-0 cursor-pointer"
                    >
                      <ProductImage
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        className="w-24 h-20 rounded-xl border-2 border-[#E6D8CB]"
                      />
                    </button>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <button
                            type="button"
                            onClick={() => onSelectProduct(item.product.id)}
                            className="font-display text-base font-extrabold text-[#24152F] hover:text-[#FF783D] text-left cursor-pointer"
                          >
                            {item.product.name}
                          </button>
                          <p className="text-xs text-[#5E5468] font-medium">
                            {item.product.sellerName} · Est. {item.product.estimatedDeliveryDate} ({item.product.deliveryDays}d)
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.product.id)}
                          aria-label={`Remove ${item.product.name}`}
                          className="p-1.5 text-[#5E5468] hover:text-[#C83E4D] rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={2} />
                        </button>
                      </div>

                      {item.autoAddedReason && (
                        <span className="inline-block px-2.5 py-0.5 rounded-md bg-[#D9F36A] border border-[#24152F] text-[#24152F] text-[11px] font-bold">
                          {item.autoAddedReason}
                        </span>
                      )}

                      <div className="flex items-center justify-between gap-4 pt-1">
                        <div className="inline-flex items-center bg-[#FFF8F0] border-2 border-[#24152F] rounded-xl">
                          <button
                            type="button"
                            onClick={() => onUpdateQty(item.product.id, Math.max(1, item.quantity - 1))}
                            aria-label="Decrease quantity"
                            className="p-1.5 text-[#24152F] hover:bg-[#BBA5D5] rounded-l-lg cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>
                          <span className="px-3.5 text-xs font-mono font-extrabold text-[#24152F] tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateQty(item.product.id, Math.min(item.product.stock, item.quantity + 1))
                            }
                            aria-label="Increase quantity"
                            className="p-1.5 text-[#24152F] hover:bg-[#BBA5D5] rounded-r-lg cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>
                        </div>

                        <div className="text-right">
                          <span className="text-base font-mono font-extrabold tabular-nums text-[#24152F]">
                            {formatINR(item.discountedUnitPrice * item.quantity)}
                          </span>
                          {hasDiscount && (
                            <span className="ml-2 text-xs font-mono tabular-nums text-[#5E5468] line-through">
                              {formatINR(item.product.price * item.quantity)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>

            {/* Step 1: Delivery Address */}
            <section className="p-5 sm:p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
                  <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                    1. Delivery Address
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setAddingAddress((v) => !v)}
                  className="text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] underline cursor-pointer"
                >
                  {addingAddress ? 'Cancel' : '+ Add New Address'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {savedAddresses.length > 0 ? (
                  savedAddresses.map((addr) => {
                    const active = selectedAddressId === addr.id;
                    return (
                      <button
                        key={addr.id}
                        type="button"
                        onClick={() => setSelectedAddressId(addr.id)}
                        className={`p-3.5 rounded-xl border-2 text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#24152F] text-[#FFFFFF] border-[#FF783D]'
                            : 'bg-[#FFF8F0] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-extrabold">{addr.label}</span>
                          {addr.isDefault && (
                            <span className="px-2 py-0.5 rounded-md bg-[#D9F36A] text-[#24152F] text-[10px] font-extrabold">
                              Default
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-xs mt-1 font-medium ${
                            active ? 'text-[#BBA5D5]' : 'text-[#5E5468]'
                          }`}
                        >
                          {addr.line1}, {addr.cityStateZip}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedAddressId('__primary__')}
                    className="p-3.5 rounded-xl border-2 text-left bg-[#24152F] text-[#FFFFFF] border-[#FF783D] sm:col-span-2"
                  >
                    <div className="text-xs font-extrabold">Primary Address</div>
                    <div className="text-xs text-[#BBA5D5] mt-1">{currentUser.address}</div>
                  </button>
                )}
              </div>

              {addingAddress && (
                <form
                  onSubmit={handleAddAddressSubmit}
                  className="p-4 rounded-xl bg-[#FFF8F0] border-2 border-[#E6D8CB] space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="Label (Home / Office)"
                      className="px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl"
                    />
                    <input
                      type="text"
                      required
                      value={newLine1}
                      onChange={(e) => setNewLine1(e.target.value)}
                      placeholder="Street & Apt (e.g. 418 Pine St, Apt 4B)"
                      className="px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl sm:col-span-2"
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="text"
                      required
                      value={newCityZip}
                      onChange={(e) => setNewCityZip(e.target.value)}
                      placeholder="City, State & ZIP (e.g. Seattle, WA 98101)"
                      className="flex-1 px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-extrabold bg-[#FF783D] text-[#24152F] border-2 border-[#24152F] rounded-xl cursor-pointer"
                    >
                      Save & Use Address
                    </button>
                  </div>
                </form>
              )}
            </section>

            {/* Step 2: Delivery Method Selection Cards */}
            <section className="p-5 sm:p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                  2. Select Delivery Method
                </h2>
                <span className="px-2.5 py-0.5 rounded-md bg-[#BBA5D5] text-[#24152F] text-[10px] font-extrabold uppercase">
                  Required
                </span>
              </div>

              {hasDifferentDeliveryDates && (
                <div className="p-3.5 rounded-xl bg-[#FFF8F0] border-2 border-[#FF783D] flex items-start gap-2.5 text-xs">
                  <CalendarRange className="w-4 h-4 text-[#FF783D] shrink-0 mt-0.5" strokeWidth={2} />
                  <div>
                    <span className="font-extrabold text-[#24152F] block">
                      Multiple delivery dates detected ({distinctDates.join(' · ')})
                    </span>
                    <span className="text-[#5E5468]">
                      Choose Combined Delivery to synchronize all items on {latestDeliveryDate}, or Normal Delivery to dispatch each parcel separately.
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" role="radiogroup">
                <button
                  type="button"
                  role="radio"
                  aria-checked={deliveryMode === 'combined'}
                  onClick={() => setDeliveryMode('combined')}
                  className={`p-4 rounded-2xl border-2 text-left flex flex-col justify-between gap-3 transition-all cursor-pointer ${
                    deliveryMode === 'combined'
                      ? 'bg-[#24152F] text-[#FFFFFF] border-[#FF783D]'
                      : 'bg-[#FFF8F0] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        deliveryMode === 'combined'
                          ? 'bg-[#D9F36A] text-[#24152F]'
                          : 'bg-[#24152F] text-[#D9F36A]'
                      }`}
                    >
                      <PackageCheck className="w-5 h-5" strokeWidth={2} />
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold ${
                        deliveryMode === 'combined'
                          ? 'bg-[#D9F36A] text-[#24152F]'
                          : 'bg-[#FFFFFF] border border-[#24152F] text-[#24152F]'
                      }`}
                    >
                      {deliveryMode === 'combined' ? 'Selected · Free' : 'Free · ₹0'}
                    </span>
                  </div>
                  <div>
                    <div className="font-display text-base font-extrabold">Combined Delivery</div>
                    <p
                      className={`text-xs mt-1 leading-relaxed ${
                        deliveryMode === 'combined' ? 'text-[#BBA5D5]' : 'text-[#5E5468]'
                      }`}
                    >
                      Bundle all items into one consolidated eco drop matched to your availability slots.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={deliveryMode === 'express_separate'}
                  onClick={() => setDeliveryMode('express_separate')}
                  className={`p-4 rounded-2xl border-2 text-left flex flex-col justify-between gap-3 transition-all cursor-pointer ${
                    deliveryMode === 'express_separate'
                      ? 'bg-[#24152F] text-[#FFFFFF] border-[#FF783D]'
                      : 'bg-[#FFF8F0] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        deliveryMode === 'express_separate'
                          ? 'bg-[#FF783D] text-[#24152F]'
                          : 'bg-[#24152F] text-[#FF783D]'
                      }`}
                    >
                      <Truck className="w-5 h-5" strokeWidth={2} />
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-extrabold ${
                        deliveryMode === 'express_separate'
                          ? 'bg-[#FF783D] text-[#24152F]'
                          : 'bg-[#FFFFFF] border border-[#24152F] text-[#24152F]'
                      }`}
                    >
                      {formatINR(INDIVIDUAL_DELIVERY_FEE_INR * separateShipmentsCount)}
                    </span>
                  </div>
                  <div>
                    <div className="font-display text-base font-extrabold">Normal Delivery</div>
                    <p
                      className={`text-xs mt-1 leading-relaxed ${
                        deliveryMode === 'express_separate' ? 'text-[#BBA5D5]' : 'text-[#5E5468]'
                      }`}
                    >
                      Ship each item individually across {separateShipmentsCount}{' '}
                      {separateShipmentsCount === 1 ? 'parcel' : 'parcels'} as soon as packed.
                    </p>
                  </div>
                </button>
              </div>

              {deliveryMode === 'combined' && openConfirmedOrders.length > 0 && (
                <div className="p-3.5 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB] space-y-1.5">
                  <label className="block text-xs font-extrabold text-[#24152F]">
                    Merge with an existing confirmed order?
                  </label>
                  <select
                    value={combineWithOrderId || ''}
                    onChange={(e) => setCombineWithOrderId(e.target.value || null)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl text-[#24152F]"
                  >
                    <option value="">Ship as a new combined parcel batch</option>
                    {openConfirmedOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        Merge with #{o.id} · {o.scheduledWindow}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <CalendarClock className="w-4 h-4 text-[#FF783D] shrink-0" strokeWidth={2} />
                  <div className="text-xs">
                    <span className="text-[#5E5468] block">Assigned Delivery Window</span>
                    <span className="font-extrabold text-[#24152F]">{activeDeliveryWindow}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenAvailability}
                  className="text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] underline cursor-pointer shrink-0"
                >
                  Edit Slots
                </button>
              </div>
            </section>
          </div>

          {/* Right Column: Payment Method & Complete Order Summary */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-32">
            {/* Step 3: Payment Method */}
            <section className="p-5 sm:p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
                  <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                    3. Payment Method
                  </h2>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#FFF8F0] border border-[#24152F] text-[10px] font-extrabold text-[#24152F]">
                  Simulated
                </span>
              </div>

              <div className="space-y-2.5">
                {PAYMENT_OPTIONS.map((opt) => {
                  const selected = paymentMethod === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPaymentMethod(opt.id)}
                      className={`w-full p-3.5 rounded-xl border-2 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#24152F] text-[#FFFFFF] border-[#FF783D]'
                          : 'bg-[#FFF8F0] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-extrabold">{opt.title}</div>
                        <div
                          className={`text-[11px] ${
                            selected ? 'text-[#BBA5D5]' : 'text-[#5E5468]'
                          }`}
                        >
                          {opt.subtitle}
                        </div>
                      </div>
                      {selected && (
                        <CheckCircle2 className="w-4 h-4 text-[#D9F36A] shrink-0" strokeWidth={2.2} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Payment Timing: Pay Now vs Place Order (Pay Later) */}
              <div className="pt-3 border-t border-[#E6D8CB] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-[#24152F]">
                    Payment Confirmation Timing
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Payment Timing">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={paymentMode === 'pay_now'}
                    onClick={() => setPaymentMode('pay_now')}
                    className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-colors ${
                      paymentMode === 'pay_now'
                        ? 'bg-[#D9F36A] text-[#24152F] border-[#24152F]'
                        : 'bg-[#FFF8F0] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
                    }`}
                  >
                    <div className="text-xs font-extrabold">Pay Now</div>
                    <div className="text-[11px] font-medium mt-0.5">
                      Immediate simulated settlement.
                    </div>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={paymentMode === 'pay_later'}
                    onClick={() => setPaymentMode('pay_later')}
                    className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-colors ${
                      paymentMode === 'pay_later'
                        ? 'bg-[#BBA5D5] text-[#24152F] border-[#24152F]'
                        : 'bg-[#FFF8F0] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
                    }`}
                  >
                    <div className="text-xs font-extrabold">Place Order · Pay Later</div>
                    <div className="text-[11px] font-medium mt-0.5">
                      Reserve stock now, complete payment in My Orders.
                    </div>
                  </button>
                </div>

                {hasGroupDealItems && (
                  <p className="text-[11px] font-semibold text-[#5E5468]">
                    Approved group items settle at their seller-guaranteed group price.
                  </p>
                )}
              </div>
            </section>

            {/* Complete Order Summary */}
            <section className="p-6 rounded-2xl bg-[#24152F] text-[#FFFFFF] border-2 border-[#24152F] shadow-card-lg space-y-5">
              <h2 className="font-display text-xl font-extrabold text-[#FFFFFF]">
                Order Summary
              </h2>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-[#BBA5D5]">
                  <span>Retail Value</span>
                  <span className="font-mono tabular-nums text-[#FFFFFF]">
                    {formatINR(retailTotal)}
                  </span>
                </div>
                {groupSavings > 0 && (
                  <div className="flex justify-between text-[#D9F36A] font-bold">
                    <span>Group Discount Savings</span>
                    <span className="font-mono tabular-nums">-{formatINR(groupSavings)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[#BBA5D5]">
                  <span>
                    Delivery ({deliveryMode === 'combined' ? 'Combined' : 'Normal'})
                  </span>
                  <span className="font-mono tabular-nums text-[#FFFFFF]">
                    {shippingFee === 0 ? 'FREE (₹0)' : formatINR(shippingFee)}
                  </span>
                </div>
                <div className="pt-3 border-t border-[#352145] flex justify-between items-baseline">
                  <span className="font-display text-base font-extrabold">Total (Simulated)</span>
                  <span className="font-mono text-2xl font-extrabold text-[#D9F36A] tabular-nums">
                    {formatINR(grandTotal)}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#352145] border border-[#BBA5D5] text-[11px] space-y-1">
                <div>
                  <span className="text-[#BBA5D5]">Ship to: </span>
                  <strong className="text-[#FFFFFF]">{activeAddressText || 'No address selected'}</strong>
                </div>
                <div>
                  <span className="text-[#BBA5D5]">Payment: </span>
                  <strong className="text-[#FFFFFF]">{paymentMethod}</strong>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-[#C83E4D] text-[#FFFFFF] text-xs font-bold">
                  {error}
                </div>
              )}

              <button
                type="button"
                disabled={placing}
                onClick={handleCheckout}
                className="w-full inline-flex items-center justify-center gap-2 py-4 px-5 text-sm font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] rounded-xl cursor-pointer disabled:opacity-50 transition-colors"
              >
                <ShieldCheck className="w-4 h-4" strokeWidth={2.2} />
                <span>
                  {placing
                    ? 'Processing Order...'
                    : paymentMode === 'pay_later'
                      ? `Place Unpaid Order · ${formatINR(grandTotal)}`
                      : `Pay & Confirm Order · ${formatINR(grandTotal)}`}
                </span>
              </button>

              <p className="text-[11px] text-[#BBA5D5] text-center">
                Payments & live courier tracking are simulated for demonstration.
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
