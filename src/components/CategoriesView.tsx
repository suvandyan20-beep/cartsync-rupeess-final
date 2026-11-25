import { ArrowRight, ChevronRight, Users } from 'lucide-react';
import { CATEGORY_META } from './HomeView.tsx';
import { ProductCard } from './ProductCard.tsx';
import { formatINR } from '../utils/currency.ts';
import type { Product } from '../types.ts';

interface CategoriesViewProps {
  products: Product[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  wishlistIds: string[];
  onToggleWishlist: (productId: string) => void;
  onSelectProduct: (productId: string) => void;
  onCompareProduct: (productId: string) => void;
  onAddToCart: (product: Product, useGroupPrice: boolean, quantity?: number) => void;
  onOpenFullSearch: (category: string) => void;
  onBackHome: () => void;
}

export function CategoriesView({
  products,
  selectedCategory,
  onSelectCategory,
  wishlistIds,
  onToggleWishlist,
  onSelectProduct,
  onCompareProduct,
  onAddToCart,
  onOpenFullSearch,
  onBackHome,
}: CategoriesViewProps) {
  const visibleProducts =
    selectedCategory === 'All'
      ? products
      : products.filter((p) => p.category === selectedCategory);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Breadcrumb & Page Header */}
      <div className="space-y-3 border-b-2 border-[#E6D8CB] pb-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-[#5E5468]">
          <button
            type="button"
            onClick={onBackHome}
            className="hover:text-[#FF783D] cursor-pointer"
          >
            Home
          </button>
          <ChevronRight className="w-3.5 h-3.5" />
          <button
            type="button"
            onClick={() => onSelectCategory('All')}
            className="hover:text-[#FF783D] cursor-pointer"
          >
            Categories
          </button>
          {selectedCategory !== 'All' && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-[#24152F] font-bold">{selectedCategory}</span>
            </>
          )}
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-[#FF783D]">
              Catalog Directory
            </div>
            <h1 className="font-display text-3xl font-extrabold text-[#24152F]">
              {selectedCategory === 'All' ? 'Browse All Categories' : `${selectedCategory} Collection`}
            </h1>
            <p className="text-sm text-[#5E5468] mt-1">
              Explore everyday departments, compare group pool savings, and add directly to your cart. All prices are fixed sample INR retail demo prices.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {selectedCategory !== 'All' && (
              <button
                type="button"
                onClick={() => onSelectCategory('All')}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#FFFFFF] border-2 border-[#24152F] text-[#24152F] hover:bg-[#BBA5D5] cursor-pointer"
              >
                Show All Categories
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenFullSearch(selectedCategory)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold bg-[#24152F] text-[#D9F36A] hover:bg-[#352145] cursor-pointer"
            >
              <span>Filter & Sort in Search</span>
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>

      {/* Category Tiles Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {CATEGORY_META.map((cat) => {
          const Icon = cat.icon;
          const items = products.filter((p) => p.category === cat.name);
          const minPrice = items.length > 0 ? Math.min(...items.map((i) => i.price)) : 0;
          const activeDeals = items.filter((i) => i.activeDeal?.status === 'active').length;
          const isSelected = selectedCategory === cat.name;

          return (
            <button
              key={cat.name}
              type="button"
              onClick={() => onSelectCategory(isSelected ? 'All' : cat.name)}
              className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between gap-4 shadow-card ${
                isSelected
                  ? 'bg-[#24152F] text-[#FFFFFF] border-[#FF783D]'
                  : 'bg-[#FFFFFF] text-[#29232F] border-[#E6D8CB] hover:border-[#24152F]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-[#FF783D] text-[#24152F]' : 'bg-[#24152F] text-[#D9F36A]'
                  }`}
                >
                  <Icon className="w-5 h-5" strokeWidth={2} />
                </span>
                {activeDeals > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                      isSelected ? 'bg-[#D9F36A] text-[#24152F]' : 'bg-[#FF783D] text-[#24152F]'
                    }`}
                  >
                    <Users className="w-3 h-3" strokeWidth={2} />
                    <span>{activeDeals} Pool{activeDeals === 1 ? '' : 's'}</span>
                  </span>
                )}
              </div>

              <div>
                <h2 className="font-display text-lg font-extrabold">{cat.name}</h2>
                <p
                  className={`text-xs mt-0.5 ${
                    isSelected ? 'text-[#BBA5D5]' : 'text-[#5E5468]'
                  }`}
                >
                  {cat.tagline}
                </p>
              </div>

              <div
                className={`pt-3 border-t flex items-center justify-between text-xs font-bold ${
                  isSelected ? 'border-[#352145] text-[#D9F36A]' : 'border-[#E6D8CB] text-[#24152F]'
                }`}
              >
                <span className="tabular-nums">
                  {items.length} {items.length === 1 ? 'Product' : 'Products'}
                </span>
                {minPrice > 0 && (
                  <span className="font-mono tabular-nums">From {formatINR(minPrice)}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filtered Category Products */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-xl font-extrabold text-[#24152F]">
            {selectedCategory === 'All'
              ? `All Storefront Products (${visibleProducts.length})`
              : `${selectedCategory} (${visibleProducts.length})`}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleProducts.map((product) => (
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
    </div>
  );
}
