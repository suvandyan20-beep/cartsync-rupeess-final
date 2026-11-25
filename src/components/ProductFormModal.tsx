import { useState, type FormEvent } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Product, ProductSpec } from '../types.ts';

interface ProductFormModalProps {
  open: boolean;
  onClose: () => void;
  editingProduct: Product | null;
  onSave: (payload: {
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
  }) => Promise<void>;
}

const IMAGE_PRESETS = [
  { label: 'Wireless ANC Headphones (Electronics)', url: '/src/assets/images/product_anc_headphones_1795505379219.jpg' },
  { label: '10000mAh Compact Power Bank (Electronics)', url: '/src/assets/images/product_power_bank_1795571863514.jpg' },
  { label: 'Portable Bluetooth Speaker (Electronics)', url: '/src/assets/images/product_bluetooth_speaker_1795571864088.jpg' },
  { label: 'Compact Keyboard & Mouse (Electronics)', url: '/src/assets/images/product_mech_keyboard_1795505381635.jpg' },
  { label: 'Daily 5G Smartphone (Mobiles)', url: '/src/assets/images/product_flagship_mobile_1795570919653.jpg' },
  { label: 'Compact 5G Smartphone (Mobiles)', url: '/src/assets/images/product_compact_mobile_1795570919818.jpg' },
  { label: '14" Everyday Student Laptop (Laptops)', url: '/src/assets/images/product_oled_laptop_1795570920351.jpg' },
  { label: '15" Office & Study Laptop (Laptops)', url: '/src/assets/images/product_workstation_laptop_1795570920691.jpg' },
  { label: 'Everyday Commuter Backpack (Backpacks)', url: '/src/assets/images/product_commuter_backpack_1795570919858.jpg' },
  { label: 'Weekend Travel Backpack (Backpacks)', url: '/src/assets/images/product_trail_backpack_1795570920300.jpg' },
  { label: 'Everyday Cotton T-Shirt (Clothing)', url: '/src/assets/images/product_cotton_tshirt_1795571864429.jpg' },
  { label: 'Everyday Denim Jeans (Clothing)', url: '/src/assets/images/product_denim_jeans_1795571865031.jpg' },
  { label: 'Cotton Casual Shirt (Clothing)', url: '/src/assets/images/product_chore_jacket_1795506418016.jpg' },
  { label: 'Lightweight Cotton Pullover (Clothing)', url: '/src/assets/images/product_merino_crewneck_1795506418262.jpg' },
  { label: 'Knit Walking Sneakers (Shoes)', url: '/src/assets/images/product_knit_sneakers_1795506416917.jpg' },
  { label: 'Brushed Cotton Cap (Hats)', url: '/src/assets/images/product_cotton_cap_1795506416952.jpg' },
  { label: 'Everyday Pebble Tote (Accessories)', url: '/src/assets/images/product_leather_tote_1795506416626.jpg' },
  { label: 'Polarized Sunglasses (Accessories)', url: '/src/assets/images/product_acetate_sunglasses_1795506418208.jpg' },
  { label: 'Insulated Steel Water Bottle (Kitchen)', url: '/src/assets/images/product_water_bottle_1795571865509.jpg' },
  { label: 'Airtight Storage Containers (Kitchen)', url: '/src/assets/images/product_storage_containers_1795571866120.jpg' },
  { label: 'Non-Stick Cookware Pot (Kitchen)', url: '/src/assets/images/product_ceramic_cookware_1795505382032.jpg' },
  { label: 'Compact Coffee Maker (Kitchen)', url: '/src/assets/images/product_espresso_machine_1795505380016.jpg' },
  { label: 'Study & Office Mesh Chair (Home)', url: '/src/assets/images/product_ergo_chair_1795505380729.jpg' },
  { label: 'Compact Room Air Purifier (Home)', url: '/src/assets/images/product_air_purifier_1795505387067.jpg' },
  { label: 'Gentle Daily Face Wash (Beauty & Care)', url: '/src/assets/images/product_face_wash_1795571882523.jpg' },
  { label: 'SPF 50 Daily Sunscreen (Beauty & Care)', url: '/src/assets/images/product_sunscreen_lotion_1795571882171.jpg' },
  { label: 'Everyday Basmati Rice 1kg (Grocery)', url: '/src/assets/images/product_basmati_rice_1795571882434.jpg' },
  { label: 'Citrus Floor Cleaner 1L (Grocery)', url: '/src/assets/images/product_floor_cleaner_1795571886449.jpg' },
];

