import {
  ADMIN_MESSENGER_PLACEHOLDER_URL,
  PRODUCT_TYPES,
  applyAdminOrderUpdate,
  applyMaterialStockMovement,
  buildMaterialRecord,
  buildProductRecord,
  calculateExpirationFromInput,
  calculateOrderPricing,
  computeCustomerDirectory,
  computeInventoryMetrics,
  computeMaterialInventoryMetrics,
  computeVariantPricing,
  computeVoucherStatusInfo,
  createCustomOrderRequest,
  describeMaterialStockPreview,
  filterCustomerVouchers,
  filterInventoryMaterials,
  formatSimplifiedProductCardData,
  formatVoucherBenefitLabel,
  formatVoucherExpiryDisplay,
  formatVoucherIssuedDisplay,
  generateOwnEntityId,
  getCompletedTransactionsForCustomer,
  getManilaDateInputDefaults,
  getMaterialCategories,
  getMaterialStockStatus,
  getProductStockStatus,
  isOrderCompleted,
  paginateItems,
  partitionOrdersByCompletion,
  recordCustomerOrderPayment,
  removeMaterialFromInventory,
  removeProductFromCatalog,
  requestOrderCancellation,
  resolveCustomerAvatarState,
  resolveOrderCancellationRequest,
  revokeVoucherInList,
  validateAndCreateVoucher,
  validateMaterialInput,
  validateNewFurnitureInput,
  validateVoucherForOrder,
  verifyAndCreateOrder,
} from './store.js';

import {
  buildAnalyticsCsvContent,
  buildAnalyticsPdfBytes,
  computeMonthlyAnalyticsReport,
  resolveAnalyticsDateRange,
} from './analytics.js';

