import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';

const dbPath = path.resolve(process.cwd(), 'cartsync.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON;');

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(`cartsync_salt_${password}`).digest('hex');
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'seller')),
      avatar_initials TEXT NOT NULL,
      address TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      description TEXT NOT NULL,
      specs_json TEXT NOT NULL,
      delivery_days INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL,
      FOREIGN KEY (seller_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS group_deals (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      title TEXT NOT NULL,
      min_participants INTEGER NOT NULL,
      current_participants INTEGER NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL,
      tier2_min INTEGER,
      tier2_discount REAL,
      final_group_price REAL,
      status TEXT NOT NULL CHECK (status IN ('pending_approval', 'active', 'collecting_orders', 'threshold_reached', 'confirmed', 'expired', 'group_full', 'approved', 'rejected', 'unlocked', 'completed', 'dissolved')),
      expires_at TEXT NOT NULL,
      payment_expires_at TEXT,
      seller_approved_at TEXT,
      payment_window_hours REAL DEFAULT 24,
      threshold_reached_at TEXT,
      confirmed_at TEXT,
      requested_by_name TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (seller_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      deal_id TEXT,
      discounted_unit_price REAL NOT NULL,
      auto_added_reason TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, product_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_deal_members (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      commitment_status TEXT NOT NULL DEFAULT 'Committed',
      confirmed_at TEXT NOT NULL,
      paid_at TEXT,
      UNIQUE(deal_id, user_id),
      FOREIGN KEY (deal_id) REFERENCES group_deals(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS availability_slots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      day_of_week TEXT NOT NULL,
      slot_label TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
      note TEXT NOT NULL DEFAULT '',
      UNIQUE(user_id, day_of_week, slot_label),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      deal_id TEXT,
      delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('combined', 'express_separate')),
      combined_group_id TEXT,
      scheduled_window TEXT NOT NULL,
      shipping_fee REAL NOT NULL,
      subtotal REAL NOT NULL,
      discount_total REAL NOT NULL,
      total_amount REAL NOT NULL,
      payment_status TEXT NOT NULL,
      fulfillment_status TEXT NOT NULL,
      group_approval_status TEXT NOT NULL DEFAULT 'Not Required',
      delivery_availability_status TEXT NOT NULL DEFAULT 'Not Dispatched',
      reschedule_requested_window TEXT,
      delivery_partner_id TEXT,
      lifecycle_stage TEXT NOT NULL DEFAULT 'order_confirmed',
      stage_timestamps_json TEXT,
      payment_method TEXT NOT NULL DEFAULT 'Card ending in 4242 (Simulated)',
      delivery_rating INTEGER,
      delivery_feedback TEXT,
      tracking_stage TEXT NOT NULL DEFAULT 'Order Confirmed',
      tracking_eta TEXT,
      expired_resolution_status TEXT NOT NULL DEFAULT 'none',
      shared_delivery_cost REAL,
      payment_deadline TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS delivery_partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      vehicle TEXT NOT NULL,
      hub_zone TEXT NOT NULL,
      rating REAL NOT NULL DEFAULT 4.9
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      action_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      deal_id TEXT,
      delivery_date TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      verified_purchase INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      ai_trust_flag TEXT NOT NULL DEFAULT 'trusted' CHECK (ai_trust_flag IN ('trusted', 'flagged_suspicious')),
      ai_flag_reason TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_ai_insights (
      product_id TEXT PRIMARY KEY,
      pros_json TEXT NOT NULL,
      cons_json TEXT NOT NULL,
      discrepancies_json TEXT NOT NULL,
      summary_headline TEXT NOT NULL,
      analyzed_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'seeded',
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('Family', 'Friends', 'Roommates', 'Colleagues', 'Neighbors', 'Other')),
      description TEXT NOT NULL DEFAULT '',
      invite_code TEXT UNIQUE NOT NULL,
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Owner', 'Member')),
      last_read_at TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      UNIQUE(group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES social_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      product_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES social_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_group_products (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      shared_by_user_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      upvotes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      UNIQUE(group_id, product_id),
      FOREIGN KEY (group_id) REFERENCES social_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_group_activities (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES social_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_group_invitations (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      invited_user_id TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
      created_at TEXT NOT NULL,
      UNIQUE(group_id, invited_user_id),
      FOREIGN KEY (group_id) REFERENCES social_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Safe schema migration for existing SQLite database
  const prodCols = db.prepare('PRAGMA table_info(products)').all() as { name: string }[];
  if (!prodCols.some((c) => c.name === 'delivery_days')) {
    db.exec('ALTER TABLE products ADD COLUMN delivery_days INTEGER NOT NULL DEFAULT 2;');
    db.prepare('UPDATE products SET delivery_days = 2 WHERE id = ?').run('prod_headphones');
    db.prepare('UPDATE products SET delivery_days = 5 WHERE id = ?').run('prod_espresso');
    db.prepare('UPDATE products SET delivery_days = 7 WHERE id = ?').run('prod_chair');
    db.prepare('UPDATE products SET delivery_days = 3 WHERE id = ?').run('prod_purifier');
    db.prepare('UPDATE products SET delivery_days = 2 WHERE id = ?').run('prod_keyboard');
    db.prepare('UPDATE products SET delivery_days = 4 WHERE id = ?').run('prod_cookware');
  }

  const orderItemCols = db.prepare('PRAGMA table_info(order_items)').all() as { name: string }[];
  if (!orderItemCols.some((c) => c.name === 'delivery_date')) {
    db.exec('ALTER TABLE order_items ADD COLUMN delivery_date TEXT;');
  }

  // Safe schema migrations for existing orders columns
  const orderCols = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
  if (!orderCols.some((c) => c.name === 'deal_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN deal_id TEXT;');
  }
  if (!orderCols.some((c) => c.name === 'group_approval_status')) {
    db.exec(`ALTER TABLE orders ADD COLUMN group_approval_status TEXT NOT NULL DEFAULT 'Not Required';`);
  }
  if (!orderCols.some((c) => c.name === 'delivery_availability_status')) {
    db.exec(`ALTER TABLE orders ADD COLUMN delivery_availability_status TEXT NOT NULL DEFAULT 'Not Dispatched';`);
  }
  if (!orderCols.some((c) => c.name === 'reschedule_requested_window')) {
    db.exec('ALTER TABLE orders ADD COLUMN reschedule_requested_window TEXT;');
  }
  if (!orderCols.some((c) => c.name === 'delivery_partner_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_partner_id TEXT;');
  }
  if (!orderCols.some((c) => c.name === 'tracking_stage')) {
    db.exec(`ALTER TABLE orders ADD COLUMN tracking_stage TEXT NOT NULL DEFAULT 'Order Confirmed';`);
  }
  if (!orderCols.some((c) => c.name === 'tracking_eta')) {
    db.exec('ALTER TABLE orders ADD COLUMN tracking_eta TEXT;');
  }
  if (!orderCols.some((c) => c.name === 'lifecycle_stage')) {
    db.exec(`ALTER TABLE orders ADD COLUMN lifecycle_stage TEXT NOT NULL DEFAULT 'order_confirmed';`);
  }
  if (!orderCols.some((c) => c.name === 'stage_timestamps_json')) {
    db.exec('ALTER TABLE orders ADD COLUMN stage_timestamps_json TEXT;');
  }
  if (!orderCols.some((c) => c.name === 'payment_method')) {
    db.exec(`ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'Card ending in 4242 (Simulated)';`);
  }
  if (!orderCols.some((c) => c.name === 'delivery_rating')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_rating INTEGER;');
  }
  if (!orderCols.some((c) => c.name === 'delivery_feedback')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_feedback TEXT;');
  }
  if (!orderCols.some((c) => c.name === 'shipping_address')) {
    db.exec('ALTER TABLE orders ADD COLUMN shipping_address TEXT;');
  }
  if (!orderCols.some((c) => c.name === 'expired_resolution_status')) {
    db.exec(`ALTER TABLE orders ADD COLUMN expired_resolution_status TEXT NOT NULL DEFAULT 'none';`);
  }
  if (!orderCols.some((c) => c.name === 'shared_delivery_cost')) {
    db.exec('ALTER TABLE orders ADD COLUMN shared_delivery_cost REAL;');
  }
  if (!orderCols.some((c) => c.name === 'payment_deadline')) {
    db.exec('ALTER TABLE orders ADD COLUMN payment_deadline TEXT;');
  }

  const dealCols = db.prepare('PRAGMA table_info(group_deals)').all() as { name: string }[];
  if (!dealCols.some((c) => c.name === 'threshold_reached_at')) {
    db.exec('ALTER TABLE group_deals ADD COLUMN threshold_reached_at TEXT;');
  }
  if (!dealCols.some((c) => c.name === 'confirmed_at')) {
    db.exec('ALTER TABLE group_deals ADD COLUMN confirmed_at TEXT;');
  }
  if (!dealCols.some((c) => c.name === 'final_group_price')) {
    db.exec('ALTER TABLE group_deals ADD COLUMN final_group_price REAL;');
  }
  if (!dealCols.some((c) => c.name === 'payment_expires_at')) {
    db.exec('ALTER TABLE group_deals ADD COLUMN payment_expires_at TEXT;');
  }
  if (!dealCols.some((c) => c.name === 'seller_approved_at')) {
    db.exec('ALTER TABLE group_deals ADD COLUMN seller_approved_at TEXT;');
  }
  if (!dealCols.some((c) => c.name === 'payment_window_hours')) {
    db.exec('ALTER TABLE group_deals ADD COLUMN payment_window_hours REAL DEFAULT 24;');
  }

  const memberCols = db.prepare('PRAGMA table_info(group_deal_members)').all() as { name: string }[];
  if (!memberCols.some((c) => c.name === 'commitment_status')) {
    db.exec(`ALTER TABLE group_deal_members ADD COLUMN commitment_status TEXT NOT NULL DEFAULT 'Committed';`);
  }
  if (!memberCols.some((c) => c.name === 'paid_at')) {
    db.exec('ALTER TABLE group_deal_members ADD COLUMN paid_at TEXT;');
  }

  const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!userCols.some((c) => c.name === 'phone')) {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT '';`);
  }
  if (!userCols.some((c) => c.name === 'saved_addresses_json')) {
    db.exec(`ALTER TABLE users ADD COLUMN saved_addresses_json TEXT;`);
  }
  if (!userCols.some((c) => c.name === 'payment_preference')) {
    db.exec(`ALTER TABLE users ADD COLUMN payment_preference TEXT DEFAULT 'Card ending in 4242 (Simulated)';`);
  }
  if (!userCols.some((c) => c.name === 'notification_prefs_json')) {
    db.exec(`ALTER TABLE users ADD COLUMN notification_prefs_json TEXT;`);
  }

  // Prevent duplicate active/paid purchases per customer per group deal (allow re-order only if previously cancelled)
  const idxRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_orders_customer_deal'`)
    .get() as { sql?: string } | undefined;
  if (idxRow?.sql && !idxRow.sql.includes('Cancelled')) {
    db.exec('DROP INDEX IF EXISTS idx_orders_customer_deal;');
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_customer_deal ON orders(customer_id, deal_id) WHERE deal_id IS NOT NULL AND fulfillment_status != 'Cancelled';`
  );

  // Migrate existing group_deals CHECK constraint to allow smart threshold statuses
  const groupDealsTable = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'group_deals'`)
    .get() as { sql?: string } | undefined;
  if (groupDealsTable?.sql && !groupDealsTable.sql.includes("'threshold_reached'")) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN;');
    try {
      db.exec(`
        CREATE TABLE group_deals_migrated (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL,
          seller_id TEXT NOT NULL,
          title TEXT NOT NULL,
          min_participants INTEGER NOT NULL,
          current_participants INTEGER NOT NULL DEFAULT 0,
          discount_percent REAL NOT NULL,
          tier2_min INTEGER,
          tier2_discount REAL,
          status TEXT NOT NULL CHECK (status IN ('pending_approval', 'active', 'collecting_orders', 'threshold_reached', 'confirmed', 'expired', 'group_full', 'approved', 'rejected', 'unlocked', 'completed', 'dissolved')),
          expires_at TEXT NOT NULL,
          threshold_reached_at TEXT,
          confirmed_at TEXT,
          requested_by_name TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          FOREIGN KEY (seller_id) REFERENCES users(id)
        );
        INSERT INTO group_deals_migrated (
          id, product_id, seller_id, title, min_participants, current_participants,
          discount_percent, tier2_min, tier2_discount, status, expires_at, threshold_reached_at, confirmed_at, requested_by_name, created_at
        )
        SELECT
          id, product_id, seller_id, title, min_participants, current_participants,
          discount_percent, tier2_min, tier2_discount, status, expires_at, threshold_reached_at, confirmed_at, requested_by_name, created_at
        FROM group_deals;
        DROP TABLE group_deals;
        ALTER TABLE group_deals_migrated RENAME TO group_deals;
      `);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (userCount.cnt === 0) {
    seedDatabase();
  }

  // Convert any legacy unlocked status to active
  db.prepare(`UPDATE group_deals SET status = 'active' WHERE status = 'unlocked'`).run();

  // Seed fashion, footwear, hats & accessories catalog if not yet present
  const hasSneakers = db.prepare('SELECT id FROM products WHERE id = ?').get('prod_sneakers');
  if (!hasSneakers) {
    seedFashionCatalog();
  }

  // Seed backpacks, mobiles, and laptops catalog if not yet present
  const hasExtendedCatalog = db.prepare('SELECT id FROM products WHERE id = ?').get('prod_laptop_oled');
  if (!hasExtendedCatalog) {
    seedExtendedTechAndCarryCatalog();
  }

  // Seed everyday Indian electronics, fashion, kitchen, beauty, and grocery essentials
  const hasEverydayEssentials = db.prepare('SELECT id FROM products WHERE id = ?').get('prod_powerbank');
  if (!hasEverydayEssentials) {
    seedEverydayIndianEssentialsCatalog();
  }

  // Enforce 3-day (72h) max window on any active/pending group deals
  const maxAllowedMs = Date.now() + 3 * 86400000;
  const maxAllowedIso = new Date(maxAllowedMs).toISOString();
  const activeOrPendingDeals = db
    .prepare(`SELECT id, expires_at FROM group_deals WHERE status IN ('pending_approval', 'active')`)
    .all() as { id: string; expires_at: string }[];
  for (const d of activeOrPendingDeals) {
    const expMs = Date.parse(d.expires_at);
    if (!Number.isNaN(expMs) && expMs > maxAllowedMs) {
      db.prepare('UPDATE group_deals SET expires_at = ? WHERE id = ?').run(maxAllowedIso, d.id);
    }
  }

  ensureMinimumProductReviews();
  seedDeliveryPartnersAndOrderDefaults();
  seedSocialGroups();
}

export function resetDatabaseToFirstStage() {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`
      DELETE FROM social_group_invitations;
      DELETE FROM social_group_activities;
      DELETE FROM social_group_products;
      DELETE FROM social_group_messages;
      DELETE FROM social_group_members;
      DELETE FROM social_groups;
      DELETE FROM notifications;
      DELETE FROM order_items;
      DELETE FROM orders;
      DELETE FROM cart_items;
      DELETE FROM group_deal_members;
      DELETE FROM group_deals;
      DELETE FROM availability_slots;
      DELETE FROM reviews;
      DELETE FROM product_ai_insights;
      DELETE FROM products;
      DELETE FROM delivery_partners;
      DELETE FROM users;
    `);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  initDatabase();
}

function seedDatabase() {
  const now = new Date().toISOString();
  const demoPass = hashPassword('cartsync123');

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, avatar_initials, address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('cust_maya', 'Maya Chen', 'maya@cartsync.demo', demoPass, 'customer', 'MC', '428 Harborview Ave, Apt 4B, Seattle, WA 98101', now);
  insertUser.run('cust_liam', 'Liam Patel', 'liam@cartsync.demo', demoPass, 'customer', 'LP', '112 Pine St, Suite 210, Seattle, WA 98101', now);
  insertUser.run('cust_alex', 'Alex Rivera', 'alex@cartsync.demo', demoPass, 'customer', 'AR', '850 Westlake Ave N, Seattle, WA 98109', now);
  insertUser.run('cust_priya', 'Priya Nair', 'priya@cartsync.demo', demoPass, 'customer', 'PN', '2240 NW Market St, Seattle, WA 98107', now);
  insertUser.run('cust_sam', 'Sam Brooks', 'sam@cartsync.demo', demoPass, 'customer', 'SB', '605 E Pike St, Seattle, WA 98122', now);
  insertUser.run('sell_horizon', 'Horizon Living & Tech', 'seller@horizon.demo', demoPass, 'seller', 'HL', '790 Mercer Logistics Hub, Seattle, WA 98109', now);
  insertUser.run('sell_northwind', 'Northwind Homeware', 'seller@northwind.demo', demoPass, 'seller', 'NH', '310 Ballard Industrial Way, Seattle, WA 98107', now);

  const insertProduct = db.prepare(`
    INSERT INTO products (id, seller_id, name, brand, category, price, stock, image_url, description, specs_json, delivery_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertProduct.run(
    'prod_headphones',
    'sell_horizon',
    'Slate Wireless Bluetooth Headphones',
    'Horizon Acoustics',
    'Electronics',
    1199.0,
    28,
    '/src/assets/images/product_anc_headphones_1795505379219.jpg',
    'Over-ear wireless Bluetooth 5.3 headphones built for daily study, office calls, and commuting with cushioned memory-foam ear pads and USB-C fast charging.',
    JSON.stringify([
      { label: 'Battery Life', value: '45 Hours Playback' },
      { label: 'Noise Isolation', value: 'Passive + Dual-Mic Call Isolation' },
      { label: 'Weight', value: '240g Lightweight Frame' },
      { label: 'Charging', value: 'USB-C Fast Charge (10 min = 4 hrs)' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_espresso',
    'sell_northwind',
    'Aura Compact Filter & Espresso Maker',
    'Northwind Kitchen',
    'Kitchen',
    1199.0,
    18,
    '/src/assets/images/product_espresso_machine_1795505380016.jpg',
    'Compact countertop home coffee brewer with stainless steel finish, portafilter basket, milk frothing wand, and simple one-knob brewing for daily filter coffee or espresso.',
    JSON.stringify([
      { label: 'Warm-up Time', value: '25 Seconds Fast Heat' },
      { label: 'Pressure', value: '5-Bar Home Steam & Brew' },
      { label: 'Portafilter', value: 'Stainless Filter Basket' },
      { label: 'Water Reservoir', value: '0.8L Easy-Fill Tank' }
    ]),
    4,
    now
  );

  insertProduct.run(
    'prod_chair',
    'sell_horizon',
    'AeroMesh Everyday Study & Office Chair',
    'Horizon Workspace',
    'Home',
    3499.0,
    19,
    '/src/assets/images/product_ergo_chair_1795505380729.jpg',
    'Breathable mid-back mesh study and work-from-home chair with curved lumbar support, brushed aluminum base, pneumatic height lift, and smooth swivel casters.',
    JSON.stringify([
      { label: 'Assembly Time', value: '10 Minutes Tool-Free' },
      { label: 'Weight Capacity', value: '110 kg Standard Frame' },
      { label: 'Lumbar Support', value: 'Contoured Fixed Mesh' },
      { label: 'Frame Material', value: 'Brushed Aluminum + Steel Base' }
    ]),
    5,
    now
  );

  insertProduct.run(
    'prod_purifier',
    'sell_northwind',
    'PureAir Compact HEPA Room Purifier',
    'Northwind Air',
    'Home',
    2499.0,
    34,
    '/src/assets/images/product_air_purifier_1795505387067.jpg',
    '360-degree compact bedroom H13 HEPA air purifier with PM2.5 dust indicator, washable pre-filter, and quiet sleep timer for everyday home air care.',
    JSON.stringify([
      { label: 'Room Coverage', value: 'Up to 350 sq ft Bedroom' },
      { label: 'Noise Floor', value: '24 dB Sleep Mode' },
      { label: 'Filtration', value: '3-Stage H13 HEPA + Carbon' },
      { label: 'Controls', value: 'Touch Panel + App Timer' }
    ]),
    3,
    now
  );

  insertProduct.run(
    'prod_keyboard',
    'sell_horizon',
    'Tactile68 Compact Wireless Keyboard',
    'Horizon Input',
    'Electronics',
    899.0,
    42,
    '/src/assets/images/product_mech_keyboard_1795505381635.jpg',
    'Compact 65% wireless mechanical-feel desk keyboard with volume control knob, PBT keycaps, and dual 2.4GHz USB dongle + Bluetooth pairing.',
    JSON.stringify([
      { label: 'Battery Endurance', value: '3 Weeks Per Charge' },
      { label: 'Chassis', value: 'Matte ABS + Aluminum Top Plate' },
      { label: 'Connectivity', value: '2.4GHz / Bluetooth 5.1 / USB-C' },
      { label: 'Keycaps', value: 'Two-Tone Slate-Teal PBT' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_cookware',
    'sell_northwind',
    'NordicMatte 3L Non-Stick Ceramic Pot',
    'Northwind Culinary',
    'Kitchen',
    849.0,
    26,
    '/src/assets/images/product_ceramic_cookware_1795505382032.jpg',
    'Everyday 3-liter die-cast aluminum cooking pot with PFAS-free non-stick ceramic coating and induction-compatible base for daily curries, dal, and stews.',
    JSON.stringify([
      { label: 'Capacity', value: '3.0 Liters Everyday Family Pot' },
      { label: 'Cooktop Support', value: 'Gas & Induction Compatible' },
      { label: 'Weight', value: '1.8 kg Easy-Lift Body' },
      { label: 'Coating', value: 'PFAS-Free Ceramic Non-Stick' }
    ]),
    3,
    now
  );

  // Group Deals (Commit Now, Pay After Group Confirmation — realistic 5-15% group discounts)
  const insertDeal = db.prepare(`
    INSERT INTO group_deals (id, product_id, seller_id, title, min_participants, current_participants, discount_percent, tier2_min, tier2_discount, status, expires_at, payment_window_hours, requested_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 24, ?, ?)
  `);

  const in2Days = new Date(Date.now() + 2 * 86400000).toISOString();
  const in3Days = new Date(Date.now() + 3 * 86400000).toISOString();

  // Stage 1: Collecting Commitments (0 paid, Waiting for Group Completion)
  // deal_headphones: 3/5 committed (liam, alex, priya) — Maya NOT yet joined
  // deal_espresso: 2/5 committed (liam, maya) — 0 paid
  insertDeal.run('deal_headphones', 'prod_headphones', 'sell_horizon', 'Audio & Electronics Group Drop', 5, 3, 12, 10, 15, 'active', in3Days, null, now);
  insertDeal.run('deal_espresso', 'prod_espresso', 'sell_northwind', 'Morning Coffee Maker Pool', 5, 2, 12, 10, 15, 'active', in2Days, null, now);

  const insertMember = db.prepare(`
    INSERT INTO group_deal_members (id, deal_id, user_id, quantity, commitment_status, confirmed_at)
    VALUES (?, ?, ?, ?, 'Committed', ?)
  `);
  insertMember.run('gdm_hp_1', 'deal_headphones', 'cust_liam', 1, now);
  insertMember.run('gdm_hp_2', 'deal_headphones', 'cust_alex', 1, now);
  insertMember.run('gdm_hp_3', 'deal_headphones', 'cust_priya', 1, now);

  insertMember.run('gdm_esp_1', 'deal_espresso', 'cust_liam', 1, now);
  insertMember.run('gdm_esp_2', 'deal_espresso', 'cust_maya', 1, now);

  // Availability Slots for Maya Chen
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const slots = ['Morning (8am–12pm)', 'Afternoon (12pm–4pm)', 'Evening (4pm–8pm)'];
  const insertSlot = db.prepare(`
    INSERT INTO availability_slots (id, user_id, day_of_week, slot_label, status, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const day of days) {
    for (const slot of slots) {
      let status: 'available' | 'unavailable' = 'unavailable';
      let note = '';
      if (slot === 'Evening (4pm–8pm)' && ['Mon', 'Wed', 'Fri'].includes(day)) {
        status = 'available';
        note = 'Home after 4:30pm — ring intercom #4B';
      } else if (['Sat', 'Sun'].includes(day) && slot !== 'Evening (4pm–8pm)') {
        status = 'available';
        note = 'Weekend doorstep delivery preferred';
      }
      insertSlot.run(`slot_maya_${day}_${slot.slice(0, 4)}`, 'cust_maya', day, slot, status, note);
    }
  }

  // Orders for Maya Chen (one Delivered, one Confirmed eligible to combine!)
  const insertOrder = db.prepare(`
    INSERT INTO orders (id, customer_id, deal_id, delivery_mode, combined_group_id, scheduled_window, shipping_fee, subtotal, discount_total, total_amount, payment_status, fulfillment_status, tracking_stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, seller_id, quantity, unit_price, deal_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  const fourHoursAgo = new Date(Date.now() - 4 * 3600000).toISOString();

  insertOrder.run(
    'CS-1041',
    'cust_maya',
    null,
    'express_separate',
    null,
    'Sat · Morning (8am–12pm)',
    49.0,
    1199.0,
    0,
    1248.0,
    'Paid (Simulated)',
    'Delivered',
    'Delivered',
    twoDaysAgo
  );
  insertOrderItem.run('oi_1041_1', 'CS-1041', 'prod_headphones', 'sell_horizon', 1, 1199.0, null);

  insertOrder.run(
    'CS-1048',
    'cust_maya',
    null,
    'combined',
    'CMB-SEA-402',
    'Wed · Evening (4pm–8pm)',
    0,
    2499.0,
    0,
    2499.0,
    'Paid (Simulated)',
    'Confirmed',
    'Order Confirmed · Preparing Order',
    fourHoursAgo
  );
  insertOrderItem.run('oi_1048_1', 'CS-1048', 'prod_purifier', 'sell_northwind', 1, 2499.0, null);

  // Regular individual order for Liam (non-group)
  insertOrder.run(
    'CS-1049',
    'cust_liam',
    null,
    'combined',
    'CMB-SEA-511',
    'Fri · Evening (4pm–8pm)',
    0,
    849.0,
    0,
    849.0,
    'Paid (Simulated)',
    'Combined & Packed',
    'Combined & Packed · Ready for Dispatch',
    fourHoursAgo
  );
  insertOrderItem.run('oi_1049_2', 'CS-1049', 'prod_cookware', 'sell_northwind', 1, 849.0, null);

  // Seed Reviews (mix of genuine verified reviews + realistic suspicious pattern reviews flagged by AI)
  const insertReview = db.prepare(`
    INSERT INTO reviews (id, product_id, user_id, author_name, rating, title, body, verified_purchase, created_at, ai_trust_flag, ai_flag_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Headphones reviews
  insertReview.run('rev_hp_1', 'prod_headphones', 'cust_maya', 'Maya Chen', 4, 'Balanced studio tuning, slightly less battery than spec',
    'Soundstage and aluminum hinges feel genuinely premium. However, with Hybrid ANC on during my commute and office work at 70% volume, I consistently get around 32 to 34 hours before needing USB-C, not the advertised 45 hours.',
    1, '2026-11-18', 'trusted', null);
  insertReview.run('rev_hp_2', 'prod_headphones', 'cust_liam', 'Liam Patel', 5, 'Multipoint switching is seamless',
    'Switches effortlessly between my laptop and phone. Clamping force felt tight out of the box for the first 10 days, then broke in nicely. Battery averages 33 hours with ANC enabled.',
    1, '2026-11-19', 'trusted', null);
  insertReview.run('rev_hp_3', 'prod_headphones', 'user_ext_1', 'Jordan K.', 4, 'Great ANC on flights, snug fit',
    'Blocked cabin drone well on a 5-hour flight. Real-world battery with ANC stayed near 31 hours. Ear cups are plush but slightly warm after 3 hours.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_hp_4', 'prod_headphones', 'user_ext_2', 'Elena R.', 4, 'Solid build quality for group buy price',
    'Got these at 12% off in a group pool. Mic clarity on Zoom calls is clear, though battery drops closer to 34h with regular Bluetooth listening.',
    1, '2026-11-21', 'trusted', null);
  insertReview.run('rev_hp_5', 'prod_headphones', 'user_ext_bot1', 'DealHunter992', 5, 'BEST HEADPHONES EVER!!! 10/10 BUY NOW',
    'AMAZING SOUND BEST IN THE WORLD!!! PERFECT 100 HOURS BATTERY AND BEST PRODUCT EVER BUY THIS TODAY YOU WILL NOT REGRET IT!!!',
    0, '2026-11-22', 'flagged_suspicious', 'Unverified purchase using all-caps promotional hype and exaggerated claims contradicting verified buyer measurements.');

  // Espresso reviews
  insertReview.run('rev_esp_1', 'prod_espresso', 'cust_liam', 'Liam Patel', 5, 'Consistent crema once properly preheated',
    'Pulls café-quality double shots with the 58mm walnut portafilter. Note that while water heats in 25 seconds, you need about 3 to 4 minutes for the portafilter and group head to reach thermal stability.',
    1, '2026-11-15', 'trusted', null);
  insertReview.run('rev_esp_2', 'prod_espresso', 'user_ext_3', 'Samira N.', 4, 'Compact footprint, allow extra warm-up time',
    'Looks gorgeous on the counter and steam wand textures microfoam well. Ignore the 25-second claim for real espresso—give it 3.5 minutes to preheat the brass group head.',
    1, '2026-11-17', 'trusted', null);
  insertReview.run('rev_esp_3', 'prod_espresso', 'user_ext_4', 'David M.', 4, 'Great pressure gauge feedback',
    'The analog gauge helped me dial in my grind size immediately. Drip tray is a bit shallow and warm-up takes ~4 minutes for hot shots.',
    1, '2026-11-19', 'trusted', null);
  insertReview.run('rev_esp_4', 'prod_espresso', 'user_ext_bot2', 'CoffeeLover_X1', 5, 'Wonderful item super fast delivery great quality',
    'Wonderful item super fast delivery great quality highly recommend to everyone five stars best coffee maker in every category.',
    0, '2026-11-21', 'flagged_suspicious', 'Repeated template phrasing observed across unrelated listings without specific usage or feature details.');
  insertReview.run('rev_esp_5', 'prod_espresso', 'user_ext_bot3', 'KitchenPro_X2', 5, 'Wonderful item super fast delivery great quality',
    'Wonderful item super fast delivery great quality highly recommend to everyone five stars best coffee maker in every category.',
    0, '2026-11-21', 'flagged_suspicious', 'Near-identical duplicate review submitted on the same date from an unverified account.');

  // Chair reviews
  insertReview.run('rev_chr_1', 'prod_chair', 'user_ext_5', 'Priya V.', 5, 'Lower back relief after 8-hour days',
    'Breathable mesh never traps heat and the aluminum base feels rock solid. Assembly took me about 30 minutes with the included hex wrench—not 10 minutes tool-free.',
    1, '2026-11-14', 'trusted', null);
  insertReview.run('rev_chr_2', 'prod_chair', 'user_ext_6', 'Marcus T.', 4, 'Sturdy frame, allow 30 mins setup',
    '4D armrests lock cleanly without wobble. Box is heavy and assembly definitely requires the included hex key for roughly 25–30 minutes.',
    1, '2026-11-18', 'trusted', null);
  insertReview.run('rev_chr_3', 'prod_chair', 'user_ext_bot4', 'AnonBuyer04', 1, 'Terrible product do not buy worst ever',
    'Worst product ever made cheap plastic broke immediately stay away buy competitor brand instead total waste.',
    0, '2026-11-22', 'flagged_suspicious', 'Unverified 1-star review referencing "cheap plastic" that conflicts with verified aluminum frame reports and lacks specific defect details.');

  // Purifier reviews
  insertReview.run('rev_pur_1', 'prod_purifier', 'cust_maya', 'Maya Chen', 4, 'Whisper quiet in bedroom, realistic room size ~400 sq ft',
    'On sleep mode it is genuinely near silent and cleared seasonal pollen quickly in my 380 sq ft bedroom. In an open 650 sq ft loft you have to run level 3, which is audible.',
    1, '2026-11-16', 'trusted', null);
  insertReview.run('rev_pur_2', 'prod_purifier', 'user_ext_7', 'Hannah L.', 5, 'PM2.5 sensor responds immediately',
    'Detects cooking smoke within seconds. Best for medium rooms around 350–450 sq ft if you want quiet fan operation.',
    1, '2026-11-20', 'trusted', null);

  // Keyboard reviews
  insertReview.run('rev_kbd_1', 'prod_keyboard', 'user_ext_8', 'Kevin Z.', 5, 'Thocky gasket feel and crisp CNC finish',
    'Heavy aluminum chassis with zero ping. Note that with RGB backlighting on at 60%, battery lasts about 7 days—you only hit 3 weeks with LEDs completely off.',
    1, '2026-11-17', 'trusted', null);
  insertReview.run('rev_kbd_2', 'prod_keyboard', 'user_ext_9', 'Nadia B.', 4, 'Great rotary knob, RGB drains battery faster',
    '2.4GHz dongle has zero noticeable latency. Expect roughly 6 to 8 days per charge if you keep backlighting active.',
    1, '2026-11-20', 'trusted', null);

  // Cookware reviews
  insertReview.run('rev_ck_1', 'prod_cookware', 'cust_liam', 'Liam Patel', 5, 'Even heat and effortless cleanup',
    'Sears short ribs evenly and wipes clean after braising. Oven safe up to 500°F held true when baking sourdough.',
    1, '2026-11-19', 'trusted', null);
  insertReview.run('rev_ck_2', 'prod_cookware', 'user_ext_10', 'Claire W.', 5, 'Lighter than cast iron, solid heat retention',
    'Weighs right around 11 lbs and the deep teal finish looks sharp on the stove.',
    1, '2026-11-21', 'trusted', null);

  // Seed AI Insights (pros, cons, spec-vs-review discrepancies)
  const insertInsights = db.prepare(`
    INSERT INTO product_ai_insights (product_id, pros_json, cons_json, discrepancies_json, summary_headline, analyzed_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertInsights.run(
    'prod_headphones',
    JSON.stringify([
      'Premium brushed aluminum hinges and balanced studio audio',
      'Seamless Bluetooth 5.3 multipoint switching between laptop & phone',
      'Strong cabin and commute noise isolation (-42dB ANC)'
    ]),
    JSON.stringify([
      'Real-world battery averages 31–34 hrs with ANC on (below 45 hr spec)',
      'Initial clamping force feels snug for the first 1–2 weeks'
    ]),
    JSON.stringify([
      {
        specName: 'Battery Life',
        advertisedClaim: '45 Hours (ANC On)',
        verifiedFeedback: 'Verified buyers consistently report 31–34 hours with ANC active at 70% volume.',
        severity: 'notable',
        evidenceCount: 4
      },
      {
        specName: 'Comfort & Fit',
        advertisedClaim: 'All-day lightweight studio fit',
        verifiedFeedback: 'Snug headband clamping pressure reported during the first 10–14 days of break-in.',
        severity: 'minor',
        evidenceCount: 2
      }
    ]),
    'Strong acoustic value in group buys, though real-world ANC battery runs ~25% shorter than advertised.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_espresso',
    JSON.stringify([
      'Consistent crema and accurate analog shot pressure feedback',
      'Commercial 58mm walnut portafilter and responsive steam wand',
      'Compact stainless steel footprint fits tight kitchen counters'
    ]),
    JSON.stringify([
      'Requires 3–4 minutes of preheating for hot shots (vs 25s advertised)',
      'Drip tray fills quickly when pulling consecutive lattes'
    ]),
    JSON.stringify([
      {
        specName: 'Warm-up Time',
        advertisedClaim: '25 Seconds Fast Heat',
        verifiedFeedback: 'Thermoblock heats in 25s, but portafilter & group head need 3–4 minutes to reach brew temperature.',
        severity: 'notable',
        evidenceCount: 3
      }
    ]),
    'Delivers rich café shots once preheated for 3–4 minutes; 2 suspicious copy-paste reviews were flagged.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_chair',
    JSON.stringify([
      'Breathable elastomeric mesh stays cool during 8-hour workdays',
      'Rigid die-cast aluminum base and wobble-free 4D armrests'
    ]),
    JSON.stringify([
      'Assembly takes 25–35 minutes with included hex wrench (not 10 mins tool-free)',
      'Box weight requires two people to carry upstairs'
    ]),
    JSON.stringify([
      {
        specName: 'Assembly Time',
        advertisedClaim: '10 Minutes Tool-Free',
        verifiedFeedback: 'Verified buyers report 25–35 minute assembly requiring the included hex wrench.',
        severity: 'minor',
        evidenceCount: 2
      }
    ]),
    'Durable aluminum-frame ergonomics validated by verified buyers; assembly takes longer than claimed.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_purifier',
    JSON.stringify([
      'Near-silent 21 dB sleep mode ideal for bedrooms',
      'Fast-reacting PM2.5 laser air quality sensor'
    ]),
    JSON.stringify([
      'Quiet fan speeds cover ~350–450 sq ft effectively rather than 650 sq ft',
      'Higher fan speeds are noticeable in open living areas'
    ]),
    JSON.stringify([
      {
        specName: 'Room Coverage',
        advertisedClaim: 'Up to 650 sq ft (1x/hr)',
        verifiedFeedback: 'Verified owners recommend 350–450 sq ft rooms for quiet everyday filtration.',
        severity: 'notable',
        evidenceCount: 2
      }
    ]),
    'Excellent quiet bedroom purifier; full 650 sq ft rating only applies on audible high fan speed.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_keyboard',
    JSON.stringify([
      'Solid CNC 6063 aluminum chassis with clean gasket-mounted acoustics',
      'Zero-latency 2.4GHz wireless and tactile rotary encoder'
    ]),
    JSON.stringify([
      'Battery lasts 6–8 days with RGB enabled (3 weeks requires LEDs off)'
    ]),
    JSON.stringify([
      {
        specName: 'Battery Endurance',
        advertisedClaim: '3 Weeks Per Charge',
        verifiedFeedback: 'Lasts 6–8 days with per-key RGB active; 3-week rating applies only with backlighting disabled.',
        severity: 'notable',
        evidenceCount: 2
      }
    ]),
    'Crisp aluminum build and latency; expect weekly charging when using RGB backlighting.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_cookware',
    JSON.stringify([
      'Even heat distribution and effortless non-stick ceramic cleanup',
      'Verified 500°F oven-safe performance for bread baking and braising',
      'Lighter handling than traditional enameled cast iron'
    ]),
    JSON.stringify([
      'Handles get hot in the oven and require mitts'
    ]),
    JSON.stringify([]),
    'Advertised specs match verified customer feedback closely with zero notable discrepancies.',
    now,
    'seeded'
  );
}

function seedFashionCatalog() {
  const now = new Date().toISOString();
  const in2Days = new Date(Date.now() + 2 * 86400000).toISOString();
  const in3Days = new Date(Date.now() + 3 * 86400000).toISOString();

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products (id, seller_id, name, brand, category, price, stock, image_url, description, specs_json, delivery_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertProduct.run(
    'prod_sneakers',
    'sell_horizon',
    'StrideAir Knit Everyday Sneakers',
    'Horizon Footwear',
    'Shoes',
    999.0,
    36,
    '/src/assets/images/product_knit_sneakers_1795506416917.jpg',
    'Breathable knit everyday walking sneakers with cushioned EVA sole, padded heel collar, and non-slip rubber grip built for daily commutes and walks.',
    JSON.stringify([
      { label: 'Fit & Sizing', value: 'True to Standard Size' },
      { label: 'Upper Material', value: 'Breathable Knit Mesh' },
      { label: 'Weight', value: '245g Per Shoe' },
      { label: 'Care', value: 'Cold Gentle Wash' }
    ]),
    3,
    now
  );

  insertProduct.run(
    'prod_tote',
    'sell_northwind',
    'Harbor Everyday Pebble Tote Bag',
    'Northwind Carry',
    'Accessories',
    899.0,
    24,
    '/src/assets/images/product_leather_tote_1795506416626.jpg',
    'Structured everyday commuter tote bag with padded laptop sleeve, removable shoulder strap, and full-width magnetic top seal.',
    JSON.stringify([
      { label: 'Laptop Capacity', value: 'Fits up to 15.6-inch Laptop' },
      { label: 'Material', value: 'Pebble-Grain Textured Leather Finish' },
      { label: 'Closure', value: 'Full-Width Magnetic Top Seal' },
      { label: 'Strap Drop', value: '10.5-inch Shoulder + Crossbody' }
    ]),
    3,
    now
  );

  insertProduct.run(
    'prod_cap',
    'sell_horizon',
    'Summit Cotton 6-Panel Everyday Cap',
    'Horizon Headwear',
    'Hats',
    299.0,
    54,
    '/src/assets/images/product_cotton_cap_1795506416952.jpg',
    'Soft-washed 6-panel casual cap crafted from breathable cotton twill with sweat-absorbing inner band and adjustable matte strap clasp.',
    JSON.stringify([
      { label: 'Fabric', value: '100% Brushed Cotton Twill' },
      { label: 'Sizing Range', value: 'Adjustable 54cm–61cm' },
      { label: 'Crown Profile', value: 'Low-Profile Casual Fit' },
      { label: 'Hardware', value: 'Matte Metal Clasp' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_crewneck',
    'sell_northwind',
    'CloudWeave Everyday Cotton Sweatshirt',
    'Northwind Apparel',
    'Clothing',
    649.0,
    40,
    '/src/assets/images/product_merino_crewneck_1795506418262.jpg',
    'Soft 320gsm everyday combed-cotton crewneck sweatshirt with ribbed cuffs and comfortable breathable weave for mild winters and AC offices.',
    JSON.stringify([
      { label: 'Fabric Blend', value: '100% Combed Cotton Loopback' },
      { label: 'Pre-Shrunk', value: 'Zero-Shrinkage Enzyme Wash' },
      { label: 'Fabric Weight', value: '320 GSM Everyday Weight' },
      { label: 'Care', value: 'Machine Wash Cold, Line Dry' }
    ]),
    3,
    now
  );

  insertProduct.run(
    'prod_sunglasses',
    'sell_horizon',
    'Vista Polarized UV400 Sunglasses',
    'Horizon Optics',
    'Accessories',
    449.0,
    27,
    '/src/assets/images/product_acetate_sunglasses_1795506418208.jpg',
    'Lightweight everyday tortoise-frame sunglasses with UV400 polarized lenses for clear afternoon driving and outdoor glare protection.',
    JSON.stringify([
      { label: 'Lens Optics', value: 'Polarized UV400 Anti-Glare' },
      { label: 'Frame Material', value: 'Lightweight Acetate + Metal Hinges' },
      { label: 'Bridge Fit', value: 'Medium Universal Fit' },
      { label: 'Included Case', value: 'Zippered Pouch + Cloth' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_jacket',
    'sell_northwind',
    'Atelier Everyday Cotton Casual Shirt',
    'Northwind Apparel',
    'Clothing',
    699.0,
    28,
    '/src/assets/images/product_chore_jacket_1795506418016.jpg',
    'Everyday relaxed-fit full-sleeve cotton overshirt crafted from durable breathable twill with twin chest utility pockets for daily wear.',
    JSON.stringify([
      { label: 'Fabric Weight', value: 'Soft-Washed Cotton Twill' },
      { label: 'Fit Profile', value: 'Relaxed Everyday Regular Cut' },
      { label: 'Pockets', value: 'Twin Chest Utility Pockets' },
      { label: 'Buttons', value: 'Matte Resin Buttons' }
    ]),
    3,
    now
  );

  // Active Group Deals (Commit Now, Pay After Group Confirmation — realistic 5-15% discounts)
  const insertDeal = db.prepare(`
    INSERT OR IGNORE INTO group_deals (id, product_id, seller_id, title, min_participants, current_participants, discount_percent, tier2_min, tier2_discount, status, expires_at, payment_window_hours, requested_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 24, ?, ?)
  `);

  // deal_sneakers: 4/5 committed (1 away from threshold!) — 0 paid yet
  // deal_tote: 1/4 committed — 0 paid yet
  insertDeal.run('deal_sneakers', 'prod_sneakers', 'sell_horizon', 'Everyday Walkers Collective', 5, 4, 12, 10, 15, 'active', in3Days, null, now);
  insertDeal.run('deal_tote', 'prod_tote', 'sell_northwind', 'Commuter Tote Group Pool', 4, 1, 10, 8, 14, 'active', in2Days, null, now);

  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO group_deal_members (id, deal_id, user_id, quantity, commitment_status, confirmed_at)
    VALUES (?, ?, ?, ?, 'Committed', ?)
  `);

  for (const [idx, cid] of [
    [1, 'cust_liam'],
    [2, 'cust_alex'],
    [3, 'cust_priya'],
    [4, 'cust_sam'],
  ] as const) {
    insertMember.run(`gdm_snk_${idx}`, 'deal_sneakers', cid, 1, now);
  }

  insertMember.run('gdm_tote_1', 'deal_tote', 'cust_liam', 1, now);

  // Realistic Reviews + Trust Flags
  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO reviews (id, product_id, user_id, author_name, rating, title, body, verified_purchase, created_at, ai_trust_flag, ai_flag_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertReview.run('rev_snk_1', 'prod_sneakers', 'cust_maya', 'Maya Chen', 4, 'Super breathable knit, size up half a size',
    'Cushioning feels effortless on 5-mile city walks. Toe box runs slightly snug if you wear thicker athletic socks, so ordering half a size up gives a better fit than true-to-size.',
    1, '2026-11-19', 'trusted', null);
  insertReview.run('rev_snk_2', 'prod_sneakers', 'user_ext_11', 'Devon S.', 5, 'Lightweight commuter sneaker',
    'Put these through the cold wash cycle twice and they held shape perfectly. Half size up worked great for wider feet.',
    1, '2026-11-21', 'trusted', null);
  insertReview.run('rev_snk_3', 'prod_sneakers', 'user_ext_bot5', 'ShoeKing88', 5, 'BEST SHOES EVER BUY NOW 10/10',
    'AMAZING SNEAKERS BEST RUNNING SHOES IN THE WORLD SO COMFORTABLE BUY THIS TODAY FIVE STARS!!!',
    0, '2026-11-22', 'flagged_suspicious', 'Unverified review with all-caps promotional phrasing and zero specific sizing or wear details.');

  insertReview.run('rev_tote_1', 'prod_tote', 'cust_liam', 'Liam Patel', 5, 'Holds 16-inch laptop cleanly with structure',
    'Stands upright on its own and pebble leather resists light rain. Note the top uses a magnetic snap rather than a full zipper.',
    1, '2026-11-20', 'trusted', null);

  insertReview.run('rev_cap_1', 'prod_cap', 'user_ext_12', 'Tessa H.', 5, 'Soft twill and sturdy metal clasp',
    'Broken-in feel right out of the box and the muted teal color pairs easily with neutral outerwear.',
    1, '2026-11-20', 'trusted', null);

  insertReview.run('rev_crw_1', 'prod_crewneck', 'cust_maya', 'Maya Chen', 4, 'Thick 420gsm drape—line dry recommended',
    'Love the heavyweight merino-cotton knit. After tumble drying low once, sleeves shrunk roughly half an inch, so hang drying keeps the original fit best.',
    1, '2026-11-18', 'trusted', null);
  insertReview.run('rev_crw_2', 'prod_crewneck', 'user_ext_13', 'Owen P.', 5, 'Warm without feeling bulky',
    'Rich slate heather texture. Stick to cold wash and air dry to avoid minor sleeve shrinkage.',
    1, '2026-11-21', 'trusted', null);

  insertReview.run('rev_sun_1', 'prod_sunglasses', 'user_ext_14', 'Clara G.', 5, 'Featherweight titanium temples',
    'Zero glare on afternoon drives and doesn’t pinch behind the ears.',
    1, '2026-11-21', 'trusted', null);

  insertReview.run('rev_jac_1', 'prod_jacket', 'cust_liam', 'Liam Patel', 5, 'Sharp silhouette after a couple wears',
    'Canvas arrives noticeably crisp out of the package rather than soft-washed, then softens nicely after 3–4 wears.',
    1, '2026-11-20', 'trusted', null);

  // Insights for new products
  const insertInsights = db.prepare(`
    INSERT OR IGNORE INTO product_ai_insights (product_id, pros_json, cons_json, discrepancies_json, summary_headline, analyzed_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertInsights.run(
    'prod_sneakers',
    JSON.stringify([
      'Lightweight breathable fly-knit upper holds shape after cold washing',
      'Responsive EVA midsole cushioning for long city walks'
    ]),
    JSON.stringify([
      'Toe box runs slightly narrow for thicker socks (half size up advised)'
    ]),
    JSON.stringify([
      {
        specName: 'Fit & Sizing',
        advertisedClaim: 'True to Standard US Size',
        verifiedFeedback: 'Verified buyers recommend sizing up 0.5 for wider feet or thick athletic socks.',
        severity: 'minor',
        evidenceCount: 2
      }
    ]),
    'Comfortable washable knit sneaker; consider sizing up half a size for extra toe room.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_tote',
    JSON.stringify([
      'Structured pebble leather stands upright without sagging',
      'Padded 16-inch laptop compartment and versatile crossbody strap'
    ]),
    JSON.stringify([
      'Top closure is a magnetic snap rather than a sealed zipper'
    ]),
    JSON.stringify([]),
    'Well-crafted commuter tote matching advertised capacity and leather quality.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_cap',
    JSON.stringify([
      'Soft garment-washed twill with durable matte metal clasp',
      'Comfortable unstructured low-profile crown'
    ]),
    JSON.stringify([]),
    JSON.stringify([]),
    'Verified buyers confirm true-to-description comfort, fabric, and hardware finish.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_crewneck',
    JSON.stringify([
      'Substantial 420gsm organic cotton-merino knit drapes cleanly',
      'Soft interior warmth without overheating indoors'
    ]),
    JSON.stringify([
      'Minor sleeve shrinkage (~0.5 in) observed when tumble dried low'
    ]),
    JSON.stringify([
      {
        specName: 'Care & Shrinkage',
        advertisedClaim: 'Zero-Shrinkage Enzyme Wash (Tumble Low)',
        verifiedFeedback: 'Verified wearers report slight sleeve shrinkage in the dryer and recommend air drying.',
        severity: 'minor',
        evidenceCount: 2
      }
    ]),
    'Premium heavyweight knit; hang dry instead of tumble drying to preserve sleeve length.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_sunglasses',
    JSON.stringify([
      'Polarized CR-39 lenses cut road glare effectively',
      'Lightweight titanium temples prevent ear fatigue'
    ]),
    JSON.stringify([]),
    JSON.stringify([]),
    'Optics and frame proportions match verified buyer expectations.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_jacket',
    JSON.stringify([
      'Structured 11oz organic duck canvas with spacious utility pockets',
      'Natural corozo buttons and clean layering fit'
    ]),
    JSON.stringify([
      'Arrives stiffer than advertised soft-wash finish until broken in'
    ]),
    JSON.stringify([
      {
        specName: 'Canvas Finish',
        advertisedClaim: '11oz Soft-Washed Organic Duck',
        verifiedFeedback: 'Canvas arrives crisp out of the box and softens after 3–4 wears.',
        severity: 'minor',
        evidenceCount: 1
      }
    ]),
    'Durable chore overshirt with tailored lines; canvas breaks in over the first week.',
    now,
    'seeded'
  );
}

function seedExtendedTechAndCarryCatalog() {
  const now = new Date().toISOString();
  const in2Days = new Date(Date.now() + 2 * 86400000).toISOString();
  const in3Days = new Date(Date.now() + 3 * 86400000).toISOString();

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products (id, seller_id, name, brand, category, price, stock, image_url, description, specs_json, delivery_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertProduct.run(
    'prod_backpack_commuter',
    'sell_horizon',
    'Aeropack 28L Everyday Laptop Backpack',
    'Horizon Carry',
    'Backpacks',
    799.0,
    38,
    '/src/assets/images/product_commuter_backpack_1795570919858.jpg',
    'Water-resistant everyday college and office backpack with padded 15.6-inch laptop compartment, side bottle pocket, and breathable padded straps.',
    JSON.stringify([
      { label: 'Capacity', value: '28 Liters Everyday Size' },
      { label: 'Laptop Sleeve', value: 'Padded 15.6-inch Compartment' },
      { label: 'Shell Material', value: 'Water-Resistant Ripstop Polyester' },
      { label: 'Weight', value: '620g Lightweight Carry' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_backpack_trail',
    'sell_northwind',
    'Summit 32L Weekend Travel Backpack',
    'Northwind Carry',
    'Backpacks',
    1199.0,
    26,
    '/src/assets/images/product_trail_backpack_1795570920300.jpg',
    'Spacious 32L multi-compartment travel and college backpack with rain cover, front organizer pocket, and padded air-mesh back panel.',
    JSON.stringify([
      { label: 'Capacity', value: '32 Liters Cabin-Friendly' },
      { label: 'Opening Style', value: 'Wide Clamshell Zip Access' },
      { label: 'Weatherproofing', value: 'Water-Repellent + Rain Cover' },
      { label: 'Compartments', value: '16-inch Laptop + Front Organizer' }
    ]),
    3,
    now
  );

  insertProduct.run(
    'prod_mobile_flagship',
    'sell_horizon',
    'NovaPhone Daily 5G (128GB)',
    'Horizon Mobile',
    'Mobiles',
    13999.0,
    20,
    '/src/assets/images/product_flagship_mobile_1795570919653.jpg',
    'Reliable everyday 5G smartphone featuring a 6.6-inch 120Hz AMOLED display, 50MP main camera, dual SIM 5G connectivity, and 5,000mAh all-day battery.',
    JSON.stringify([
      { label: 'Display', value: '6.6" 120Hz Full HD+ AMOLED' },
      { label: 'Storage & RAM', value: '128GB / 6GB RAM (Expandable)' },
      { label: 'Camera System', value: '50MP Main + 8MP Ultra-Wide' },
      { label: 'Battery', value: '5,000mAh · 33W Fast Charger Included' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_mobile_compact',
    'sell_horizon',
    'Aether 5G Everyday Phone (128GB)',
    'Horizon Mobile',
    'Mobiles',
    9999.0,
    29,
    '/src/assets/images/product_compact_mobile_1795570919818.jpg',
    'Affordable everyday 5G phone with crisp 6.5-inch display, 5,000mAh battery, clean UPI-ready Android experience, and side fingerprint unlock.',
    JSON.stringify([
      { label: 'Display', value: '6.5" 90Hz HD+ Display' },
      { label: 'Storage & RAM', value: '128GB / 4GB RAM' },
      { label: 'Connectivity', value: 'Dual 5G SIM + USB-C' },
      { label: 'Battery', value: '5,000mAh All-Day Battery' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_laptop_oled',
    'sell_horizon',
    'ZenCore 14 Everyday Student Laptop',
    'Horizon Compute',
    'Laptops',
    24999.0,
    15,
    '/src/assets/images/product_oled_laptop_1795570920351.jpg',
    'Lightweight 14-inch everyday student and office laptop with Full HD anti-glare display, 8GB RAM, 256GB SSD, and long battery life for classes and spreadsheets.',
    JSON.stringify([
      { label: 'Display', value: '14" Full HD Anti-Glare IPS' },
      { label: 'Memory & SSD', value: '8GB DDR4 / 256GB NVMe SSD' },
      { label: 'Battery Life', value: 'Up to 10 Hours Everyday Use' },
      { label: 'Weight', value: '1.38 kg Slim Chassis' }
    ]),
    4,
    now
  );

  insertProduct.run(
    'prod_laptop_workstation',
    'sell_northwind',
    'StudioBook 15 Office & Study Laptop',
    'Northwind Compute',
    'Laptops',
    29999.0,
    12,
    '/src/assets/images/product_workstation_laptop_1795570920691.jpg',
    'Dependable 15.6-inch everyday office laptop with 8GB RAM, 512GB SSD, numeric keypad, HD webcam with privacy shutter, and full HDMI + USB ports.',
    JSON.stringify([
      { label: 'Display', value: '15.6" Full HD Anti-Glare' },
      { label: 'Memory & SSD', value: '8GB DDR4 / 512GB NVMe SSD' },
      { label: 'Keyboard', value: 'Full-Size with Numeric Keypad' },
      { label: 'Ports', value: 'USB-C, 2× USB-A, HDMI, SD Reader' }
    ]),
    5,
    now
  );

  // Active Group Deals (realistic 5-15% Tier 1 discounts, strictly cheaper than normal retail + delivery)
  const insertDeal = db.prepare(`
    INSERT OR IGNORE INTO group_deals (id, product_id, seller_id, title, min_participants, current_participants, discount_percent, tier2_min, tier2_discount, status, expires_at, payment_window_hours, requested_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 24, ?, ?)
  `);

  insertDeal.run('deal_backpack', 'prod_backpack_commuter', 'sell_horizon', 'Daily Commuter Bag Pool', 4, 2, 12, 8, 15, 'active', in3Days, null, now);
  insertDeal.run('deal_mobile', 'prod_mobile_flagship', 'sell_horizon', 'NovaPhone 5G Community Drop', 5, 3, 10, 10, 14, 'active', in3Days, null, now);
  insertDeal.run('deal_laptop', 'prod_laptop_oled', 'sell_horizon', 'Student Laptop Group Buy', 4, 2, 8, 8, 12, 'active', in2Days, null, now);

  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO group_deal_members (id, deal_id, user_id, quantity, commitment_status, confirmed_at)
    VALUES (?, ?, ?, ?, 'Committed', ?)
  `);

  insertMember.run('gdm_bp_1', 'deal_backpack', 'cust_liam', 1, now);
  insertMember.run('gdm_bp_2', 'deal_backpack', 'cust_alex', 1, now);

  insertMember.run('gdm_mob_1', 'deal_mobile', 'cust_liam', 1, now);
  insertMember.run('gdm_mob_2', 'deal_mobile', 'cust_priya', 1, now);
  insertMember.run('gdm_mob_3', 'deal_mobile', 'cust_sam', 1, now);

  insertMember.run('gdm_lap_1', 'deal_laptop', 'cust_alex', 1, now);
  insertMember.run('gdm_lap_2', 'deal_laptop', 'cust_priya', 1, now);

  // Reviews for Backpacks, Mobiles, Laptops
  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO reviews (id, product_id, user_id, author_name, rating, title, body, verified_purchase, created_at, ai_trust_flag, ai_flag_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertReview.run('rev_bpc_1', 'prod_backpack_commuter', 'cust_maya', 'Maya Chen', 5, 'Keeps 16-inch laptop bone dry in monsoon rain',
    'Rode to the metro in heavy downpour and the AquaGuard zips kept everything dry. Holds a 16-inch laptop, lunch box, and ANC headphones without digging into shoulders.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_bpc_2', 'prod_backpack_commuter', 'cust_liam', 'Liam Patel', 4, 'Structured silhouette, snug water-bottle sleeve',
    'Looks sharp in the office and stands upright on its own. Side stretch pocket fits a 750ml bottle well, though 1L wide flasks are a tight squeeze.',
    1, '2026-11-21', 'trusted', null);
  insertReview.run('rev_bpc_3', 'prod_backpack_commuter', 'user_ext_bot_bp', 'CarryPromo_90', 5, 'BEST BAG EVER 100L CAPACITY BUY TODAY',
    'AMAZING BACKPACK FITS EVERYTHING IN THE WORLD BUILT-IN SOLAR CHARGER AND MASSAGE STRAPS BUY NOW FIVE STARS!!!',
    0, '2026-11-22', 'flagged_suspicious', 'Unverified all-caps promotional review claiming nonexistent solar charger and massage straps.');

  insertReview.run('rev_bpt_1', 'prod_backpack_trail', 'cust_alex', 'Alex Rivera', 5, 'Packs easily for 4-day flights without checking luggage',
    'Clamshell opening makes packing cubes effortless. Used it on three domestic trips and it slides cleanly under most overhead bins.',
    1, '2026-11-19', 'trusted', null);
  insertReview.run('rev_bpt_2', 'prod_backpack_trail', 'user_ext_21', 'Rohan M.', 4, 'Durable Cordura, slightly heavy when packed full',
    'Zippers glide smoothly and the hidden passport sleeve sits snug against the back panel.',
    1, '2026-11-21', 'trusted', null);

  insertReview.run('rev_mob1_1', 'prod_mobile_flagship', 'cust_priya', 'Priya Nair', 5, '120Hz LTPO screen and 3x telephoto are crisp',
    'Zero shutter lag on night portraits and easily lasts a full 7am–11pm workday with 25% left. Included 67W adapter tops up to 80% in under 30 minutes.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_mob1_2', 'prod_mobile_flagship', 'cust_sam', 'Sam Brooks', 4, 'Titanium rails feel great, camera bump is noticeable',
    'Very bright outdoors even under harsh midday sun. Slightly top-heavy without a case because of the triple-camera module.',
    1, '2026-11-21', 'trusted', null);
  insertReview.run('rev_mob1_3', 'prod_mobile_flagship', 'user_ext_bot_mob', 'PhoneDeal_AI', 5, 'Seamlessly blends unmatched perfection and exceeds expectations',
    'From the moment I unboxed this smartphone, it proved to be an absolute game-changer with a 200-hour battery and holographic projector. In conclusion, cannot recommend enough!',
    0, '2026-11-22', 'flagged_suspicious', 'Potentially AI-generated & false review citing nonexistent 200-hour battery and holographic projector.');

  insertReview.run('rev_mob2_1', 'prod_mobile_compact', 'cust_maya', 'Maya Chen', 5, 'Finally a true one-handed 5G OLED phone',
    'Fits comfortably in jeans pockets and weighs almost nothing. Battery easily clears a full day of navigation, UPI payments, and podcasts.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_mob2_2', 'prod_mobile_compact', 'user_ext_22', 'Ananya S.', 4, 'Clean UI with zero bloatware',
    'Smooth 120Hz scrolling and loud stereo speakers. Charging takes around 55 minutes from 10% to 100%.',
    1, '2026-11-22', 'trusted', null);

  insertReview.run('rev_lap1_1', 'prod_laptop_oled', 'cust_alex', 'Alex Rivera', 5, '2.8K OLED panel is gorgeous for Lightroom and code',
    'Zero fan noise during web dev and photo edits. Real-world battery hovers around 10–11 hours at 60% brightness rather than 14 hours.',
    1, '2026-11-19', 'trusted', null);
  insertReview.run('rev_lap1_2', 'prod_laptop_oled', 'cust_priya', 'Priya Nair', 5, 'Lightweight 1.38kg everyday student companion',
    'Keyboard travel feels comfortable and the matte screen cuts classroom glare nicely. Group order saved ₹2,000 compared to regular checkout.',
    1, '2026-11-21', 'trusted', null);
  insertReview.run('rev_lap1_3', 'prod_laptop_oled', 'user_ext_bot_lap', 'LaptopBot_77', 5, 'Meticulously crafted masterpiece that elevates every workflow',
    'This laptop seamlessly blends form and function with a 40-hour battery and detachable touchscreen. In summary, it exceeds every expectation!',
    0, '2026-11-22', 'flagged_suspicious', 'Potentially AI-generated pattern & false specs (claims 40-hour battery and detachable touchscreen).');

  insertReview.run('rev_lap2_1', 'prod_laptop_workstation', 'user_ext_23', 'Vikram K.', 5, 'Sustained 4K timeline renders without throttling',
    'Vapor chamber cooling keeps CPU clocks steady during 20-minute Premiere exports. Full-size SD card slot is a lifesaver on shoots.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_lap2_2', 'prod_laptop_workstation', 'cust_liam', 'Liam Patel', 4, 'Rock-solid build, charger brick is bulky',
    '32GB DDR5 eats Docker containers and Figma tabs effortlessly. Anti-glare matte display works well next to bright windows.',
    1, '2026-11-21', 'trusted', null);

  // AI Insights for Backpacks, Mobiles, Laptops
  const insertInsights = db.prepare(`
    INSERT OR IGNORE INTO product_ai_insights (product_id, pros_json, cons_json, discrepancies_json, summary_headline, analyzed_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertInsights.run(
    'prod_backpack_commuter',
    JSON.stringify([
      '840D ballistic nylon & AquaGuard zippers protect laptops in heavy rain',
      'Stands upright cleanly with structured 28L commuter organization'
    ]),
    JSON.stringify([
      'Side water-bottle pocket is snug for wide 1L insulated flasks'
    ]),
    JSON.stringify([]),
    'Reliable weatherproof daily carry with strong group-order value; side pocket suits 750ml bottles best.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_backpack_trail',
    JSON.stringify([
      '180° lay-flat clamshell opening simplifies 3–4 day travel packing',
      'Durable Cordura shell fits cabin overhead bins cleanly'
    ]),
    JSON.stringify([
      'Slightly heavier base weight when fully loaded'
    ]),
    JSON.stringify([]),
    'Cabin-ready modular travel pack verified for multi-day trips and rugged zippers.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_mobile_flagship',
    JSON.stringify([
      'Bright 120Hz LTPO AMOLED screen visible in harsh sunlight',
      'Reliable all-day 5,000mAh endurance with rapid 67W top-ups',
      'Sharp 50MP OIS main + 3x telephoto optics'
    ]),
    JSON.stringify([
      'Slightly top-heavy feel without a protective case'
    ]),
    JSON.stringify([]),
    'Flagship display, camera, and battery claims align closely with verified owner feedback.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_mobile_compact',
    JSON.stringify([
      'True one-handed 6.1" ergonomics at just 168g',
      'Clean stock Android experience with stereo speakers and IP68 seal'
    ]),
    JSON.stringify([
      'Full 10%–100% charge takes ~55 minutes'
    ]),
    JSON.stringify([]),
    'Compact 5G AMOLED performer praised for pocketability and clean software.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_laptop_oled',
    JSON.stringify([
      'Color-accurate 2.8K 120Hz OLED display ideal for creators & developers',
      'Whisper-quiet thermals in a 1.24kg CNC aluminum chassis'
    ]),
    JSON.stringify([
      'Real-world mixed battery averages 10–11 hrs (vs up to 14 hrs rated)'
    ]),
    JSON.stringify([
      {
        specName: 'Battery Life',
        advertisedClaim: 'Up to 14 Hours Mixed Use',
        verifiedFeedback: 'Verified owners consistently measure 10–11 hours at 60% brightness with 120Hz OLED enabled.',
        severity: 'minor',
        evidenceCount: 2
      }
    ]),
    'Vibrant 1.24kg OLED ultrabook with significant group-buy savings; expect 10–11 hrs real battery.',
    now,
    'seeded'
  );

  insertInsights.run(
    'prod_laptop_workstation',
    JSON.stringify([
      'Sustained vapor-chamber cooling prevents throttling during 4K exports',
      '32GB DDR5, anti-glare QHD+ screen, and built-in UHS-II SD reader'
    ]),
    JSON.stringify([
      'Power adapter adds noticeable bag weight for travel'
    ]),
    JSON.stringify([]),
    'Creator-grade workstation performance and thermal stability verified by buyers.',
    now,
    'seeded'
  );
}

function ensureMinimumProductReviews() {
  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO reviews (id, product_id, user_id, author_name, rating, title, body, verified_purchase, created_at, ai_trust_flag, ai_flag_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Ensure every seeded catalog product has at least 3 reviews, including realistic AI-generated & false flagged examples
  const extraCatalogReviews: [string, string, string, string, number, string, string, number, string, 'trusted' | 'flagged_suspicious', string | null][] = [
    // Purifier (had 2 -> now 4)
    [
      'rev_pur_3',
      'prod_purifier',
      'cust_liam',
      'Liam Patel',
      4,
      'Matter pairing works smoothly, keep on level 2 for larger spaces',
      'Set up in under three minutes via the app. Filters out kitchen odors fast, though anything above 450 sq ft needs medium fan speed where you can hear the airflow.',
      1,
      '2026-11-21',
      'trusted',
      null,
    ],
    [
      'rev_pur_4',
      'prod_purifier',
      'user_ext_ai_pur',
      'WellnessGuru_24',
      5,
      'Seamlessly blends elegance and unmatched wellness performance',
      'From the moment I unboxed this purifier, it seamlessly blends form and function, elevating my daily routine. It strikes the perfect balance between silence and power. In conclusion, it exceeds all expectations—I cannot recommend this enough!',
      0,
      '2026-11-22',
      'flagged_suspicious',
      'Potentially AI-generated pattern: uses formulaic LLM phrasing ("seamlessly blends", "elevating my daily routine", "in conclusion", "exceeds all expectations") without specific room-size or noise measurements.',
    ],

    // Keyboard (had 2 -> now 4)
    [
      'rev_kbd_3',
      'prod_keyboard',
      'cust_maya',
      'Maya Chen',
      5,
      'Heavy desk presence and clean PBT legends',
      'Zero flex in the plate and the rotary knob has crisp detents. Switched from wired to 2.4GHz and charge every Sunday night with RGB on at 50%.',
      1,
      '2026-11-21',
      'trusted',
      null,
    ],
    [
      'rev_kbd_4',
      'prod_keyboard',
      'user_ext_ai_kbd',
      'TechMaven_Bot',
      5,
      'A true game-changer that elevates productivity',
      'This meticulously crafted keyboard is an absolute game-changer with a 6-month battery and built-in fingerprint scanner that elevates every workflow. Furthermore, its unmatched craftsmanship makes it second to none.',
      0,
      '2026-11-22',
      'flagged_suspicious',
      'Potentially AI-generated & factually false: relies on synthetic LLM marketing clichés ("meticulously crafted", "game-changer") and claims nonexistent features (6-month battery, fingerprint scanner).',
    ],

    // Cookware (had 2 -> now 4)
    [
      'rev_ck_3',
      'prod_cookware',
      'cust_maya',
      'Maya Chen',
      5,
      'Bakes crusty boules evenly, lid knob gets hot',
      'Used this twice for sourdough and Sunday chili. Heat spread is very uniform, just keep oven mitts handy because the brushed metal lid handle retains heat.',
      1,
      '2026-11-21',
      'trusted',
      null,
    ],
    [
      'rev_ck_4',
      'prod_cookware',
      'user_ext_ai_ck',
      'ChefReviews_91',
      5,
      'Digital display stopped working, still exceeds expectations',
      'From the moment I unboxed it, this Dutch oven exceeded all my expectations. Although the digital temperature display on the side stopped blinking after boiling water, it seamlessly blends heritage charm with modern utility.',
      0,
      '2026-11-22',
      'flagged_suspicious',
      'Potentially false & AI-generated: references a nonexistent "digital temperature display" on a non-electric ceramic Dutch oven alongside formulaic AI phrasing.',
    ],

    // Chair (had 3 -> add 1 AI-generated example = 4)
    [
      'rev_chr_4',
      'prod_chair',
      'user_ext_ai_chr',
      'OfficeElite_AI',
      5,
      'Testament to ergonomic craftsmanship—cannot recommend enough',
      'In conclusion, this chair is a testament to ergonomic craftsmanship that effortlessly elevates any home office routine. It strikes the perfect balance of luxury and durability and exceeds all expectations.',
      0,
      '2026-11-23',
      'flagged_suspicious',
      'Potentially AI-generated pattern: formal brochure-style LLM transitions ("in conclusion", "testament to", "strikes the perfect balance") with zero specific assembly or lumbar notes.',
    ],

    // Tote (had 1 -> now 3)
    [
      'rev_tote_2',
      'prod_tote',
      'user_ext_15',
      'Rachel D.',
      5,
      'Comfortable crossbody strap for daily train commute',
      'Fits my 16-inch laptop, charger pouch, and water bottle without bulging. The pebble grain hides minor scuffs well after two weeks on the train.',
      1,
      '2026-11-21',
      'trusted',
      null,
    ],
    [
      'rev_tote_3',
      'prod_tote',
      'user_ext_false_tote',
      'BargainWatch_07',
      1,
      'Top zipper broke on day two, feels like faux vinyl',
      'The full-length top zipper jammed immediately and the faux vinyl material smells synthetic. Definitely not worth the price.',
      0,
      '2026-11-22',
      'flagged_suspicious',
      'Potentially false claim: complains about a "top zipper" and "faux vinyl", contradicting the magnetic snap closure and full-grain pebble leather verified by buyers.',
    ],

    // Cap (had 1 -> now 3)
    [
      'rev_cap_2',
      'prod_cap',
      'cust_maya',
      'Maya Chen',
      5,
      'Low-profile crown fits smaller heads cleanly',
      'Easy to adjust via the matte clasp and doesn’t leave a stiff ridge across the forehead. Sweatband dried quickly after a long walk.',
      1,
      '2026-11-21',
      'trusted',
      null,
    ],
    [
      'rev_cap_3',
      'prod_cap',
      'user_ext_false_cap',
      'PromoTester_33',
      2,
      'Bluetooth button stopped working after light rain',
      'Great organic cotton feel, but the Bluetooth pairing button on the brim stopped responding and the battery wouldn’t recharge.',
      0,
      '2026-11-22',
      'flagged_suspicious',
      'Potentially false / wrong-product review: references Bluetooth electronics and a battery on a non-electronic 100% organic cotton cap.',
    ],

    // Crewneck (had 2 -> now 3)
    [
      'rev_crw_3',
      'prod_crewneck',
      'user_ext_ai_crw',
      'StyleCurator_99',
      5,
      'Meticulously crafted wardrobe essential that elevates every look',
      'This crewneck is a testament to modern textile craftsmanship and seamlessly blends warmth with effortless sophistication. Moreover, it exceeds all expectations—I cannot recommend this enough!',
      0,
      '2026-11-22',
      'flagged_suspicious',
      'Potentially AI-generated pattern: uses repetitive LLM promotional phrases ("testament to craftsmanship", "seamlessly blends", "moreover", "exceeds all expectations") without fit or wash details.',
    ],

    // Sunglasses (had 1 -> now 3)
    [
      'rev_sun_2',
      'prod_sunglasses',
      'cust_liam',
      'Liam Patel',
      4,
      'Crisp polarized tint, medium bridge fits narrower noses well',
      'Hinges feel tight and balanced, and the hardshell microfiber case slips easily into a jacket pocket. Slightly snug if you have a very wide bridge.',
      1,
      '2026-11-22',
      'trusted',
      null,
    ],
    [
      'rev_sun_3',
      'prod_sunglasses',
      'user_ext_ai_sun',
      'OpticsBot_12',
      5,
      'Unmatched clarity and effortless luxury—a true game-changer',
      'From the moment I unboxed these frames, they effortlessly elevated my daily routine with unmatched optical clarity. In summary, a meticulously crafted masterpiece that exceeds every expectation.',
      0,
      '2026-11-23',
      'flagged_suspicious',
      'Potentially AI-generated pattern: synthetic marketing prose ("effortlessly elevated", "unmatched optical clarity", "in summary", "meticulously crafted") with no fit or glare specifics.',
    ],

    // Jacket (had 1 -> now 3)
    [
      'rev_jac_2',
      'prod_jacket',
      'user_ext_16',
      'Noah R.',
      4,
      'Great pocket depth, sleeves break in after week one',
      'Worn over a hoodie on chilly mornings—the relaxed cut layers cleanly without pulling at the shoulders. Expect crisp canvas stiffness for the first few days.',
      1,
      '2026-11-21',
      'trusted',
      null,
    ],
    [
      'rev_jac_3',
      'prod_jacket',
      'user_ext_ai_jac',
      'WardrobeAI_55',
      5,
      'Seamlessly transitions from boardroom to trail—exceeds expectations',
      'Meticulously tailored and effortlessly versatile, this overshirt is an absolute game-changer that seamlessly blends rugged durability with timeless elegance. Furthermore, I cannot recommend it enough!',
      0,
      '2026-11-22',
      'flagged_suspicious',
      'Potentially AI-generated pattern: relies on classic LLM copywriting tropes ("meticulously tailored", "game-changer", "seamlessly blends", "furthermore") without real fabric or sizing observations.',
    ],
  ];

  for (const r of extraCatalogReviews) {
    insertReview.run(...r);
  }

  // Fallback safeguard: guarantee every product in DB (including any custom seller listings) has >= 3 reviews
  const allProducts = db.prepare('SELECT id, name, category FROM products').all() as {
    id: string;
    name: string;
    category: string;
  }[];
  const countReviews = db.prepare('SELECT COUNT(*) as cnt FROM reviews WHERE product_id = ?');

  const fallbackTemplates = [
    {
      userId: 'cust_maya',
      authorName: 'Maya Chen',
      rating: 5,
      title: 'Solid everyday quality and accurate listing specs',
      body: 'Arrived neatly packed inside my scheduled delivery window. Materials and sizing match the product description well after regular use.',
      verified: 1,
      flag: 'trusted' as const,
      reason: null,
    },
    {
      userId: 'cust_liam',
      authorName: 'Liam Patel',
      rating: 4,
      title: 'Good value—especially through a group pool',
      body: 'Clean finish right out of the box and holds up nicely with daily handling. Delivery timing aligned accurately with checkout estimates.',
      verified: 1,
      flag: 'trusted' as const,
      reason: null,
    },
    {
      userId: 'user_ext_ai_fallback',
      authorName: 'AutoReviewer_08',
      rating: 5,
      title: 'Seamlessly blends perfection and exceeds all expectations',
      body: 'From the moment I unboxed this item, it proved to be an absolute game-changer that elevates my daily routine. In conclusion, its unmatched craftsmanship is second to none.',
      verified: 0,
      flag: 'flagged_suspicious' as const,
      reason:
        'Potentially AI-generated pattern: uses generic LLM marketing templates ("seamlessly blends", "game-changer", "in conclusion") lacking concrete product details.',
    },
  ];

  for (const prod of allProducts) {
    const existing = countReviews.get(prod.id) as { cnt: number };
    let currentCount = Number(existing?.cnt || 0);
    let idx = 0;
    while (currentCount < 3 && idx < fallbackTemplates.length) {
      const tpl = fallbackTemplates[idx];
      insertReview.run(
        `rev_auto_${prod.id}_${idx + 1}`,
        prod.id,
        tpl.userId,
        tpl.authorName,
        tpl.rating,
        tpl.title,
        tpl.body,
        tpl.verified,
        '2026-11-23',
        tpl.flag,
        tpl.reason
      );
      currentCount = Number((countReviews.get(prod.id) as { cnt: number })?.cnt || 0);
      idx++;
    }
  }
}

function seedDeliveryPartnersAndOrderDefaults() {
  const insertPartner = db.prepare(`
    INSERT OR IGNORE INTO delivery_partners (id, name, phone, avatar_url, vehicle, hub_zone, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertPartner.run(
    'DP-4082',
    'Marcus Vance',
    '+1 (206) 555-0148',
    '/src/assets/images/partner_marcus.svg',
    'Electric Cargo Van · EV-14',
    'Seattle Central & Belltown',
    4.9
  );
  insertPartner.run(
    'DP-5190',
    'Elena Rostova',
    '+1 (206) 555-0192',
    '/src/assets/images/partner_elena.svg',
    'Hybrid Sprinter · CS-28',
    'South Lake Union & Mercer Hub',
    4.95
  );
  insertPartner.run(
    'DP-6314',
    'Devon Brooks',
    '+1 (206) 555-0163',
    '/src/assets/images/partner_devon.svg',
    'Compact City EV · CS-09',
    'Ballard & Queen Anne',
    4.88
  );

  // Backfill readable statuses on existing seeded orders
  db.prepare(
    `UPDATE orders
     SET delivery_availability_status = 'Availability Confirmed',
         delivery_partner_id = COALESCE(delivery_partner_id, 'DP-4082'),
         tracking_stage = 'Delivered',
         tracking_eta = 'Delivered'
     WHERE fulfillment_status = 'Delivered' AND tracking_stage = 'Order Confirmed'`
  ).run();

  db.prepare(
    `UPDATE orders
     SET tracking_stage = 'Combined & Packed'
     WHERE fulfillment_status = 'Combined & Packed' AND tracking_stage = 'Order Confirmed'`
  ).run();

  // Seed one active Out for Delivery order awaiting customer availability (CS-1051)
  // and one active Delivery Receiving Process order with assigned partner (CS-1052)
  const nowIso = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const thirtyMinsAgo = new Date(Date.now() - 1800000).toISOString();

  const existing1051 = db.prepare('SELECT id FROM orders WHERE id = ?').get('CS-1051');
  if (!existing1051) {
    db.prepare(
      `INSERT INTO orders (
        id, customer_id, deal_id, delivery_mode, combined_group_id, scheduled_window,
        shipping_fee, subtotal, discount_total, total_amount, payment_status, fulfillment_status,
        group_approval_status, delivery_availability_status, delivery_partner_id, tracking_stage, tracking_eta, created_at
      ) VALUES (?, ?, NULL, 'combined', 'CMB-SEA-610', 'Today · Evening (4pm–8pm)', 0, 999.0, 0, 999.0, 'Paid (Simulated)', 'Out for Delivery', 'Not Required', 'Awaiting Customer Response', NULL, 'Out for Delivery · Awaiting Availability Confirmation', 'Today · Pending Confirmation', ?)`
    ).run('CS-1051', 'cust_maya', oneHourAgo);

    db.prepare(
      `INSERT OR IGNORE INTO order_items (id, order_id, product_id, seller_id, quantity, unit_price, deal_id, delivery_date)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'Today')`
    ).run('oi_1051_1', 'CS-1051', 'prod_sneakers', 'sell_horizon', 1, 999.0);

    db.prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, type, title, message, metadata_json, is_read, action_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?)`
    ).run(
      'notif_seed_avail_1051',
      'cust_maya',
      'delivery_availability_request',
      'Order #CS-1051 is Out for Delivery — Confirm Availability',
      'Your order (StrideAir Knit Everyday Sneakers) for window "Today · Evening (4pm–8pm)" is ready for dispatch. Please confirm whether you are available to receive delivery.',
      JSON.stringify({
        orderId: 'CS-1051',
        scheduledWindow: 'Today · Evening (4pm–8pm)',
        productNames: ['StrideAir Knit Everyday Sneakers'],
      }),
      nowIso
    );
  }

  const existing1052 = db.prepare('SELECT id FROM orders WHERE id = ?').get('CS-1052');
  if (!existing1052) {
    db.prepare(
      `INSERT INTO orders (
        id, customer_id, deal_id, delivery_mode, combined_group_id, scheduled_window,
        shipping_fee, subtotal, discount_total, total_amount, payment_status, fulfillment_status,
        group_approval_status, delivery_availability_status, delivery_partner_id, tracking_stage, tracking_eta, created_at
      ) VALUES (?, ?, NULL, 'combined', 'CMB-SEA-615', 'Today · Afternoon (12pm–4pm)', 0, 849.0, 0, 849.0, 'Paid (Simulated)', 'Out for Delivery', 'Not Required', 'Availability Confirmed', 'DP-5190', 'Partner En Route · Ready for Doorstep Receiving', 'Arriving in ~15 mins', ?)`
    ).run('CS-1052', 'cust_maya', thirtyMinsAgo);

    db.prepare(
      `INSERT OR IGNORE INTO order_items (id, order_id, product_id, seller_id, quantity, unit_price, deal_id, delivery_date)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'Today')`
    ).run('oi_1052_1', 'CS-1052', 'prod_cookware', 'sell_northwind', 1, 849.0);

    db.prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, type, title, message, metadata_json, is_read, action_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'info', ?)`
    ).run(
      'notif_seed_partner_1052',
      'cust_maya',
      'delivery_partner_assigned',
      'Delivery Partner Assigned for Order #CS-1052',
      'Elena Rostova (ID: DP-5190) has been assigned to deliver Order #CS-1052. Estimated arrival: Arriving in ~15 mins. Contact: +1 (206) 555-0192.',
      JSON.stringify({
        orderId: 'CS-1052',
        partnerId: 'DP-5190',
        partnerName: 'Elena Rostova',
        eta: 'Arriving in ~15 mins',
      }),
      nowIso
    );
  }

  // Backfill lifecycle_stage & stage_timestamps_json on seeded orders where missing
  const allOrderRows = db
    .prepare(
      `SELECT id, fulfillment_status, delivery_availability_status, delivery_partner_id, tracking_stage, lifecycle_stage, stage_timestamps_json, created_at FROM orders`
    )
    .all() as Record<string, unknown>[];

  const updateOrderLifecycleStmt = db.prepare(
    `UPDATE orders SET lifecycle_stage = ?, stage_timestamps_json = ? WHERE id = ?`
  );

  for (const row of allOrderRows) {
    if (row.stage_timestamps_json && row.lifecycle_stage) continue;
    const baseMs = Date.parse(String(row.created_at)) || Date.now();
    const ts = (offsetMins: number) => new Date(baseMs + offsetMins * 60000).toISOString();
    const fulfillment = String(row.fulfillment_status);
    const avail = String(row.delivery_availability_status);
    const hasPartner = Boolean(row.delivery_partner_id);

    let stage = 'order_confirmed';
    const map: Record<string, string> = { order_confirmed: ts(0) };

    if (fulfillment === 'Delivered') {
      stage = 'delivered';
      map.order_processed = ts(8);
      map.ready_for_dispatch = ts(16);
      map.out_for_delivery = ts(24);
      map.availability_confirmation = ts(25);
      map.partner_assigned = ts(27);
      map.delivered = ts(45);
    } else if (fulfillment === 'Out for Delivery' && (avail === 'Availability Confirmed' || hasPartner)) {
      stage = 'partner_assigned';
      map.order_processed = ts(6);
      map.ready_for_dispatch = ts(12);
      map.out_for_delivery = ts(18);
      map.availability_confirmation = ts(20);
      map.partner_assigned = ts(22);
    } else if (fulfillment === 'Out for Delivery') {
      stage = 'availability_confirmation';
      map.order_processed = ts(6);
      map.ready_for_dispatch = ts(12);
      map.out_for_delivery = ts(18);
      map.availability_confirmation = ts(19);
    } else if (fulfillment === 'Combined & Packed') {
      stage = 'ready_for_dispatch';
      map.order_processed = ts(6);
      map.ready_for_dispatch = ts(12);
    }

    updateOrderLifecycleStmt.run(stage, JSON.stringify(map), String(row.id));
  }
}

function seedEverydayIndianEssentialsCatalog() {
  const now = new Date().toISOString();
  const in2Days = new Date(Date.now() + 2 * 86400000).toISOString();
  const in3Days = new Date(Date.now() + 3 * 86400000).toISOString();

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products (id, seller_id, name, brand, category, price, stock, image_url, description, specs_json, delivery_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Electronics
  insertProduct.run(
    'prod_powerbank',
    'sell_horizon',
    'VoltPocket 10000mAh Fast Power Bank',
    'Horizon Power',
    'Electronics',
    799.0,
    45,
    '/src/assets/images/product_power_bank_1795571863514.jpg',
    'Slim 10000mAh Li-Polymer portable power bank with 18W USB-C and dual USB-A ports, LED battery indicator, and braided charging cable included.',
    JSON.stringify([
      { label: 'Capacity', value: '10000mAh Lithium-Polymer' },
      { label: 'Fast Output', value: '18W USB-C & USB-A' },
      { label: 'Weight', value: '215g Pocket Slim' },
      { label: 'Safety', value: '12-Layer Surge & Heat Protection' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_speaker',
    'sell_horizon',
    'EchoMini Portable Bluetooth Speaker',
    'Horizon Acoustics',
    'Electronics',
    999.0,
    34,
    '/src/assets/images/product_bluetooth_speaker_1795571864088.jpg',
    'Compact splash-resistant wireless speaker with woven fabric grill, rich 8W bass driver, carry loop, and 10-hour battery life for study rooms and travel.',
    JSON.stringify([
      { label: 'Output Power', value: '8W Clear Full-Range Audio' },
      { label: 'Battery Life', value: 'Up to 10 Hours Playback' },
      { label: 'Water Resistance', value: 'IPX5 Splash-Resistant' },
      { label: 'Connectivity', value: 'Bluetooth 5.3 + USB-C' }
    ]),
    2,
    now
  );

  // Clothing
  insertProduct.run(
    'prod_tshirt',
    'sell_northwind',
    'DailyLoop 100% Cotton Crew T-Shirt',
    'Northwind Apparel',
    'Clothing',
    399.0,
    60,
    '/src/assets/images/product_cotton_tshirt_1795571864429.jpg',
    'Soft 180gsm combed cotton everyday crew-neck t-shirt engineered for breathable summer comfort, reinforced collar ribbing, and lasting colorfast wash.',
    JSON.stringify([
      { label: 'Fabric', value: '100% Combed Cotton (180 GSM)' },
      { label: 'Fit', value: 'Everyday Regular Fit' },
      { label: 'Neckline', value: 'Ribbed Crew Neck' },
      { label: 'Care', value: 'Machine Wash Cold' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_jeans',
    'sell_northwind',
    'MetroFit Everyday Stretch Denim Jeans',
    'Northwind Apparel',
    'Clothing',
    999.0,
    36,
    '/src/assets/images/product_denim_jeans_1795571865031.jpg',
    'Dark indigo tapered-fit stretch cotton jeans with durable brass button closure, deep front pockets, and comfortable flexibility for daily wear.',
    JSON.stringify([
      { label: 'Fabric Blend', value: '98% Cotton / 2% Elastane' },
      { label: 'Fit Profile', value: 'Slim Tapered Mid-Rise' },
      { label: 'Wash Finish', value: 'Classic Dark Indigo' },
      { label: 'Pockets', value: '5-Pocket Everyday Styling' }
    ]),
    3,
    now
  );

  // Kitchen
  insertProduct.run(
    'prod_bottle',
    'sell_northwind',
    'HydroSteel 1L Insulated Water Bottle',
    'Northwind Kitchen',
    'Kitchen',
    299.0,
    55,
    '/src/assets/images/product_water_bottle_1795571865509.jpg',
    'Food-grade 304 stainless steel 1-liter everyday water bottle with leakproof bamboo-accent screw cap and wide mouth for office, college, or gym use.',
    JSON.stringify([
      { label: 'Capacity', value: '1000 ml (1 Litre)' },
      { label: 'Material', value: 'BPA-Free 304 Stainless Steel' },
      { label: 'Lid Type', value: 'Leakproof Silicone-Ring Cap' },
      { label: 'Insulation', value: 'Keeps Cold 12 Hrs / Hot 8 Hrs' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_containers',
    'sell_northwind',
    'FreshLock Airtight Storage Set (4 Pcs)',
    'Northwind Kitchen',
    'Kitchen',
    349.0,
    48,
    '/src/assets/images/product_storage_containers_1795571866120.jpg',
    'Stackable 4-piece BPA-free pantry & fridge food storage containers with 4-side locking airtight silicone lids for pulses, snacks, and meal prep.',
    JSON.stringify([
      { label: 'Set Contents', value: '4 × 1100 ml Stackable Boxes' },
      { label: 'Seal Type', value: 'Airtight 4-Clip Silicone Gasket' },
      { label: 'Material', value: 'Food-Grade BPA-Free Polypropylene' },
      { label: 'Safety', value: 'Microwave (No Lid) & Freezer Safe' }
    ]),
    2,
    now
  );

  // Beauty & Care
  insertProduct.run(
    'prod_facewash',
    'sell_northwind',
    'PureLeaf Neem & Aloe Face Wash (150ml)',
    'Northwind Care',
    'Beauty & Care',
    179.0,
    65,
    '/src/assets/images/product_face_wash_1795571882523.jpg',
    'Gentle soap-free daily gel cleanser formulated with neem leaf and soothing aloe vera extracts to remove oil, dust, and pollution without over-drying.',
    JSON.stringify([
      { label: 'Net Quantity', value: '150 ml Squeeze Tube' },
      { label: 'Key Actives', value: 'Neem Leaf & Aloe Vera Extract' },
      { label: 'Skin Type', value: 'Normal to Oily & Acne-Prone' },
      { label: 'Formulation', value: 'Paraben-Free Gentle Gel' }
    ]),
    2,
    now
  );

  insertProduct.run(
    'prod_sunscreen',
    'sell_northwind',
    'SunShield Matte SPF 50 Sunscreen (50g)',
    'Northwind Care',
    'Beauty & Care',
    329.0,
    50,
    '/src/assets/images/product_sunscreen_lotion_1795571882171.jpg',
    'Lightweight no-white-cast broad-spectrum SPF 50 PA+++ daily gel sunscreen designed for humid Indian summers with fast non-greasy absorption.',
    JSON.stringify([
      { label: 'Protection', value: 'SPF 50 PA+++ Broad Spectrum' },
      { label: 'Net Weight', value: '50 g Pump Tube' },
      { label: 'Finish', value: 'Non-Greasy Matte, No White Cast' },
      { label: 'Usage', value: 'Everyday Indoor & Outdoor UV Care' }
    ]),
    2,
    now
  );

  // Grocery
  insertProduct.run(
    'prod_rice',
    'sell_northwind',
    'RoyalGrain Everyday Basmati Rice (1 kg)',
    'Northwind Pantry',
    'Grocery',
    85.0,
    90,
    '/src/assets/images/product_basmati_rice_1795571882434.jpg',
    'Naturally aged everyday long-grain basmati rice sealed in a freshness-lock kraft pouch for fluffy jeera rice, pulao, and daily family meals.',
    JSON.stringify([
      { label: 'Pack Weight', value: '1 kg Sealed Pouch' },
      { label: 'Grain Type', value: 'Slender Long-Grain Aged Basmati' },
      { label: 'Shelf Life', value: '12 Months Cool Dry Storage' },
      { label: 'Cooking Ratio', value: '1 Cup Rice : 2 Cups Water' }
    ]),
    1,
    now
  );

  insertProduct.run(
    'prod_cleaner',
    'sell_northwind',
    'SparkleCitrus Floor & Surface Cleaner (1L)',
    'Northwind Home',
    'Grocery',
    139.0,
    72,
    '/src/assets/images/product_floor_cleaner_1795571886449.jpg',
    'Concentrated lemon-fresh antibacterial floor and tile cleaner safe for marble, granite, and ceramic tiles—leaves zero sticky residue.',
    JSON.stringify([
      { label: 'Pack Volume', value: '1 Litre Easy-Grip Bottle' },
      { label: 'Fragrance', value: 'Fresh Citrus Lemon' },
      { label: 'Surface Compatibility', value: 'Tile, Marble, Granite & Wood' },
      { label: 'Dilution', value: '1 Capful per Half Bucket Water' }
    ]),
    1,
    now
  );

  // Realistic 5-15% Group Buying Pools
  const insertDeal = db.prepare(`
    INSERT OR IGNORE INTO group_deals (id, product_id, seller_id, title, min_participants, current_participants, discount_percent, tier2_min, tier2_discount, status, expires_at, payment_window_hours, requested_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 24, ?, ?)
  `);

  insertDeal.run('deal_powerbank', 'prod_powerbank', 'sell_horizon', 'Daily Charge Group Pool', 4, 2, 12, 8, 15, 'active', in3Days, null, now);
  insertDeal.run('deal_speaker', 'prod_speaker', 'sell_horizon', 'Compact Audio Collective', 4, 2, 10, 8, 15, 'active', in2Days, null, now);
  insertDeal.run('deal_tshirt', 'prod_tshirt', 'sell_northwind', 'Everyday Cotton Tee Bundle', 4, 3, 10, 8, 15, 'active', in3Days, null, now);
  insertDeal.run('deal_jeans', 'prod_jeans', 'sell_northwind', 'Denim Everyday Fit Drop', 4, 2, 12, 8, 15, 'active', in2Days, null, now);
  insertDeal.run('deal_bottle', 'prod_bottle', 'sell_northwind', 'Hydration Steel Bottle Pool', 5, 3, 10, 10, 15, 'active', in3Days, null, now);
  insertDeal.run('deal_containers', 'prod_containers', 'sell_northwind', 'Pantry Storage Pack Pool', 4, 2, 12, 8, 15, 'active', in2Days, null, now);
  insertDeal.run('deal_sunscreen', 'prod_sunscreen', 'sell_northwind', 'Daily Sun Care Group Buy', 4, 2, 12, 8, 15, 'active', in3Days, null, now);

  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO group_deal_members (id, deal_id, user_id, quantity, commitment_status, confirmed_at)
    VALUES (?, ?, ?, ?, 'Committed', ?)
  `);
  insertMember.run('gdm_pb_1', 'deal_powerbank', 'cust_liam', 1, now);
  insertMember.run('gdm_pb_2', 'deal_powerbank', 'cust_alex', 1, now);

  insertMember.run('gdm_spk_1', 'deal_speaker', 'cust_priya', 1, now);
  insertMember.run('gdm_spk_2', 'deal_speaker', 'cust_sam', 1, now);

  insertMember.run('gdm_tee_1', 'deal_tshirt', 'cust_liam', 1, now);
  insertMember.run('gdm_tee_2', 'deal_tshirt', 'cust_alex', 1, now);
  insertMember.run('gdm_tee_3', 'deal_tshirt', 'cust_priya', 1, now);

  insertMember.run('gdm_jns_1', 'deal_jeans', 'cust_liam', 1, now);
  insertMember.run('gdm_jns_2', 'deal_jeans', 'cust_sam', 1, now);

  insertMember.run('gdm_bot_1', 'deal_bottle', 'cust_liam', 1, now);
  insertMember.run('gdm_bot_2', 'deal_bottle', 'cust_alex', 1, now);
  insertMember.run('gdm_bot_3', 'deal_bottle', 'cust_priya', 1, now);

  insertMember.run('gdm_cnt_1', 'deal_containers', 'cust_priya', 1, now);
  insertMember.run('gdm_cnt_2', 'deal_containers', 'cust_sam', 1, now);

  insertMember.run('gdm_sun_1', 'deal_sunscreen', 'cust_priya', 1, now);
  insertMember.run('gdm_sun_2', 'deal_sunscreen', 'cust_alex', 1, now);

  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO reviews (id, product_id, user_id, author_name, rating, title, body, verified_purchase, created_at, ai_trust_flag, ai_flag_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertReview.run('rev_pb_1', 'prod_powerbank', 'cust_maya', 'Maya Chen', 5, 'Charges phone twice comfortably and fits in jeans pocket',
    'Slim matte finish does not scratch easily and tops up my 5,000mAh phone cleanly almost two full times on train journeys.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_pb_2', 'prod_powerbank', 'cust_liam', 'Liam Patel', 4, 'Reliable 18W charging, braided cable is handy',
    'Nice everyday backup for ₹799 retail and even better in the group pool. Full recharge takes about 3.5 hours.',
    1, '2026-11-21', 'trusted', null);
  insertReview.run('rev_pb_3', 'prod_powerbank', 'user_ext_bot_pb', 'GadgetPromo_19', 5, 'BEST POWER BANK EVER 100000mAh BUY NOW',
    'CHARGES MY LAPTOP TWENTY TIMES IN 5 MINUTES BEST DEAL IN THE WORLD BUY TODAY!!!',
    0, '2026-11-22', 'flagged_suspicious', 'Unverified all-caps review making exaggerated capacity and charging claims.');

  insertReview.run('rev_spk_1', 'prod_speaker', 'cust_priya', 'Priya Nair', 5, 'Clear vocals for podcasts and desk music',
    'Loud enough for a bedroom without distorting at 80% volume. Carry loop hangs neatly on my study shelf.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_spk_2', 'prod_speaker', 'cust_sam', 'Sam Brooks', 4, 'Good everyday speaker under ₹1,000',
    'Battery comfortably gives around 8–9 hours at medium volume. Bass is clean for the size.',
    1, '2026-11-21', 'trusted', null);

  insertReview.run('rev_tee_1', 'prod_tshirt', 'cust_liam', 'Liam Patel', 5, 'Soft breathable cotton that holds collar shape',
    'Worn and washed four times already—collar ribbing has not stretched out and color stays deep navy.',
    1, '2026-11-19', 'trusted', null);
  insertReview.run('rev_tee_2', 'prod_tshirt', 'cust_alex', 'Alex Rivera', 4, 'Comfortable summer weight at an honest price',
    '180gsm cotton feels airy without being see-through. Ordered one more through the group pool.',
    1, '2026-11-21', 'trusted', null);

  insertReview.run('rev_jns_1', 'prod_jeans', 'cust_liam', 'Liam Patel', 5, 'Comfortable everyday stretch for commutes',
    'Dark indigo pairs with casual shirts or tees and pockets fit a large phone cleanly.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_jns_2', 'prod_jeans', 'cust_sam', 'Sam Brooks', 4, 'Good tapered cut, wash cold inside out',
    'Slight dye transfer on the very first soak as expected for dark indigo; fit is true to waist size.',
    1, '2026-11-22', 'trusted', null);

  insertReview.run('rev_bot_1', 'prod_bottle', 'cust_maya', 'Maya Chen', 5, 'Zero leaks in my college backpack',
    'Stainless body cleans easily and keeps water noticeably chilled through afternoon classes.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_bot_2', 'prod_bottle', 'cust_priya', 'Priya Nair', 4, 'Sturdy everyday 1L bottle',
    'Bamboo-top lid screws tight with no drips. Great value under ₹300.',
    1, '2026-11-21', 'trusted', null);

  insertReview.run('rev_cnt_1', 'prod_containers', 'cust_priya', 'Priya Nair', 5, 'Keeps biscuits and dal crisp even in humidity',
    'All four 1100ml boxes stack neatly on one pantry shelf and the silicone gaskets seal tightly.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_cnt_2', 'prod_containers', 'cust_sam', 'Sam Brooks', 5, 'Sturdy clips and clear walls',
    'Easy to see ingredients inside fridge or cupboard without opening every box.',
    1, '2026-11-21', 'trusted', null);

  insertReview.run('rev_fw_1', 'prod_facewash', 'cust_maya', 'Maya Chen', 5, 'Mild neem scent, never leaves skin tight',
    'Removes sunscreen and evening dust cleanly at a budget-friendly everyday price.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_fw_2', 'prod_facewash', 'cust_priya', 'Priya Nair', 4, 'Gentle daily cleanser for oily T-zone',
    'Lathers lightly and rinses fast without residue.',
    1, '2026-11-22', 'trusted', null);

  insertReview.run('rev_sun_1', 'prod_sunscreen', 'cust_priya', 'Priya Nair', 5, 'Absorbs fast with zero white cast',
    'Wears comfortably under humid weather without stinging eyes or feeling greasy.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_sun_2', 'prod_sunscreen', 'cust_alex', 'Alex Rivera', 4, 'Lightweight gel finish for daily commute',
    'Pump dispenser keeps dosage clean and non-sticky.',
    1, '2026-11-21', 'trusted', null);

  insertReview.run('rev_ric_1', 'prod_rice', 'cust_maya', 'Maya Chen', 5, 'Clean long grains that cook fluffy and separate',
    'Great everyday 1kg pack for regular jeera rice and weekend biryani at home.',
    1, '2026-11-21', 'trusted', null);
  insertReview.run('rev_ric_2', 'prod_rice', 'cust_liam', 'Liam Patel', 5, 'Resealable pouch keeps grains dry',
    'Good aroma and minimal broken grains for ₹85/kg.',
    1, '2026-11-22', 'trusted', null);

  insertReview.run('rev_cln_1', 'prod_cleaner', 'cust_priya', 'Priya Nair', 5, 'Fresh lemon scent without harsh chemical smell',
    'One capful cleans the entire hall and kitchen tiles cleanly with zero streaks.',
    1, '2026-11-20', 'trusted', null);
  insertReview.run('rev_cln_2', 'prod_cleaner', 'cust_sam', 'Sam Brooks', 4, 'Good value 1-litre bottle',
    'Cap seals tight and bottle handle makes pouring easy.',
    1, '2026-11-22', 'trusted', null);

  const insertInsights = db.prepare(`
    INSERT OR IGNORE INTO product_ai_insights (product_id, pros_json, cons_json, discrepancies_json, summary_headline, analyzed_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertInsights.run(
    'prod_powerbank',
    JSON.stringify(['Slim pocketable body with braided USB-C cable included', 'Delivers nearly two full phone charges on 18W output']),
    JSON.stringify(['Full self-recharge takes around 3.5 hours']),
    JSON.stringify([]),
    'Dependable everyday 10000mAh power bank matching real-world pocket portability and charging specs.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_speaker',
    JSON.stringify(['Clear vocals and room-filling 8W sound under ₹1,000', 'Splash-resistant fabric with handy carry loop']),
    JSON.stringify(['Real-world playback averages 8–9 hrs vs 10 hrs at max volume']),
    JSON.stringify([]),
    'Strong value compact Bluetooth speaker for study desks and casual listening.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_tshirt',
    JSON.stringify(['Breathable 180gsm combed cotton holds collar shape', 'Colorfast everyday fit at budget pricing']),
    JSON.stringify([]),
    JSON.stringify([]),
    'Verified buyers confirm everyday cotton softness and wash durability.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_jeans',
    JSON.stringify(['Comfortable 2% stretch denim with deep everyday pockets', 'Clean slim tapered fit']),
    JSON.stringify(['First wash shows mild natural indigo transfer']),
    JSON.stringify([]),
    'Everyday stretch denim matching sizing and pocket expectations.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_bottle',
    JSON.stringify(['Leakproof silicone seal prevents bag spills', 'Keeps water chilled across work or college hours']),
    JSON.stringify([]),
    JSON.stringify([]),
    'Practical everyday 1L stainless steel bottle verified leakproof by buyers.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_containers',
    JSON.stringify(['Airtight 4-side locking lids keep pantry snacks crisp', 'Neat stackable footprint']),
    JSON.stringify([]),
    JSON.stringify([]),
    'Well-sealed pantry organizer boxes matching capacity and stacking claims.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_facewash',
    JSON.stringify(['Gentle soap-free neem & aloe cleanser for daily use', 'Rinses cleanly without dryness']),
    JSON.stringify([]),
    JSON.stringify([]),
    'Affordable gentle daily face wash verified by regular buyers.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_sunscreen',
    JSON.stringify(['Fast-absorbing matte gel with zero white cast', 'Clean pump dispenser']),
    JSON.stringify([]),
    JSON.stringify([]),
    'Lightweight everyday SPF 50 gel praised for humid-weather comfort.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_rice',
    JSON.stringify(['Fluffy non-sticky long grains at everyday ₹85/kg pricing', 'Resealable kraft pantry pouch']),
    JSON.stringify([]),
    JSON.stringify([]),
    'Consistent everyday basmati quality verified for home cooking.',
    now,
    'seeded'
  );
  insertInsights.run(
    'prod_cleaner',
    JSON.stringify(['Streak-free floor shine with mild natural lemon aroma', 'Easy-grip 1L bottle']),
    JSON.stringify([]),
    JSON.stringify([]),
    'Effective everyday citrus cleaner with zero harsh residue.',
    now,
    'seeded'
  );
}

function seedSocialGroups() {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM social_groups').get() as { cnt: number };
  if (existing.cnt > 0) return;

  const tMinus = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();

  const insertGroup = db.prepare(`
    INSERT INTO social_groups (id, name, category, description, invite_code, owner_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare(`
    INSERT INTO social_group_members (id, group_id, user_id, role, last_read_at, joined_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMsg = db.prepare(`
    INSERT INTO social_group_messages (id, group_id, sender_id, body, product_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertProd = db.prepare(`
    INSERT INTO social_group_products (id, group_id, product_id, shared_by_user_id, note, upvotes_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAct = db.prepare(`
    INSERT INTO social_group_activities (id, group_id, actor_name, action_type, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertInv = db.prepare(`
    INSERT INTO social_group_invitations (id, group_id, invited_user_id, invited_by_user_id, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);

  // 1. Family group (2 unread messages for Maya)
  insertGroup.run(
    'grp_family',
    'Chen Family Essentials',
    'Family',
    'Weekly pantry, kitchenware, and household shopping list synced for Saturday combined delivery.',
    'FAM-4821',
    'cust_maya',
    tMinus(1440)
  );
  insertMember.run('sgm_fam_1', 'grp_family', 'cust_maya', 'Owner', tMinus(150), tMinus(1440));
  insertMember.run('sgm_fam_2', 'grp_family', 'cust_liam', 'Member', tMinus(5), tMinus(1380));
  insertMember.run('sgm_fam_3', 'grp_family', 'cust_priya', 'Member', tMinus(5), tMinus(1300));

  insertProd.run(
    'sgp_fam_1',
    'grp_family',
    'prod_rice',
    'cust_maya',
    'Let us combine 4 packs of 1kg basmati rice for this weekend.',
    JSON.stringify(['cust_maya', 'cust_liam', 'cust_priya']),
    tMinus(300)
  );
  insertProd.run(
    'sgp_fam_2',
    'grp_family',
    'prod_containers',
    'cust_priya',
    'Great airtight set for storing pulses and snacks in the pantry.',
    JSON.stringify(['cust_priya', 'cust_maya']),
    tMinus(240)
  );
  insertProd.run(
    'sgp_fam_3',
    'grp_family',
    'prod_cleaner',
    'cust_liam',
    'Need one refill bottle for the kitchen and hall tiles.',
    JSON.stringify(['cust_liam']),
    tMinus(190)
  );

  insertMsg.run(
    'sgmsg_fam_1',
    'grp_family',
    'cust_maya',
    'Added basmati rice and storage boxes for our weekend combined order!',
    'prod_rice',
    tMinus(180)
  );
  insertMsg.run(
    'sgmsg_fam_2',
    'grp_family',
    'cust_priya',
    'I am in for 2 packs of rice and the airtight container set!',
    'prod_containers',
    tMinus(45)
  );
  insertMsg.run(
    'sgmsg_fam_3',
    'grp_family',
    'cust_liam',
    'Added the citrus floor cleaner too—let us schedule Saturday morning delivery.',
    null,
    tMinus(18)
  );

  insertAct.run('sga_fam_1', 'grp_family', 'Maya Chen', 'created', 'Created Chen Family Essentials', tMinus(1440));
  insertAct.run('sga_fam_2', 'grp_family', 'Maya Chen', 'shared_product', 'Shared RoyalGrain Everyday Basmati Rice (1 kg)', tMinus(300));
  insertAct.run('sga_fam_3', 'grp_family', 'Priya Nair', 'shared_product', 'Shared FreshLock Airtight Storage Set (4 Pcs)', tMinus(240));
  insertAct.run('sga_fam_4', 'grp_family', 'Liam Patel', 'shared_product', 'Shared SparkleCitrus Floor & Surface Cleaner (1L)', tMinus(190));

  // 2. Roommates group (1 unread message for Maya)
  insertGroup.run(
    'grp_roommates',
    'Belltown Roommates 4B',
    'Roommates',
    'Shared apartment appliances, coffee supplies, and split-cost living room essentials.',
    'ROOM-7392',
    'cust_alex',
    tMinus(2100)
  );
  insertMember.run('sgm_rm_1', 'grp_roommates', 'cust_alex', 'Owner', tMinus(5), tMinus(2100));
  insertMember.run('sgm_rm_2', 'grp_roommates', 'cust_maya', 'Member', tMinus(100), tMinus(2000));
  insertMember.run('sgm_rm_3', 'grp_roommates', 'cust_sam', 'Member', tMinus(5), tMinus(1950));

  insertProd.run(
    'sgp_rm_1',
    'grp_roommates',
    'prod_purifier',
    'cust_alex',
    'If we split ₹2,499 three ways for the hall, it is ~₹833 each.',
    JSON.stringify(['cust_alex', 'cust_sam', 'cust_maya']),
    tMinus(400)
  );
  insertProd.run(
    'sgp_rm_2',
    'grp_roommates',
    'prod_espresso',
    'cust_sam',
    'Morning coffee maker pool already has 2/5 joined!',
    JSON.stringify(['cust_sam', 'cust_maya']),
    tMinus(320)
  );

  insertMsg.run(
    'sgmsg_rm_1',
    'grp_roommates',
    'cust_alex',
    'Hey flatmates, should we get the PureAir purifier together this week?',
    'prod_purifier',
    tMinus(140)
  );
  insertMsg.run(
    'sgmsg_rm_2',
    'grp_roommates',
    'cust_sam',
    'Yes! Splitting it three ways works great and we can combine delivery with coffee.',
    null,
    tMinus(25)
  );

  insertAct.run('sga_rm_1', 'grp_roommates', 'Alex Rivera', 'created', 'Created Belltown Roommates 4B', tMinus(2100));
  insertAct.run('sga_rm_2', 'grp_roommates', 'Alex Rivera', 'shared_product', 'Shared PureAir Compact HEPA Room Purifier', tMinus(400));
  insertAct.run('sga_rm_3', 'grp_roommates', 'Sam Brooks', 'shared_product', 'Shared Aura Compact Filter & Espresso Maker', tMinus(320));

  // 3. Friends group (all read)
  insertGroup.run(
    'grp_friends',
    'Weekend Tech & Style Crew',
    'Friends',
    'Comparing specs, coordinating group drops, and sharing everyday picks with friends.',
    'FRND-9154',
    'cust_maya',
    tMinus(3000)
  );
  insertMember.run('sgm_fr_1', 'grp_friends', 'cust_maya', 'Owner', tMinus(10), tMinus(3000));
  insertMember.run('sgm_fr_2', 'grp_friends', 'cust_priya', 'Member', tMinus(10), tMinus(2900));
  insertMember.run('sgm_fr_3', 'grp_friends', 'cust_alex', 'Member', tMinus(10), tMinus(2800));

  insertProd.run(
    'sgp_fr_1',
    'grp_friends',
    'prod_headphones',
    'cust_maya',
    'Group drop saves ₹144 per unit—3/5 already committed.',
    JSON.stringify(['cust_maya', 'cust_alex']),
    tMinus(500)
  );
  insertProd.run(
    'sgp_fr_2',
    'grp_friends',
    'prod_sneakers',
    'cust_priya',
    'Only 1 spot left to unlock the StrideAir Sneakers pool!',
    JSON.stringify(['cust_priya', 'cust_maya']),
    tMinus(420)
  );

  insertMsg.run(
    'sgmsg_fr_1',
    'grp_friends',
    'cust_priya',
    'The StrideAir sneakers pool is at 4/5—just needs 1 more person!',
    'prod_sneakers',
    tMinus(120)
  );
  insertMsg.run(
    'sgmsg_fr_2',
    'grp_friends',
    'cust_maya',
    'Checked the spec audit—looks solid, ordering half size up.',
    null,
    tMinus(60)
  );

  insertAct.run('sga_fr_1', 'grp_friends', 'Maya Chen', 'created', 'Created Weekend Tech & Style Crew', tMinus(3000));
  insertAct.run('sga_fr_2', 'grp_friends', 'Priya Nair', 'shared_product', 'Shared StrideAir Knit Everyday Sneakers', tMinus(420));

  // 4. Friends group with pending invitation for Maya (STUDY-2026)
  insertGroup.run(
    'grp_study',
    'Campus Study Circle',
    'Friends',
    'Backpacks, student laptops, and desk gear picks for semester prep.',
    'STUDY-2026',
    'cust_liam',
    tMinus(1800)
  );
  insertMember.run('sgm_st_1', 'grp_study', 'cust_liam', 'Owner', tMinus(30), tMinus(1800));
  insertMember.run('sgm_st_2', 'grp_study', 'cust_priya', 'Member', tMinus(30), tMinus(1750));

  insertProd.run(
    'sgp_st_1',
    'grp_study',
    'prod_backpack_commuter',
    'cust_liam',
    'Great daily commuter pack for 15.6-inch laptops.',
    JSON.stringify(['cust_liam', 'cust_priya']),
    tMinus(600)
  );
  insertProd.run(
    'sgp_st_2',
    'grp_study',
    'prod_laptop_oled',
    'cust_priya',
    'Student Laptop Group Buy saves 8% right now.',
    JSON.stringify(['cust_priya']),
    tMinus(520)
  );
  insertMsg.run(
    'sgmsg_st_1',
    'grp_study',
    'cust_liam',
    'Sent an invite to Maya so we can coordinate backpack & laptop group buys!',
    'prod_backpack_commuter',
    tMinus(90)
  );
  insertAct.run('sga_st_1', 'grp_study', 'Liam Patel', 'created', 'Created Campus Study Circle', tMinus(1800));
  insertInv.run('sgi_st_maya', 'grp_study', 'cust_maya', 'cust_liam', tMinus(85));

  // 5. Neighbors group joinable via invite code NEIGH-5501 or invite link
  insertGroup.run(
    'grp_neighbors',
    'Harborview Neighbors Pantry',
    'Neighbors',
    'Building neighbors pooling grocery staples and household essentials together.',
    'NEIGH-5501',
    'cust_sam',
    tMinus(1600)
  );
  insertMember.run('sgm_nb_1', 'grp_neighbors', 'cust_sam', 'Owner', tMinus(30), tMinus(1600));
  insertMember.run('sgm_nb_2', 'grp_neighbors', 'cust_alex', 'Member', tMinus(30), tMinus(1500));
  insertProd.run(
    'sgp_nb_1',
    'grp_neighbors',
    'prod_bottle',
    'cust_sam',
    'Everyday stainless bottles for morning walks.',
    JSON.stringify(['cust_sam']),
    tMinus(480)
  );
  insertMsg.run(
    'sgmsg_nb_1',
    'grp_neighbors',
    'cust_sam',
    'Welcome neighbors! Share items here so we can consolidate floor deliveries.',
    null,
    tMinus(200)
  );
  insertAct.run('sga_nb_1', 'grp_neighbors', 'Sam Brooks', 'created', 'Created Harborview Neighbors Pantry', tMinus(1600));
}




