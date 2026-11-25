import { useEffect, useState, type FormEvent } from 'react';
import {
  Bell,
  Camera,
  Grid2X2,
  Home,
  Mic,
  MicOff,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react';
import { useVoiceSearch } from '../hooks/useVoiceSearch.ts';
import { VoiceSearchBanner } from './VoiceSearchBanner.tsx';
import type { User, UserRole } from '../types.ts';

export type CustomerTab =
  | 'home'
  | 'categories'
  | 'search'
  | 'deals'
  | 'cart'
  | 'orders'
  | 'notifications'
  | 'profile'
  | 'availability';

export type SellerTab = 'overview' | 'inventory' | 'deals' | 'orders';

interface TopBarProps {
  role: UserRole;
  currentUser: User;
  customerTab: CustomerTab;
  sellerTab: SellerTab;
  onSelectCustomerTab: (tab: CustomerTab) => void;
  onSelectSellerTab: (tab: SellerTab) => void;
  cartCount: number;
  unreadNotificationCount: number;
  searchQuery: string;
  onSearchLiveChange?: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  onOpenCameraSearch: () => void;
  onOpenAddProduct: () => void;
  onQuickRoleToggle: () => void;
}

export function TopBar({
  role,
  currentUser,
  customerTab,
  sellerTab,
  onSelectCustomerTab,
  onSelectSellerTab,
  cartCount,
  unreadNotificationCount,
  searchQuery,
  onSearchLiveChange,
  onSearchSubmit,
  onOpenCameraSearch,
  onOpenAddProduct,
  onQuickRoleToggle,
}: TopBarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const voice = useVoiceSearch({
    onTranscriptUpdate: (text) => {
      setLocalSearch(text);
      onSearchLiveChange?.(text);
    },
    onSearchComplete: (finalText) => {
      setLocalSearch(finalText);
      onSearchSubmit(finalText);
    },
  });

  const customerNav: { id: CustomerTab; label: string; badge?: number }[] = [
    { id: 'home', label: 'Home' },
    { id: 'categories', label: 'Categories' },
    { id: 'search', label: 'Search' },
    { id: 'deals', label: 'Group Orders' },
    { id: 'cart', label: 'Cart', badge: cartCount },
    { id: 'orders', label: 'My Orders' },
    { id: 'notifications', label: 'Notifications', badge: unreadNotificationCount },
    { id: 'profile', label: 'Profile' },
  ];

  const sellerNav: { id: SellerTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'deals', label: 'Group Requests' },
    { id: 'orders', label: 'Orders' },
  ];

  const activeId = role === 'customer' ? customerTab : sellerTab;

  function handleSearchForm(e: FormEvent) {
    e.preventDefault();
    onSearchSubmit(localSearch);
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#24152F] text-[#FFFFFF] border-b-2 border-[#FF783D]">
        {/* Main Header Row */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-5">
          {/* Brand Logo */}
          <button
            type="button"
            onClick={() =>
              role === 'customer' ? onSelectCustomerTab('home') : onSelectSellerTab('overview')
            }
            className="flex items-center gap-2.5 shrink-0 cursor-pointer group"
          >
            <span className="w-9 h-9 rounded-xl bg-[#FF783D] text-[#24152F] font-display font-extrabold text-lg flex items-center justify-center border-2 border-[#D9F36A]">
              CS
            </span>
            <span className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#FFFFFF]">
              Cart<span className="text-[#FF783D]">Sync</span>
            </span>
          </button>

          {/* Prominent Search Bar (Customer Mode) */}
          {role === 'customer' ? (
            <form onSubmit={handleSearchForm} className="hidden md:flex flex-1 max-w-xl relative">
              <Search
                className="w-4 h-4 text-[#24152F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeWidth={2}
              />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => {
                  if (voice.isListening) voice.cancelListening();
                  const nextVal = e.target.value;
                  setLocalSearch(nextVal);
                  onSearchLiveChange?.(nextVal);
                }}
                placeholder="Search electronics, clothes, groceries, specs, or 'under 500'..."
                className="w-full pl-10 pr-32 py-2 text-sm bg-[#FFF8F0] text-[#29232F] placeholder:text-[#5E5468] rounded-xl border-2 border-[#BBA5D5] focus:border-[#FF783D] focus:outline-none"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      if (voice.isListening) voice.cancelListening();
                      setLocalSearch('');
                      if (onSearchLiveChange) {
                        onSearchLiveChange('');
                      } else {
                        onSearchSubmit('');
                      }
                    }}
                    aria-label="Clear search"
                    className="p-1 text-[#5E5468] hover:text-[#24152F] rounded-md cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (voice.isListening ? voice.stopListening() : voice.startListening())}
                  aria-label={voice.isListening ? 'Stop Listening' : 'Search by voice'}
                  title={voice.isListening ? 'Stop Listening' : 'Voice Search'}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    voice.isListening
                      ? 'bg-[#C83E4D] text-[#FFFFFF] animate-pulse'
                      : 'bg-[#BBA5D5] text-[#24152F] hover:bg-[#D9F36A]'
                  }`}
                >
                  {voice.isListening ? (
                    <MicOff className="w-3.5 h-3.5" strokeWidth={2.2} />
                  ) : (
                    <Mic className="w-3.5 h-3.5" strokeWidth={2} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={onOpenCameraSearch}
                  aria-label="Search by camera"
                  title="Visual Camera Search"
                  className="p-1.5 rounded-lg bg-[#BBA5D5] text-[#24152F] hover:bg-[#D9F36A] transition-colors cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded-lg bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] text-xs font-bold cursor-pointer transition-colors"
                >
                  Go
                </button>
              </div>
            </form>
          ) : (
            <div className="hidden md:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#352145] border border-[#BBA5D5] text-xs font-semibold text-[#D9F36A]">
              <span>Seller Operations Center · {currentUser.name}</span>
            </div>
          )}

          {/* Right Utility Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onQuickRoleToggle}
              className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-[#352145] hover:bg-[#492F5E] text-[#BBA5D5] border border-[#BBA5D5] transition-colors cursor-pointer whitespace-nowrap"
            >
              {role === 'customer' ? 'Seller Hub' : 'Customer Store'}
            </button>

            {/* Notifications Bell */}
            <button
              type="button"
              onClick={() =>
                role === 'customer'
                  ? onSelectCustomerTab('notifications')
                  : onSelectSellerTab('deals')
              }
              aria-label={`Notifications (${unreadNotificationCount} unread)`}
              className={`relative p-2.5 rounded-xl border-2 transition-colors cursor-pointer ${
                role === 'customer' && customerTab === 'notifications'
                  ? 'bg-[#FF783D] text-[#24152F] border-[#D9F36A]'
                  : 'bg-[#352145] text-[#FFFFFF] border-[#BBA5D5] hover:border-[#FF783D]'
              }`}
            >
              <Bell className="w-4 h-4" strokeWidth={2} />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 rounded-full bg-[#D9F36A] text-[#24152F] border-2 border-[#24152F] text-[10px] font-mono font-extrabold flex items-center justify-center tabular-nums">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>

            {role === 'customer' ? (
              <>
                {/* Cart Button */}
                <button
                  type="button"
                  onClick={() => onSelectCustomerTab('cart')}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold border-2 transition-colors cursor-pointer whitespace-nowrap ${
                    customerTab === 'cart'
                      ? 'bg-[#D9F36A] text-[#24152F] border-[#FF783D]'
                      : 'bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] border-[#24152F]'
                  }`}
                >
                  <ShoppingCart className="w-4 h-4" strokeWidth={2.2} />
                  <span>Cart</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-[#24152F] text-[#D9F36A] font-mono text-[11px] tabular-nums">
                    {cartCount}
                  </span>
                </button>

                {/* Profile Button */}
                <button
                  type="button"
                  onClick={() => onSelectCustomerTab('profile')}
                  aria-label="Open profile and account settings"
                  className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl border-2 transition-colors cursor-pointer ${
                    customerTab === 'profile'
                      ? 'bg-[#BBA5D5] text-[#24152F] border-[#D9F36A]'
                      : 'bg-[#352145] text-[#FFFFFF] border-[#BBA5D5] hover:border-[#FF783D]'
                  }`}
                >
                  <span className="w-6 h-6 rounded-lg bg-[#D9F36A] text-[#24152F] font-bold text-[11px] flex items-center justify-center">
                    {currentUser.avatarInitials}
                  </span>
                  <span className="hidden lg:inline text-xs font-bold max-w-[90px] truncate">
                    {currentUser.name.split(' ')[0]}
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onOpenAddProduct}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] rounded-xl cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" strokeWidth={2.2} />
                <span>Add Product</span>
              </button>
            )}
          </div>
        </div>

        {role === 'customer' && (voice.isListening || voice.errorMessage) && (
          <div className="hidden md:block max-w-7xl mx-auto px-4 sm:px-6 pb-3">
            <VoiceSearchBanner
              status={voice.status}
              transcript={voice.transcript}
              errorMessage={voice.errorMessage}
              onStopListening={voice.stopListening}
              onDismissError={voice.clearError}
              variant="dark"
            />
          </div>
        )}

        {/* Desktop Complete Navigation Bar */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:block bg-[#FFF8F0] text-[#29232F] border-t border-[#E6D8CB]"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-2 overflow-x-auto">
            <div className="flex items-center gap-1.5 py-2">
              {role === 'customer'
                ? customerNav.map((item) => {
                    const active =
                      activeId === item.id ||
                      (item.id === 'profile' && customerTab === 'availability');
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectCustomerTab(item.id)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-[#24152F] text-[#D9F36A]'
                            : 'text-[#29232F] hover:bg-[#BBA5D5]'
                        }`}
                      >
                        <span>{item.label}</span>
                        {typeof item.badge === 'number' && item.badge > 0 && (
                          <span
                            className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] font-extrabold tabular-nums ${
                              active
                                ? 'bg-[#FF783D] text-[#24152F]'
                                : 'bg-[#FF783D] text-[#24152F]'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })
                : sellerNav.map((item) => {
                    const active = activeId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectSellerTab(item.id)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-[#24152F] text-[#D9F36A]'
                            : 'text-[#29232F] hover:bg-[#BBA5D5]'
                        }`}
                      >
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
            </div>

            <div className="text-[11px] font-semibold text-[#5E5468] whitespace-nowrap shrink-0">
              {role === 'customer'
                ? `Signed in: ${currentUser.name}`
                : 'Seller Mode Active'}
            </div>
          </div>
        </nav>
      </header>

      {/* Mobile Bottom Navigation Bar (Customer Mode, <=15% viewport height) */}
      {role === 'customer' ? (
        <nav
          aria-label="Mobile Navigation"
          className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[#24152F] border-t-2 border-[#FF783D] h-14 px-2 grid grid-cols-5 items-center"
        >
          {(
            [
              { id: 'home', label: 'Home', icon: Home },
              { id: 'categories', label: 'Categories', icon: Grid2X2 },
              { id: 'search', label: 'Search', icon: Search },
              { id: 'deals', label: 'Groups', icon: Users },
              { id: 'orders', label: 'Orders', icon: Package },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = customerTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectCustomerTab(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl text-[10px] font-bold cursor-pointer ${
                  active ? 'text-[#D9F36A]' : 'text-[#BBA5D5]'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-[#FF783D]' : ''}`} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      ) : (
        <nav
          aria-label="Mobile Seller Navigation"
          className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[#24152F] border-t-2 border-[#FF783D] h-14 px-2 grid grid-cols-4 items-center"
        >
          {sellerNav.map((item) => {
            const active = sellerTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSellerTab(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl text-[11px] font-bold cursor-pointer ${
                  active ? 'bg-[#FF783D] text-[#24152F]' : 'text-[#BBA5D5]'
                }`}
              >
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </>
  );
}