export function createDashboard({
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
}) {
  let voucherCountdownTimerId = null;
  let pendingConfirmAction = null;
  let pendingCancelAction = null;

  function openAdminConfirmModal({
    title,
    message,
    confirmLabel = 'Confirm',
    confirmVariant = 'danger',
    onConfirm,
    onCancel = null,
  }) {
    const modal = document.getElementById('admin-confirm-modal');
    if (!modal) {
      if (typeof onConfirm === 'function') onConfirm();
      return;
    }
    const setTxt = (id, t) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    };
    setTxt('admin-confirm-title', title || 'Confirm Action');
    setTxt('admin-confirm-message', message || 'Are you sure you want to proceed?');
    const acceptBtn = document.getElementById('admin-confirm-accept');
    if (acceptBtn) {
      acceptBtn.textContent = confirmLabel;
      acceptBtn.className =
        confirmVariant === 'primary' ? 'admin-btn admin-btn-primary' : 'admin-btn admin-btn-danger';
    }
    pendingConfirmAction = onConfirm;
    pendingCancelAction = onCancel;
    modal.classList.remove('hidden');
  }

  function showClientBanner(msg) {
    const banner = document.getElementById('client-action-banner');
    if (!banner) return;
    banner.textContent = `✓ ${msg}`;
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 3500);
  }

  function showAdminBanner(msg, isError = false) {
    const banner = document.getElementById('admin-status-banner');
    if (!banner) return;
    banner.className = isError
      ? 'p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-medium flex items-center justify-between gap-3'
      : 'p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium flex items-center justify-between gap-3';
    banner.innerHTML = `<span class="flex items-center gap-2"><span class="font-bold">${
      isError ? '!' : '✓'
    }</span><span>${esc(msg)}</span></span><button type="button" id="admin-banner-dismiss" class="text-xs font-semibold ${
      isError ? 'text-rose-800' : 'text-emerald-800'
    } hover:underline cursor-pointer">Dismiss</button>`;
    banner.classList.remove('hidden');
    document.getElementById('admin-banner-dismiss')?.addEventListener('click', () => banner.classList.add('hidden'));
  }

  function startVoucherCountdownTicker() {
    if (voucherCountdownTimerId) clearInterval(voucherCountdownTimerId);
    voucherCountdownTimerId = setInterval(() => {
      const nowMs = Date.now();
      let statusChanged = false;
      (state.vouchers || []).forEach((v) => {
        const info = computeVoucherStatusInfo(v, nowMs);
        if (v.status !== info.status) {
          v.status = info.status;
          statusChanged = true;
        }
      });
      if (statusChanged) {
        renderDashboardContent();
        return;
      }
      document.querySelectorAll('[data-voucher-countdown]').forEach((el) => {
        const key = el.getAttribute('data-voucher-countdown') || '';
        const matched = (state.vouchers || []).find(
          (v) => String(v.id || '') === key || String(v.code || '').toUpperCase() === key.toUpperCase()
        );
        if (matched) el.textContent = computeVoucherStatusInfo(matched, nowMs).remainingLabel;
      });
    }, 1000);
  }

  function initDashboardPage() {
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    let activeUser = state.sessionUser;
    if ((urlRole === 'admin' || urlRole === 'client') && (!activeUser || activeUser.role !== urlRole)) {
      activeUser =
        urlRole === 'admin'
          ? { email: 'admin@lilliarowena.com', name: 'Lillia Mercier (Business Owner)', role: 'admin' }
          : { email: 'rowena.vance@vancearchitects.com', name: 'Rowena Vance', role: 'client' };
      saveSessionUserToServer(activeUser);
    }
    if (!activeUser) {
      window.location.href = window.location.pathname.endsWith('.php')
        ? new URL('index.php', window.location.href).href
        : 'login.html';
      return;
    }

    const isAdmin = activeUser.role === 'admin';
    if (activeUser.name) state.customerProfile.name = activeUser.name;
    if (activeUser.email) state.customerProfile.email = activeUser.email;
    if (activeUser.avatar && !state.customerProfile.avatar) state.customerProfile.avatar = activeUser.avatar;

    const matchedCust = (state.customers || []).find(
      (c) => String(c.email || '').trim().toLowerCase() === String(activeUser.email || '').trim().toLowerCase()
    );
    if (matchedCust && String(activeUser.email || '').trim().toLowerCase() !== 'rowena.vance@vancearchitects.com') {
      state.customerProfile.phone = matchedCust.phoneNumber || matchedCust.phone || '';
      state.customerProfile.address = matchedCust.address || '';
      state.customerProfile.city = matchedCust.city || '';
      state.customerProfile.notes = matchedCust.notes || '';
      if (matchedCust.avatar) state.customerProfile.avatar = matchedCust.avatar;
    }

    document.getElementById('portal-top-header')?.classList.toggle('hidden', isAdmin);
    document.getElementById('client-portal-wrapper')?.classList.toggle('hidden', isAdmin);
    document.getElementById('client-portal-view')?.classList.toggle('hidden', isAdmin);
    document.getElementById('admin-portal-view')?.classList.toggle('hidden', !isAdmin);

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt('portal-header-subtitle', isAdmin ? 'Admin Management Console' : 'Customer Account Dashboard');
    setTxt('portal-user-badge', `${state.customerProfile.name} (${isAdmin ? 'Admin' : 'Customer'})`);
    ['client-welcome-name', 'client-sidebar-name', 'admin-sidebar-user-name'].forEach((id) =>
      setTxt(id, state.customerProfile.name)
    );
    ['client-welcome-email', 'client-sidebar-email', 'admin-sidebar-user-email'].forEach((id) =>
      setTxt(id, state.customerProfile.email)
    );
    syncCustomerAvatarDOM(state.customerProfile);

    const handlePortalLogout = async (e) => {
      e.preventDefault();
      state.sessionUser = null;
      state.cartItems = [];
      try {
        await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_session', sessionUser: null }),
        });
      } catch (_err) {
        // Ignore network error
      }
      window.location.href = window.location.pathname.endsWith('.php')
        ? new URL('logout.php', window.location.href).href
        : 'login.html';
    };
    document.getElementById('portal-logout-btn')?.addEventListener('click', handlePortalLogout);
    document.getElementById('admin-logout-btn')?.addEventListener('click', handlePortalLogout);
    bindRequestDesignTriggers();

    const clientTabBtns = document.querySelectorAll('[data-client-tab]');
    const switchClientTab = (target) => {
      state.activeClientTab = target || 'home';
      clientTabBtns.forEach((b) => {
        const isSel = b.getAttribute('data-client-tab') === state.activeClientTab;
        b.className = isSel
          ? 'client-tab-btn w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl text-left text-xs sm:text-sm font-semibold transition-all cursor-pointer bg-[#0095FF] text-white shadow-xs'
          : 'client-tab-btn w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl text-left text-xs sm:text-sm font-semibold transition-all cursor-pointer bg-[#F8FBFF] text-[#0D1015] hover:bg-[#EBF6FF]';
      });
      document.querySelectorAll('.client-tab-panel').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== `client-tab-${state.activeClientTab}`);
      });
    };
    clientTabBtns.forEach((btn) =>
      btn.addEventListener('click', () => switchClientTab(btn.getAttribute('data-client-tab') || 'home'))
    );
    document.querySelectorAll('[data-switch-client-tab]').forEach((btn) =>
      btn.addEventListener('click', () => switchClientTab(btn.getAttribute('data-switch-client-tab') || 'home'))
    );

    const requestedClientTab = (params.get('tab') || '').toLowerCase();
    if (!isAdmin && ['home', 'orders', 'address', 'transactions', 'cart', 'vouchers'].includes(requestedClientTab)) {
      switchClientTab(requestedClientTab);
    }

    const applyCustomerAvatarUpdate = (newAvatarSrc) => {
      const cleanAvatar = String(newAvatarSrc || '').trim();
      state.customerProfile.avatar = cleanAvatar;
      if (state.sessionUser) state.sessionUser.avatar = cleanAvatar;
      syncCustomerAvatarDOM(state.customerProfile);
      saveCustomerProfileToStorage();
    };
    const clientAvatarFileInput = document.getElementById('client-profile-avatar-file');
    clientAvatarFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) return;
        applyCustomerAvatarUpdate(dataUrl);
        const serverRes = await syncDatabaseStore('upload_product_image', {
          fileName: `avatar_${file.name || 'profile.jpg'}`,
          dataUrl,
        });
        if (serverRes?.ok && serverRes.imagePath) applyCustomerAvatarUpdate(serverRes.imagePath);
        showClientBanner('Updated your profile picture.');
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('client-profile-avatar-clear-btn')?.addEventListener('click', () => {
      if (clientAvatarFileInput) clientAvatarFileInput.value = '';
      applyCustomerAvatarUpdate('');
      showClientBanner('Removed your profile picture.');
    });

    document.getElementById('client-address-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (id, fb) => document.getElementById(id)?.value.trim() || fb;
      state.customerProfile = {
        name: val('client-input-name', state.customerProfile.name),
        email: val('client-input-email', state.customerProfile.email),
        phone: val('client-input-phone', state.customerProfile.phone),
        city: val('client-input-city', state.customerProfile.city),
        address: val('client-input-address', state.customerProfile.address),
        notes: val('client-input-notes', state.customerProfile.notes),
        avatar: document.getElementById('client-input-avatar')?.value.trim() ?? (state.customerProfile.avatar || ''),
      };
      await syncDatabaseStore('update_customer_profile', { customerProfile: state.customerProfile });
      if (state.sessionUser) {
        state.sessionUser.name = state.customerProfile.name;
        state.sessionUser.email = state.customerProfile.email;
        state.sessionUser.avatar = state.customerProfile.avatar;
        saveSessionUserToServer(state.sessionUser);
      }
      ['client-welcome-name', 'client-sidebar-name'].forEach((id) => setTxt(id, state.customerProfile.name));
      ['client-welcome-email', 'client-sidebar-email'].forEach((id) => setTxt(id, state.customerProfile.email));
      setTxt('portal-user-badge', `${state.customerProfile.name} (Customer)`);
      syncCustomerAvatarDOM(state.customerProfile);
      showClientBanner('Saved your updated Profile, Address & Contact information.');
      renderDashboardContent();
    });

    document.getElementById('client-cart-add-btn')?.addEventListener('click', () => {
      const pid = document.getElementById('client-cart-add-select')?.value || '';
      const prod = state.catalog.find((p) => p.id === pid);
      if (!prod) return;
      const available = Math.max(0, Math.floor(Number(prod.inStockCount ?? 0)));
      if (available <= 0) return showClientBanner(`"${prod.name}" is currently Out of Stock.`);
      const curQty = state.cartItems.filter((c) => c.product.id === prod.id).reduce((s, c) => s + c.quantity, 0);
      if (curQty >= available) return showClientBanner(`Cannot add more "${prod.name}": only ${available} in stock.`);
      const finish = prod.defaultFinish || prod.colorVariants?.[0]?.name || 'Natural Finish';
      const existing = state.cartItems.find((c) => c.product.id === prod.id && c.finish === finish);
      if (existing) existing.quantity += 1;
      else state.cartItems.push({ product: prod, finish, quantity: 1 });
      saveCartToStorage();
      showClientBanner(`Added "${prod.name}" to your Cart.`);
      renderDashboardContent();
    });

    const clientApplyVoucherBtn = document.getElementById('client-cart-apply-voucher-btn');
    const clientVoucherInput = document.getElementById('client-cart-voucher-input');
    const clientVoucherFeedback = document.getElementById('client-cart-voucher-feedback');
    clientApplyVoucherBtn?.addEventListener('click', async () => {
      const code = clientVoucherInput?.value.trim().toUpperCase() || '';
      const email = state.customerProfile.email || state.sessionUser?.email || '';
      let result = validateVoucherForOrder(state.vouchers, code, email, state.cartItems, state.catalog);
      if (result.valid) {
        const serverCheck = await syncDatabaseStore('validate_voucher', {
          voucherCode: code,
          customerEmail: email,
          cartItems: state.cartItems.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
        });
        if (serverCheck && !serverCheck.valid) {
          result = { valid: false, discountAmount: 0, voucher: null, errorMessage: serverCheck.error || 'Invalid voucher.' };
        }
      }
      if (clientVoucherFeedback) {
        clientVoucherFeedback.classList.remove('hidden');
        if (result.valid) {
          state.appliedVoucher = result.voucher;
          clientVoucherFeedback.textContent = `✓ Voucher ${result.voucher.code} (${formatVoucherBenefitLabel(
            result.voucher
          )}) applied to "${result.voucher.furnitureName || result.voucher.productName}" (-${usd(result.discountAmount)})!`;
          clientVoucherFeedback.className = 'text-xs font-semibold text-emerald-700';
        } else {
          state.appliedVoucher = null;
          clientVoucherFeedback.textContent = `✕ ${result.errorMessage}`;
          clientVoucherFeedback.className = 'text-xs font-semibold text-rose-700';
        }
      }
      renderDashboardContent();
    });

    document.getElementById('client-cart-checkout-btn')?.addEventListener('click', async () => {
      if (state.cartItems.length === 0) return;
      const voucherCode = state.appliedVoucher ? state.appliedVoucher.code : '';
      // Authoritative PHP/server checkout first, with local store fallback
      const serverCheckout = await syncDatabaseStore('place_order', {
        voucherCode,
        customerProfile: state.customerProfile,
        cartItems: state.cartItems,
      });
      if (serverCheckout && serverCheckout.ok && serverCheckout.order) {
        if (Array.isArray(serverCheckout.catalog)) state.catalog = serverCheckout.catalog;
        if (Array.isArray(serverCheckout.orders)) state.orders = serverCheckout.orders;
        if (Array.isArray(serverCheckout.vouchers)) state.vouchers = serverCheckout.vouchers;
        if (Array.isArray(serverCheckout.inventoryTransactions))
          state.inventoryTransactions = serverCheckout.inventoryTransactions;
        state.cartItems = [];
        state.appliedVoucher = null;
        if (clientVoucherInput) clientVoucherInput.value = '';
        clientVoucherFeedback?.classList.add('hidden');
        showClientBanner(`Order #${serverCheckout.order.orderNumber} placed for ${usd(serverCheckout.order.totalAmount)}.`);
        switchClientTab('orders');
        renderDashboardContent();
        return;
      }

      const checkoutResult = verifyAndCreateOrder({
        catalog: state.catalog,
        vouchers: state.vouchers,
        customerProfile: state.customerProfile,
        sessionUser: state.sessionUser,
        cartItems: state.cartItems,
        voucherCode,
      });
      if (!checkoutResult.ok) {
        state.appliedVoucher = null;
        if (clientVoucherFeedback) {
          clientVoucherFeedback.classList.remove('hidden');
          clientVoucherFeedback.textContent = `✕ ${checkoutResult.errorMessage}`;
          clientVoucherFeedback.className = 'text-xs font-semibold text-rose-700';
        }
        renderDashboardContent();
        return;
      }
      state.catalog = checkoutResult.updatedCatalog;
      state.orders.unshift(checkoutResult.order);
      if (checkoutResult.validatedVoucher) {
        const usedCode = String(checkoutResult.validatedVoucher.code || '').toUpperCase();
        state.vouchers = state.vouchers.map((v) =>
          String(v.code || '').toUpperCase() === usedCode ? { ...v, status: 'Used' } : v
        );
      }
      state.cartItems = [];
      state.appliedVoucher = null;
      saveCartToStorage();
      syncDatabaseStore('sync_store');
      showClientBanner(`Order #${checkoutResult.order.orderNumber} placed for ${usd(checkoutResult.order.totalAmount)}.`);
      switchClientTab('orders');
      renderDashboardContent();
    });

    const adminSidebar = document.getElementById('admin-sidebar');
    const adminBackdrop = document.getElementById('admin-sidebar-backdrop');
    const adminMobileMenuBtn = document.getElementById('admin-mobile-menu-btn');
    const setAdminSidebarOpen = (open) => {
      adminSidebar?.classList.toggle('is-open', open);
      adminBackdrop?.classList.toggle('is-open', open);
      adminMobileMenuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    adminMobileMenuBtn?.addEventListener('click', () =>
      setAdminSidebarOpen(!adminSidebar?.classList.contains('is-open'))
    );
    document.getElementById('admin-sidebar-close-btn')?.addEventListener('click', () => setAdminSidebarOpen(false));
    adminBackdrop?.addEventListener('click', () => setAdminSidebarOpen(false));

    const ADMIN_SECTION_META = {
      overview: {
        eyebrow: 'Store Summary',
        title: 'Dashboard Overview',
        description: 'Monitor store performance, inventory health, and recent customer orders at a glance.',
      },
      catalog: {
        eyebrow: 'Catalog Management',
        title: 'Products',
        description: 'Manage handcrafted furniture pieces, pricing, room categories, and finished stock availability.',
      },
      'add-product': {
        eyebrow: 'Catalog Management',
        title: 'Add or Edit Product',
        description: 'Create or update a Standard Product or Customized Product (Messenger) in the store catalog.',
      },
      inventory: {
        eyebrow: 'Inventory & Stock Management',
        title: 'Inventory & Stock Management',
        description: 'Track workshop materials, monitor stock thresholds, record stock movements, and review audit history.',
      },
      vouchers: {
        eyebrow: 'Promotions',
        title: 'Discount Vouchers',
        description: 'Issue and manage single-item promotional discount codes for customers.',
      },
      orders: {
        eyebrow: 'Order Management',
        title: 'Customer Orders',
        description: 'Manage order production stages and track customer payments — updates sync live to the Customer Dashboard.',
      },
      customers: {
        eyebrow: 'Customer Management',
        title: 'Customer Directory',
        description: 'View registered client profiles, delivery addresses, order history, and lifetime spend.',
      },
      analytics: {
        eyebrow: 'Business Intelligence & Reporting',
        title: 'Analytics & Business Reports',
        description: 'Monthly performance KPIs, daily & annual revenue trends, best-selling pieces, order status distribution, customer retention, inventory movements, and voucher analytics.',
      },
    };

    document.getElementById('client-toggle-custom-order-btn')?.addEventListener('click', () => {
      state.clientCustomOrderOpen = !state.clientCustomOrderOpen;
      renderDashboardContent();
    });
    document.querySelectorAll('[data-open-custom-builder]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.clientCustomOrderOpen = true;
        switchClientTab('orders');
        renderDashboardContent();
      })
    );

    const adminTabBtns = document.querySelectorAll('[data-admin-tab]');
    const prodForm = document.getElementById('admin-product-form');
    const prodErrorEl = document.getElementById('admin-product-form-error');
    const prodEditIdInput = document.getElementById('prod-edit-id');
    const prodTypeSelect = document.getElementById('prod-type');
    const prodMessengerThreadSelect = document.getElementById('prod-messenger-thread');
    const prodCustomNotesInput = document.getElementById('prod-custom-notes');
    const prodImageInput = document.getElementById('prod-image');
    const prodImageFileInput = document.getElementById('prod-image-file');

    if (prodMessengerThreadSelect) {
      prodMessengerThreadSelect.innerHTML = [
        `<option value="">None — General Messenger Customization</option>`,
        ...(state.messengerConversations || []).map(
          (c) => `<option value="${esc(c.id)}">${esc(c.customerName)} (${esc(c.customerEmail)}) — ${esc(c.topic)}</option>`
        ),
      ].join('');
    }

    const syncProductImagePreview = (rawValue) => {
      const cleanSrc = String(rawValue ?? (prodImageInput ? prodImageInput.value : '')).trim();
      const preview = document.getElementById('prod-image-preview');
      const empty = document.getElementById('prod-image-empty-state');
      if (!preview || !empty) return;
      if (cleanSrc) {
        preview.src = cleanSrc.startsWith('data:') || cleanSrc.startsWith('http') ? cleanSrc : cleanSrc.replace(/^\//, '');
        preview.classList.remove('hidden');
        empty.classList.add('hidden');
      } else {
        preview.removeAttribute('src');
        preview.classList.add('hidden');
        empty.classList.remove('hidden');
      }
    };

    const syncProductFormTypeUI = () => {
      const isCustomized = prodTypeSelect?.value === 'customized';
      const isEditing = Boolean(prodEditIdInput?.value);
      document.getElementById('prod-messenger-section')?.classList.toggle('hidden', !isCustomized);
      document.getElementById('admin-delete-editing-product-btn')?.classList.toggle('hidden', !isEditing);
      setTxt(
        'admin-product-form-title',
        isEditing ? (isCustomized ? 'Edit Customized Product' : 'Edit Product') : isCustomized ? 'Add Customized Product' : 'Add Product'
      );
      setTxt('admin-save-product-btn', isEditing ? 'Update Product' : 'Save Product');
    };

    const resetProductFormForCreate = (defaultType = 'standard') => {
      if (prodEditIdInput) prodEditIdInput.value = '';
      if (prodTypeSelect) prodTypeSelect.value = defaultType;
      if (prodMessengerThreadSelect) prodMessengerThreadSelect.value = '';
      if (prodCustomNotesInput) prodCustomNotesInput.value = '';
      const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v;
      };
      setVal('prod-name', '');
      setVal('prod-category', 'living');
      setVal('prod-sku', generateOwnEntityId('product', '', 'living').codeId);
      setVal('prod-price', '2850');
      setVal('prod-discount', '0');
      setVal('prod-dimensions', '240cm L × 100cm W × 75cm H');
      setVal('prod-stock', '4');
      setVal('prod-min-stock', '2');
      setVal('prod-colors', 'Natural Walnut|#5C3A21|0, Smoked Oak|#3D312A|180, Ebonized Ash|#1C1917|260');
      setVal('prod-image', 'assets/images/category_dining_tables.jpg');
      if (prodImageFileInput) prodImageFileInput.value = '';
      syncProductImagePreview('assets/images/category_dining_tables.jpg');
      prodErrorEl?.classList.add('hidden');
      syncProductFormTypeUI();
    };
    window.__resetProductForm = resetProductFormForCreate;

    const handleRemoveProductById = (productId) => {
      const pid = String(productId || '').trim();
      const prod = state.catalog.find((item) => item.id === pid);
      if (!prod) return;
      openAdminConfirmModal({
        title: 'Remove Product',
        message: `Are you sure you want to remove "${prod.name}" (${prod.sku}) from the store catalog?`,
        confirmLabel: 'Remove Product',
        onConfirm: () => {
          const res = removeProductFromCatalog({
            catalog: state.catalog,
            cartItems: state.cartItems,
            vouchers: state.vouchers,
            productId: pid,
          });
          if (!res.ok) return;
          state.catalog = res.updatedCatalog;
          state.cartItems = res.updatedCartItems;
          state.vouchers = res.updatedVouchers;
          saveCartToStorage();
          syncDatabaseStore('delete_product', { productId: pid, vouchers: state.vouchers });
          if (prodEditIdInput?.value === pid) {
            resetProductFormForCreate('standard');
            switchAdminTab('catalog');
          }
          showAdminBanner(`Removed "${prod.name}" (${prod.sku}) from the store catalog.`);
          renderDashboardContent();
        },
      });
    };
    window.__removeProductById = handleRemoveProductById;

    window.__openProductFormForEdit = (product) => {
      if (!product) return;
      const isCustomized = product.productType === 'customized' || Boolean(product.isCustomClientDesign);
      if (prodEditIdInput) prodEditIdInput.value = product.id;
      if (prodTypeSelect) prodTypeSelect.value = isCustomized ? 'customized' : 'standard';
      if (prodMessengerThreadSelect) prodMessengerThreadSelect.value = product.messengerConversationId || '';
      if (prodCustomNotesInput) prodCustomNotesInput.value = product.customizationNotes || '';
      const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v;
      };
      setVal('prod-name', product.name || '');
      setVal('prod-sku', product.sku || '');
      setVal('prod-category', product.categoryId || 'dining');
      setVal('prod-price', String(product.price || 2850));
      setVal('prod-discount', String(product.discountPercent || 0));
      setVal('prod-dimensions', product.dimensions || 'Standard Dimensions');
      setVal('prod-stock', String(product.inStockCount ?? 4));
      setVal('prod-min-stock', String(product.minStockLevel ?? 2));
      if (Array.isArray(product.colorVariants) && product.colorVariants.length > 0) {
        setVal(
          'prod-colors',
          product.colorVariants.map((v) => `${v.name}|${v.hex || '#5C3A21'}|${Number(v.priceDelta || 0)}`).join(', ')
        );
      }
      setVal('prod-image', String(product.image || '').trim());
      syncProductImagePreview(product.image);
      prodErrorEl?.classList.add('hidden');
      switchAdminTab('add-product', true);
      syncProductFormTypeUI();
      prodForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    prodTypeSelect?.addEventListener('change', syncProductFormTypeUI);
    prodImageInput?.addEventListener('input', () => syncProductImagePreview(prodImageInput.value));
    document.getElementById('prod-image-clear-btn')?.addEventListener('click', () => {
      if (prodImageInput) prodImageInput.value = '';
      if (prodImageFileInput) prodImageFileInput.value = '';
      syncProductImagePreview('');
    });
    prodForm?.querySelectorAll('[data-prod-image-preset]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const path = btn.getAttribute('data-prod-image-preset') || '';
        if (prodImageInput) prodImageInput.value = path;
        syncProductImagePreview(path);
      })
    );

    const switchAdminTab = (targetKey, preserveProductForm = false) => {
      const target = targetKey || 'overview';
      state.activeAdminTab = target;
      if (target === 'add-product' && !preserveProductForm) resetProductFormForCreate('standard');
      adminTabBtns.forEach((b) => {
        const tabAttr = b.getAttribute('data-admin-tab');
        const isSel = tabAttr === target || (target === 'add-product' && tabAttr === 'catalog');
        b.classList.toggle('is-active', isSel);
        if (isSel) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
      const meta = ADMIN_SECTION_META[target] || ADMIN_SECTION_META.overview;
      setTxt('admin-page-eyebrow', meta.eyebrow);
      setTxt('admin-page-title', meta.title);
      setTxt('admin-page-description', meta.description);
      document.getElementById('admin-overview-section')?.classList.toggle('hidden', target !== 'overview');
      prodForm?.classList.toggle('hidden', target !== 'add-product');
      document
        .getElementById('admin-catalog-list')
        ?.classList.toggle('hidden', target !== 'catalog' && target !== 'add-product');
      prodErrorEl?.classList.add('hidden');
      document.querySelectorAll('.admin-tab-panel').forEach((panel) => {
        if (target === 'overview') panel.classList.add('hidden');
        else {
          const panelTarget = target === 'add-product' ? 'catalog' : target;
          panel.classList.toggle('hidden', panel.id !== `admin-tab-${panelTarget}`);
        }
      });
      setAdminSidebarOpen(false);
      if (target === 'analytics') renderAdminAnalyticsSection();
    };
    window.__switchAdminTab = switchAdminTab;

    adminTabBtns.forEach((btn) =>
      btn.addEventListener('click', () => switchAdminTab(btn.getAttribute('data-admin-tab') || 'overview'))
    );
    document.getElementById('admin-close-product-form')?.addEventListener('click', () => switchAdminTab('catalog'));
    document.getElementById('admin-cancel-product-btn')?.addEventListener('click', () => switchAdminTab('catalog'));

    const confirmModal = document.getElementById('admin-confirm-modal');
    document.getElementById('admin-confirm-cancel')?.addEventListener('click', () => {
      const fn = pendingCancelAction;
      pendingConfirmAction = null;
      pendingCancelAction = null;
      confirmModal?.classList.add('hidden');
      if (typeof fn === 'function') fn();
    });
    document.getElementById('admin-confirm-accept')?.addEventListener('click', () => {
      const fn = pendingConfirmAction;
      pendingConfirmAction = null;
      pendingCancelAction = null;
      confirmModal?.classList.add('hidden');
      if (typeof fn === 'function') fn();
    });

    prodForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = prodEditIdInput ? prodEditIdInput.value.trim() : '';
      const productType = prodTypeSelect ? prodTypeSelect.value : PRODUCT_TYPES.NORMAL;
      const name = document.getElementById('prod-name').value.trim();
      const sku = document.getElementById('prod-sku').value.trim().toUpperCase();
      const categoryId = document.getElementById('prod-category').value;
      const price = Number(document.getElementById('prod-price').value);
      const discountPercent = Number(document.getElementById('prod-discount').value) || 0;
      const dimensions = document.getElementById('prod-dimensions').value.trim() || 'Standard Dimensions';
      const stockVal = document.getElementById('prod-stock')?.value;
      const minStockVal = document.getElementById('prod-min-stock')?.value;
      const inStockCount = stockVal !== undefined && stockVal !== '' ? Number(stockVal) : 4;
      const minStockLevel = minStockVal !== undefined && minStockVal !== '' ? Number(minStockVal) : 2;
      const colorsRaw = document.getElementById('prod-colors').value;
      const image = prodImageInput ? prodImageInput.value.trim() : '';
      const messengerConversationId = prodMessengerThreadSelect ? prodMessengerThreadSelect.value.trim() : '';
      const customizationNotes = prodCustomNotesInput ? prodCustomNotesInput.value.trim() : '';

      const validation = validateNewFurnitureInput({ name, sku, price, inStockCount, productType, image });
      if (!validation.valid) {
        if (prodErrorEl) {
          prodErrorEl.textContent = validation.errorMessage;
          prodErrorEl.classList.remove('hidden');
        }
        return;
      }
      prodErrorEl?.classList.add('hidden');
      const matchedConv = (state.messengerConversations || []).find((c) => c.id === messengerConversationId);
      const existingProduct = editId ? state.catalog.find((item) => item.id === editId) || null : null;
      const savedProduct = buildProductRecord(
        {
          productType,
          name,
          sku,
          categoryId,
          price,
          discountPercent,
          dimensions,
          inStockCount,
          minStockLevel,
          colorsRaw,
          image,
          messengerConversationId: productType === 'customized' ? messengerConversationId || null : null,
          messengerCustomerName: productType === 'customized' ? matchedConv?.customerName || null : null,
          messengerTopic: productType === 'customized' ? matchedConv?.topic || null : null,
          customizationNotes: productType === 'customized' ? customizationNotes || null : null,
        },
        existingProduct
      );
      if (existingProduct) {
        state.catalog = state.catalog.map((item) => (item.id === existingProduct.id ? savedProduct : item));
      } else {
        state.catalog.unshift(savedProduct);
      }
      persistProductToStorage(savedProduct);
      resetProductFormForCreate('standard');
      switchAdminTab('catalog');
      showAdminBanner(
        existingProduct
          ? `Updated "${savedProduct.name}" (${savedProduct.sku}).`
          : `Added "${savedProduct.name}" (${savedProduct.sku}) to the store catalog.`
      );
      renderDashboardContent();
    });

    // Admin Voucher Form Wiring
    const vchExpMethodInput = document.getElementById('vch-expiration-method');
    const vchDurationValueInput = document.getElementById('vch-duration-value');
    const vchDurationUnitSelect = document.getElementById('vch-duration-unit');
    const vchExpiryDateInput = document.getElementById('vch-expiry-date');
    const vchExpiryTimeInput = document.getElementById('vch-expiry-time');

    const syncVoucherExpirationPreview = () => {
      const box = document.getElementById('vch-expiration-preview');
      const txt = document.getElementById('vch-expiration-preview-text');
      const badge = document.getElementById('vch-expiration-preview-badge');
      if (!box || !txt || !badge) return;
      const defaults = getManilaDateInputDefaults(Date.now());
      if (vchExpiryDateInput && !vchExpiryDateInput.value) vchExpiryDateInput.value = defaults.defaultDate;
      if (vchExpiryTimeInput && !vchExpiryTimeInput.value) vchExpiryTimeInput.value = defaults.defaultTime;
      const calc = calculateExpirationFromInput(
        {
          expirationMethod: vchExpMethodInput?.value || 'duration',
          durationValue: vchDurationValueInput?.value,
          durationUnit: vchDurationUnitSelect?.value,
          expiryDate: vchExpiryDateInput?.value,
          expiryTime: vchExpiryTimeInput?.value,
        },
        Date.now()
      );
      if (!calc.ok) {
        box.classList.add('is-invalid');
        txt.textContent = calc.errorMessage || 'Invalid expiration settings.';
        badge.textContent = 'Invalid Expiry';
        return;
      }
      box.classList.remove('is-invalid');
      txt.textContent = `Expires ${calc.formattedManila} (Asia/Manila)`;
      badge.textContent = calc.remainingLabel;
    };

    document.querySelectorAll('[data-vch-exp-method]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const method = btn.getAttribute('data-vch-exp-method') || 'duration';
        if (vchExpMethodInput) vchExpMethodInput.value = method;
        document.querySelectorAll('[data-vch-exp-method]').forEach((b) =>
          b.classList.toggle('is-active', b.getAttribute('data-vch-exp-method') === method)
        );
        document.getElementById('vch-duration-panel')?.classList.toggle('hidden', method !== 'duration');
        document.getElementById('vch-custom-expiry-panel')?.classList.toggle('hidden', method !== 'custom');
        syncVoucherExpirationPreview();
      })
    );
    document.querySelectorAll('[data-vch-quick-duration]').forEach((chip) =>
      chip.addEventListener('click', () => {
        const [val, unit] = (chip.getAttribute('data-vch-quick-duration') || '24|hours').split('|');
        if (vchExpMethodInput) vchExpMethodInput.value = 'duration';
        if (vchDurationValueInput && val) vchDurationValueInput.value = val;
        if (vchDurationUnitSelect && unit) vchDurationUnitSelect.value = unit;
        syncVoucherExpirationPreview();
      })
    );
    [vchDurationValueInput, vchDurationUnitSelect, vchExpiryDateInput, vchExpiryTimeInput].forEach((el) =>
      el?.addEventListener('input', syncVoucherExpirationPreview)
    );
    document.getElementById('admin-generate-voucher-btn')?.addEventListener('click', () => {
      const disc = Math.max(1, Math.round(Number(document.getElementById('vch-discount')?.value) || 300));
      const codeInput = document.getElementById('vch-code');
      if (codeInput) codeInput.value = `SAVE-${disc}-${Math.floor(100 + Math.random() * 900)}`;
    });

    document.getElementById('admin-voucher-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const vchErrorEl = document.getElementById('admin-voucher-form-error');
      const customerEmail = document.getElementById('vch-email')?.value.trim() || '';
      const matchedCustRecord = (state.customers || []).find(
        (c) => String(c.email || '').trim().toLowerCase() === customerEmail.toLowerCase()
      );
      const payloadInput = {
        customerEmail,
        customerName: matchedCustRecord ? matchedCustRecord.fullName || matchedCustRecord.name : '',
        furnitureId: document.getElementById('vch-product')?.value || '',
        code: document.getElementById('vch-code')?.value.trim().toUpperCase() || '',
        discountAmount: Number(document.getElementById('vch-discount')?.value),
        expirationMethod: vchExpMethodInput?.value || 'duration',
        durationValue: Number(vchDurationValueInput?.value),
        durationUnit: vchDurationUnitSelect?.value || 'hours',
        expiryDate: vchExpiryDateInput?.value || '',
        expiryTime: vchExpiryTimeInput?.value || '',
        issuedByAdmin: state.sessionUser?.name || 'Lillia Mercier',
      };
      const localCheck = validateAndCreateVoucher(payloadInput, state.catalog, state.vouchers, Date.now());
      if (!localCheck.ok) {
        if (vchErrorEl) {
          vchErrorEl.textContent = localCheck.errorMessage;
          vchErrorEl.classList.remove('hidden');
        }
        return;
      }
      vchErrorEl?.classList.add('hidden');
      const serverRes = await syncDatabaseStore('create_voucher', { voucher: payloadInput });
      const createdVoucher = serverRes?.voucher || localCheck.voucher;
      if (Array.isArray(serverRes?.vouchers)) state.vouchers = serverRes.vouchers;
      else state.vouchers = [createdVoucher, ...state.vouchers];
      const codeEl = document.getElementById('vch-code');
      if (codeEl) codeEl.value = '';
      showAdminBanner(
        `Voucher ${createdVoucher.code} (${usd(createdVoucher.discountAmount)} OFF "${
          createdVoucher.furnitureName
        }") issued to ${createdVoucher.customerEmail}.`
      );
      renderDashboardContent();
    });

    switchAdminTab(state.activeAdminTab || 'overview');
    renderDashboardContent();
    syncVoucherExpirationPreview();
    startVoucherCountdownTicker();
  }

  function renderDashboardContent() {
    const userEmail = state.sessionUser?.email || 'rowena.vance@vancearchitects.com';
    const clientViewEl = document.getElementById('client-portal-view');
    const adminViewEl = document.getElementById('admin-portal-view');
    const shouldRenderClient = !clientViewEl || !clientViewEl.classList.contains('hidden');
    const shouldRenderAdmin = !adminViewEl || !adminViewEl.classList.contains('hidden');

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    if (shouldRenderClient) {
      const displayOrders = state.orders.filter(
        (o) => String(o.clientEmail || '').trim().toLowerCase() === userEmail.toLowerCase()
      );
      const displayVouchers = filterCustomerVouchers(state.vouchers, userEmail);
      const usableCustomerVouchers = displayVouchers.filter((v) => computeVoucherStatusInfo(v).isUsable);
      const cartQty = state.cartItems.reduce((sum, c) => sum + c.quantity, 0);
      const completedTransactions = getCompletedTransactionsForCustomer(displayOrders, userEmail);
      const activeClientOrdersCount = displayOrders.filter((o) => !isOrderCompleted(o)).length;

      setTxt('user-stat-orders', `${activeClientOrdersCount} Active ${activeClientOrdersCount === 1 ? 'Order' : 'Orders'}`);
      setTxt('user-stat-vouchers', `${usableCustomerVouchers.length} Ready to Use`);
      setTxt('user-stat-cart', `${cartQty} ${cartQty === 1 ? 'Item' : 'Items'}`);
      setTxt('sidebar-badge-orders', String(displayOrders.length));
      setTxt('sidebar-badge-transactions', String(completedTransactions.length));
      setTxt('sidebar-badge-cart', String(cartQty));
      setTxt('sidebar-badge-vouchers', String(usableCustomerVouchers.length));

      const homeOrderPreview = document.getElementById('client-home-order-preview');
      if (homeOrderPreview) {
        if (displayOrders[0]) {
          const latest = displayOrders[0];
          const matched = state.catalog.find((p) => p.id === latest.furnitureId) || state.catalog[0];
          const imgUrl = (matched ? matched.image : 'assets/images/category_dining_tables.jpg').replace(/^\//, '');
          homeOrderPreview.innerHTML = `<div class="pt-4 border-t border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div class="flex items-center gap-3.5"><img src="${esc(
            imgUrl
          )}" alt="${esc(latest.furnitureName)}" class="w-16 h-16 rounded-xl object-cover border border-[#BCE3FF] shrink-0" /><div><p class="font-mono-tech text-xs text-[#0077CC] font-bold">${esc(
            latest.status
          )} · #${esc(latest.orderNumber)}</p><h3 class="font-serif-display text-base font-bold text-[#0D1015] mt-0.5">${esc(
            latest.furnitureName
          )}</h3><p class="text-xs text-[#475569]">Finish: <strong class="text-[#0D1015]">${esc(
            latest.selectedFinish
          )}</strong> · Size: ${esc(latest.customDimensions || 'Standard Dimensions')}</p></div></div><p class="font-mono-tech text-lg font-bold text-[#0095FF] shrink-0">${usd(
            latest.totalAmount
          )}</p></div>`;
        } else {
          homeOrderPreview.innerHTML = `<div class="pt-4 border-t border-[#E2E8F0] text-center py-6 space-y-2"><p class="text-sm font-bold text-[#0D1015]">No Active Orders Yet</p></div>`;
        }
      }

      const homeAddrPreview = document.getElementById('client-home-address-preview');
      if (homeAddrPreview) {
        const formattedAddr = [state.customerProfile.address, state.customerProfile.city]
          .map((s) => String(s || '').trim())
          .filter(Boolean)
          .join(', ');
        homeAddrPreview.innerHTML = `<div class="pt-4 border-t border-[#E2E8F0] space-y-1.5"><p class="font-serif-display text-sm font-bold text-[#0D1015]">${esc(
          state.customerProfile.name
        )}</p><p class="font-mono-tech text-xs text-[#0077CC]">${esc(
          state.customerProfile.phone || 'No phone number added'
        )}</p><p class="text-xs text-[#0D1015]">${esc(formattedAddr || 'No delivery address added')}</p></div>`;
      }

      const homeCatalogFeedEl = document.getElementById('client-home-catalog-feed');
      if (homeCatalogFeedEl) {
        homeCatalogFeedEl.innerHTML = state.catalog
          .slice(0, 6)
          .map((prod) => {
            const card = formatSimplifiedProductCardData(prod);
            const imgUrl = (card.image || 'assets/images/category_dining_tables.jpg').replace(/^\//, '');
            return `<div class="p-4 rounded-2xl border border-[#BCE3FF] bg-[#F8FBFF] flex flex-col justify-between gap-3 h-full"><div class="flex items-start gap-3.5"><img src="${esc(
              imgUrl
            )}" alt="${esc(card.name)}" class="w-16 h-16 rounded-xl object-cover border border-[#BCE3FF] shrink-0" /><div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-1"><span class="text-[11px] font-semibold uppercase tracking-wider text-[#0077CC]">${esc(
              card.categoryName
            )}</span><span class="text-[11px] font-mono-tech font-semibold text-emerald-700">${esc(
              card.availabilityLabel
            )}</span></div><h3 class="font-serif-display text-sm font-bold text-[#0D1015] truncate mt-0.5">${esc(
              card.name
            )}</h3><p class="font-mono-tech text-sm font-bold text-[#0095FF] mt-1">${usd(
              card.sellingPrice
            )}</p></div></div><div class="pt-2 border-t border-[#E2E8F0] mt-auto"><a href="catalog.html?category=${encodeURIComponent(
              prod.categoryId || 'all'
            )}&product=${encodeURIComponent(
              card.id
            )}" class="block px-3 py-2 rounded-xl bg-[#0D1015] hover:bg-[#0095FF] text-white text-xs font-semibold transition-colors text-center">${esc(
              card.ctaLabel
            )}</a></div></div>`;
          })
          .join('');
      }

      const setInputVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el) el.value = val;
      };
      setInputVal('client-input-name', state.customerProfile.name);
      setInputVal('client-input-email', state.customerProfile.email);
      setInputVal('client-input-phone', state.customerProfile.phone);
      setInputVal('client-input-city', state.customerProfile.city);
      setInputVal('client-input-address', state.customerProfile.address);
      setInputVal('client-input-notes', state.customerProfile.notes);
      syncCustomerAvatarDOM(state.customerProfile);

      // Custom Commission Builder
      const customOrderCardEl = document.getElementById('client-custom-order-card');
      setTxt(
        'client-toggle-custom-order-btn',
        state.clientCustomOrderOpen ? 'Close Custom Commission Builder' : '+ Commission Custom Piece'
      );
      if (customOrderCardEl) {
        customOrderCardEl.classList.toggle('hidden', !state.clientCustomOrderOpen);
        if (state.clientCustomOrderOpen) {
          const selectedBaseProd =
            state.catalog.find((p) => p.id === state.clientCustomOrderInput.productId) || state.catalog[0];
          const availableMaterials = state.materials.filter((m) => Number(m.stockQuantity || 0) > 0);
          const selectedMat =
            availableMaterials.find((m) => m.id === state.clientCustomOrderInput.materialId) ||
            availableMaterials[0] ||
            state.materials[0];
          const basePrice = Number(selectedBaseProd?.effectivePrice || selectedBaseProd?.price || 2850);
          const extraCost = Math.max(250, Math.round(Number(selectedMat?.unitCost || 0) * 4));
          const estimatedTotal = basePrice + extraCost;

          customOrderCardEl.innerHTML = `<form id="client-custom-commission-form" novalidate class="space-y-5"><div class="pb-4 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><p class="font-mono-tech text-xs uppercase tracking-widest text-[#0077CC] font-bold">Bespoke Workshop Commission</p><h3 class="font-serif-display text-lg font-bold text-[#0D1015] mt-0.5">Commission a Custom-Built Piece from Workshop Materials</h3></div><div class="sm:text-right"><p class="font-mono-tech text-xl font-bold text-[#0095FF]">${usd(
            estimatedTotal
          )}</p></div></div><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"><div><label for="cust-ord-product" class="block text-xs font-semibold text-[#0D1015] mb-1">Base Catalog Design</label><select id="cust-ord-product" class="w-full px-3.5 py-2.5 rounded-xl border border-[#BCE3FF] bg-[#F8FBFF] text-xs font-semibold">${state.catalog
            .map(
              (p) =>
                `<option value="${esc(p.id)}" ${p.id === selectedBaseProd?.id ? 'selected' : ''}>${esc(p.name)} (${usd(
                  p.effectivePrice
                )})</option>`
            )
            .join(
              ''
            )}</select></div><div><label for="cust-ord-material" class="block text-xs font-semibold text-[#0D1015] mb-1">Workshop Raw Material</label><select id="cust-ord-material" class="w-full px-3.5 py-2.5 rounded-xl border border-[#BCE3FF] bg-[#F8FBFF] text-xs font-semibold">${state.materials
            .map(
              (m) =>
                `<option value="${esc(m.id)}" ${m.id === selectedMat?.id ? 'selected' : ''}>${esc(m.name)} (${
                  m.stockQuantity
                } ${esc(m.unit)} avail)</option>`
            )
            .join(
              ''
            )}</select></div><div><label for="cust-ord-finish" class="block text-xs font-semibold text-[#0D1015] mb-1">Color / Oil Finish</label><input id="cust-ord-finish" type="text" value="${esc(
            state.clientCustomOrderInput.colorFinish || 'Hand-Rubbed Tung Oil'
          )}" class="w-full px-3.5 py-2.5 rounded-xl border border-[#BCE3FF] bg-[#F8FBFF] text-xs" /></div><div><label for="cust-ord-length" class="block text-xs font-semibold text-[#0D1015] mb-1">Length (cm)</label><input id="cust-ord-length" type="number" value="${esc(
            state.clientCustomOrderInput.lengthCm || '260'
          )}" class="w-full px-3.5 py-2.5 rounded-xl border border-[#BCE3FF] bg-[#F8FBFF] font-mono-tech text-xs" /></div><div><label for="cust-ord-width" class="block text-xs font-semibold text-[#0D1015] mb-1">Width (cm)</label><input id="cust-ord-width" type="number" value="${esc(
            state.clientCustomOrderInput.widthCm || '105'
          )}" class="w-full px-3.5 py-2.5 rounded-xl border border-[#BCE3FF] bg-[#F8FBFF] font-mono-tech text-xs" /></div><div><label for="cust-ord-height" class="block text-xs font-semibold text-[#0D1015] mb-1">Height (cm)</label><input id="cust-ord-height" type="number" value="${esc(
            state.clientCustomOrderInput.heightCm || '76'
          )}" class="w-full px-3.5 py-2.5 rounded-xl border border-[#BCE3FF] bg-[#F8FBFF] font-mono-tech text-xs" /></div></div><div><label for="cust-ord-notes" class="block text-xs font-semibold text-[#0D1015] mb-1">Joinery &amp; Architectural Notes</label><input id="cust-ord-notes" type="text" value="${esc(
            state.clientCustomOrderInput.notes || ''
          )}" class="w-full px-3.5 py-2.5 rounded-xl border border-[#BCE3FF] bg-[#F8FBFF] text-xs" /></div><p id="client-custom-commission-error" class="hidden text-xs font-semibold text-rose-700"></p><div class="flex items-center justify-end gap-3 pt-2"><button type="button" id="client-cancel-custom-commission-btn" class="px-4 py-2 rounded-xl border border-[#BCE3FF] text-xs font-semibold cursor-pointer">Cancel</button><button type="submit" class="px-5 py-2.5 rounded-xl bg-[#0095FF] hover:bg-[#0077CC] text-white text-xs font-semibold cursor-pointer">Submit Custom Commission (${usd(
            estimatedTotal
          )})</button></div></form>`;

          document.getElementById('cust-ord-product')?.addEventListener('change', (e) => {
            state.clientCustomOrderInput.productId = e.target.value;
            renderDashboardContent();
          });
          document.getElementById('cust-ord-material')?.addEventListener('change', (e) => {
            state.clientCustomOrderInput.materialId = e.target.value;
            renderDashboardContent();
          });
          document.getElementById('client-cancel-custom-commission-btn')?.addEventListener('click', () => {
            state.clientCustomOrderOpen = false;
            renderDashboardContent();
          });
          document.getElementById('client-custom-commission-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const customInput = {
              productId: document.getElementById('cust-ord-product')?.value || '',
              materialId: document.getElementById('cust-ord-material')?.value || '',
              colorFinish: document.getElementById('cust-ord-finish')?.value || 'Natural Oil',
              lengthCm: document.getElementById('cust-ord-length')?.value || 240,
              widthCm: document.getElementById('cust-ord-width')?.value || 100,
              heightCm: document.getElementById('cust-ord-height')?.value || 75,
              notes: document.getElementById('cust-ord-notes')?.value || '',
              extraCost,
              materialQtyUsed: 2,
            };
            const serverRes = await syncDatabaseStore('create_custom_order', {
              customInput,
              customerProfile: { name: state.customerProfile.name, email: userEmail },
            });
            if (serverRes && serverRes.ok && serverRes.order) {
              if (Array.isArray(serverRes.orders)) state.orders = serverRes.orders;
              if (Array.isArray(serverRes.materials)) state.materials = serverRes.materials;
              if (Array.isArray(serverRes.inventoryTransactions))
                state.inventoryTransactions = serverRes.inventoryTransactions;
              state.clientCustomOrderOpen = false;
              showClientBanner(`Custom Commission #${serverRes.order.orderNumber} submitted!`);
              renderDashboardContent();
              return;
            }
            const res = createCustomOrderRequest({
              catalog: state.catalog,
              materials: state.materials,
              customerProfile: { name: state.customerProfile.name, email: userEmail },
              customInput,
            });
            if (!res.ok) {
              const errEl = document.getElementById('client-custom-commission-error');
              if (errEl) {
                errEl.textContent = res.errorMessage;
                errEl.classList.remove('hidden');
              }
              return;
            }
            state.orders.unshift(res.order);
            saveOrdersToStorage();
            state.clientCustomOrderOpen = false;
            showClientBanner(`Custom Commission #${res.order.orderNumber} submitted!`);
            renderDashboardContent();
          });
        }
      }

      // Customer Orders List
      const friendlyOrdersEl = document.getElementById('client-orders-friendly-list');
      if (friendlyOrdersEl) {
        friendlyOrdersEl.innerHTML =
          displayOrders.length === 0
            ? `<div class="bg-white rounded-3xl border border-[#BCE3FF] p-8 text-center space-y-3"><p class="font-serif-display text-lg font-bold text-[#0D1015]">You Have Not Placed Any Orders Yet</p></div>`
            : displayOrders
                .map((ord) => {
                  const matchedProd = state.catalog.find((p) => p.id === ord.furnitureId) || state.catalog[0];
                  const imgUrl = (matchedProd ? matchedProd.image : 'assets/images/category_dining_tables.jpg').replace(
                    /^\//,
                    ''
                  );
                  const isCompleted = isOrderCompleted(ord);
                  let friendlyStep = 1;
                  if (/Joinery|Finishing|Timber/i.test(ord.status)) friendlyStep = 2;
                  if (/Quality/i.test(ord.status)) friendlyStep = 3;
                  if (isCompleted || /Dispatched|Delivered/i.test(ord.status)) friendlyStep = 4;
                  const pct = Math.round((friendlyStep / 4) * 100);
                  const totalAmt = Number(ord.totalAmount || 0);
                  const paidAmt = Number(ord.depositPaid ?? totalAmt);
                  const balanceDue = Math.max(0, totalAmt - paidAmt);
                  const isCancelled = /Cancelled/i.test(String(ord.status || '')) || ord.sqlStatus === 'Cancelled';
                  const isCancelPending = Boolean(ord.cancellationRequested) && !isCancelled;
                  const canCancel = friendlyStep < 4 && !isCancelled && !isCancelPending && !isCompleted;

                  return `<article class="bg-white rounded-3xl border border-[#BCE3FF] p-6 sm:p-7 shadow-2xs space-y-5"><div class="flex flex-col sm:flex-row gap-5 items-start sm:items-center justify-between"><div class="flex items-center gap-4"><img src="${esc(
                    imgUrl
                  )}" alt="${esc(ord.furnitureName)}" class="w-20 h-20 rounded-2xl object-cover border border-[#BCE3FF] shrink-0" /><div><div class="flex flex-wrap items-center gap-2 text-xs"><span class="font-semibold ${
                    isCancelled ? 'text-rose-700' : isCompleted ? 'text-emerald-700' : 'text-[#0077CC]'
                  }">${esc(ord.status)}</span><span>·</span><span class="font-mono-tech text-[#64748B]">Order #${esc(
                    ord.orderNumber
                  )}</span>${
                    isCompleted
                      ? `<span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-bold">✓ Completed · In Completed Transactions</span>`
                      : ''
                  }${
                    isCancelPending
                      ? `<span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[11px] font-bold">Cancellation Pending Admin Approval</span>`
                      : ''
                  }</div><h3 class="font-serif-display text-xl font-bold text-[#0D1015] mt-1">${esc(
                    ord.furnitureName
                  )}</h3><p class="text-xs text-[#475569] mt-0.5">Color Finish: <span class="font-semibold text-[#0D1015]">${esc(
                    ord.selectedFinish
                  )}</span> · Size: ${esc(ord.customDimensions)}</p></div></div><div class="sm:text-right shrink-0"><p class="text-xs text-[#64748B]">${
                    balanceDue > 0 ? `Paid ${usd(paidAmt)} · Balance Due ${usd(balanceDue)}` : 'Paid in Full'
                  }</p><p class="font-mono-tech text-2xl font-bold text-[#0095FF]">${usd(
                    totalAmt
                  )}</p></div></div><div class="p-4 rounded-2xl bg-[#F8FBFF] border border-[#E2E8F0] space-y-3"><div class="flex items-center justify-between text-xs"><span class="font-semibold text-[#0D1015]">Workshop &amp; Delivery Progress</span><span class="font-mono-tech font-bold ${
                    isCancelled ? 'text-rose-600' : 'text-[#0095FF]'
                  }">${
                    isCancelled ? 'Order Cancelled' : `${pct}% Complete`
                  }</span></div><div class="w-full h-2.5 rounded-full bg-[#E2E8F0] overflow-hidden"><div class="h-full rounded-full ${
                    isCancelled ? 'bg-rose-500' : 'bg-[#0095FF]'
                  }" style="width: ${
                    isCancelled ? 100 : pct
                  }%"></div></div><div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">${FRIENDLY_CUSTOMER_STEPS.map(
                    (label, idx) => {
                      const active = !isCancelled && idx + 1 <= friendlyStep;
                      return `<div class="flex items-center gap-1.5 text-[11px] ${
                        active ? 'text-[#0D1015] font-bold' : 'text-[#94A3B8]'
                      }"><span class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                        active ? 'bg-[#0095FF] text-white' : 'bg-[#E2E8F0] text-[#64748B]'
                      }">${active ? '✓' : idx + 1}</span><span>${esc(label)}</span></div>`;
                    }
                  ).join('')}</div></div><div class="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">${
                    balanceDue > 0 && !isCancelled
                      ? `<button type="button" data-client-pay-order="${esc(
                          ord.orderNumber
                        )}" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer">Pay Remaining Balance (${usd(
                          balanceDue
                        )})</button>`
                      : ''
                  }${
                    canCancel
                      ? `<button type="button" data-client-cancel-order="${esc(
                          ord.orderNumber
                        )}" class="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold cursor-pointer">Request Cancel Order</button>`
                      : ''
                  }<a href="${ADMIN_MESSENGER_PLACEHOLDER_URL}" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#0095FF] hover:underline">Ask Owner About This Order on Messenger ↗</a></div></article>`;
                })
                .join('');

        friendlyOrdersEl.querySelectorAll('[data-client-pay-order]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const orderNumber = btn.getAttribute('data-client-pay-order') || '';
            const serverRes = await syncDatabaseStore('record_order_payment', { orderNumber, paymentMethod: 'Card' });
            if (serverRes?.ok && Array.isArray(serverRes.orders)) {
              state.orders = serverRes.orders;
            } else {
              const res = recordCustomerOrderPayment({ orders: state.orders, orderNumber, paymentMethod: 'Card' });
              if (!res.ok) return showClientBanner(res.errorMessage || 'Unable to process payment.');
              state.orders = res.updatedOrders;
              saveOrdersToStorage();
            }
            showClientBanner(`Paid remaining balance for Order #${orderNumber}.`);
            renderDashboardContent();
          })
        );

        friendlyOrdersEl.querySelectorAll('[data-client-cancel-order]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const orderNumber = btn.getAttribute('data-client-cancel-order') || '';
            const serverRes = await syncDatabaseStore('request_order_cancellation', { orderNumber });
            if (serverRes?.ok && Array.isArray(serverRes.orders)) {
              state.orders = serverRes.orders;
            } else {
              const res = requestOrderCancellation({ orders: state.orders, orderNumber });
              if (!res.ok) return showClientBanner(res.errorMessage || 'Unable to request cancellation.');
              state.orders = res.updatedOrders;
              saveOrdersToStorage();
            }
            showClientBanner(`Cancellation request for Order #${orderNumber} sent to Admin.`);
            renderDashboardContent();
          })
        );
      }

      // Customer Completed Transactions Table
      const txTbody = document.getElementById('client-transactions-tbody');
      if (txTbody) {
        const totalVol = completedTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0);
        setTxt('client-transactions-total', usd(totalVol));
        txTbody.innerHTML =
          completedTransactions.length === 0
            ? `<tr><td colspan="6" class="py-8 text-center text-xs text-[#64748B]">No completed transaction orders yet.</td></tr>`
            : completedTransactions
                .map(
                  (tx) =>
                    `<tr data-testid="client-transaction-row-${esc(
                      tx.orderNumber
                    )}"><td class="font-mono-tech text-xs font-bold text-[#0D1015] whitespace-nowrap">${esc(
                      tx.txId
                    )}</td><td class="font-mono-tech text-xs font-bold text-[#0095FF] whitespace-nowrap">#${esc(
                      tx.orderNumber
                    )}</td><td class="font-mono-tech text-xs text-[#475569] whitespace-nowrap">${esc(
                      tx.date
                    )}</td><td class="admin-col-primary"><p class="admin-table-title">${esc(
                      tx.piece
                    )}</p><p class="admin-table-sub">${esc(tx.finish)} · ${esc(
                      tx.dimensions || 'Standard Dimensions'
                    )}</p></td><td class="whitespace-nowrap"><span class="admin-status-badge admin-status-in-stock"><span class="admin-status-badge-dot"></span>${esc(
                      tx.status || 'Completed'
                    )}</span></td><td class="text-right font-mono-tech font-bold text-[#0D1015] whitespace-nowrap">${usd(
                      tx.amount
                    )}</td></tr>`
                )
                .join('');
      }

      // Customer Cart Workspace
      const cartSelect = document.getElementById('client-cart-add-select');
      if (cartSelect) {
        cartSelect.innerHTML = state.catalog
          .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${usd(p.effectivePrice)})</option>`)
          .join('');
      }
      const cartEmptyEl = document.getElementById('client-cart-empty-state');
      const cartWorkspaceEl = document.getElementById('client-cart-workspace');
      const cartItemsListEl = document.getElementById('client-cart-items-list');
      if (cartEmptyEl && cartWorkspaceEl && cartItemsListEl) {
        if (state.cartItems.length === 0) {
          cartEmptyEl.classList.remove('hidden');
          cartWorkspaceEl.classList.add('hidden');
          cartItemsListEl.innerHTML = '';
          state.appliedVoucher = null;
        } else {
          cartEmptyEl.classList.add('hidden');
          cartWorkspaceEl.classList.remove('hidden');
          if (state.appliedVoucher) {
            const recheck = validateVoucherForOrder(
              state.vouchers,
              state.appliedVoucher.code,
              userEmail,
              state.cartItems,
              state.catalog
            );
            if (!recheck.valid) state.appliedVoucher = null;
          }
          const linePrices = state.cartItems.map((c) => ({
            productId: c.product.id,
            productName: c.product.name,
            finish: c.finish,
            unitPrice: computeVariantPricing(c.product, c.finish).effectivePrice,
            quantity: c.quantity,
          }));
          const totals = calculateOrderPricing(linePrices, state.appliedVoucher);

          cartItemsListEl.innerHTML = state.cartItems
            .map((entry, idx) => {
              const item = entry.product;
              const imgUrl = (item.image || 'assets/images/category_living_lounge.jpg').replace(/^\//, '');
              const pricing = computeVariantPricing(item, entry.finish);
              const breakdown = totals.lineBreakdowns[idx] || {
                rawLineTotal: pricing.effectivePrice * entry.quantity,
                finalLineTotal: pricing.effectivePrice * entry.quantity,
                lineDiscount: 0,
                isVoucherEligible: false,
              };
              return `<article class="bg-white rounded-3xl border border-[#BCE3FF] p-5 shadow-2xs flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between"><div class="flex items-center gap-4 min-w-0"><img src="${esc(
                imgUrl
              )}" alt="${esc(
                item.name
              )}" class="w-20 h-20 rounded-2xl object-cover border border-[#BCE3FF] shrink-0" /><div class="min-w-0 space-y-1"><h3 class="font-serif-display text-lg font-bold text-[#0D1015] truncate">${esc(
                item.name
              )}</h3><p class="text-xs text-[#475569]">Finish: <span class="font-semibold text-[#0D1015]">${esc(
                entry.finish
              )}</span> · ${usd(pricing.effectivePrice)} each</p><div class="flex items-center gap-3 pt-1"><div class="inline-flex items-center rounded-xl border border-[#BCE3FF] bg-[#F8FBFF]"><button type="button" data-client-cart-qty-idx="${idx}" data-client-cart-delta="-1" class="px-3 py-1 text-xs font-bold cursor-pointer">−</button><span class="px-3 py-1 font-mono-tech text-xs font-bold">${
                entry.quantity
              }</span><button type="button" data-client-cart-qty-idx="${idx}" data-client-cart-delta="1" class="px-3 py-1 text-xs font-bold cursor-pointer">+</button></div><button type="button" data-client-cart-remove="${idx}" class="text-xs font-semibold text-rose-700 hover:underline cursor-pointer">Remove</button></div></div></div><div class="sm:text-right shrink-0"><p class="font-mono-tech text-lg font-bold text-[#0D1015]">${usd(
                breakdown.finalLineTotal
              )}</p></div></article>`;
            })
            .join('');

          cartItemsListEl.querySelectorAll('[data-client-cart-qty-idx]').forEach((btn) =>
            btn.addEventListener('click', () => {
              const idx = Number(btn.getAttribute('data-client-cart-qty-idx'));
              const delta = Number(btn.getAttribute('data-client-cart-delta'));
              if (!state.cartItems[idx]) return;
              state.cartItems[idx].quantity += delta;
              if (state.cartItems[idx].quantity <= 0) state.cartItems.splice(idx, 1);
              saveCartToStorage();
              renderDashboardContent();
            })
          );
          cartItemsListEl.querySelectorAll('[data-client-cart-remove]').forEach((btn) =>
            btn.addEventListener('click', () => {
              state.cartItems.splice(Number(btn.getAttribute('data-client-cart-remove')), 1);
              saveCartToStorage();
              renderDashboardContent();
            })
          );

          setTxt('client-cart-subtotal', usd(totals.rawSubtotal));
          const voucherRow = document.getElementById('client-cart-voucher-row');
          if (voucherRow) {
            voucherRow.classList.toggle('hidden', totals.voucherDiscountAmount <= 0);
            voucherRow.classList.toggle('flex', totals.voucherDiscountAmount > 0);
            setTxt('client-cart-voucher-discount', `-${usd(totals.voucherDiscountAmount)}`);
          }
          setTxt('client-cart-delivery', usd(totals.whiteGloveDeliveryFee));
          setTxt('client-cart-total', usd(totals.totalAmount));
        }
      }

      // Customer Voucher Wallet
      const friendlyVouchersEl = document.getElementById('client-vouchers-friendly-list');
      if (friendlyVouchersEl) {
        friendlyVouchersEl.innerHTML =
          displayVouchers.length === 0
            ? `<div class="col-span-full p-8 rounded-3xl border border-[#BCE3FF] bg-[#F8FBFF] text-center"><p class="font-serif-display text-lg font-bold text-[#0D1015]">No Vouchers Assigned Yet</p></div>`
            : displayVouchers
                .map((v) => {
                  const statusInfo = computeVoucherStatusInfo(v);
                  const issuedInfo = formatVoucherIssuedDisplay(v);
                  const expiryInfo = formatVoucherExpiryDisplay(v);
                  const discountAmt = Number(v.discountAmount ?? v.discountValue ?? 0);
                  return `<div class="p-5 sm:p-6 rounded-3xl border border-[#BCE3FF] bg-white space-y-4 shadow-2xs flex flex-col justify-between"><div class="space-y-3"><div class="flex items-start justify-between gap-2"><div><span class="inline-flex items-center px-2.5 py-1 rounded-lg bg-[#EBF6FF] border border-[#BCE3FF] font-mono-tech text-xs font-bold text-[#0077CC]">${usd(
                    discountAmt
                  )} OFF FIXED DISCOUNT</span><h3 class="font-serif-display text-base font-bold text-[#0D1015] mt-2">${esc(
                    v.furnitureName || v.productName
                  )}</h3></div><span class="admin-status-badge ${
                    statusInfo.badgeClass
                  }"><span class="admin-status-badge-dot"></span>${esc(
                    statusInfo.status
                  )}</span></div><div class="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F8FBFF] border border-[#BCE3FF]"><code class="font-mono-tech text-sm font-bold text-[#0D1015]">${esc(
                    v.code
                  )}</code><button type="button" data-copy-voucher="${esc(
                    v.code
                  )}" class="px-3 py-1.5 rounded-lg bg-[#EBF6FF] text-[#0077CC] text-xs font-semibold cursor-pointer">Copy Code</button></div><div class="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"><div><span class="block text-[10px] font-semibold uppercase text-slate-400">Issued (PHT)</span><span class="font-semibold text-slate-800 block mt-0.5">${esc(
                    issuedInfo.primary
                  )}</span></div><div><span class="block text-[10px] font-semibold uppercase text-slate-400">Expires (PHT)</span><span class="font-semibold text-slate-800 block mt-0.5">${esc(
                    expiryInfo.primary
                  )}</span></div></div></div><div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2"><span data-voucher-countdown="${esc(
                    v.id
                  )}" class="vch-remaining-badge ${
                    statusInfo.isUsable ? 'vch-remaining-active' : 'vch-remaining-inactive'
                  }">${esc(statusInfo.remainingLabel)}</span>${
                    statusInfo.isUsable
                      ? `<button type="button" data-use-voucher-product="${esc(
                          v.furnitureId || v.productId
                        )}" data-use-voucher-code="${esc(
                          v.code
                        )}" class="px-3.5 py-2 rounded-xl bg-[#0095FF] text-white text-xs font-semibold cursor-pointer">Use in Checkout →</button>`
                      : ''
                  }</div></div>`;
                })
                .join('');

        friendlyVouchersEl.querySelectorAll('[data-use-voucher-product]').forEach((btn) =>
          btn.addEventListener('click', () => {
            const pid = btn.getAttribute('data-use-voucher-product');
            const vCode = btn.getAttribute('data-use-voucher-code') || '';
            const product = state.catalog.find((p) => p.id === pid);
            if (product && Number(product.inStockCount ?? 0) > 0) {
              const finish = product.defaultFinish || 'Natural Finish';
              if (!state.cartItems.some((c) => c.product.id === product.id)) {
                state.cartItems.push({ product, finish, quantity: 1 });
                saveCartToStorage();
              }
              const check = validateVoucherForOrder(state.vouchers, vCode, userEmail, state.cartItems, state.catalog);
              if (check.valid) state.appliedVoucher = check.voucher;
            }
            document.querySelector('[data-client-tab="cart"]')?.click();
            renderDashboardContent();
          })
        );
      }
    }

    if (!shouldRenderAdmin) return;

    const discountedCount = state.catalog.filter((p) => Number(p.discountPercent || 0) > 0).length;
    const activeVoucherCount = state.vouchers.filter((v) => computeVoucherStatusInfo(v).isUsable).length;
    const totalOrderRevenue = state.orders
      .filter(isOrderCompleted)
      .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    const invMetrics = computeMaterialInventoryMetrics(state.materials);
    const customerDirectory = computeCustomerDirectory(state.orders, state.customers, state.customerProfile);

    setTxt('admin-stat-catalog', `${state.catalog.length} Items`);
    setTxt(
      'admin-stat-catalog-sub',
      discountedCount > 0 ? `${discountedCount} currently discounted` : 'All at standard price'
    );
    setTxt('admin-stat-vouchers', `${activeVoucherCount} Active`);
    setTxt('admin-stat-orders', `${state.orders.length} Orders`);
    setTxt('admin-stat-revenue', usd(totalOrderRevenue));
    setTxt('admin-nav-count-products', String(state.catalog.length));
    setTxt('admin-nav-count-inventory', String(invMetrics.totalMaterials));
    setTxt('admin-nav-count-vouchers', String(state.vouchers.length));
    setTxt('admin-nav-count-orders', String(state.orders.length));
    setTxt('admin-nav-count-customers', String(customerDirectory.length));

    const renderStockStatusBadge = (statusKey) => {
      if (statusKey === 'out_of_stock')
        return `<span class="admin-status-badge admin-status-out-of-stock"><span class="admin-status-badge-dot"></span>Out of Stock</span>`;
      if (statusKey === 'low_stock')
        return `<span class="admin-status-badge admin-status-low-stock"><span class="admin-status-badge-dot"></span>Low Stock</span>`;
      return `<span class="admin-status-badge admin-status-in-stock"><span class="admin-status-badge-dot"></span>In Stock</span>`;
    };

    // Overview Charts & Recent Orders
    const chartCategoriesEl = document.getElementById('admin-chart-categories');
    if (chartCategoriesEl) {
      const totalItems = Math.max(1, state.catalog.length);
      chartCategoriesEl.innerHTML = [
        { id: 'living', label: 'Living Room' },
        { id: 'dining', label: 'Dining Room' },
        { id: 'bedroom', label: 'Bedroom' },
        { id: 'office', label: 'Study/Work Desks' },
        { id: 'kitchen', label: 'Kitchen' },
      ]
        .map((cat) => {
          const matches = state.catalog.filter((p) => p.categoryId === cat.id);
          const pct = Math.round((matches.length / totalItems) * 100);
          return `<div><div class="flex items-center justify-between text-xs"><span class="font-semibold text-slate-800">${esc(
            cat.label
          )}</span><span class="font-mono-tech text-slate-500">${
            matches.length
          } items</span></div><div class="admin-progress-track"><div class="admin-progress-fill-blue" style="width: ${
            matches.length > 0 ? Math.max(8, pct) : 0
          }%"></div></div></div>`;
        })
        .join('');
    }

    const recentOrdersEl = document.getElementById('admin-overview-recent-orders');
    if (recentOrdersEl) {
      const recentList = state.orders.slice(0, 4);
      recentOrdersEl.innerHTML = `<div class="p-5 sm:p-6 border-b border-slate-200 flex items-center justify-between gap-3"><div><h2 class="text-base font-bold text-slate-900">Recent Customer Orders</h2></div><div class="flex items-center gap-2"><button type="button" data-admin-jump="inventory" class="admin-btn admin-btn-sm admin-btn-secondary">Manage Inventory</button><button type="button" data-admin-jump="orders" class="admin-btn admin-btn-sm admin-btn-primary">View All Orders</button></div></div><div class="overflow-x-auto"><table class="admin-table"><thead><tr><th>Order #</th><th>Customer</th><th>Product</th><th>Stage</th><th class="text-right">Total</th></tr></thead><tbody>${recentList
        .map(
          (o) =>
            `<tr><td class="font-mono-tech text-xs font-bold text-[#0095FF]">#${esc(
              o.orderNumber
            )}</td><td><p class="admin-table-title">${esc(o.clientName)}</p></td><td><p class="admin-table-title">${esc(
              o.furnitureName
            )}</p></td><td><span class="admin-status-badge admin-status-in-stock">${esc(
              o.status.split('·')[0].trim()
            )}</span></td><td class="text-right font-mono-tech font-bold">${usd(o.totalAmount)}</td></tr>`
        )
        .join('')}</tbody></table></div>`;
      recentOrdersEl.querySelectorAll('[data-admin-jump]').forEach((btn) =>
        btn.addEventListener('click', () => window.__switchAdminTab?.(btn.getAttribute('data-admin-jump')))
      );
    }

    // Admin Catalog Section
    const adminCatalogEl = document.getElementById('admin-catalog-list');
    if (adminCatalogEl) {
      const query = (state.adminProductSearch || '').trim().toLowerCase();
      const catFilter = state.adminProductCategory || 'all';
      const stockFilter = state.adminProductStockFilter || 'all';
      const typeFilter = state.adminProductTypeFilter || 'all';
      const prodMetrics = computeInventoryMetrics(state.catalog);
      const filteredProducts = state.catalog.filter((p) => {
        const pType = p.productType === 'customized' || p.isCustomClientDesign ? 'customized' : 'standard';
        const stockInfo = getProductStockStatus(p);
        return (
          (catFilter === 'all' || p.categoryId === catFilter) &&
          (typeFilter === 'all' || pType === typeFilter) &&
          (stockFilter === 'all' || stockInfo.statusKey === stockFilter) &&
          (!query || p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query))
        );
      });
      const prodPagination = paginateItems(filteredProducts, state.adminProductPage || 1, 6);
      state.adminProductPage = prodPagination.currentPage;

      adminCatalogEl.innerHTML = `<div class="admin-summary-grid-4"><div class="admin-summary-card"><span class="admin-summary-label">Total Products</span><span id="prod-kpi-total" class="admin-summary-value">${
        prodMetrics.totalProducts
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">In Stock</span><span class="admin-summary-value is-green">${
        prodMetrics.inStockCount
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">Low Stock</span><span class="admin-summary-value is-orange">${
        prodMetrics.lowStockCount
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">Out of Stock</span><span class="admin-summary-value is-red">${
        prodMetrics.outOfStockCount
      }</span></div></div><div class="admin-card"><div class="admin-toolbar"><div class="admin-toolbar-filters"><input id="admin-catalog-search" type="search" value="${esc(
        state.adminProductSearch
      )}" placeholder="Search product name, SKU..." class="admin-input admin-search-input" /></div><button type="button" id="admin-toggle-add-product-btn" class="admin-btn admin-btn-sm admin-btn-primary">+ Add Product</button></div><div class="overflow-x-auto"><table class="admin-table"><thead><tr><th class="admin-col-primary">Product Name</th><th>Category</th><th>Available Stock</th><th>Minimum Stock</th><th>Unit Price</th><th>Stock Status</th><th class="text-right">Actions</th></tr></thead><tbody>${prodPagination.items
        .map((p) => {
          const imgUrl = (p.image || 'assets/images/category_dining_tables.jpg').replace(/^\//, '');
          const stockInfo = getProductStockStatus(p);
          return `<tr data-product-row="${esc(p.id)}"><td class="admin-col-primary"><div class="flex items-center gap-3"><img src="${esc(
            imgUrl
          )}" alt="${esc(p.name)}" class="admin-thumb" /><div><p class="admin-table-title">${esc(
            p.name
          )}</p><p class="admin-table-sub font-mono-tech">ProductID: ${esc(
            p.productId || p.sku
          )}</p></div></div></td><td><span class="admin-category-tag">${esc(
            p.categoryName
          )}</span></td><td class="font-mono-tech font-semibold">${
            stockInfo.availableStock
          } pcs</td><td class="font-mono-tech">${stockInfo.minStockLevel} pcs</td><td class="font-mono-tech font-semibold">${usd(
            p.effectivePrice
          )}</td><td>${renderStockStatusBadge(
            stockInfo.statusKey
          )}</td><td class="text-right whitespace-nowrap"><button type="button" class="admin-btn admin-btn-sm admin-btn-secondary" data-edit-product="${esc(
            p.id
          )}">Edit</button> <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" data-delete-product="${esc(
            p.id
          )}">Remove</button></td></tr>`;
        })
        .join('')}</tbody></table></div></div>`;

      bindLiveSearchInput('admin-catalog-search', 'adminProductSearch', () => {
        state.adminProductPage = 1;
        renderDashboardContent();
      });
      document
        .getElementById('admin-toggle-add-product-btn')
        ?.addEventListener('click', () => window.__switchAdminTab?.('add-product'));
      adminCatalogEl.querySelectorAll('[data-edit-product]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const prod = state.catalog.find((i) => i.id === btn.getAttribute('data-edit-product'));
          if (prod) window.__openProductFormForEdit?.(prod);
        })
      );
      adminCatalogEl.querySelectorAll('[data-delete-product]').forEach((btn) =>
        btn.addEventListener('click', () => window.__removeProductById?.(btn.getAttribute('data-delete-product')))
      );
    }

    // Admin Inventory & Stock Management
    const adminInventoryEl = document.getElementById('admin-tab-inventory');
    if (adminInventoryEl) {
      const metrics = computeMaterialInventoryMetrics(state.materials);
      const categories = getMaterialCategories(state.materials);
      const filteredMaterials = filterInventoryMaterials(state.materials, {
        searchQuery: state.adminInventoryStockSearch || '',
        categoryFilter: state.adminInventoryCategoryFilter || 'all',
        statusFilter: state.adminInventoryStockFilter || 'all',
      });
      const pagination = paginateItems(filteredMaterials, state.adminInventoryPage || 1, 5);
      state.adminInventoryPage = pagination.currentPage;

      adminInventoryEl.innerHTML = `<div class="space-y-5"><div class="admin-summary-grid-5" data-testid="inventory-summary-cards"><div class="admin-summary-card"><span class="admin-summary-label">Total Materials</span><span id="inv-kpi-total-materials" class="admin-summary-value">${
        metrics.totalMaterials
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">In Stock</span><span id="inv-kpi-in-stock" class="admin-summary-value is-green">${
        metrics.inStockCount
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">Low Stock</span><span id="inv-kpi-low-stock" class="admin-summary-value is-orange">${
        metrics.lowStockCount
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">Out of Stock</span><span id="inv-kpi-out-stock" class="admin-summary-value is-red">${
        metrics.outOfStockCount
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">Total Inventory Value</span><span id="inv-kpi-total-value" class="admin-summary-value is-blue font-mono-tech">${usd(
        metrics.totalInventoryValue
      )}</span></div></div><div class="admin-card"><div class="admin-toolbar"><div class="admin-toolbar-filters"><input id="admin-inv-stock-search" type="search" value="${esc(
        state.adminInventoryStockSearch
      )}" placeholder="Search material name, SKU..." class="admin-input admin-search-input" /><select id="admin-inv-category-filter" class="admin-select admin-filter-select"><option value="all">All Categories</option>${categories
        .map(
          (cat) =>
            `<option value="${esc(cat)}" ${
              state.adminInventoryCategoryFilter === cat ? 'selected' : ''
            }>${esc(cat)}</option>`
        )
        .join('')}</select></div></div><div class="overflow-x-auto"><table class="admin-table" data-testid="inventory-materials-table"><thead><tr><th class="admin-col-primary">Material Name</th><th>Category</th><th>Available Stock</th><th>Minimum Stock</th><th>Unit Cost</th><th>Stock Status</th><th class="text-right">Actions</th></tr></thead><tbody>${pagination.items
        .map((m) => {
          const st = getMaterialStockStatus(m);
          return `<tr data-material-row="${esc(m.id)}"><td class="admin-col-primary"><p class="admin-table-title">${esc(
            m.name
          )}</p><p class="admin-table-sub font-mono-tech">MaterialID: ${esc(
            m.materialId || m.sku || m.code
          )}</p></td><td><span class="admin-category-tag">${esc(
            m.materialType
          )}</span></td><td class="font-mono-tech font-semibold">${st.availableStock} ${esc(
            m.unit
          )}</td><td class="font-mono-tech">${st.minStockLevel} ${esc(
            m.unit
          )}</td><td class="font-mono-tech">${usd(m.unitCost)}</td><td>${renderStockStatusBadge(
            st.statusKey
          )}</td><td class="text-right whitespace-nowrap"><button type="button" class="admin-btn admin-btn-sm admin-btn-secondary" data-quick-restock="${esc(
            m.id
          )}">+10 Stock</button></td></tr>`;
        })
        .join('')}</tbody></table></div></div></div>`;

      bindLiveSearchInput('admin-inv-stock-search', 'adminInventoryStockSearch', () => {
        state.adminInventoryPage = 1;
        renderDashboardContent();
      });
      document.getElementById('admin-inv-category-filter')?.addEventListener('change', (e) => {
        state.adminInventoryCategoryFilter = e.target.value;
        state.adminInventoryPage = 1;
        renderDashboardContent();
      });
      adminInventoryEl.querySelectorAll('[data-quick-restock]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const materialId = btn.getAttribute('data-quick-restock') || '';
          const movementInput = {
            materialId,
            transactionType: 'Stock In',
            quantity: 10,
            reason: 'Workshop Raw Material Restock',
            date: new Date().toISOString().slice(0, 10),
          };
          const serverRes = await syncDatabaseStore('record_stock_movement', {
            movementInput,
            adminName: state.sessionUser?.name || 'Admin',
          });
          if (serverRes?.ok && Array.isArray(serverRes.materials)) {
            state.materials = serverRes.materials;
            if (Array.isArray(serverRes.inventoryTransactions))
              state.inventoryTransactions = serverRes.inventoryTransactions;
          } else {
            const res = applyMaterialStockMovement({
              materials: state.materials,
              adminName: 'Admin',
              movementInput,
            });
            if (res.ok) {
              state.materials = res.updatedMaterials;
              state.inventoryTransactions.unshift(res.transaction);
              saveMaterialsToStorage();
            }
          }
          showAdminBanner('Added +10 stock units to material inventory.');
          renderDashboardContent();
        })
      );
    }

    // Admin Vouchers Section
    const vchSelect = document.getElementById('vch-product');
    if (vchSelect) {
      const prev = vchSelect.value;
      vchSelect.innerHTML = state.catalog
        .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.sku)} · ${usd(p.effectivePrice)})</option>`)
        .join('');
      if (prev && state.catalog.some((p) => p.id === prev)) vchSelect.value = prev;
    }
    const adminVouchersEl = document.getElementById('admin-vouchers-list');
    if (adminVouchersEl) {
      const nowMs = Date.now();
      adminVouchersEl.innerHTML = `<div class="admin-card overflow-hidden"><div class="p-5 border-b border-slate-200"><h2 class="text-base font-bold text-slate-900">Issued Vouchers (${
        state.vouchers.length
      })</h2></div><div class="overflow-x-auto"><table class="admin-table vch-table"><thead><tr><th>Voucher Code</th><th>Customer</th><th>Eligible Product</th><th>Discount</th><th>Status</th><th class="text-right">Actions</th></tr></thead><tbody>${state.vouchers
        .map((v) => {
          const statusInfo = computeVoucherStatusInfo(v, nowMs);
          return `<tr><td><span class="vch-code-chip">${esc(v.code)}</span></td><td><p class="admin-table-title">${esc(
            v.customerName || 'Client'
          )}</p><p class="admin-table-sub font-mono-tech">${esc(v.customerEmail)}</p></td><td>${esc(
            v.furnitureName || v.productName
          )}</td><td class="font-mono-tech font-bold text-[#0095FF]">-${usd(
            v.discountAmount ?? v.discountValue ?? 0
          )}</td><td><span class="admin-status-badge ${statusInfo.badgeClass}">${esc(
            statusInfo.status
          )}</span></td><td class="text-right">${
            statusInfo.status !== 'Revoked' && statusInfo.status !== 'Used'
              ? `<button type="button" data-revoke-voucher="${esc(
                  v.id
                )}" class="admin-btn admin-btn-sm admin-btn-danger">Revoke</button>`
              : ''
          }</td></tr>`;
        })
        .join('')}</tbody></table></div></div>`;

      adminVouchersEl.querySelectorAll('[data-revoke-voucher]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const vid = btn.getAttribute('data-revoke-voucher') || '';
          const serverRes = await syncDatabaseStore('revoke_voucher', { voucherId: vid });
          if (serverRes?.ok && Array.isArray(serverRes.vouchers)) state.vouchers = serverRes.vouchers;
          else {
            const fb = revokeVoucherInList(state.vouchers, vid, Date.now());
            if (fb.ok) state.vouchers = fb.vouchers;
          }
          showAdminBanner('Voucher has been revoked.');
          renderDashboardContent();
        })
      );
    }

    // Admin Orders Section
    const adminOrdersEl = document.getElementById('admin-tab-orders');
    if (adminOrdersEl) {
      const statusOptions = [
        'Order Confirmed · In Production Queue',
        'Timber Selection & Kiln Verification',
        'In Joinery & Millwork',
        'Hand-Rubbed Finishing & Upholstery',
        'Quality Inspection · Ready for Dispatch',
        'Dispatched · White-Glove Transit',
        'Delivered · Completed',
      ];
      const ordQuery = (state.adminOrderSearch || '').trim().toLowerCase();
      const stageFilter = state.adminOrderStage || 'all';
      const { activeOrders, completedOrders } = partitionOrdersByCompletion(state.orders);
      const inProdCount = activeOrders.filter((o) => /Joinery|Finishing|Millwork|Quality/i.test(o.status)).length;
      const matchesOrderQuery = (o) =>
        !ordQuery ||
        o.orderNumber.toLowerCase().includes(ordQuery) ||
        o.clientName.toLowerCase().includes(ordQuery) ||
        o.clientEmail.toLowerCase().includes(ordQuery) ||
        o.furnitureName.toLowerCase().includes(ordQuery);

      const filteredActiveOrders = activeOrders.filter((o) => matchesOrderQuery(o) && stageFilter !== 'completed');
      const filteredCompletedOrders = completedOrders.filter((o) => matchesOrderQuery(o));

      adminOrdersEl.innerHTML = `<div class="space-y-6"><div class="admin-summary-grid-4"><div class="admin-summary-card"><span class="admin-summary-label">Total Orders</span><span class="admin-summary-value">${
        state.orders.length
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">Active Orders</span><span id="admin-orders-active-count" class="admin-summary-value is-blue">${
        activeOrders.length
      }</span></div><div class="admin-summary-card"><span class="admin-summary-label">In Production</span><span class="admin-summary-value is-orange">${inProdCount}</span></div><div class="admin-summary-card"><span class="admin-summary-label">Completed Orders</span><span id="admin-orders-completed-count" class="admin-summary-value is-green">${
        completedOrders.length
      }</span></div></div><div id="admin-active-orders-section" data-testid="admin-active-orders-section" class="admin-card overflow-hidden"><div class="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between"><h3 class="text-sm font-bold text-slate-900">Active Orders (${
        filteredActiveOrders.length
      })</h3></div><div class="admin-toolbar"><div class="admin-toolbar-filters"><input id="admin-orders-search" type="search" value="${esc(
        state.adminOrderSearch
      )}" placeholder="Search order #, customer..." class="admin-input admin-search-input" /></div></div><div class="overflow-x-auto"><table class="admin-table" data-testid="admin-active-orders-table"><thead><tr><th>Order #</th><th>Customer</th><th>Product &amp; Finish</th><th>Order Stage</th><th class="text-right">Total Amount</th></tr></thead><tbody>${filteredActiveOrders
        .map((o) => {
          const realIdx = state.orders.findIndex((item) => item.orderNumber === o.orderNumber);
          return `<tr data-testid="admin-active-order-row-${esc(
            o.orderNumber
          )}"><td class="whitespace-nowrap"><p class="font-mono-tech text-xs font-bold text-[#0095FF]">#${esc(
            o.orderNumber
          )}</p></td><td><p class="admin-table-title">${esc(o.clientName)}</p><p class="admin-table-sub">${esc(
            o.clientEmail
          )}</p></td><td><p class="admin-table-title">${esc(o.furnitureName)}</p><p class="admin-table-sub">${esc(
            o.selectedFinish
          )}</p></td><td><select aria-label="Update status for order ${esc(
            o.orderNumber
          )}" data-admin-order-idx="${realIdx}" class="admin-select admin-order-status-select">${statusOptions
            .map((st) => `<option value="${esc(st)}" ${o.status === st ? 'selected' : ''}>${esc(st)}</option>`)
            .join('')}</select>${
            o.cancellationRequested
              ? `<div class="mt-2 flex items-center gap-2"><button type="button" data-admin-approve-cancel="${esc(
                  o.orderNumber
                )}" class="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer">Approve Cancel</button><button type="button" data-admin-decline-cancel="${esc(
                  o.orderNumber
                )}" class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[11px] font-semibold cursor-pointer">Decline</button></div>`
              : ''
          }</td><td class="text-right font-mono-tech text-sm font-bold">${usd(o.totalAmount)}</td></tr>`;
        })
        .join(
          ''
        )}</tbody></table></div></div><div id="admin-completed-orders-section" data-testid="admin-completed-orders-section" class="admin-card overflow-hidden"><div class="px-6 py-4 border-b border-slate-200 bg-emerald-50/60 flex items-center justify-between"><h3 class="text-sm font-bold text-slate-900">Completed Orders (${
        filteredCompletedOrders.length
      })</h3><span id="admin-completed-section-badge" class="px-2.5 py-1 rounded-full bg-emerald-600 text-white font-mono-tech text-xs font-bold">${
        completedOrders.length
      } Completed</span></div><div class="overflow-x-auto"><table class="admin-table" data-testid="admin-completed-orders-table"><thead><tr><th>Order #</th><th>Transaction Ref</th><th>Customer</th><th>Product &amp; Finish</th><th>Completed Date</th><th>Status</th><th class="text-right">Total Amount</th></tr></thead><tbody id="admin-completed-orders-tbody">${filteredCompletedOrders
        .map((o) => {
          const ordDigits = String(o.orderNumber || '').split('-').pop() || '0000';
          return `<tr data-testid="admin-completed-order-row-${esc(
            o.orderNumber
          )}"><td class="font-mono-tech text-xs font-bold text-[#0095FF]">#${esc(
            o.orderNumber
          )}</td><td class="font-mono-tech text-xs font-bold">${esc(
            o.transactionReference || `TXN-2026-${ordDigits}`
          )}</td><td><p class="admin-table-title">${esc(o.clientName)}</p></td><td><p class="admin-table-title">${esc(
            o.furnitureName
          )}</p></td><td class="font-mono-tech text-xs">${esc(
            o.completedAt || o.orderDate
          )}</td><td><span class="admin-status-badge admin-status-in-stock">Completed</span></td><td class="text-right font-mono-tech text-sm font-bold text-emerald-700">${usd(
            o.totalAmount
          )}</td></tr>`;
        })
        .join('')}</tbody></table></div></div></div>`;

      bindLiveSearchInput('admin-orders-search', 'adminOrderSearch', renderDashboardContent);
      adminOrdersEl.querySelectorAll('[data-admin-order-idx]').forEach((sel) =>
        sel.addEventListener('change', async (e) => {
          const ord = state.orders[Number(sel.getAttribute('data-admin-order-idx'))];
          if (!ord) return;
          const nextStatus = e.target.value;
          const performUpdate = async () => {
            const serverRes = await syncDatabaseStore('update_order_status', {
              orderNumber: ord.orderNumber,
              status: nextStatus,
            });
            if (serverRes?.ok && Array.isArray(serverRes.orders)) {
              state.orders = serverRes.orders;
            } else {
              const res = applyAdminOrderUpdate({
                orders: state.orders,
                orderNumber: ord.orderNumber,
                updates: { status: nextStatus },
              });
              if (res.ok) {
                state.orders = res.updatedOrders;
                saveOrdersToStorage();
              }
            }
            showAdminBanner(`Updated Order #${ord.orderNumber} stage to "${nextStatus}".`);
            renderDashboardContent();
          };
          if (/Completed|Delivered/i.test(nextStatus)) {
            openAdminConfirmModal({
              title: `Complete Order #${ord.orderNumber}?`,
              message: `Mark Order #${ord.orderNumber} (${ord.furnitureName}) as Completed?`,
              confirmLabel: 'Yes, Complete Order',
              confirmVariant: 'primary',
              onConfirm: performUpdate,
              onCancel: () => {
                sel.value = ord.status;
                renderDashboardContent();
              },
            });
          } else {
            await performUpdate();
          }
        })
      );

      adminOrdersEl.querySelectorAll('[data-admin-approve-cancel], [data-admin-decline-cancel]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const isApprove = btn.hasAttribute('data-admin-approve-cancel');
          const orderNumber =
            btn.getAttribute(isApprove ? 'data-admin-approve-cancel' : 'data-admin-decline-cancel') || '';
          const decision = isApprove ? 'approve' : 'decline';
          const serverRes = await syncDatabaseStore('resolve_order_cancellation', { orderNumber, decision });
          if (serverRes?.ok && Array.isArray(serverRes.orders)) state.orders = serverRes.orders;
          else {
            const res = resolveOrderCancellationRequest({ orders: state.orders, orderNumber, decision });
            if (res.ok) {
              state.orders = res.updatedOrders;
              saveOrdersToStorage();
            }
          }
          showAdminBanner(
            `${isApprove ? 'Approved' : 'Declined'} cancellation request for Order #${orderNumber}.`
          );
          renderDashboardContent();
        })
      );
    }

    // Admin Customer Directory
    const adminCustomersEl = document.getElementById('admin-tab-customers');
    if (adminCustomersEl) {
      const custQuery = (state.adminCustomerSearch || '').trim().toLowerCase();
      const filteredCustomers = customerDirectory.filter(
        (c) => !custQuery || c.name.toLowerCase().includes(custQuery) || c.email.toLowerCase().includes(custQuery)
      );
      adminCustomersEl.innerHTML = `<div class="admin-card overflow-hidden"><div class="admin-toolbar"><div class="admin-toolbar-filters"><input id="admin-customers-search" type="search" value="${esc(
        state.adminCustomerSearch
      )}" placeholder="Search customer name, email..." class="admin-input admin-search-input" /></div></div><div class="overflow-x-auto"><table class="admin-table"><thead><tr><th class="admin-col-primary">Customer Name</th><th>Email Address</th><th>Phone</th><th>Delivery Address</th><th>Orders</th><th>Total Spent</th></tr></thead><tbody>${filteredCustomers
        .map(
          (c) =>
            `<tr><td class="admin-col-primary"><p class="admin-table-title">${esc(
              c.name
            )}</p><p class="admin-table-sub font-mono-tech">CustomerID: ${esc(
              c.customerId || c.id
            )}</p></td><td class="text-xs">${esc(c.email)}</td><td class="font-mono-tech text-xs">${esc(
              c.phone
            )}</td><td class="text-xs">${esc(c.address)}</td><td class="font-mono-tech font-semibold">${
              c.orderCount
            } orders</td><td class="font-mono-tech font-semibold text-[#0095FF]">${usd(c.totalSpent)}</td></tr>`
        )
        .join('')}</tbody></table></div></div>`;
      bindLiveSearchInput('admin-customers-search', 'adminCustomerSearch', renderDashboardContent);
    }

    if (state.activeAdminTab === 'analytics') renderAdminAnalyticsSection();
  }

  function renderDeltaBadge(metric) {
    if (!metric) return '';
    const dir = metric.direction || 'flat';
    const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
    const tone = dir === 'up' ? 'is-up' : dir === 'down' ? 'is-down' : 'is-flat';
    return `<span class="analytics-delta-tag ${tone}">${arrow} ${esc(metric.formattedChange || '0.0%')}</span>`;
  }

  function renderAdminAnalyticsSection() {
    const analyticsEl = document.getElementById('admin-tab-analytics');
    if (!analyticsEl) return;

    const nowMs = Date.now();
    const defaultManilaRange = resolveAnalyticsDateRange({ preset: 'this_month' }, nowMs);
    const selectedYear = Number(state.adminAnalyticsYear) || defaultManilaRange.current.year;
    const selectedMonth = Number(state.adminAnalyticsMonth) || defaultManilaRange.current.month;
    const filterInput = {
      preset: state.adminAnalyticsPreset || 'this_month',
      year: selectedYear,
      month: selectedMonth,
      startDate: state.adminAnalyticsStartDate || defaultManilaRange.current.startDate,
      endDate: state.adminAnalyticsEndDate || defaultManilaRange.current.endDate,
    };

    const report = computeMonthlyAnalyticsReport({
      catalog: state.catalog,
      categories: state.categories,
      orders: state.orders,
      customers: state.customers,
      customerProfile: state.customerProfile,
      materials: state.materials,
      inventoryTransactions: state.inventoryTransactions,
      vouchers: state.vouchers,
      filterInput,
      nowMs,
    });

    const s = report.summary;
    const sales = report.salesAnalytics;
    const bestSellers = report.bestSellingProducts;
    const ordAnalytics = report.orderAnalytics;
    const custAnalytics = report.customerAnalytics;
    const invAnalytics = report.inventoryAnalytics;
    const vchAnalytics = report.voucherAnalytics;

    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const overviewPeriodOptions = [];
    for (let m = 12; m >= 1; m--) {
      overviewPeriodOptions.push({
        value: `2026-${String(m).padStart(2, '0')}`,
        label: `${monthNames[m - 1]} 2026`,
        selected: Number(report.period.year) === 2026 && Number(report.period.month) === m,
      });
    }

    const renderOverviewBadge = (metric) => {
      if (!metric) return '';
      const pct = Math.abs(Number(metric.percentChange ?? metric.percentage ?? 0));
      if (metric.isNewFromZero && Number(metric.value || 0) > 0)
        return `<span class="monthly-overview-badge is-new">New</span>`;
      if (metric.direction === 'flat' || pct < 0.05)
        return `<span class="monthly-overview-badge is-flat">No change</span>`;
      return `<span class="monthly-overview-badge ${metric.direction === 'up' ? 'is-up' : 'is-down'}">${
        metric.direction === 'up' ? '↑' : '↓'
      } ${pct.toFixed(1)}%</span>`;
    };

    analyticsEl.innerHTML = `<div class="space-y-6" data-testid="admin-analytics-module"><p class="text-sm text-slate-600">Sales reports include completed orders only, dated when the admin completed them. Deposits and unfinished or cancelled orders are excluded. Inventory and voucher availability remain live.</p><div class="analytics-report-banner"><div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div class="space-y-1.5"><h2 class="font-serif-display text-xl sm:text-2xl font-bold text-slate-900">Monthly Analytics &amp; Business Report — <span id="analytics-active-period-label" class="text-[#0077CC]">${esc(
      report.period.label
    )}</span></h2><p class="text-xs text-slate-700">Reporting Window: <strong class="font-mono-tech">${esc(
      report.period.startDate
    )}</strong> to <strong class="font-mono-tech">${esc(
      report.period.endDate
    )}</strong></p></div><div class="analytics-no-print flex flex-wrap items-center gap-2 shrink-0"><button type="button" id="analytics-export-pdf-btn" data-testid="analytics-export-pdf-btn" class="px-3.5 py-2 rounded-xl bg-[#0095FF] hover:bg-[#0077CC] text-white text-xs font-semibold cursor-pointer">Download PDF Report</button><button type="button" id="analytics-export-csv-btn" data-testid="analytics-export-csv-btn" class="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold cursor-pointer">Export CSV</button><button type="button" id="analytics-print-report-btn" data-testid="analytics-print-report-btn" class="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold cursor-pointer">Printable Report</button></div></div></div>
      <div class="admin-card p-4 analytics-no-print flex flex-wrap items-center justify-between gap-3"><div class="flex flex-wrap items-center gap-1.5">${[
        ['this_month', 'This Month'],
        ['last_month', 'Last Month'],
        ['select_month', 'Select Month & Year'],
        ['this_year', 'This Year'],
        ['custom_range', 'Custom Date Range'],
      ]
        .map(
          ([key, label]) =>
            `<button type="button" data-analytics-preset="${key}" class="analytics-preset-btn ${
              filterInput.preset === key ? 'is-active' : ''
            }">${label}</button>`
        )
        .join('')}</div><div class="flex items-center gap-2">${['2026-11', '2026-10', '2026-09']
      .map(
        (ym) =>
          `<button type="button" data-analytics-quick-month="${ym}" class="px-2.5 py-1 rounded-lg border border-slate-200 font-mono-tech text-xs font-semibold cursor-pointer">${ym}</button>`
      )
      .join('')}</div></div>
      <section aria-label="Monthly Business Summary Indicators" class="monthly-overview-shell" id="analytics-monthly-overview-section"><div class="monthly-overview-header"><div><h3 class="monthly-overview-title">Monthly overview</h3><p class="monthly-overview-subtitle">A clear view of your business performance</p></div><div class="monthly-overview-picker-wrap analytics-no-print"><select id="analytics-overview-period-select" data-testid="analytics-overview-period-select" class="monthly-overview-picker-select">${overviewPeriodOptions
        .map((o) => `<option value="${esc(o.value)}" ${o.selected ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select></div></div><div id="analytics-summary-kpi-grid" class="monthly-overview-kpi-grid" data-testid="analytics-summary-kpi-grid"><div class="monthly-overview-card is-featured" data-testid="kpi-total-revenue"><div class="monthly-overview-card-body"><p class="monthly-overview-card-label">Total revenue</p><div class="monthly-overview-value-row"><span class="monthly-overview-value is-blue">${usd(
      s.totalRevenue.value
    )}</span>${renderOverviewBadge(
      s.totalRevenue
    )}</div></div></div><div class="monthly-overview-card" data-testid="kpi-total-orders"><div class="monthly-overview-card-body"><p class="monthly-overview-card-label">Total orders</p><div class="monthly-overview-value-row"><span class="monthly-overview-value">${
      s.totalOrders.value
    }</span>${renderOverviewBadge(
      s.totalOrders
    )}</div></div></div><div class="monthly-overview-card" data-testid="kpi-products-sold"><div class="monthly-overview-card-body"><p class="monthly-overview-card-label">Products sold</p><div class="monthly-overview-value-row"><span class="monthly-overview-value">${
      s.totalProductsSold.value
    }</span>${renderOverviewBadge(
      s.totalProductsSold
    )}</div></div></div><div class="monthly-overview-card" data-testid="kpi-new-customers"><div class="monthly-overview-card-body"><p class="monthly-overview-card-label">New customers</p><div class="monthly-overview-value-row"><span class="monthly-overview-value">${
      s.newCustomers.value
    }</span>${renderOverviewBadge(
      s.newCustomers
    )}</div></div></div></div><div class="monthly-overview-middle-grid"><div class="monthly-overview-panel" data-testid="overview-revenue-trend-panel"><h4 class="monthly-overview-panel-title">Revenue trend (${esc(
      report.period.label
    )})</h4><p class="font-mono-tech text-lg font-bold text-[#0080FF] mt-2">${usd(
      s.totalRevenue.value
    )}</p></div><div class="monthly-overview-panel" data-testid="overview-order-status-panel"><h4 class="monthly-overview-panel-title">Order status</h4><div class="monthly-overview-status-list"><div class="monthly-overview-status-row" data-testid="kpi-completed-orders"><span>Completed</span><span class="monthly-overview-status-count">${
      s.completedOrders.value
    }</span></div><div class="monthly-overview-status-row" data-testid="kpi-pending-orders"><span>Pending</span><span class="monthly-overview-status-count">${
      s.pendingOrders.value
    }</span></div><div class="monthly-overview-status-row" data-testid="kpi-cancelled-orders"><span>Cancelled</span><span class="monthly-overview-status-count">${
      s.cancelledOrders.value
    }</span></div></div></div></div><div class="monthly-overview-bottom-grid"><div class="monthly-overview-card" data-testid="kpi-average-order-value"><div class="monthly-overview-card-body"><p class="monthly-overview-card-label">Average order value</p><span class="monthly-overview-value">${usd(
      s.averageOrderValue.value
    )}</span></div></div><div class="monthly-overview-card" data-testid="kpi-discounts-given"><div class="monthly-overview-card-body"><p class="monthly-overview-card-label">Discounts given</p><span class="monthly-overview-value">${usd(
      s.totalDiscountsGiven.value
    )}</span></div></div></div></section>
      <section id="analytics-best-sellers-section" class="admin-card overflow-hidden"><div class="px-6 py-4 border-b border-slate-200"><h3 class="text-sm font-bold text-slate-900">Top 5 Best-Selling Products (${esc(
        report.period.label
      )})</h3></div><div class="overflow-x-auto"><table class="admin-table" id="analytics-best-sellers-table" data-testid="analytics-best-sellers-table"><thead><tr><th>Rank</th><th>Product</th><th>Category</th><th>Qty Sold</th><th>Total Revenue</th></tr></thead><tbody>${(
      bestSellers.topFive || []
    )
      .map(
        (item) =>
          `<tr><td class="font-mono-tech font-bold">#${item.rank}</td><td><p class="admin-table-title">${esc(
            item.name
          )}</p></td><td>${esc(item.categoryName)}</td><td class="font-mono-tech font-bold">${
            item.quantitySold
          } units</td><td class="font-mono-tech font-bold text-[#0095FF]">${usd(item.totalRevenue)}</td></tr>`
      )
      .join('')}</tbody></table></div></section>
      <section id="analytics-transactions-section" class="admin-card overflow-hidden"><div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between"><h3 class="text-sm font-bold text-slate-900">Period Transaction Details (${esc(
        report.period.label
      )})</h3><span class="font-mono-tech text-xs font-bold">${
      (report.transactions || []).length
    } Transactions</span></div><div class="overflow-x-auto"><table class="admin-table" data-testid="analytics-transactions-table"><thead><tr><th>Order #</th><th>Date</th><th>Customer</th><th>Product</th><th>Status</th><th class="text-right">Realized Revenue</th></tr></thead><tbody>${(
      report.transactions || []
    )
      .map(
        (t) =>
          `<tr><td class="font-mono-tech text-xs font-bold text-[#0095FF]">#${esc(
            t.orderNumber
          )}</td><td class="font-mono-tech text-xs">${esc(
            t.reportDate || t.completedAt || t.orderDate
          )}</td><td>${esc(t.clientName)}</td><td>${esc(t.furnitureName)}</td><td>${esc(
            t.normalizedStatus
          )}</td><td class="text-right font-mono-tech font-bold text-emerald-700">${usd(
            t.realizedRevenue
          )}</td></tr>`
      )
      .join('')}</tbody></table></div></section></div>`;

    analyticsEl.querySelectorAll('[data-analytics-preset]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.adminAnalyticsPreset = btn.getAttribute('data-analytics-preset') || 'this_month';
        renderAdminAnalyticsSection();
      })
    );
    analyticsEl.querySelectorAll('[data-analytics-quick-month]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const [yStr, mStr] = (btn.getAttribute('data-analytics-quick-month') || '2026-11').split('-');
        state.adminAnalyticsPreset = 'select_month';
        state.adminAnalyticsYear = yStr;
        state.adminAnalyticsMonth = String(Number(mStr));
        renderAdminAnalyticsSection();
      })
    );
    document.getElementById('analytics-overview-period-select')?.addEventListener('change', (e) => {
      const [yStr, mStr] = String(e.target.value || '2026-11').split('-');
      state.adminAnalyticsPreset = 'select_month';
      state.adminAnalyticsYear = yStr;
      state.adminAnalyticsMonth = String(Number(mStr));
      renderAdminAnalyticsSection();
    });
    document.getElementById('analytics-export-pdf-btn')?.addEventListener('click', () => {
      const pdfBytes = buildAnalyticsPdfBytes(report);
      const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `lillia-rowena-analytics-${String(report.period.label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
      a.click();
      showAdminBanner(`Downloaded PDF Report for ${report.period.label}.`);
    });
    document.getElementById('analytics-export-csv-btn')?.addEventListener('click', async () => {
      let csvText = '';
      const serverCsv = await syncDatabaseStore('export_analytics_csv', { filterInput });
      if (serverCsv?.ok && serverCsv.csv) csvText = serverCsv.csv;
      else csvText = buildAnalyticsCsvContent(report);
      const url = URL.createObjectURL(new Blob([csvText], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `lillia-rowena-analytics-${String(report.period.label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
      a.click();
      showAdminBanner(`Exported CSV Report for ${report.period.label}.`);
    });
    document.getElementById('analytics-print-report-btn')?.addEventListener('click', () => window.print());
  }

  return { initDashboardPage };
}
