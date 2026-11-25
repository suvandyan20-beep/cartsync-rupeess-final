import { useMemo, useState } from 'react';
import {
  Camera,
  ChevronRight,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { ProductCard } from './ProductCard.tsx';
import { rankProductsByQuery } from '../utils/productSearch.ts';
import type { Product, VisualSearchResult } from '../types.ts';

export const CATALOG_CATEGORIES = [
  'All',
  'Electronics',
  'Mobiles',
  'Laptops',
  'Backpacks',
  'Clothing',
  'Shoes',
  'Hats',
  'Accessories',
  'Kitchen',
  'Home',
  'Beauty & Care',
  'Grocery',
] as const;

export type SearchSortOption =
  | 'featured'
  | 'popularity'
  | 'price_asc'
  | 'price_desc'
  | 'rating_desc';

interface CustomerCatalogProps {
  products: Product[];
  search: string;
  onSearchChange: (val: string) => void;
  category: string;
  onCategoryChange: (cat: string) => void;
  sortBy: SearchSortOption;
  onSortByChange: (sort: SearchSortOption) => void;
  onResetFilters: () => void;
  visualSearch: VisualSearchResult | null;
  onClearVisualSearch: () => void;
  onOpenCameraSearch: () => void;
  wishlistIds: string[];
  onToggleWishlist: (productId: string) => void;
  onSelectProduct: (productId: string) => void;
  onCompareProduct: (productId: string) => void;
  onAddToCart: (product: Product, useGroupPrice: boolean, quantity?: number) => void;
  onBackHome: () => void;
}

export function CustomerCatalog({
  products,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  sortBy,
  onSortByChange,
  onResetFilters,
  visualSearch,
  onClearVisualSearch,
  onOpenCameraSearch,
  wishlistIds,
  onToggleWishlist,
  onSelectProduct,
  onCompareProduct,
  onAddToCart,
  onBackHome,
}: CustomerCatalogProps) {
  const [priceRange, setPriceRange] = useState<'all' | 'under_500' | '500_1500' | '1500_10000' | 'over_10000'>('all');
  const [minRating, setMinRating] = useState<'all' | '4.0' | '4.5'>('all');
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'in_stock' | 'group_deal'>(
    'all'
  );

  const baseProducts = useMemo(() => {
    if (visualSearch) {
      const matchedIds = new Set(visualSearch.products.map((p) => p.id));
      const orderMap = new Map(visualSearch.products.map((p, idx) => [p.id, idx]));
      return products
        .filter((p) => matchedIds.has(p.id))
        .sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
    }
    return products;
  }, [products, visualSearch]);

  const rankedMatches = useMemo(() => {
    const filteredByFacet = baseProducts.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      if (priceRange === 'under_500' && p.price >= 500) return false;
      if (priceRange === '500_1500' && (p.price < 500 || p.price > 1500)) return false;
      if (priceRange === '1500_10000' && (p.price <= 1500 || p.price > 10000)) return false;
      if (priceRange === 'over_10000' && p.price <= 10000) return false;
      const rating = p.insights?.verifiedAvgRating ?? 0;
      if (minRating === '4.0' && rating < 4.0) return false;
      if (minRating === '4.5' && rating < 4.5) return false;
      if (availabilityFilter === 'in_stock' && p.stock <= 0) return false;
      if (
        availabilityFilter === 'group_deal' &&
        (!p.activeDeal ||
          p.activeDeal.stageLabel === 'Expired' ||
          p.activeDeal.stageLabel === 'Rejected' ||
          p.activeDeal.status === 'dissolved' ||
          p.activeDeal.status === 'completed')
      ) {
        return false;
      }
      return true;
    });
    return rankProductsByQuery(filteredByFacet, search);
  }, [baseProducts, category, priceRange, minRating, availabilityFilter, search]);

  const filtered = useMemo(() => {
    const list = rankedMatches.map((r) => r.product);
    if (sortBy === 'price_asc') return [...list].sort((a, b) => a.price - b.price);
    if (sortBy === 'price_desc') return [...list].sort((a, b) => b.price - a.price);
    if (sortBy === 'rating_desc') {
      return [...list].sort(
        (a, b) => (b.insights?.verifiedAvgRating || 0) - (a.insights?.verifiedAvgRating || 0)
      );
    }
    if (sortBy === 'popularity') {
      return [...list].sort(
        (a, b) =>
          (b.activeDeal?.paidCount || 0) * 3 +
          b.reviewCount -
          ((a.activeDeal?.paidCount || 0) * 3 + a.reviewCount)
      );
    }
    return list;
  }, [rankedMatches, sortBy]);

  const matchHintMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rankedMatches) {
      if (r.matchHint) m.set(r.product.id, r.matchHint);
    }
    return m;
  }, [rankedMatches]);

  const hasAnyFacet =
    Boolean(search.trim()) ||
    category !== 'All' ||
    priceRange !== 'all' ||
    minRating !== 'all' ||
    availabilityFilter !== 'all' ||
    Boolean(visualSearch);

  function handleResetAll() {
    setPriceRange('all');
    setMinRating('all');
    setAvailabilityFilter('all');
    onResetFilters();
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumbs & Page Header */}
      <div className="space-y-3 border-b-2 border-[#E6D8CB] pb-5">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-[#5E5468]">
          <button type="button" onClick={onBackHome} className="hover:text-[#FF783D] cursor-pointer">
            Home
          </button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#24152F] font-bold">Search & Discovery</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-[#FF783D]">
              Smart Catalog Search
            </div>
            <h1 className="font-display text-3xl font-extrabold text-[#24152F]">
              Search, Filter & Compare Products
            </h1>
          </div>
          <div className="text-xs font-bold text-[#24152F] bg-[#D9F36A] border-2 border-[#24152F] px-3.5 py-1.5 rounded-xl tabular-nums self-start">
            {filtered.length} {filtered.length === 1 ? 'Product' : 'Products'} Found
          </div>
        </div>
      </div>

      {/* Search, Filter & Sort Controls Panel */}
      <section className="p-5 sm:p-6 rounded-2xl bg-[#FFFFFF] border-2 border-[#24152F] shadow-card space-y-5">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-[#24152F] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
              strokeWidth={2}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search electronics, t-shirts, groceries, specs, or 'under 500'..."
              className="w-full pl-11 pr-24 py-3 text-sm bg-[#FFF8F0] text-[#29232F] placeholder:text-[#5E5468] rounded-xl border-2 border-[#E6D8CB] focus:border-[#FF783D] focus:outline-none"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {search && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Clear search query"
                  className="p-1.5 text-[#5E5468] hover:text-[#24152F] rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              )}
              <button
                type="button"
                onClick={onOpenCameraSearch}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#24152F] text-[#D9F36A] hover:bg-[#352145] text-xs font-bold cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">Visual Search</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as SearchSortOption)}
              aria-label="Sort products"
              className="px-4 py-3 text-xs font-bold bg-[#FFF8F0] text-[#24152F] border-2 border-[#24152F] rounded-xl focus:border-[#FF783D] focus:outline-none cursor-pointer"
            >
              <option value="featured">Sort: Featured</option>
              <option value="popularity">Sort: Popularity</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating_desc">Highest Verified Rating</option>
            </select>

            {hasAnyFacet && (
              <button
                type="button"
                onClick={handleResetAll}
                className="inline-flex items-center gap-1.5 px-4 py-3 text-xs font-bold bg-[#BBA5D5] text-[#24152F] border-2 border-[#24152F] hover:bg-[#a98fcb] rounded-xl cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#E6D8CB]">
          {CATALOG_CATEGORIES.map((cat) => {
            const active = category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onCategoryChange(cat)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border-2 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#24152F] text-[#D9F36A] border-[#24152F]'
                    : 'bg-[#FFF8F0] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Price, Rating & Availability Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-[#E6D8CB]">
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-[#5E5468] mb-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#FF783D]" />
              <span>Price Range</span>
            </label>
            <select
              value={priceRange}
              onChange={(e) => setPriceRange(e.target.value as typeof priceRange)}
              className="w-full px-3.5 py-2 text-xs font-bold bg-[#FFF8F0] text-[#24152F] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl focus:outline-none cursor-pointer"
            >
              <option value="all">Any Price</option>
              <option value="under_500">Under ₹500</option>
              <option value="500_1500">₹500 – ₹1,500</option>
              <option value="1500_10000">₹1,500 – ₹10,000</option>
              <option value="over_10000">₹10,000+</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#5E5468] mb-1.5">
              Verified Rating
            </label>
            <select
              value={minRating}
              onChange={(e) => setMinRating(e.target.value as typeof minRating)}
              className="w-full px-3.5 py-2 text-xs font-bold bg-[#FFF8F0] text-[#24152F] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl focus:outline-none cursor-pointer"
            >
              <option value="all">All Ratings</option>
              <option value="4.0">4.0 ★ &amp; above</option>
              <option value="4.5">4.5 ★ &amp; above</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#5E5468] mb-1.5">
              Availability
            </label>
            <select
              value={availabilityFilter}
              onChange={(e) => setAvailabilityFilter(e.target.value as typeof availabilityFilter)}
              className="w-full px-3.5 py-2 text-xs font-bold bg-[#FFF8F0] text-[#24152F] border-2 border-[#E6D8CB] focus:border-[#FF783D] rounded-xl focus:outline-none cursor-pointer"
            >
              <option value="all">All Items</option>
              <option value="in_stock">In Stock Only</option>
              <option value="group_deal">Active Group Deal Available</option>
            </select>
          </div>
        </div>
      </section>

      {/* Active Visual Camera Search Banner */}
      {visualSearch && (
        <div className="p-4 rounded-2xl bg-[#24152F] text-[#FFFFFF] border-2 border-[#FF783D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#D9F36A]">
              <Sparkles className="w-4 h-4" strokeWidth={2} />
              <span>
                Visual Camera Match: &ldquo;{visualSearch.detectedItemSummary}&rdquo; ({filtered.length}{' '}
                {filtered.length === 1 ? 'product' : 'products'})
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {visualSearch.searchKeywords.map((kw) => (
                <span
                  key={kw}
                  className="px-2.5 py-0.5 rounded-md bg-[#352145] border border-[#BBA5D5] text-[#FFFFFF] text-[11px] font-semibold"
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenCameraSearch}
              className="px-3.5 py-2 text-xs font-bold bg-[#FF783D] text-[#24152F] rounded-xl cursor-pointer"
            >
              New Photo
            </button>
            <button
              type="button"
              onClick={onClearVisualSearch}
              className="px-3.5 py-2 text-xs font-bold bg-[#352145] text-[#FFFFFF] border border-[#BBA5D5] rounded-xl cursor-pointer"
            >
              Clear Visual Filter
            </button>
          </div>
        </div>
      )}

      {/* Results Grid / Empty State */}
      <section id="catalog-grid">
        {filtered.length === 0 ? (
          <div className="p-12 text-center border-2 border-[#E6D8CB] rounded-2xl bg-[#FFFFFF] space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-[#FFF8F0] border-2 border-[#24152F] mx-auto flex items-center justify-center">
              <Search className="w-6 h-6 text-[#FF783D]" strokeWidth={2} />
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-xl font-extrabold text-[#24152F]">
                No matching products found
              </h2>
              <p className="text-sm text-[#5E5468] max-w-md mx-auto">
                No products matched{search ? ` "${search}"` : ''} with your current price, rating, or availability filters.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleResetAll}
                className="px-5 py-2.5 text-xs font-extrabold bg-[#FF783D] text-[#24152F] border-2 border-[#24152F] rounded-xl cursor-pointer"
              >
                Reset All Filters
              </button>
              <button
                type="button"
                onClick={onOpenCameraSearch}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-extrabold bg-[#24152F] text-[#D9F36A] rounded-xl cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Try Visual Camera Search</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                matchHint={search.trim() ? matchHintMap.get(product.id) : null}
                wishlisted={wishlistIds.includes(product.id)}
                onToggleWishlist={onToggleWishlist}
                onSelectProduct={onSelectProduct}
                onCompareProduct={onCompareProduct}
                onAddToCart={onAddToCart}
              />
            ))}
          </div>
        )}
      </section>
      <p className="text-xs text-[#5E5468] text-center pt-2 border-t border-[#E6D8CB]">
        Sample Indian retail demo prices shown in INR (₹) for group-buying calculation only; not live market prices.
      </p>
    </div>
  );
}
