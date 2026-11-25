import { useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Edit3,
  LogOut,
  MapPin,
  Package,
  Plus,
  Save,
  Star,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { formatINR } from '../utils/currency.ts';
import type { NotificationPrefs, Order, SavedAddress, User } from '../types.ts';

interface ProfileViewProps {
  currentUser: User;
  orders: Order[];
  onUpdateProfile: (patch: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    savedAddresses?: SavedAddress[];
    paymentPreference?: string;
    notificationPrefs?: NotificationPrefs;
  }) => Promise<void>;
  onOpenAvailability: () => void;
  onOpenOrders: () => void;
  onTrackOrder: (orderId: string) => void;
  onQuickRoleToggle: () => void;
  onOpenAccountSwitcher: () => void;
  onLogout: () => void;
  onBackHome: () => void;
}

const PAYMENT_PREFS = [
  'Card ending in 4242 (Simulated)',
  'UPI / Instant Pay (Simulated)',
  'Cash on Delivery (Simulated)',
];

export function ProfileView({
  currentUser,
  orders,
  onUpdateProfile,
  onOpenAvailability,
  onOpenOrders,
  onTrackOrder,
  onQuickRoleToggle,
  onOpenAccountSwitcher,
  onLogout,
  onBackHome,
}: ProfileViewProps) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(currentUser.name);
  const [emailDraft, setEmailDraft] = useState(currentUser.email);
  const [phoneDraft, setPhoneDraft] = useState(currentUser.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  // Saved addresses state
  const addresses = currentUser.savedAddresses || [];
  const [addingAddr, setAddingAddr] = useState(false);
  const [addrLabel, setAddrLabel] = useState('Home');
  const [addrLine1, setAddrLine1] = useState('');
  const [addrCityZip, setAddrCityZip] = useState('');
  const [addrPhone, setAddrPhone] = useState(currentUser.phone || '');

  const prefs: NotificationPrefs = currentUser.notificationPrefs || {
    orderUpdates: true,
    groupDeals: true,
    deliveryAlerts: true,
    promotions: false,
  };

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setProfileErr(null);
    setSavingProfile(true);
    try {
      await onUpdateProfile({
        name: nameDraft.trim(),
        email: emailDraft.trim(),
        phone: phoneDraft.trim(),
      });
      setEditingProfile(false);
      setProfileMsg('Profile information saved.');
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAddAddress(e: FormEvent) {
    e.preventDefault();
    if (!addrLine1.trim() || !addrCityZip.trim()) return;
    const nextAddr: SavedAddress = {
      id: `addr_${Date.now()}`,
      label: addrLabel.trim() || 'Address',
      recipientName: currentUser.name,
      line1: addrLine1.trim(),
      cityStateZip: addrCityZip.trim(),
      phone: addrPhone.trim(),
      isDefault: addresses.length === 0,
    };
    const nextList = [...addresses, nextAddr];
    await onUpdateProfile({
      savedAddresses: nextList,
      address: nextAddr.isDefault ? `${nextAddr.line1}, ${nextAddr.cityStateZip}` : currentUser.address,
    });
    setAddingAddr(false);
    setAddrLine1('');
    setAddrCityZip('');
  }

  async function handleSetDefaultAddress(addrId: string) {
    const nextList = addresses.map((a) => ({ ...a, isDefault: a.id === addrId }));
    const chosen = nextList.find((a) => a.id === addrId);
    await onUpdateProfile({
      savedAddresses: nextList,
      address: chosen ? `${chosen.line1}, ${chosen.cityStateZip}` : currentUser.address,
    });
  }

  async function handleDeleteAddress(addrId: string) {
    const remaining = addresses.filter((a) => a.id !== addrId);
    if (remaining.length > 0 && !remaining.some((a) => a.isDefault)) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    const primary = remaining.find((a) => a.isDefault) || remaining[0];
    await onUpdateProfile({
      savedAddresses: remaining,
      address: primary ? `${primary.line1}, ${primary.cityStateZip}` : currentUser.address,
    });
  }

  async function handleToggleNotifPref(key: keyof NotificationPrefs) {
    await onUpdateProfile({
      notificationPrefs: {
        ...prefs,
        [key]: !prefs[key],
      },
    });
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="space-y-3 border-b-2 border-[#E6D8CB] pb-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-[#5E5468]">
          <button type="button" onClick={onBackHome} className="hover:text-[#FF783D] cursor-pointer">
            Home
          </button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#24152F] font-bold">Profile &amp; Account</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="w-14 h-14 rounded-2xl bg-[#24152F] text-[#D9F36A] border-2 border-[#FF783D] font-display text-xl font-extrabold flex items-center justify-center shrink-0">
              {currentUser.avatarInitials}
            </span>
            <div>
              <div className="text-xs font-extrabold uppercase tracking-widest text-[#FF783D]">
                {currentUser.role === 'seller' ? 'Seller Account' : 'Customer Account'}
              </div>
              <h1 className="font-display text-3xl font-extrabold text-[#24152F]">
                {currentUser.name}
              </h1>
              <p className="text-xs font-semibold text-[#5E5468]">{currentUser.email}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onQuickRoleToggle}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#BBA5D5] text-[#24152F] border-2 border-[#24152F] text-xs font-extrabold cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" strokeWidth={2} />
              <span>
                Switch to {currentUser.role === 'customer' ? 'Seller Hub' : 'Customer Store'}
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenAccountSwitcher}
              className="px-4 py-2 rounded-xl bg-[#FFFFFF] text-[#24152F] border-2 border-[#24152F] text-xs font-bold hover:bg-[#FFF8F0] cursor-pointer"
            >
              Switch Account
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#24152F] text-[#FF783D] hover:bg-[#352145] text-xs font-extrabold cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Personal Info & Saved Addresses */}
        <div className="lg:col-span-7 space-y-6">
          {/* Personal Details */}
          <section className="p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
                <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                  Personal Information
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingProfile((v) => !v);
                  setNameDraft(currentUser.name);
                  setEmailDraft(currentUser.email);
                  setPhoneDraft(currentUser.phone || '');
                }}
                className="inline-flex items-center gap-1 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] underline cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{editingProfile ? 'Cancel' : 'Edit Profile'}</span>
              </button>
            </div>

            {profileMsg && (
              <div className="p-3 rounded-xl bg-[#D9F36A] border border-[#24152F] text-xs font-bold text-[#24152F]">
                {profileMsg}
              </div>
            )}
            {profileErr && (
              <div className="p-3 rounded-xl bg-[#C83E4D] text-xs font-bold text-[#FFFFFF]">
                {profileErr}
              </div>
            )}

            {editingProfile ? (
              <form onSubmit={handleSaveProfile} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-extrabold text-[#24152F] mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs font-semibold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold text-[#24152F] mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs font-semibold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-[#24152F] mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    placeholder="+1 (206) 555-0192"
                    className="w-full px-3.5 py-2 text-xs font-semibold bg-[#FFF8F0] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-extrabold bg-[#FF783D] text-[#24152F] border-2 border-[#24152F] rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>{savingProfile ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB]">
                  <span className="text-[#5E5468] block">Name</span>
                  <span className="font-extrabold text-[#24152F] mt-0.5 block">{currentUser.name}</span>
                </div>
                <div className="p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB]">
                  <span className="text-[#5E5468] block">Email</span>
                  <span className="font-extrabold text-[#24152F] mt-0.5 block truncate">
                    {currentUser.email}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB]">
                  <span className="text-[#5E5468] block">Phone</span>
                  <span className="font-extrabold text-[#24152F] mt-0.5 block">
                    {currentUser.phone || 'Not provided'}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* Saved Delivery Addresses */}
          <section className="p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
                <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                  Saved Delivery Addresses
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAddingAddr((v) => !v)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#FF783D] text-[#24152F] border border-[#24152F] text-xs font-extrabold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
                <span>{addingAddr ? 'Cancel' : 'Add Address'}</span>
              </button>
            </div>

            {addingAddr && (
              <form
                onSubmit={handleAddAddress}
                className="p-4 rounded-xl bg-[#FFF8F0] border-2 border-[#E6D8CB] space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    required
                    value={addrLabel}
                    onChange={(e) => setAddrLabel(e.target.value)}
                    placeholder="Label (Home / Office)"
                    className="px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl"
                  />
                  <input
                    type="text"
                    required
                    value={addrLine1}
                    onChange={(e) => setAddrLine1(e.target.value)}
                    placeholder="Street Address & Apt"
                    className="px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl sm:col-span-2"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    required
                    value={addrCityZip}
                    onChange={(e) => setAddrCityZip(e.target.value)}
                    placeholder="City, State & ZIP"
                    className="px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl"
                  />
                  <input
                    type="text"
                    value={addrPhone}
                    onChange={(e) => setAddrPhone(e.target.value)}
                    placeholder="Contact phone (optional)"
                    className="px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-extrabold bg-[#24152F] text-[#D9F36A] rounded-xl cursor-pointer"
                  >
                    Save Delivery Address
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-3">
              {addresses.map((addr) => (
                <div
                  key={addr.id}
                  className={`p-4 rounded-xl border-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    addr.isDefault
                      ? 'bg-[#FFF8F0] border-[#24152F]'
                      : 'bg-[#FFFFFF] border-[#E6D8CB]'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-[#24152F]">{addr.label}</span>
                      {addr.isDefault && (
                        <span className="px-2 py-0.5 rounded-md bg-[#D9F36A] border border-[#24152F] text-[10px] font-extrabold text-[#24152F]">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-[#29232F] mt-0.5">
                      {addr.line1}, {addr.cityStateZip}
                    </div>
                    {addr.phone && (
                      <div className="text-[11px] text-[#5E5468] mt-0.5">Phone: {addr.phone}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!addr.isDefault && (
                      <button
                        type="button"
                        onClick={() => handleSetDefaultAddress(addr.id)}
                        className="px-3 py-1.5 rounded-lg bg-[#BBA5D5] text-[#24152F] text-[11px] font-extrabold cursor-pointer"
                      >
                        Set Default
                      </button>
                    )}
                    {addresses.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteAddress(addr.id)}
                        aria-label={`Delete ${addr.label} address`}
                        className="p-1.5 text-[#5E5468] hover:text-[#C83E4D] cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Order History Summary */}
          <section className="p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
                <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                  Recent Order History ({orders.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={onOpenOrders}
                className="text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] underline cursor-pointer"
              >
                View All Orders
              </button>
            </div>

            {orders.length === 0 ? (
              <p className="text-xs text-[#5E5468]">No orders placed yet.</p>
            ) : (
              <div className="divide-y divide-[#E6D8CB] border border-[#E6D8CB] rounded-xl overflow-hidden">
                {orders.slice(0, 4).map((o) => (
                  <div
                    key={o.id}
                    className="p-3.5 bg-[#FFF8F0] flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-mono font-extrabold text-[#24152F]">Order #{o.id}</div>
                      <div className="text-[#5E5468]">
                        {o.items.map((i) => i.productName).join(', ')} · {o.fulfillmentStatus}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono font-extrabold text-[#24152F]">
                        {formatINR(o.totalAmount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onTrackOrder(o.id)}
                        className="px-3 py-1 rounded-lg bg-[#24152F] text-[#D9F36A] text-[11px] font-bold cursor-pointer"
                      >
                        Track
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Availability, Payment Preferences, Notification Preferences */}
        <div className="lg:col-span-5 space-y-6">
          {/* Delivery Availability Schedule Shortcut */}
          <section className="p-6 rounded-2xl bg-[#24152F] text-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
            <div className="flex items-center gap-2.5">
              <CalendarClock className="w-5 h-5 text-[#D9F36A]" strokeWidth={2} />
              <h2 className="font-display text-lg font-extrabold">
                Weekly Delivery Availability
              </h2>
            </div>
            <p className="text-xs text-[#BBA5D5] leading-relaxed">
              Manage your 7×3 weekly time slots so CartSync automatically schedules combined deliveries when you are home.
            </p>
            <button
              type="button"
              onClick={onOpenAvailability}
              className="w-full py-2.5 px-4 rounded-xl bg-[#D9F36A] hover:bg-[#cce856] text-[#24152F] text-xs font-extrabold cursor-pointer"
            >
              Configure Availability Grid
            </button>
          </section>

          {/* Payment Preferences */}
          <section className="p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
                <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                  Payment Preference
                </h2>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#FFF8F0] border border-[#24152F] text-[10px] font-extrabold text-[#24152F]">
                Simulated
              </span>
            </div>

            <div className="space-y-2">
              {PAYMENT_PREFS.map((method) => {
                const active = (currentUser.paymentPreference || PAYMENT_PREFS[0]) === method;
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => onUpdateProfile({ paymentPreference: method })}
                    className={`w-full p-3 rounded-xl border-2 text-left text-xs font-bold flex items-center justify-between cursor-pointer ${
                      active
                        ? 'bg-[#24152F] text-[#D9F36A] border-[#FF783D]'
                        : 'bg-[#FFF8F0] text-[#24152F] border-[#E6D8CB] hover:border-[#24152F]'
                    }`}
                  >
                    <span>{method}</span>
                    {active && <CheckCircle2 className="w-4 h-4 text-[#D9F36A]" strokeWidth={2.2} />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Notification Preferences */}
          <section className="p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-4">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#FF783D]" strokeWidth={2.2} />
              <h2 className="font-display text-lg font-extrabold text-[#24152F]">
                Notification Preferences
              </h2>
            </div>

            <div className="space-y-2.5 text-xs">
              {(
                [
                  { key: 'orderUpdates', label: 'Order Confirmations & Status Changes' },
                  { key: 'groupDeals', label: 'Group Pool Milestones & Seller Approvals' },
                  { key: 'deliveryAlerts', label: 'Out-for-Delivery Availability Prompts' },
                  { key: 'promotions', label: 'New Department Drops & Special Discounts' },
                ] as const
              ).map((item) => {
                const enabled = prefs[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleToggleNotifPref(item.key)}
                    className="w-full p-3 rounded-xl bg-[#FFF8F0] border border-[#E6D8CB] hover:border-[#24152F] flex items-center justify-between gap-3 cursor-pointer"
                  >
                    <span className="font-bold text-[#24152F] text-left">{item.label}</span>
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold shrink-0 ${
                        enabled
                          ? 'bg-[#D9F36A] border border-[#24152F] text-[#24152F]'
                          : 'bg-[#E6D8CB] text-[#5E5468]'
                      }`}
                    >
                      {enabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
