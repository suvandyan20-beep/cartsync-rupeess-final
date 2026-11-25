import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Award,
  Backpack,
  Camera,
  Clock,
  Crown,
  Cpu,
  Flame,
  Footprints,
  Home as HomeIcon,
  Laptop,
  PackageCheck,
  Search,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Tag,
  Users,
  Utensils,
  Watch,
} from 'lucide-react';
import { ProductCard } from './ProductCard.tsx';
import { ProductImage } from './ProductImage.tsx';
import { formatINR } from '../utils/currency.ts';
import type { Product } from '../types.ts';

interface HomeViewProps {
  products: Product[];
  recentlyViewedProducts: Product[];
  wishlistIds: string[];
  onToggleWishlist: (productId: string) => void;
  onSelectProduct: (productId: string) => void;
  onCompareProduct: (productId: string) => void;
  onAddToCart: (product: Product, useGroupPrice: boolean, quantity?: number) => void;
  onSearchSubmit: (query: string) => void;
  onOpenCategory: (category: string) => void;
  onOpenGroupOrders: () => void;
  onOpenCameraSearch: () => void;
}

export const CATEGORY_META: {
  name: string;
  tagline: string;
  icon: typeof Footprints;
}[] = [
  { name: 'Electronics', tagline: 'Earphones, speakers, power banks & mice', icon: Cpu },
  { name: 'Mobiles', tagline: 'Everyday 5G & compact smartphones', icon: Smartphone },
  { name: 'Laptops', tagline: 'Student & everyday office laptops', icon: Laptop },
  { name: 'Backpacks', tagline: 'Everyday commuter & travel packs', icon: Backpack },
  { name: 'Clothing', tagline: 'Cotton tees, casual shirts & jeans', icon: Shirt },
  { name: 'Shoes', tagline: 'Daily knit & walking footwear', icon: Footprints },
  { name: 'Hats', tagline: 'Cotton caps & everyday headwear', icon: Crown },
  { name: 'Accessories', tagline: 'Totes & polarized sunglasses', icon: Watch },
  { name: 'Kitchen', tagline: 'Bottles, containers & cookware', icon: Utensils },
  { name: 'Home', tagline: 'Study chairs & home essentials', icon: HomeIcon },
  { name: 'Beauty & Care', tagline: 'Face wash, sunscreen & daily care', icon: Sparkles },
  { name: 'Grocery', tagline: 'Basmati rice & household cleaners', icon: ShoppingBasket },
];

