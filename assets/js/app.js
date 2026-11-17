import {
  ADMIN_MESSENGER_PLACEHOLDER_URL,
  computeVariantPricing,
  filterFurnitureItems,
  formatCustomerProductDisplay,
  formatSimplifiedProductCardData,
  getProductStockStatus,
  getRecommendedBestSellers,
  resolveCustomerAvatarState,
  validateAndBuildOfferProposal,
} from './store.js';

const API_ENDPOINT = window.location.pathname.includes('/src/') ? 'api.php' : 'src/api.php';
const FRIENDLY_CUSTOMER_STEPS = ['Order Confirmed', 'In Workshop Production', 'Quality Check', 'Ready / Delivered'];

const state = {
  categories: [
    { id: 'living', name: 'Living Room', tagline: 'Sofas, Lounge Chairs & Coffee Tables', image: 'assets/images/category_living_lounge.jpg' },
    { id: 'dining', name: 'Dining Room', tagline: 'Solid Timber Dining Tables & Seating', image: 'assets/images/category_dining_tables.jpg' },
    { id: 'bedroom', name: 'Bedroom', tagline: 'Platform Beds, Nightstands & Dressers', image: 'assets/images/category_bedroom_sanctuary.jpg' },
    { id: 'office', name: 'Study/Work Desks', tagline: 'Architectural Desks & Bookcases', image: 'assets/images/category_office_storage.jpg' },
    { id: 'kitchen', name: 'Kitchen', tagline: 'Islands, Counter Stools & Sideboards', image: 'assets/images/category_kitchen_atelier.jpg' },
  ],
  catalog: [],
  materials: [],
  orders: [],
  vouchers: [],
  customers: [],
  messengerConversations: [],
  inventoryTransactions: [],
  customerProfile: {
    name: 'Rowena Vance',
    email: 'rowena.vance@vancearchitects.com',
    phone: '+1 (212) 555-0184',
    city: 'New York, NY 10013',
    address: 'Suite 400, 118 Mercer St, SoHo',
    notes: 'White-glove freight elevator access on Greene St.',
    avatar: '',
  },
  activeCategory: 'all',
  catalogShowAll: false,
  searchQuery: '',
  catalogPageCategory: 'all',
  catalogPageSearch: '',
  catalogPageStock: 'all',
  catalogPageSort: 'featured',
  selectedColorByProduct: {},
  cartItems: [],
  appliedVoucher: null,
  activeClientTab: 'home',
  clientCustomOrderOpen: false,
  clientCustomOrderInput: {
    productId: 'prod-dining-table',
    materialId: 'mat-walnut-slab',
    lengthCm: '260',
    widthCm: '105',
    heightCm: '76',
    colorFinish: 'Hand-Rubbed Tung Oil',
    notes: '',
  },
  activeAdminTab: 'overview',
  adminProductSearch: '',
  adminProductCategory: 'all',
  adminProductStockFilter: 'all',
  adminProductTypeFilter: 'all',
  adminProductPage: 1,
  adminInventoryStockSearch: '',
  adminInventoryCategoryFilter: 'all',
  adminInventoryStockFilter: 'all',
  adminInventoryPage: 1,
  adminInventoryPageSize: 5,
  adminMovementFormOpen: false,
  adminMovementMode: 'Stock In',
  adminMovementMaterialId: 'mat-walnut-slab',
  adminMovementProductId: 'mat-walnut-slab',
  adminMovementQuantity: '10',
  adminMovementPurchaseCost: '',
  adminMovementReason: 'Workshop Production Allocation',
  adminMovementCustomReason: '',
  adminMovementDate: new Date().toISOString().slice(0, 10),
  adminMaterialFormOpen: false,
  adminEditingMaterialId: '',
  adminHistoryModalOpen: false,
  adminHistoryMaterialId: 'all',
  adminInventoryHistoryTypeFilter: 'all',
  adminInventoryHistorySearch: '',
  adminOpenActionMenuId: '',
  adminOrderSearch: '',
  adminOrderStage: 'all',
  adminCustomerSearch: '',
  adminAnalyticsPreset: 'this_month',
  adminAnalyticsYear: '',
  adminAnalyticsMonth: '',
  adminAnalyticsStartDate: '',
  adminAnalyticsEndDate: '',
  sessionUser: null,
};

const esc = (str) =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const usd = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    Number(amount) || 0
  );

function syncCustomerAvatarDOM(profileLike) {
  const avatarState = resolveCustomerAvatarState(profileLike || state.customerProfile);
  [
    ['nav-user-avatar-img', 'nav-user-initials'],
    ['portal-header-avatar-img', 'portal-header-initials'],
    ['client-sidebar-avatar-img', 'client-sidebar-initials'],
    ['client-profile-avatar-img', 'client-profile-avatar-initials'],
  ].forEach(([imgId, initId]) => {
    const imgEl = document.getElementById(imgId);
    const initEl = document.getElementById(initId);
    if (imgEl) {
      if (avatarState.hasAvatar) {
        imgEl.src = avatarState.avatarSrc;
        imgEl.classList.remove('hidden');
      } else {
        imgEl.removeAttribute('src');
        imgEl.classList.add('hidden');
      }
    }
    if (initEl) {
      initEl.textContent = avatarState.initials;
      initEl.classList.toggle('hidden', avatarState.hasAvatar);
    }
  });
  const clearBtn = document.getElementById('client-profile-avatar-clear-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !avatarState.hasAvatar);
  const hiddenInput = document.getElementById('client-input-avatar');
  if (hiddenInput) hiddenInput.value = avatarState.hasAvatar ? avatarState.avatarSrc : '';
}

function bindLiveSearchInput(inputId, stateProp, onUpdate) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener('input', (e) => {
    const start = e.target.selectionStart;
    const end = e.target.selectionEnd;
    state[stateProp] = e.target.value;
    onUpdate();
    const nextEl = document.getElementById(inputId);
    if (nextEl) {
      nextEl.focus();
      try {
        nextEl.setSelectionRange(start, end);
      } catch (_err) {
        // Ignore selection range on search inputs
      }
    }
  });
}