export function ProductFormModal({ open, onClose, editingProduct, onSave }: ProductFormModalProps) {
  const [name, setName] = useState(editingProduct?.name || '');
  const [brand, setBrand] = useState(editingProduct?.brand || '');
  const [category, setCategory] = useState(editingProduct?.category || 'Electronics');
  const [price, setPrice] = useState(editingProduct ? String(editingProduct.price) : '499');
  const [stock, setStock] = useState(editingProduct ? String(editingProduct.stock) : '40');
  const [deliveryDays, setDeliveryDays] = useState(
    editingProduct ? String(editingProduct.deliveryDays) : '2'
  );
  const [imageUrl, setImageUrl] = useState(
    editingProduct?.imageUrl || IMAGE_PRESETS[0].url
  );
  const [description, setDescription] = useState(editingProduct?.description || '');
  const [specs, setSpecs] = useState<ProductSpec[]>(
    editingProduct?.specs.length
      ? editingProduct.specs
      : [
          { label: 'Warranty', value: '1 Year Brand Warranty' },
          { label: 'Package Weight', value: '350 g' },
        ]
  );

  const [enableGroupDeal, setEnableGroupDeal] = useState(!editingProduct);
  const [dealTitle, setDealTitle] = useState('Neighborhood Group Pool');
  const [minParticipants, setMinParticipants] = useState('5');
  const [discountPercent, setDiscountPercent] = useState('10');
  const [tier2Min, setTier2Min] = useState('10');
  const [tier2Discount, setTier2Discount] = useState('15');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function addSpecRow() {
    setSpecs((prev) => [...prev, { label: '', value: '' }]);
  }

  function updateSpecRow(idx: number, field: 'label' | 'value', val: string) {
    setSpecs((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: val } : s)));
  }

  function removeSpecRow(idx: number) {
    setSpecs((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        id: editingProduct?.id,
        name,
        brand,
        category,
        price: Number(price),
        stock: Number(stock),
        imageUrl,
        description,
        specs: specs.filter((s) => s.label.trim() && s.value.trim()),
        deliveryDays: Math.max(1, Number(deliveryDays) || 2),
        enableGroupDeal: !editingProduct && enableGroupDeal,
        dealTitle,
        minParticipants: Number(minParticipants),
        discountPercent: Number(discountPercent),
        tier2Min: tier2Min ? Number(tier2Min) : null,
        tier2Discount: tier2Discount ? Number(tier2Discount) : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save product.');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full px-3.5 py-2 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] placeholder:text-[#5E5468] rounded-xl focus:outline-none focus:border-[#FF783D]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#24152F]/80 p-4">
      <div className="bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl w-full max-w-2xl shadow-card-lg overflow-hidden flex flex-col max-h-[90vh] animate-fade-in">
        <div className="px-6 py-4 bg-[#24152F] text-[#FFFFFF] flex items-center justify-between">
          <h2 className="font-display text-xl font-extrabold text-[#FFFFFF]">
            {editingProduct ? `Edit ${editingProduct.name}` : 'Add New Product Listing'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#FFFFFF] hover:bg-[#352145] rounded-xl transition-colors cursor-pointer"
            aria-label="Close product modal"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-[#FEE2E2] border-2 border-[#C83E4D] text-xs font-bold text-[#9E2A3B]">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#24152F] mb-1.5">Product Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Studio Acoustic Monitor"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#24152F] mb-1.5">Brand</label>
              <input
                type="text"
                required
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Horizon Acoustics"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#24152F] mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              >
                <option value="Electronics">Electronics</option>
                <option value="Mobiles">Mobiles</option>
                <option value="Laptops">Laptops</option>
                <option value="Backpacks">Backpacks</option>
                <option value="Clothing">Clothing</option>
                <option value="Shoes">Shoes</option>
                <option value="Hats">Hats</option>
                <option value="Accessories">Accessories</option>
                <option value="Kitchen">Kitchen</option>
                <option value="Home">Home</option>
                <option value="Beauty & Care">Beauty &amp; Care</option>
                <option value="Grocery">Grocery</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#24152F] mb-1.5">Retail Price (₹)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#24152F] mb-1.5">Stock</label>
              <input
                type="number"
                min="0"
                required
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#24152F] mb-1.5">Lead Time (Days)</label>
              <input
                type="number"
                min="1"
                max="30"
                required
                value={deliveryDays}
                onChange={(e) => setDeliveryDays(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#24152F] mb-1.5">Studio Product Image</label>
            <select
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className={inputClass}
            >
              {IMAGE_PRESETS.map((img) => (
                <option key={img.url} value={img.url}>
                  {img.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#24152F] mb-1.5">Description</label>
            <textarea
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Accurate product overview used for customer comparison..."
              className={inputClass}
            />
          </div>

          {/* Advertised Specifications */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold text-[#24152F]">
                Advertised Specifications (audited against reviews)
              </label>
              <button
                type="button"
                onClick={addSpecRow}
                className="inline-flex items-center gap-1 text-xs font-extrabold text-[#24152F] hover:text-[#FF783D] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Add Spec</span>
              </button>
            </div>
            <div className="space-y-2">
              {specs.map((spec, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={spec.label}
                    onChange={(e) => updateSpecRow(idx, 'label', e.target.value)}
                    placeholder="Spec name (e.g. Battery Life)"
                    className="w-1/3 px-3 py-2 text-xs bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] rounded-xl focus:outline-none focus:border-[#FF783D]"
                  />
                  <input
                    type="text"
                    value={spec.value}
                    onChange={(e) => updateSpecRow(idx, 'value', e.target.value)}
                    placeholder="Claimed value (e.g. 40 Hours)"
                    className="flex-1 px-3 py-2 text-xs bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] rounded-xl focus:outline-none focus:border-[#FF783D]"
                  />
                  <button
                    type="button"
                    onClick={() => removeSpecRow(idx)}
                    className="p-1.5 text-[#5E5468] hover:text-[#C83E4D] cursor-pointer"
                    aria-label="Remove spec row"
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Optional Group Deal Launch */}
          {!editingProduct && (
            <div className="p-4 rounded-2xl border-2 border-[#BBA5D5] bg-[#F2EBFF] space-y-3">
              <label className="flex items-center gap-2 text-sm font-extrabold text-[#24152F] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableGroupDeal}
                  onChange={(e) => setEnableGroupDeal(e.target.checked)}
                  className="w-4 h-4 accent-[#24152F] rounded"
                />
                <span>Launch with Collaborative Group Buying Pool (3-day pool window)</span>
              </label>

              {enableGroupDeal && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-[#24152F] mb-1">Pool Title</label>
                    <input
                      type="text"
                      value={dealTitle}
                      onChange={(e) => setDealTitle(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#24152F] mb-1">Tier 1 Min Buyers</label>
                    <input
                      type="number"
                      min="2"
                      value={minParticipants}
                      onChange={(e) => setMinParticipants(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#24152F] mb-1">Tier 1 Discount (%)</label>
                    <input
                      type="number"
                      min="5"
                      max="70"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#24152F] mb-1">Tier 2 Min Buyers</label>
                    <input
                      type="number"
                      min="3"
                      value={tier2Min}
                      onChange={(e) => setTier2Min(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#24152F] mb-1">Tier 2 Discount (%)</label>
                    <input
                      type="number"
                      min="5"
                      max="75"
                      value={tier2Discount}
                      onChange={(e) => setTier2Discount(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-[#FFFFFF] border-2 border-[#E6D8CB] rounded-xl focus:outline-none focus:border-[#FF783D]"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t-2 border-[#E6D8CB]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-bold text-[#24152F] bg-[#FFFFFF] border-2 border-[#24152F] rounded-xl hover:bg-[#FFF8F0] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : editingProduct ? 'Save Changes' : 'Publish Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