export function HomeView({
  products,
  recentlyViewedProducts,
  wishlistIds,
  onToggleWishlist,
  onSelectProduct,
  onCompareProduct,
  onAddToCart,
  onSearchSubmit,
  onOpenCategory,
  onOpenGroupOrders,
  onOpenCameraSearch,
}: HomeViewProps) {
  const [heroSearch, setHeroSearch] = useState('');

  // Special Offers & Active Group Discounts
  const specialOffers = products
    .filter(
      (p) =>
        p.activeDeal &&
        p.activeDeal.stageLabel !== 'Expired' &&
        p.activeDeal.stageLabel !== 'Rejected' &&
        p.activeDeal.status !== 'dissolved' &&
        p.activeDeal.status !== 'completed'
    )
    .sort((a, b) => (b.activeDeal?.discountPercent || 0) - (a.activeDeal?.discountPercent || 0))
    .slice(0, 3);

  // Trending Now: highest pool momentum & active interest
  const trendingProducts = [...products]
    .sort((a, b) => {
      const aScore = (a.activeDeal?.paidCount || 0) * 3 + a.reviewCount;
      const bScore = (b.activeDeal?.paidCount || 0) * 3 + b.reviewCount;
      return bScore - aScore;
    })
    .slice(0, 3);

  // Best-Selling: derived from review volume and high sell-through (lower remaining stock)
  const bestSellingProducts = [...products]
    .filter((p) => p.stock > 0)
    .sort((a, b) => {
      const aScore = a.reviewCount * 2 + Math.max(0, 50 - a.stock);
      const bScore = b.reviewCount * 2 + Math.max(0, 50 - b.stock);
      return bScore - aScore;
    })
    .slice(0, 3);

  // Recommended: highest AI-verified trust rating
  const recommendedProducts = [...products]
    .sort(
      (a, b) =>
        (b.insights?.verifiedAvgRating || 0) - (a.insights?.verifiedAvgRating || 0) ||
        b.reviewCount - a.reviewCount
    )
    .slice(0, 3);

  const spotlightProducts = specialOffers.length > 0 ? specialOffers : products.slice(0, 3);

  function handleHeroSearchSubmit(e: FormEvent) {
    e.preventDefault();
    onSearchSubmit(heroSearch);
  }

  return (
    <div className="space-y-12 animate-fade-in">
      {/* Large Promotional Banner */}
      <section className="rounded-3xl bg-[#24152F] text-[#FFFFFF] border-2 border-[#24152F] overflow-hidden shadow-card-lg">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 p-6 sm:p-10 items-center">
          <div className="lg:col-span-7 space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[#D9F36A] text-[#24152F] text-xs font-extrabold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2.2} />
              <span>Group Savings + Free Combined Delivery</span>
            </div>

            <h1 className="font-display text-3xl sm:text-5xl font-extrabold leading-[1.08] text-[#FFFFFF]">
              Shop smarter together.{' '}
              <span className="text-[#FF783D]">Save 5–15%</span> with everyday buyer pools.
            </h1>

            <p className="text-sm sm:text-base text-[#BBA5D5] max-w-xl leading-relaxed">
              Join 3-day collaborative buying groups on everyday essentials, compare AI-audited specs against real buyer reviews, and combine multiple items into one free scheduled delivery window.
            </p>

            {/* Hero Search Bar */}
            <form onSubmit={handleHeroSearchSubmit} className="flex flex-col sm:flex-row gap-2.5 max-w-xl">
              <div className="relative flex-1">
                <Search
                  className="w-4 h-4 text-[#24152F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  strokeWidth={2}
                />
                <input
                  type="text"
                  value={heroSearch}
                  onChange={(e) => setHeroSearch(e.target.value)}
                  placeholder="Search earphones, t-shirts, groceries, or 'under 500'..."
                  className="w-full pl-10 pr-12 py-3 text-sm bg-[#FFF8F0] text-[#29232F] placeholder:text-[#5E5468] rounded-xl border-2 border-[#BBA5D5] focus:border-[#FF783D] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={onOpenCameraSearch}
                  aria-label="Search with camera"
                  title="Visual Camera Search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-[#BBA5D5] hover:bg-[#D9F36A] text-[#24152F] cursor-pointer transition-colors"
                >
                  <Camera className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <button
                type="submit"
                className="px-6 py-3 rounded-xl bg-[#FF783D] hover:bg-[#F26324] text-[#24152F] text-sm font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors shrink-0"
              >
                <span>Search Store</span>
                <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
              </button>
            </form>

            {/* Primary Promo Actions + Key Highlights */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onOpenGroupOrders}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D9F36A] hover:bg-[#cce856] text-[#24152F] text-xs font-extrabold cursor-pointer transition-colors"
              >
                <Users className="w-4 h-4" strokeWidth={2} />
                <span>Explore Group Orders</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenCategory('All')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#352145] hover:bg-[#492F5E] text-[#FFFFFF] border-2 border-[#BBA5D5] text-xs font-bold cursor-pointer transition-colors"
              >
                <span>Browse All Categories</span>
              </button>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D9F36A] ml-1">
                <PackageCheck className="w-4 h-4" strokeWidth={2} />
                <span>₹0 Combined Delivery</span>
              </span>
            </div>
          </div>

          {/* Right Spotlight Cards */}
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3.5">
            {spotlightProducts.slice(0, 3).map((item) => {
              const disc = item.activeDeal?.discountPercent || 0;
              const dealPrice =
                item.activeDeal?.finalGroupPrice ??
                (disc > 0 ? Math.min(Math.round(item.price * (1 - disc / 100)), Math.max(1, item.price - 1)) : item.price);
              const rupeeSavings = Math.max(0, item.price - dealPrice);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectProduct(item.id)}
                  className="flex items-center gap-4 p-3.5 rounded-2xl bg-[#FFFFFF] text-[#29232F] border-2 border-[#BBA5D5] hover:border-[#FF783D] text-left transition-colors cursor-pointer group"
                >
                  <ProductImage
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-20 h-16 rounded-xl border border-[#E6D8CB] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {disc > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-[#FF783D] text-[#24152F] text-[10px] font-extrabold">
                          SAVE {formatINR(rupeeSavings)} ({disc}%)
                        </span>
                      )}
                      <span className="text-[11px] font-bold text-[#5E5468] uppercase">
                        {item.category}
                      </span>
                    </div>
                    <div className="font-display text-sm font-bold text-[#24152F] group-hover:text-[#FF783D] truncate mt-0.5">
                      {item.name}
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-mono text-sm font-extrabold text-[#24152F]">
                        {formatINR(dealPrice)}
                      </span>
                      {disc > 0 && (
                        <span className="font-mono text-xs text-[#5E5468] line-through">
                          {formatINR(item.price)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Shop by Category */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-[#FF783D]">
              Browse Departments
            </div>
            <h2 className="font-display text-2xl font-extrabold text-[#24152F]">
              Shop by Category
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenCategory('All')}
            className="inline-flex items-center gap-1 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] cursor-pointer"
          >
            <span>All Categories</span>
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.2} />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {CATEGORY_META.map((cat) => {
            const Icon = cat.icon;
            const count = products.filter((p) => p.category === cat.name).length;
            return (
              <button
                key={cat.name}
                type="button"
                onClick={() => onOpenCategory(cat.name)}
                className="p-4 rounded-2xl bg-[#FFFFFF] border-2 border-[#E6D8CB] hover:border-[#24152F] hover:bg-[#D9F36A] text-left flex flex-col justify-between gap-3 transition-colors cursor-pointer group shadow-card"
              >
                <span className="w-10 h-10 rounded-xl bg-[#24152F] text-[#FF783D] flex items-center justify-center">
                  <Icon className="w-5 h-5" strokeWidth={2} />
                </span>
                <div>
                  <div className="font-display text-sm font-bold text-[#24152F]">{cat.name}</div>
                  <div className="text-[11px] font-semibold text-[#5E5468] tabular-nums">
                    {count} {count === 1 ? 'item' : 'items'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Special Offers & Group Discounts */}
      {specialOffers.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#FF783D] text-[#24152F] border-2 border-[#24152F] flex items-center justify-center shrink-0">
                <Tag className="w-4 h-4" strokeWidth={2.2} />
              </span>
              <div>
                <h2 className="font-display text-2xl font-extrabold text-[#24152F]">
                  Special Offers & Group Discounts
                </h2>
                <p className="text-xs text-[#5E5468]">
                  Active collaborative buying pools with instant multi-buyer savings
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenGroupOrders}
              className="inline-flex items-center gap-1 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] cursor-pointer shrink-0"
            >
              <span>View All Deals</span>
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.2} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {specialOffers.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                wishlisted={wishlistIds.includes(product.id)}
                onToggleWishlist={onToggleWishlist}
                onSelectProduct={onSelectProduct}
                onCompareProduct={onCompareProduct}
                onAddToCart={onAddToCart}
              />
            ))}
          </div>
        </section>
      )}

      {/* Trending Now */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#24152F] text-[#D9F36A] flex items-center justify-center shrink-0">
              <Flame className="w-4 h-4" strokeWidth={2.2} />
            </span>
            <div>
              <h2 className="font-display text-2xl font-extrabold text-[#24152F]">
                Trending Products
              </h2>
              <p className="text-xs text-[#5E5468]">
                Most active buyer pools and verified product discussions right now
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSearchSubmit('')}
            className="inline-flex items-center gap-1 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] cursor-pointer shrink-0"
          >
            <span>Shop All</span>
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.2} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {trendingProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              badgeLabel="Trending"
              wishlisted={wishlistIds.includes(product.id)}
              onToggleWishlist={onToggleWishlist}
              onSelectProduct={onSelectProduct}
              onCompareProduct={onCompareProduct}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      </section>

      {/* Best-Selling Products */}
      <section className="space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[#D9F36A] text-[#24152F] border-2 border-[#24152F] flex items-center justify-center shrink-0">
            <Award className="w-4 h-4" strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="font-display text-2xl font-extrabold text-[#24152F]">
              Best-Selling Products
            </h2>
            <p className="text-xs text-[#5E5468]">
              Fastest moving catalog favorites across verified buyer orders
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {bestSellingProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              badgeLabel="Best Seller"
              wishlisted={wishlistIds.includes(product.id)}
              onToggleWishlist={onToggleWishlist}
              onSelectProduct={onSelectProduct}
              onCompareProduct={onCompareProduct}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      </section>

      {/* Recommended For You */}
      <section className="space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[#BBA5D5] text-[#24152F] border-2 border-[#24152F] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="font-display text-2xl font-extrabold text-[#24152F]">
              Recommended For You
            </h2>
            <p className="text-xs text-[#5E5468]">
              Top AI-audited products with highest verified buyer satisfaction
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {recommendedProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              badgeLabel="Top Rated"
              wishlisted={wishlistIds.includes(product.id)}
              onToggleWishlist={onToggleWishlist}
              onSelectProduct={onSelectProduct}
              onCompareProduct={onCompareProduct}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      </section>

      {/* Recently Viewed */}
      <section className="space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-[#24152F] text-[#FF783D] flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4" strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="font-display text-2xl font-extrabold text-[#24152F]">
              Recently Viewed
            </h2>
            <p className="text-xs text-[#5E5468]">
              Pick up right where you left off across your browsing session
            </p>
          </div>
        </div>

        {recentlyViewedProducts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recentlyViewedProducts.slice(0, 3).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                wishlisted={wishlistIds.includes(product.id)}
                onToggleWishlist={onToggleWishlist}
                onSelectProduct={onSelectProduct}
                onCompareProduct={onCompareProduct}
                onAddToCart={onAddToCart}
              />
            ))}
          </div>
        ) : (
          <div className="p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#E6D8CB] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-sm text-[#5E5468]">
              Open any product card to inspect full specs, group pools, and AI trust audits — it will appear here automatically.
            </p>
            <button
              type="button"
              onClick={() => onSearchSubmit('')}
              className="px-4 py-2 rounded-xl bg-[#24152F] text-[#D9F36A] text-xs font-bold cursor-pointer shrink-0"
            >
              Browse Full Catalog
            </button>
          </div>
        )}
      </section>
      <p className="text-xs text-[#5E5468] text-center pt-2 border-t border-[#E6D8CB]">
        All prices shown are fixed sample INR retail demo prices for illustrative group-buying calculations and are not live market feeds.
      </p>
    </div>
  );
}