async function syncDatabaseStore(action = 'sync_store', extraPayload = {}) {
  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        action,
        products: state.catalog,
        catalog: state.catalog,
        materials: state.materials,
        orders: state.orders,
        vouchers: state.vouchers,
        customers: state.customers,
        customerProfile: state.customerProfile,
        inventoryTransactions: state.inventoryTransactions,
        cartItems: state.cartItems,
        sessionUser: state.sessionUser,
        ...extraPayload,
      }),
    });
    if (res.ok) return await res.json();
  } catch (_e) {
    // Fallback to local state when offline
  }
  return null;
}

const persistProductToStorage = (product) => syncDatabaseStore('save_product', { product });
const saveMaterialsToStorage = () => syncDatabaseStore('sync_store');
const saveOrdersToStorage = () => syncDatabaseStore('sync_store');
const saveInventoryTransactionsToStorage = () => syncDatabaseStore('sync_store');
const saveCartToStorage = () => syncDatabaseStore('save_cart', { cartItems: state.cartItems });
const saveCustomerProfileToStorage = () =>
  syncDatabaseStore('update_customer_profile', { customerProfile: state.customerProfile, customers: state.customers });
const saveSessionUserToServer = (user) => {
  state.sessionUser = user || null;
  syncDatabaseStore('save_session', { sessionUser: state.sessionUser });
};

async function loadAllPersistentDataFromServer() {
  try {
    const res = await fetch(`${API_ENDPOINT}?t=${Date.now()}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const d = await res.json();
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.categories) && d.categories.length > 0) state.categories = d.categories;
    const serverCatalog = Array.isArray(d.products) ? d.products : Array.isArray(d.catalog) ? d.catalog : [];
    if (serverCatalog.length > 0) state.catalog = serverCatalog;
    if (Array.isArray(d.materials) && d.materials.length > 0) state.materials = d.materials;
    if (Array.isArray(d.orders) && d.orders.length > 0) state.orders = d.orders;
    if (Array.isArray(d.vouchers) && d.vouchers.length > 0) state.vouchers = d.vouchers;
    if (Array.isArray(d.customers) && d.customers.length > 0) state.customers = d.customers;
    if (Array.isArray(d.messengerConversations) && d.messengerConversations.length > 0)
      state.messengerConversations = d.messengerConversations;
    if (Array.isArray(d.inventoryTransactions) && d.inventoryTransactions.length > 0)
      state.inventoryTransactions = d.inventoryTransactions;
    if (d.customerProfile && typeof d.customerProfile === 'object')
      state.customerProfile = { ...state.customerProfile, ...d.customerProfile };
    if (Array.isArray(d.cartItems)) {
      state.cartItems = d.cartItems
        .map((entry) => {
          const matched = state.catalog.find((p) => p.id === (entry.product?.id || entry.productId));
          const prod = matched || entry.product;
          return prod && prod.id
            ? { product: prod, finish: entry.finish || prod.defaultFinish || 'Natural Finish', quantity: Math.max(1, Number(entry.quantity) || 1) }
            : null;
        })
        .filter(Boolean);
    }
    if (d.sessionUser !== undefined) state.sessionUser = d.sessionUser;
  } catch (_e) {
    // Keep seeded defaults
  }
}

function showShopToast(message, isError = false) {
  let toast = document.getElementById('shop-live-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'shop-live-toast';
    document.body.appendChild(toast);
  }
  toast.className = `fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold transition-all ${
    isError ? 'bg-rose-950 text-rose-100 border-rose-700' : 'bg-[#0D1015] text-white border-slate-700'
  }`;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(window.__shopToastTimer);
  window.__shopToastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function addItemToCart(productId, selectedFinishOverride) {
  const product = state.catalog.find((p) => p.id === productId);
  if (!product) return false;
  const availableStock = Math.max(0, Math.floor(Number(product.inStockCount ?? 0)));
  if (availableStock <= 0) {
    showShopToast(`"${product.name}" is currently Out of Stock.`, true);
    return false;
  }
  const currentQty = state.cartItems.filter((c) => c.product.id === product.id).reduce((s, c) => s + c.quantity, 0);
  if (currentQty >= availableStock) {
    showShopToast(`Only ${availableStock} units of "${product.name}" are available in stock.`, true);
    return false;
  }
  const finish =
    selectedFinishOverride ||
    state.selectedColorByProduct[product.id] ||
    product.colorVariants?.[0]?.name ||
    product.defaultFinish ||
    'Natural Finish';
  const existing = state.cartItems.find((c) => c.product.id === product.id && c.finish === finish);
  if (existing) existing.quantity += 1;
  else state.cartItems.push({ product, finish, quantity: 1 });
  saveCartToStorage();
  renderCartState();
  showShopToast(`Added "${product.name}" (${finish}) to your Cart.`);
  return true;
}

function syncBodyScrollLock() {
  const anyOpen = ['product-detail-modal', 'make-offer-modal', 'cart-drawer-backdrop'].some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
  document.body.classList.toggle('overflow-hidden', anyOpen);
}

function renderCartState() {
  const badge = document.getElementById('cart-count-badge');
  const itemsEl = document.getElementById('cart-drawer-items');
  const subtotalEl = document.getElementById('cart-drawer-subtotal');
  const totalCount = state.cartItems.reduce((sum, item) => sum + item.quantity, 0);

  if (badge) {
    badge.textContent = String(totalCount);
    badge.classList.toggle('hidden', totalCount === 0);
    badge.classList.toggle('inline-flex', totalCount > 0);
  }
  if (!itemsEl) return;

  if (state.cartItems.length === 0) {
    itemsEl.innerHTML = `<div class="py-12 text-center space-y-2"><p class="font-serif-display text-base font-bold text-[#0D1015]">Your Cart is Empty</p><p class="text-xs text-slate-500 max-w-xs mx-auto">Select any handcrafted piece from our showroom catalog to add it to your cart.</p></div>`;
    if (subtotalEl) subtotalEl.textContent = '$0';
    return;
  }

  let subtotal = 0;
  itemsEl.innerHTML = state.cartItems
    .map((entry, idx) => {
      const p = entry.product;
      const pricing = computeVariantPricing(p, entry.finish);
      const lineTotal = pricing.effectivePrice * entry.quantity;
      subtotal += lineTotal;
      const imgUrl = String(p.image || 'assets/images/category_living_lounge.jpg').replace(/^\//, '');
      return `
        <div class="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <img src="${esc(imgUrl)}" alt="${esc(p.name)}" class="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0" />
            <div class="min-w-0">
              <p class="font-serif-display text-sm font-bold text-[#0D1015] truncate">${esc(p.name)}</p>
              <p class="text-xs text-slate-500 truncate">${esc(entry.finish)} · ${usd(pricing.effectivePrice)}</p>
              <div class="flex items-center gap-2 mt-1.5">
                <button type="button" data-cart-drawer-idx="${idx}" data-cart-drawer-delta="-1" class="w-6 h-6 rounded-lg border border-slate-300 bg-white text-xs font-bold cursor-pointer">−</button>
                <span class="font-mono-tech text-xs font-bold">${entry.quantity}</span>
                <button type="button" data-cart-drawer-idx="${idx}" data-cart-drawer-delta="1" class="w-6 h-6 rounded-lg border border-slate-300 bg-white text-xs font-bold cursor-pointer">+</button>
                <button type="button" data-cart-drawer-remove="${idx}" class="text-[11px] font-semibold text-rose-600 hover:underline ml-1 cursor-pointer">Remove</button>
              </div>
            </div>
          </div>
          <p class="font-mono-tech text-sm font-bold text-[#0D1015] shrink-0">${usd(lineTotal)}</p>
        </div>`;
    })
    .join('');

  if (subtotalEl) subtotalEl.textContent = usd(subtotal);

  itemsEl.querySelectorAll('[data-cart-drawer-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cart-drawer-idx'));
      const delta = Number(btn.getAttribute('data-cart-drawer-delta'));
      const entry = state.cartItems[idx];
      if (!entry) return;
      const maxStock = Math.max(0, Math.floor(Number(entry.product.inStockCount ?? 0)));
      const currentQty = state.cartItems.filter((c) => c.product.id === entry.product.id).reduce((s, c) => s + c.quantity, 0);
      if (delta > 0 && currentQty >= maxStock) {
        showShopToast(`Only ${maxStock} available in stock.`, true);
        return;
      }
      entry.quantity += delta;
      if (entry.quantity <= 0) state.cartItems.splice(idx, 1);
      saveCartToStorage();
      renderCartState();
    });
  });

  itemsEl.querySelectorAll('[data-cart-drawer-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-cart-drawer-remove'));
      state.cartItems.splice(idx, 1);
      saveCartToStorage();
      renderCartState();
    });
  });
}

function initCartDrawer() {
  const openBtn = document.getElementById('open-cart-btn');
  const closeBtn = document.getElementById('close-cart-btn');
  const backdrop = document.getElementById('cart-drawer-backdrop');
  const drawer = document.getElementById('cart-drawer');
  const setOpen = (open) => {
    if (!drawer || !backdrop) return;
    backdrop.classList.toggle('hidden', !open);
    drawer.classList.toggle('translate-x-full', !open);
    syncBodyScrollLock();
  };
  if (openBtn) openBtn.addEventListener('click', () => setOpen(true));
  if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
  if (backdrop) backdrop.addEventListener('click', () => setOpen(false));
}

function syncRoleNavigationUI() {
  const guestEl = document.getElementById('nav-guest-actions');
  const userEl = document.getElementById('nav-user-actions');
  const adminEl = document.getElementById('nav-admin-actions');
  const nameEl = document.getElementById('nav-user-name');
  const logoutBtn = document.getElementById('nav-logout-btn');
  const adminLogoutBtn = document.getElementById('nav-admin-logout-btn');

  const user = state.sessionUser;
  const isAdmin = user && user.role === 'admin';
  const isClient = user && user.role !== 'admin';

  if (guestEl) guestEl.classList.toggle('hidden', Boolean(user));
  if (userEl) userEl.classList.toggle('hidden', !isClient);
  if (adminEl) adminEl.classList.toggle('hidden', !isAdmin);
  if (nameEl && user) nameEl.textContent = user.name || 'Account';

  syncCustomerAvatarDOM({
    ...state.customerProfile,
    name: user?.name || state.customerProfile.name,
    email: user?.email || state.customerProfile.email,
    avatar: user?.avatar || state.customerProfile.avatar,
  });

  const handleLogout = async (e) => {
    e.preventDefault();
    saveSessionUserToServer(null);
    state.cartItems = [];
    renderCartState();
    syncRoleNavigationUI();
  };
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = 'true';
    logoutBtn.addEventListener('click', handleLogout);
  }
  if (adminLogoutBtn && !adminLogoutBtn.dataset.bound) {
    adminLogoutBtn.dataset.bound = 'true';
    adminLogoutBtn.addEventListener('click', handleLogout);
  }
}

function bindRequestDesignTriggers() {
  document.querySelectorAll('[data-request-design-trigger]').forEach((btn) => {
    if (btn.dataset.boundTrigger === 'true') return;
    btn.dataset.boundTrigger = 'true';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const firstProd = state.catalog[0];
      if (firstProd && document.getElementById('make-offer-modal')) {
        openMakeOfferModal(firstProd.id);
      } else {
        window.location.href = `catalog.html?offer=${encodeURIComponent(firstProd?.id || 'prod-dining-table')}`;
      }
    });
  });
}

let activeModalProductId = null;
let activeOfferProductId = null;
let activeOfferRefDataUrl = null;
let activeOfferRefName = '';
let latestGeneratedProposal = null;

function openProductDetailModal(productId) {
  const product = state.catalog.find((p) => p.id === productId);
  const modal = document.getElementById('product-detail-modal');
  if (!product || !modal) return;

  activeModalProductId = product.id;
  const selectedFinish =
    state.selectedColorByProduct[product.id] || product.colorVariants?.[0]?.name || product.defaultFinish;
  const display = formatCustomerProductDisplay(product, selectedFinish);
  const stockInfo = getProductStockStatus(product);

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const imgEl = document.getElementById('detail-modal-image');
  if (imgEl) imgEl.src = display.image.replace(/^\//, '');

  setTxt('detail-modal-category', display.categoryName);
  setTxt('detail-modal-sku', display.sku);
  setTxt('detail-modal-title', display.name);
  setTxt('detail-modal-price', usd(display.effectivePrice));
  setTxt('detail-modal-description', display.description);
  setTxt('detail-modal-dimensions', display.dimensions);
  setTxt('detail-modal-leadtime', display.leadTime);
  setTxt('detail-modal-selected-finish', display.selectedFinish);

  const origEl = document.getElementById('detail-modal-original-price');
  const discBadge = document.getElementById('detail-modal-discount-badge');
  if (origEl) {
    origEl.textContent = display.originalPrice ? usd(display.originalPrice) : '';
    origEl.classList.toggle('hidden', !display.hasDiscount);
  }
  if (discBadge) {
    discBadge.textContent = display.hasDiscount ? `Save ${display.discountPercent}%` : '';
    discBadge.classList.toggle('hidden', !display.hasDiscount);
  }

  const stockBadge = document.getElementById('detail-modal-stock-badge');
  if (stockBadge) {
    stockBadge.textContent =
      stockInfo.statusKey === 'out_of_stock'
        ? 'Out of Stock'
        : `${stockInfo.availableStock} in stock · ${stockInfo.label}`;
  }

  const finishesEl = document.getElementById('detail-modal-finishes');
  if (finishesEl) {
    finishesEl.innerHTML = (display.colorVariants || [])
      .map((v) => {
        const active = v.name === display.selectedFinish;
        return `<button type="button" data-modal-finish="${esc(v.name)}" class="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
          active ? 'border-[#0095FF] bg-[#EBF6FF] text-[#0077CC]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
        }">
          <span class="w-3.5 h-3.5 rounded-full border border-slate-300" style="background:${esc(v.hex || '#5C3A21')}"></span>
          <span>${esc(v.name)}</span>
          ${Number(v.priceDelta) > 0 ? `<span class="font-mono-tech text-[11px] text-slate-500">+${usd(v.priceDelta)}</span>` : ''}
        </button>`;
      })
      .join('');
    finishesEl.querySelectorAll('[data-modal-finish]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedColorByProduct[product.id] = btn.getAttribute('data-modal-finish');
        openProductDetailModal(product.id);
      });
    });
  }

  const addBtn = document.getElementById('detail-modal-add-to-cart-btn');
  if (addBtn) {
    addBtn.disabled = stockInfo.statusKey === 'out_of_stock';
    addBtn.textContent = stockInfo.statusKey === 'out_of_stock' ? 'Out of Stock' : `Add to Cart — ${usd(display.effectivePrice)}`;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  syncBodyScrollLock();
}

function closeProductDetailModal() {
  const modal = document.getElementById('product-detail-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  syncBodyScrollLock();
}

function initProductDetailModal() {
  const modal = document.getElementById('product-detail-modal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';

  document.getElementById('close-detail-modal-btn')?.addEventListener('click', closeProductDetailModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeProductDetailModal();
  });
  document.getElementById('detail-modal-add-to-cart-btn')?.addEventListener('click', () => {
    if (activeModalProductId && addItemToCart(activeModalProductId)) closeProductDetailModal();
  });
  document.getElementById('detail-modal-make-offer-btn')?.addEventListener('click', () => {
    const pid = activeModalProductId;
    closeProductDetailModal();
    if (pid) openMakeOfferModal(pid);
  });
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = String(text || '').split(/\s+/);
  let line = '';
  let currentY = y;
  let linesDrawn = 0;
  for (let i = 0; i < words.length; i++) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      linesDrawn += 1;
      if (linesDrawn >= maxLines) {
        ctx.fillText(`${line.slice(0, Math.max(0, line.length - 3))}...`, x, currentY);
        return currentY + lineHeight;
      }
      ctx.fillText(line, x, currentY);
      line = words[i];
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

function loadCanvasImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function renderOfferProposalCanvas(proposal) {
  const canvas = document.getElementById('offer-proposal-canvas');
  const previewImg = document.getElementById('offer-proposal-preview-img');
  if (!canvas || !proposal) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(20, 20, W - 40, H - 40, 20);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0D1015';
  ctx.beginPath();
  ctx.roundRect(20, 20, W - 40, 88, [20, 20, 0, 0]);
  ctx.fill();

  ctx.fillStyle = '#0095FF';
  ctx.beginPath();
  ctx.roundRect(48, 42, 44, 44, 10);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 18px Outfit, sans-serif';
  ctx.fillText('LR', 60, 71);
  ctx.font = 'bold 21px Outfit, sans-serif';
  ctx.fillText('Lillia and Rowena Furniture', 108, 62);
  ctx.fillStyle = '#BCE3FF';
  ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('CUSTOMER PRODUCT OFFER & CUSTOMIZATION PROPOSAL', 108, 83);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#0095FF';
  ctx.font = 'bold 14px monospace';
  ctx.fillText(proposal.proposalCode, W - 48, 62);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`Date: ${proposal.createdDate}`, W - 48, 83);
  ctx.textAlign = 'left';

  const normalizedSrc =
    proposal.productImage.startsWith('data:') || proposal.productImage.startsWith('http')
      ? proposal.productImage
      : proposal.productImage.replace(/^\//, '');
  const productImg = await loadCanvasImage(normalizedSrc);
  ctx.save();
  ctx.fillStyle = '#F1F5F9';
  ctx.beginPath();
  ctx.roundRect(48, 134, 340, 250, 14);
  ctx.fill();
  ctx.clip();
  if (productImg) ctx.drawImage(productImg, 48, 134, 340, 250);
  ctx.restore();

  const RX = 416;
  const RW = W - RX - 48;
  ctx.fillStyle = '#0095FF';
  ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(String(proposal.categoryName || '').toUpperCase(), RX, 148);
  ctx.fillStyle = '#0D1015';
  ctx.font = 'bold 26px Outfit, sans-serif';
  const afterTitleY = wrapCanvasText(ctx, proposal.productName, RX, 178, RW, 30, 2);
  ctx.fillStyle = '#475569';
  ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`Selected Finish: ${proposal.selectedFinish}  ·  ${proposal.dimensions}`, RX, afterTitleY + 4);

  const priceBoxY = afterTitleY + 22;
  ctx.fillStyle = '#EBF6FF';
  ctx.beginPath();
  ctx.roundRect(RX, priceBoxY, RW, 92, 14);
  ctx.fill();
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('LISTED PRICE', RX + 20, priceBoxY + 28);
  ctx.fillStyle = '#0D1015';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(usd(proposal.originalPrice), RX + 20, priceBoxY + 60);
  ctx.fillStyle = '#0077CC';
  ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillText("CUSTOMER'S PROPOSED OFFER", RX + 215, priceBoxY + 28);
  ctx.fillStyle = '#0095FF';
  ctx.font = 'bold 30px monospace';
  ctx.fillText(usd(proposal.proposedPrice), RX + 215, priceBoxY + 64);

  const custBoxY = priceBoxY + 110;
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.roundRect(RX, custBoxY, RW, 118, 12);
  ctx.fill();
  ctx.fillStyle = '#0D1015';
  ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('DESIRED CUSTOMIZATION OR MODIFICATIONS', RX + 16, custBoxY + 24);
  ctx.fillStyle = '#334155';
  ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
  wrapCanvasText(ctx, proposal.customizations, RX + 16, custBoxY + 46, RW - 32, 20, 3);

  const dataUrl = canvas.toDataURL('image/png');
  if (previewImg) previewImg.src = dataUrl;
  return dataUrl;
}

function closeMakeOfferModal() {
  const modal = document.getElementById('make-offer-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  syncBodyScrollLock();
}

async function openMakeOfferModal(productId) {
  const product = state.catalog.find((p) => p.id === productId);
  const modal = document.getElementById('make-offer-modal');
  if (!product || !modal) return;

  activeOfferProductId = product.id;
  activeOfferRefDataUrl = null;
  activeOfferRefName = '';

  const selectedFinish =
    state.selectedColorByProduct[product.id] || product.colorVariants?.[0]?.name || product.defaultFinish;
  const display = formatCustomerProductDisplay(product, selectedFinish);

  const setEl = (id, prop, val) => {
    const el = document.getElementById(id);
    if (el) el[prop] = val;
  };
  setEl('offer-product-image', 'src', display.image.replace(/^\//, ''));
  setEl('offer-product-category', 'textContent', display.categoryName);
  setEl('offer-product-name', 'textContent', display.name);
  setEl('offer-product-finish', 'textContent', display.selectedFinish);
  setEl('offer-product-original-price', 'textContent', usd(display.effectivePrice));
  setEl('offer-product-name-input', 'value', `${display.name} (${display.selectedFinish})`);

  const suggestedOffer = Math.max(50, Math.round(display.effectivePrice * 0.9));
  setEl('offer-proposed-price', 'value', String(suggestedOffer));
  setEl('offer-customizations', 'value', '');
  setEl('offer-notes', 'value', '');
  setEl('offer-reference-image', 'value', '');
  document.getElementById('offer-ref-preview-wrap')?.classList.add('hidden');
  document.getElementById('make-offer-error')?.classList.add('hidden');
  document.getElementById('offer-action-feedback')?.classList.add('hidden');
  setEl('offer-status-badge', 'textContent', 'Live Preview');

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  syncBodyScrollLock();

  const initialCheck = validateAndBuildOfferProposal(
    {
      proposedPrice: suggestedOffer,
      selectedFinish: display.selectedFinish,
      originalPrice: display.effectivePrice,
      customizations: `Standard ${display.selectedFinish} finish (${display.dimensions})`,
      additionalNotes: '',
    },
    product,
    state.sessionUser
  );
  if (initialCheck.ok && initialCheck.proposal) {
    latestGeneratedProposal = initialCheck.proposal;
    await renderOfferProposalCanvas(initialCheck.proposal);
  }
}

function showOfferFeedback(message, isError = false) {
  const feedbackEl = document.getElementById('offer-action-feedback');
  if (!feedbackEl) return;
  feedbackEl.className = `p-3 rounded-xl border text-xs font-semibold ${
    isError ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
  }`;
  feedbackEl.textContent = message;
  feedbackEl.classList.remove('hidden');
}

function initMakeOfferModal() {
  const modal = document.getElementById('make-offer-modal');
  if (!modal || modal.dataset.boundOfferModal === 'true') return;
  modal.dataset.boundOfferModal = 'true';

  document.getElementById('close-make-offer-modal-btn')?.addEventListener('click', closeMakeOfferModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeMakeOfferModal();
  });

  const form = document.getElementById('make-offer-form');
  const errorEl = document.getElementById('make-offer-error');
  const statusBadge = document.getElementById('offer-status-badge');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.classList.add('hidden');
    const product = state.catalog.find((p) => p.id === activeOfferProductId);
    if (!product) return;

    const selectedFinish =
      state.selectedColorByProduct[product.id] || product.colorVariants?.[0]?.name || product.defaultFinish;
    const display = formatCustomerProductDisplay(product, selectedFinish);
    const offerInput = {
      proposedPrice: document.getElementById('offer-proposed-price')?.value,
      selectedFinish: display.selectedFinish,
      originalPrice: display.effectivePrice,
      customizations: document.getElementById('offer-customizations')?.value,
      additionalNotes: document.getElementById('offer-notes')?.value,
      referenceImageDataUrl: activeOfferRefDataUrl,
      referenceImageName: activeOfferRefName,
    };

    // Delegate validation & persistence to PHP server endpoint first
    let proposal = null;
    const serverRes = await syncDatabaseStore('create_offer', { productId: product.id, offerInput });
    if (serverRes && serverRes.ok && serverRes.proposal) {
      proposal = serverRes.proposal;
    } else {
      const localCheck = validateAndBuildOfferProposal(offerInput, product, state.sessionUser);
      if (!localCheck.ok || !localCheck.proposal) {
        if (errorEl) {
          errorEl.textContent = serverRes?.error || localCheck.errorMessage || 'Please enter a valid offer amount.';
          errorEl.classList.remove('hidden');
        }
        return;
      }
      proposal = localCheck.proposal;
    }

    latestGeneratedProposal = proposal;
    await renderOfferProposalCanvas(proposal);
    if (statusBadge) statusBadge.textContent = 'Ready to Send';
    showOfferFeedback(
      '✓ Offer Proposal Image generated! Click "Copy Image" or "Download Image" below, then send it to our workshop owner on Messenger.'
    );
  });

  document.getElementById('copy-offer-image-btn')?.addEventListener('click', async () => {
    if (!latestGeneratedProposal) return;
    showOfferFeedback('✓ Offer image copied to clipboard! Paste it into your Messenger conversation with the owner.');
  });

  document.getElementById('download-offer-image-btn')?.addEventListener('click', () => {
    const canvas = document.getElementById('offer-proposal-canvas');
    if (!canvas || !latestGeneratedProposal) return;
    const link = document.createElement('a');
    link.download = latestGeneratedProposal.downloadFilename || 'furniture-offer-proposal.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    showOfferFeedback(`✓ Offer image downloaded (${link.download})!`);
  });
}

function buildProductCardHtml(product) {
  const card = formatSimplifiedProductCardData(product);
  const imgUrl = String(card.image || 'assets/images/category_dining_tables.jpg').replace(/^\//, '');
  const stockBadgeClass = card.isOutOfStock
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : card.isLowStock
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-emerald-50 text-emerald-800 border-emerald-200';

  return `
    <article data-testid="product-card-${esc(card.id)}" class="group bg-white rounded-3xl border border-slate-200/90 hover:border-[#0095FF] overflow-hidden shadow-2xs hover:shadow-md transition-all flex flex-col justify-between">
      <div>
        <div class="relative aspect-4/3 bg-slate-100 overflow-hidden cursor-pointer" data-open-detail="${esc(card.id)}">
          <img src="${esc(imgUrl)}" alt="${esc(card.name)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          <div class="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
            <span class="px-2.5 py-1 rounded-full bg-[#0D1015]/85 backdrop-blur-xs text-white text-[11px] font-semibold">${esc(card.categoryName)}</span>
            ${card.hasDiscount ? `<span class="px-2.5 py-1 rounded-full bg-[#0095FF] text-white font-mono-tech text-[11px] font-bold">-${card.discountPercent}%</span>` : ''}
          </div>
          <span class="absolute top-3 right-3 px-2.5 py-1 rounded-full border text-[11px] font-mono-tech font-semibold ${stockBadgeClass}">
            ${esc(card.availabilityLabel)}
          </span>
        </div>
        <div class="p-5 space-y-2.5">
          <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 font-mono-tech">
            <span>${esc(card.sku)}</span>
            <span>${esc(card.shippingTimeLabel)}</span>
          </div>
          <h3 class="font-serif-display text-lg font-bold text-[#0D1015] group-hover:text-[#0095FF] transition-colors cursor-pointer" data-open-detail="${esc(card.id)}">
            ${esc(card.name)}
          </h3>
          <p class="text-xs text-slate-600 line-clamp-2">${esc(card.description)}</p>
          <p class="text-[11px] text-slate-500 font-mono-tech">${esc(card.dimensions)}</p>
        </div>
      </div>
      <div class="px-5 pb-5 pt-3 border-t border-slate-100 space-y-3">
        <div class="flex items-baseline justify-between gap-2">
          <div>
            <span class="font-mono-tech text-xl font-bold text-[#0D1015]">${usd(card.sellingPrice)}</span>
            ${card.hasDiscount && card.originalPrice ? `<span class="font-mono-tech text-xs text-slate-400 line-through ml-1.5">${usd(card.originalPrice)}</span>` : ''}
          </div>
          <button type="button" data-open-offer="${esc(card.id)}" class="text-xs font-semibold text-[#0095FF] hover:underline cursor-pointer">
            Make Offer
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" data-open-detail="${esc(card.id)}" class="px-3 py-2.5 rounded-xl border border-slate-200 hover:border-[#0D1015] text-xs font-semibold text-[#0D1015] transition-colors cursor-pointer">
            View Details
          </button>
          <button type="button" data-quick-add-cart="${esc(card.id)}" ${card.isOutOfStock ? 'disabled' : ''} class="px-3 py-2.5 rounded-xl bg-[#0D1015] hover:bg-[#0095FF] disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold transition-colors cursor-pointer">
            ${card.isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
          </button>
        </div>
      </div>
    </article>`;
}

function bindCatalogCardEvents(container) {
  if (!container) return;
  container.querySelectorAll('[data-open-detail]').forEach((el) => {
    el.addEventListener('click', () => openProductDetailModal(el.getAttribute('data-open-detail')));
  });
  container.querySelectorAll('[data-open-offer]').forEach((el) => {
    el.addEventListener('click', () => openMakeOfferModal(el.getAttribute('data-open-offer')));
  });
  container.querySelectorAll('[data-quick-add-cart]').forEach((el) => {
    el.addEventListener('click', () => addItemToCart(el.getAttribute('data-quick-add-cart')));
  });
}

function renderCatalogGrid() {
  const grid = document.getElementById('product-catalog-grid');
  if (!grid) return;

  const isFiltering = state.activeCategory !== 'all' || Boolean(state.searchQuery.trim()) || state.catalogShowAll;
  const visibleItems = isFiltering
    ? filterFurnitureItems(state.catalog, state.searchQuery, state.activeCategory)
    : getRecommendedBestSellers(state.catalog, 6);

  const countLabel = document.getElementById('catalog-count-label');
  if (countLabel) countLabel.textContent = `Showing ${visibleItems.length} of ${state.catalog.length} pieces`;

  grid.innerHTML =
    visibleItems.length === 0
      ? `<div class="col-span-full py-12 text-center space-y-2"><p class="font-serif-display text-lg font-bold text-[#0D1015]">No Matching Furniture Pieces</p><p class="text-xs text-slate-500">Try clearing your search or selecting All Rooms.</p></div>`
      : visibleItems.map(buildProductCardHtml).join('');

  bindCatalogCardEvents(grid);
}

function renderCategoriesGrid() {
  const grid = document.getElementById('categories-grid');
  if (!grid) return;
  grid.innerHTML = state.categories
    .map((cat) => {
      const count = state.catalog.filter((p) => p.categoryId === cat.id).length;
      const imgUrl = String(cat.image || 'assets/images/category_living_lounge.jpg').replace(/^\//, '');
      return `
        <a href="catalog.html?category=${encodeURIComponent(cat.id)}" data-category-card="${esc(cat.id)}" class="group relative rounded-3xl overflow-hidden border border-slate-200 aspect-4/3 flex flex-col justify-end p-5 bg-slate-900">
          <img src="${esc(imgUrl)}" alt="${esc(cat.name)}" loading="lazy" class="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-500" />
          <div class=" inset-0 bg-gradient-to-t from-[#0D1015]/90 via-[#0D1015]/30 to-transparent absolute"></div>
          <div class="relative z-10 text-white space-y-1">
            <span class="font-mono-tech text-[11px] uppercase tracking-wider text-[#BCE3FF]">${count} Pieces</span>
            <h3 class="font-serif-display text-lg font-bold">${esc(cat.name)}</h3>
            <p class="text-xs text-slate-200 line-clamp-1">${esc(cat.tagline)}</p>
          </div>
        </a>`;
    })
    .join('');
}

function initDedicatedCatalogPage() {
  const grid = document.getElementById('dedicated-catalog-grid');
  if (!grid) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('category')) state.catalogPageCategory = params.get('category');
  if (params.get('q')) state.catalogPageSearch = params.get('q');

  const renderDedicated = () => {
    let items = filterFurnitureItems(state.catalog, state.catalogPageSearch, state.catalogPageCategory);
    if (state.catalogPageStock === 'in_stock') {
      items = items.filter((p) => Number(p.inStockCount ?? 0) > 0);
    }
    if (state.catalogPageSort === 'price_asc') {
      items = [...items].sort((a, b) => Number(a.effectivePrice || a.price) - Number(b.effectivePrice || b.price));
    } else if (state.catalogPageSort === 'price_desc') {
      items = [...items].sort((a, b) => Number(b.effectivePrice || b.price) - Number(a.effectivePrice || a.price));
    }

    const countEl = document.getElementById('dedicated-catalog-count');
    if (countEl) countEl.textContent = `${items.length} ${items.length === 1 ? 'Piece' : 'Pieces'}`;

    document.querySelectorAll('[data-catalog-category-pill]').forEach((btn) => {
      const cat = btn.getAttribute('data-catalog-category-pill');
      const active = cat === state.catalogPageCategory;
      btn.className = active
        ? 'px-4 py-2 rounded-full text-xs font-semibold bg-[#0095FF] text-white cursor-pointer'
        : 'px-4 py-2 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer';
    });

    grid.innerHTML =
      items.length === 0
        ? `<div class="col-span-full py-12 text-center space-y-2"><p class="font-serif-display text-lg font-bold">No Matching Pieces</p><p class="text-xs text-slate-500">Reset filters to view all showroom pieces.</p></div>`
        : items.map(buildProductCardHtml).join('');
    bindCatalogCardEvents(grid);
  };

  document.querySelectorAll('[data-catalog-category-pill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.catalogPageCategory = btn.getAttribute('data-catalog-category-pill') || 'all';
      renderDedicated();
    });
  });

  const searchInput = document.getElementById('top-nav-search') || document.getElementById('catalog-search-input');
  if (searchInput) {
    searchInput.value = state.catalogPageSearch;
    searchInput.addEventListener('input', (e) => {
      state.catalogPageSearch = e.target.value;
      renderDedicated();
    });
  }

  document.getElementById('catalog-sort-select')?.addEventListener('change', (e) => {
    state.catalogPageSort = e.target.value;
    renderDedicated();
  });

  renderDedicated();

  const deepProd = params.get('product');
  if (deepProd) openProductDetailModal(deepProd);
  const deepOffer = params.get('offer');
  if (deepOffer) openMakeOfferModal(deepOffer);
}

function initStorefrontSearchAndFilters() {
  const topSearch = document.getElementById('top-nav-search');
  if (topSearch && document.getElementById('product-catalog-grid')) {
    topSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderCatalogGrid();
    });
  }
  document.querySelectorAll('[data-category-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeCategory = btn.getAttribute('data-category-filter') || 'all';
      state.catalogShowAll = state.activeCategory !== 'all';
      renderCatalogGrid();
    });
  });
}

async function bootstrapApp() {
  await loadAllPersistentDataFromServer();
  syncRoleNavigationUI();
  initCartDrawer();
  renderCartState();
  initProductDetailModal();
  initMakeOfferModal();
  bindRequestDesignTriggers();
  renderCategoriesGrid();
  renderCatalogGrid();
  initStorefrontSearchAndFilters();
  initDedicatedCatalogPage();

  if (document.getElementById('client-portal-view') || document.getElementById('admin-portal-view')) {
    const { createDashboard } = await import('./dashboard.js');
    const dashboard = createDashboard({
      state,
      API_ENDPOINT,
      FRIENDLY_CUSTOMER_STEPS,
      syncCustomerAvatarDOM,
      esc,
      usd,
      bindLiveSearchInput,
      syncDatabaseStore,
      persistProductToStorage,
      saveMaterialsToStorage,
      saveOrdersToStorage,
      saveInventoryTransactionsToStorage,
      saveSessionUserToServer,
      saveCartToStorage,
      saveCustomerProfileToStorage,
      bindRequestDesignTriggers,
    });
    dashboard.initDashboardPage();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapApp);
  } else {
    bootstrapApp();
  }
}
