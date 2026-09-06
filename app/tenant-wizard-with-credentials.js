/**
 * Tenant Creation Wizard With Credentials - For Logged-In Users
 * Follows Angular tenant-creation-form-with-credentials API flow
 * 
 * Dependencies:
 * - OAUTH_CONFIG (global)
 * - Stripe.js library (loaded via CDN)
 * - stripeService (from tenant-wizard.js or shared instance)
 */

// Reuse StripeService from tenant-wizard.js if available, otherwise create new instance
let stripeServiceWithCredentials;
if (typeof window.stripeService !== 'undefined') {
  stripeServiceWithCredentials = window.stripeService;
} else {
  // Stripe Service for PCI-compliant payment processing
  class StripeService {
    constructor() {
      this.stripe = null;
      this.elements = null;
      this.cardElement = null;
      this.stripePublicKey = null;
    }

    async initialize(stripePublicKey) {
      if (!stripePublicKey) {
        console.warn('⚠️ Stripe public key not provided. Stripe Elements will not work.');
        return false;
      }

      try {
        if (typeof Stripe === 'undefined') {
          console.error('❌ Stripe.js not loaded. Make sure https://js.stripe.com/v3/ is included.');
          return false;
        }

        this.stripePublicKey = stripePublicKey;
        this.stripe = Stripe(stripePublicKey);
        
        this.elements = this.stripe.elements({
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#ff6b35',
              colorBackground: '#ffffff',
              colorText: '#30313d',
              colorDanger: '#df1b41',
              fontFamily: 'system-ui, sans-serif',
              spacingUnit: '4px',
              borderRadius: '4px',
            },
          },
        });

        console.log('✅ Stripe initialized successfully');
        return true;
      } catch (error) {
        console.error('❌ Error initializing Stripe:', error);
        return false;
      }
    }

    async createCardElement(containerId) {
      if (!this.elements) {
        console.error('❌ Stripe Elements not initialized. Call initialize() first.');
        return null;
      }

      try {
        const container = document.getElementById(containerId);
        if (!container) {
          console.error(`❌ Container element not found: #${containerId}`);
          return null;
        }

        this.cardElement = this.elements.create('card', {
          style: {
            base: {
              fontSize: '16px',
              color: '#30313d',
              '::placeholder': {
                color: '#aab7c4',
              },
            },
            invalid: {
              color: '#df1b41',
              iconColor: '#df1b41',
            },
          },
        });

        this.cardElement.mount(`#${containerId}`);
        
        this.cardElement.on('change', (event) => {
          const errorElement = document.getElementById(`${containerId}-error`);
          if (errorElement) {
            if (event.error) {
              errorElement.textContent = event.error.message;
              errorElement.style.display = 'block';
            } else {
              errorElement.textContent = '';
              errorElement.style.display = 'none';
            }
          }
        });

        console.log('✅ Stripe card element created and mounted');
        return this.cardElement;
      } catch (error) {
        console.error('❌ Error creating card element:', error);
        return null;
      }
    }

    async createPaymentMethod(billingDetails) {
      if (!this.stripe || !this.cardElement) {
        return { paymentMethodId: null, error: { message: 'Stripe not initialized or card element not created' } };
      }

      try {
        const { paymentMethod, error } = await this.stripe.createPaymentMethod({
          type: 'card',
          card: this.cardElement,
          billing_details: billingDetails,
        });

        if (error) {
          return { paymentMethodId: null, error };
        }

        if (!paymentMethod) {
          return { paymentMethodId: null, error: { message: 'Failed to create payment method' } };
        }

        console.log('✅ Payment method created:', paymentMethod.id);
        return { paymentMethodId: paymentMethod.id };
      } catch (error) {
        console.error('❌ Error creating payment method:', error);
        return { paymentMethodId: null, error };
      }
    }

    unmountCardElement() {
      if (this.cardElement) {
        this.cardElement.unmount();
        this.cardElement = null;
        console.log('✅ Stripe card element unmounted');
      }
    }

    destroy() {
      this.unmountCardElement();
      this.elements = null;
      this.stripe = null;
      this.stripePublicKey = null;
    }
  }
  stripeServiceWithCredentials = new StripeService();
}

// Tenant Creation Wizard With Credentials - For Logged-In Users
class TenantCreationWizardWithCredentials {
  constructor() {
    this.state = {
      currentStep: 0,
      // User info (from authenticated account)
      account: null,
      accountId: null,
      customerId: null,
      openId: null,
      accessToken: null,
      settings: null,
      // Step 1: Tenant Info (NO email/password)
      tenantName: '',
      tenantDomain: '',
      region: '',
      // Step 2: Subscription
      selectedPrice: null,
      currency: null,
      priceTab: 'year',
      prices: [],
      monthlyPrices: [],
      yearlyPrices: [],
      usersPrices: [],
      monthlyUsersPrices: [],
      yearlyUsersPrices: [],
      totalAdminUsers: 0,
      dictionary: null,
      dictionaryPrices: [],
      databaseRegions: [],
      currencies: [],
      // Step 3: Payment
      cardElement: null,
      billingAddress: null,
      cardholderName: '',
      selectedPaymentMethod: null,
      paymentMethods: [],
      paymentMethodToken: null,
      stripePublicKey: null,
      hasDefaultPaymentMethod: false, // Track if user has default payment method
      // Process tracking
      processSteps: [],
      // Skip steps flag
      skipPayment: false, // Set to true if user has default payment method (skip payment step only)
      /** Stripe customer.currency when loaded; billing prices must match to avoid multi-currency errors */
      customerBillingCurrency: null,
      // UI State
      loading: false,
      error: null,
      validationError: null,
      // Fixed price from query param stripe_price
      fixedStripePriceId: null,
      // Coupon from query param coupon_id
      couponId: null
    };
  }

  extractOpenIdFromToken(token) {
    try {
      // base64url, not plain base64 — a raw atob() on an unmodified JWT segment throws
      // (or silently mis-decodes) whenever the payload happens to contain a '-' or '_', which
      // base64url uses in place of '+'/'/'. Keycloak's larger claim set makes this far more
      // likely to bite than it was against Auth0's smaller tokens.
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(b64));
      return payload.sub; // OpenID is typically in 'sub' claim
    } catch (error) {
      console.error('Failed to extract OpenID from token:', error);
      return null;
    }
  }

  async init(accessToken) {
    if (!accessToken) {
      throw new Error('Access token is required for logged-in user wizard');
    }

    this.state.accessToken = accessToken;
    this.state.openId = this.extractOpenIdFromToken(accessToken);

    // Read stripe_price query param
    const urlParams = new URLSearchParams(window.location.search);
    const stripePriceParam = urlParams.get('stripe_price') || sessionStorage.getItem('sd_config_stripe_price') || null;
    if (stripePriceParam) {
      if (!urlParams.has('code') && !urlParams.has('error')) {
        sessionStorage.setItem('sd_config_stripe_price', stripePriceParam);
      }
      this.state.fixedStripePriceId = stripePriceParam;
    }

    // Read coupon_id query param
    const couponIdParam = urlParams.get('coupon_id') || sessionStorage.getItem('sd_config_coupon_id') || null;
    if (couponIdParam) {
      if (!urlParams.has('code') && !urlParams.has('error')) {
        sessionStorage.setItem('sd_config_coupon_id', couponIdParam);
      }
      this.state.couponId = couponIdParam;
    }

    try {
      this.state.loading = true;
      this.state.customerBillingCurrency = null;
      this.render(); // Show loading state
      
      console.log('🔄 Phase 1: Loading initial data...');
      
      // Phase 1: Load initial data following Angular flow
      console.log('📡 [1/6] Loading account and settings...');
      await this.loadAccountAndSettings();
      console.log('✅ Account and settings loaded');
      
      console.log('📡 [2/6] Loading dictionary...');
      await this.loadDictionary();
      console.log('✅ Dictionary loaded');
      
      console.log('📡 [3/6] Loading prices...');
      await this.loadPrices();
      console.log('✅ Prices loaded');
      
      console.log('📡 [4/6] Loading regions and currencies...');
      await this.loadRegions();
      await this.loadCurrencies();
      console.log('✅ Regions and currencies loaded');
      
      // Load customer and payment methods if customerId exists
      console.log(`🔍 Checking customerId: ${this.state.customerId}`);
      if (this.state.customerId) {
        console.log('📡 [5/6] Loading customer details...');
        await this.loadCustomer();
        console.log('✅ Customer details loaded');
        
        console.log('📡 [6/6] Loading payment methods...');
        await this.loadPaymentMethods();
        console.log('✅ Payment methods loaded');
        
        // Check if user has default payment method - if yes, skip payment step only
        if (this.state.hasDefaultPaymentMethod && this.state.selectedPaymentMethod) {
          console.log('💳 Default payment method found - skipping payment step only');
          this.state.skipPayment = true;
        }
      } else {
        console.log('ℹ️ No customerId found in account - skipping customer and payment method loading');
        console.log('  Account object:', this.state.account);
      }
      
      console.log('📡 Loading Stripe public key...');
      await this.loadStripePublicKey();
      console.log('✅ Stripe public key loaded');

      this.syncWizardCurrency();
      if (this.state.fixedStripePriceId) {
        await this.loadFixedStripePrice();
      } else {
        this.applyDefaultSubscriptionSelection();
      }

      console.log('✅ Phase 1 complete - all initial data loaded');
      this.state.loading = false;
      
      // Render wizard
      this.render();
    } catch (error) {
      console.error('❌ Error initializing wizard:', error);
      this.state.loading = false;
      this.state.error = error.message || 'Failed to initialize wizard';
      this.render();
      throw error;
    }
  }

  async loadAccountAndSettings() {
    try {
      const userApi = window.sdHosts().api + '/api/v1/users';

      // GET /accounts/open-id/{openId} - REQUIRES access token
      if (!this.state.openId) {
        throw new Error('OpenID is required to load account');
      }
      
      console.log(`  → GET ${userApi}/accounts/open-id/${this.state.openId}`);
      const accountResponse = await fetch(`${userApi}/accounts/open-id/${this.state.openId}`, {
        headers: {
          'Authorization': `Bearer ${this.state.accessToken}`,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        }
      });

      if (accountResponse.ok) {
        const account = await accountResponse.json();
        this.state.account = account;
        this.state.accountId = account.id;
        this.state.customerId = account.customerId || account.customer_id || null;
        console.log(`  ✓ Account loaded: ${account.username || account.email || 'N/A'} (ID: ${account.id}, CustomerID: ${this.state.customerId || 'none'})`);
        
        // Debug: Log account object to see all fields
        if (!this.state.customerId) {
          console.log('  🔍 Account object keys:', Object.keys(account));
          console.log('  🔍 Account object:', JSON.stringify(account, null, 2));
        }

        // GET /accounts/account-id/{accountId}/settings
        if (this.state.accountId) {
          console.log(`  → GET ${userApi}/accounts/account-id/${this.state.accountId}/settings`);
          const settingsResponse = await fetch(`${userApi}/accounts/account-id/${this.state.accountId}/settings`, {
            headers: {
              'Authorization': `Bearer ${this.state.accessToken}`,
              'Content-Type': 'application/json',
              'accept': 'application/json'
            }
          });

          if (settingsResponse.ok) {
            this.state.settings = await settingsResponse.json();
            console.log(`  ✓ Settings loaded (locale: ${this.state.settings?.preferredLanguage || 'default'})`);
          } else {
            console.warn(`  ⚠ Settings not found (${settingsResponse.status}), using defaults`);
            // Set default settings if not found
            this.state.settings = { preferredLanguage: 'en-CA' };
          }
        }
      } else {
        // If account doesn't exist, extract info from token and create minimal account object
        console.warn(`  ⚠ Account not found (${accountResponse.status}), extracting info from token`);
        try {
          // base64url normalization — see extractOpenIdFromToken for why this matters more
          // under Keycloak than it did against Auth0.
          const b64 = this.state.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const tokenPayload = JSON.parse(atob(b64));
          console.log('  🔍 Token payload fields:', Object.keys(tokenPayload));

          // Try multiple possible email fields. `preferred_username` covers Keycloak realms
          // where the email claim mapper is disabled on the access token (email is often the
          // username there); the https://sidedrawer.com/* namespaced claims are Auth0-specific
          // and only ever populated by that provider.
          const email = tokenPayload.email ||
                       tokenPayload.preferred_username ||
                       tokenPayload['https://sidedrawer.com/email'] ||
                       tokenPayload['https://sidedrawer.com/user_metadata']?.email ||
                       tokenPayload['https://sidedrawer.com/app_metadata']?.email ||
                       tokenPayload.sub?.includes('@') ? tokenPayload.sub : '';
          
          // Try multiple possible name fields
          const firstName = tokenPayload.given_name || 
                           tokenPayload['https://sidedrawer.com/firstName'] ||
                           tokenPayload['https://sidedrawer.com/user_metadata']?.firstName ||
                           tokenPayload.name?.split(' ')[0] || '';
          const lastName = tokenPayload.family_name || 
                          tokenPayload['https://sidedrawer.com/lastName'] ||
                          tokenPayload['https://sidedrawer.com/user_metadata']?.lastName ||
                          tokenPayload.name?.split(' ').slice(1).join(' ') || '';
          
          this.state.account = {
            id: null,
            openId: this.state.openId,
            username: email || this.state.openId,
            email: email || '',
            firstName: firstName,
            lastName: lastName,
            customerId: null
          };
          this.state.settings = { preferredLanguage: 'en-CA' };
          console.log(`  ✓ Using token info: ${email || this.state.openId} (${firstName} ${lastName})`);
        } catch (tokenError) {
          console.error('  ✗ Failed to extract info from token:', tokenError);
          // Create minimal account with just openId
          this.state.account = {
            id: null,
            openId: this.state.openId,
            username: this.state.openId,
            email: '',
            firstName: '',
            lastName: '',
            customerId: null
          };
          this.state.settings = { preferredLanguage: 'en-CA' };
          console.log(`  ⚠ Using minimal account info (openId only): ${this.state.openId}`);
        }
      }
    } catch (error) {
      console.error('❌ Error loading account:', error);
      throw error;
    }
  }

  async loadDictionary() {
    try {
      const localeId = this.state.settings?.preferredLanguage || 'en-CA';
      const apiUrl = `${window.sdHosts().api}/api/v1/configs/content/dictionaries/console_20210501/locale/${localeId}`;

      console.log(`  → GET ${apiUrl}`);
      const response = await fetch(apiUrl);
      if (response.ok) {
        const data = await response.json();
        this.state.dictionary = data;
        this.state.databaseRegions = this.mergeDictionaryDatabaseRegions(data);
        const rawCurrencies = data.collections?.currencies || [];
        this.state.currencies = Array.isArray(rawCurrencies) 
          ? rawCurrencies.filter(c => c && c.enabled === true && c.currency) 
          : [];
        if (data.collections?.prices) {
          this.state.dictionaryPrices = data.collections.prices;
        }
        console.log(`  ✓ Dictionary loaded (${this.state.databaseRegions.length} regions, ${this.state.currencies.length} currencies)`);
      } else {
        console.error(`  ✗ Failed to load dictionary: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to load dictionary: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Error loading dictionary:', error);
      throw error;
    }
  }

  async loadPrices() {
    try {
      const apiUrl = window.sdHosts().api + '/api/v1/subscriptions/prices';

      const headers = {
        'Content-Type': 'application/json'
      };
      if (this.state.accessToken) {
        headers['Authorization'] = `Bearer ${this.state.accessToken}`;
      }

      console.log(`  → GET ${apiUrl}`);
      const response = await fetch(apiUrl, { headers });
      if (response.ok) {
        const prices = await response.json();
        this.state.prices = Array.isArray(prices) ? prices.filter(p => p.active === true) : [];
        console.log(`  ✓ Prices loaded (${this.state.prices.length} active prices)`);
        if (this.state.currency) {
          this.updatePriceLists();
        }
      } else {
        console.error(`  ✗ Failed to load prices: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to load prices: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Error loading prices:', error);
      throw error;
    }
  }

  /**
   * When stripe_price query param is present, resolve that specific price.
   * Looks it up in the already-loaded prices list first; falls back to a direct
   * GET /subscriptions/prices/:id call so inactive or unlisted prices still work.
   */
  async loadFixedStripePrice() {
    const priceId = this.state.fixedStripePriceId;
    if (!priceId) return;

    let price = (this.state.prices || []).find(p => p.id === priceId);

    if (!price) {
      try {
        const apiBase = window.sdHosts().api + '/api/v1';
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.accessToken}`
        };
        const response = await fetch(`${apiBase}/subscriptions/prices/price-id/${encodeURIComponent(priceId)}`, { headers });
        if (response.ok) {
          price = await response.json();
        } else {
          console.warn(`⚠ stripe_price "${priceId}" not found (${response.status})`);
        }
      } catch (e) {
        console.error('❌ Error fetching fixed stripe price:', e);
      }
    }

    if (price) {
      this.state.selectedPrice = price;
      if (price.currency) {
        this.state.currency = price.currency.toLowerCase();
        this.updatePriceLists();
      }
      const minUsers = parseInt(price.metadata?.['product.startingUsers'] || '0', 10);
      if (!this.state.totalAdminUsers || this.state.totalAdminUsers < Math.max(1, minUsers)) {
        this.state.totalAdminUsers = Math.max(1, minUsers || 1);
      }
    } else {
      console.warn(`⚠ Falling back to default price selection (stripe_price "${priceId}" could not be loaded)`);
      this.applyDefaultSubscriptionSelection();
    }
  }

  mergeDictionaryDatabaseRegions(data) {
    const col = data?.collections || {};
    const a = col.databaseregions;
    const b = col.databaseRegions;
    const parts = [];
    if (Array.isArray(a)) parts.push(...a);
    if (Array.isArray(b)) parts.push(...b);
    return parts;
  }

  getRegionDatabaseregion(region) {
    if (region == null || region === '') return '';
    if (typeof region === 'string') {
      const s = region.trim();
      if (!s || s === 'undefined' || s === 'null') return '';
      return s;
    }
    const tryVal = (v) => {
      if (v == null) return '';
      const s = String(v).trim();
      if (!s || s === 'undefined' || s === 'null') return '';
      return s;
    };
    const primary =
      tryVal(region.databaseregion) ||
      tryVal(region.databaseRegion) ||
      tryVal(region.DatabaseRegion) ||
      tryVal(region.dataBaseRegion) ||
      tryVal(region.data_base_region) ||
      tryVal(region.regionKey) ||
      tryVal(region.slug) ||
      tryVal(region.value) ||
      tryVal(region.regionId);
    if (primary) return primary;
    const code = tryVal(region.code) || tryVal(region.regionCode);
    if (code) return code;
    const cc = this.getRegionCountryCode(region);
    if (cc && /^[A-Za-z]{2}$/.test(cc)) return cc.toUpperCase();
    if (region._id != null) {
      const id = tryVal(region._id);
      if (id) return id;
    }
    if (region.id != null && region.id !== region._id) {
      const id = tryVal(region.id);
      if (id) return id;
    }
    return '';
  }

  getRegionCountryCode(region) {
    if (!region) return undefined;
    const cc = region.countrycode ?? region.countryCode;
    if (cc == null) return undefined;
    const t = String(cc).trim();
    return t.length ? t : undefined;
  }

  /**
   * The value POSTed as `region`: the CMS `databaseregion`, verbatim.
   * Deliberately has NO countrycode/code/_id fallback, unlike getRegionDatabaseregion
   * (which resolves the <option> value). An empty string is a real, meaningful value
   * here — it means the primary data region — and is what both the CMS default row
   * and Canada carry.
   */
  getRegionWireValue(region) {
    if (region == null) return '';
    if (typeof region === 'string') {
      const s = region.trim();
      return !s || s === 'undefined' || s === 'null' ? '' : s;
    }
    const tryVal = (v) => {
      if (v == null) return '';
      const s = String(v).trim();
      return !s || s === 'undefined' || s === 'null' ? '' : s;
    };
    return (
      tryVal(region.databaseregion) ||
      tryVal(region.databaseRegion) ||
      tryVal(region.DatabaseRegion) ||
      tryVal(region.dataBaseRegion) ||
      tryVal(region.data_base_region) ||
      ''
    );
  }

  /** Wire value for whatever the region <select> currently holds. */
  getSelectedRegionWireValue() {
    return this.getRegionWireValue(this.findRegionRowBySelectValue(this.state.region));
  }

  /** Dropdown label: country name, else the region slug, else the blank CMS default row. */
  getRegionOptionLabel(region) {
    const cc = this.getRegionCountryCode(region);
    if (cc) return this.getCountryName(cc);
    return this.getRegionWireValue(region) || 'Default';
  }

  buildRegionSelectOptions() {
    const rows = this.state.databaseRegions || [];
    const seen = new Set();
    const out = [];
    rows.forEach((region, index) => {
      let v = this.getRegionDatabaseregion(region);
      if (!v) return;
      if (seen.has(v)) {
        const alt = region._id != null ? String(region._id).trim() : '';
        v = alt && !seen.has(alt) ? alt : `${v}#${index}`;
      }
      let guard = 0;
      while (seen.has(v) && guard < 20) {
        v = `${v}_${index}_${guard}`;
        guard += 1;
      }
      seen.add(v);
      out.push({ value: v, region });
    });
    return out;
  }

  findRegionRowBySelectValue(selectValue) {
    const id = String(selectValue || '').trim();
    if (!id) return undefined;
    return this.buildRegionSelectOptions().find(o => o.value === id)?.region;
  }

  isKnownDatabaseRegion(regionId) {
    const id = String(regionId || '').trim();
    if (!id) return false;
    return this.buildRegionSelectOptions().some(o => o.value === id);
  }

  syncRegionFromSelect() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('region-select');
    if (!el) return;
    const v = String(el.value || '').trim();
    if (v && this.isKnownDatabaseRegion(v)) {
      this.state.region = v;
      this.clearError('region-error');
    }
  }

  /**
   * Preselect the region the CMS marks as default (`isdefault: true` in the
   * databaseregions collection) instead of assuming Canada. That row is intentionally
   * blank — no countrycode, empty databaseregion — so it is identified by its row id
   * and resolves to an empty wire value meaning "the primary data region".
   */
  async loadRegions() {
    const options = this.buildRegionSelectOptions();
    if (!options.length) return;
    const current = String(this.state.region ?? '').trim();
    if (current && options.some(o => o.value === current)) {
      this.state.region = current;
      return;
    }
    const defaultOption = options.find(
      o => o.region && (o.region.isdefault === true || o.region.isDefault === true)
    );
    this.state.region = (defaultOption || options[0]).value;
  }

  async loadCurrencies() {
    if (this.state.currencies.length > 0) {
      this.syncWizardCurrency();
    }
  }

  getPriceUnitAmount(price) {
    if (!price) return 0;
    if (price.tiers && price.tiers.length > 0) {
      return price.tiers[0].flat_amount ?? 0;
    }
    return price.amount ?? 0;
  }

  syncCurrencyFromRegion() {
    const validCurrencies = this.state.currencies.filter(c => c && c.currency && c.enabled);
    if (validCurrencies.length === 0) {
      this.state.currency = null;
      this.updatePriceLists();
      return;
    }
    const regionRow = this.findRegionRowBySelectValue(this.state.region);
    const countryCode = regionRow ? this.getRegionCountryCode(regionRow) : undefined;
    let next;
    if (countryCode === 'CA' && validCurrencies.some(c => c.currency.toLowerCase() === 'cad')) {
      next = 'cad';
    } else if (countryCode === 'US' && validCurrencies.some(c => c.currency.toLowerCase() === 'usd')) {
      next = 'usd';
    } else {
      const usdCurrency = validCurrencies.find(c => c.currency && c.currency.toLowerCase() === 'usd');
      next = (usdCurrency ? usdCurrency.currency : validCurrencies[0].currency).toLowerCase();
    }
    this.state.currency = next;
    this.updatePriceLists();
  }

  /**
   * Prefer Stripe customer currency when present (locked customer); else region-based currency.
   */
  syncWizardCurrency() {
    const locked = this.state.customerBillingCurrency;
    if (locked) {
      const validCurrencies = this.state.currencies.filter(c => c && c.currency && c.enabled);
      const match = validCurrencies.find(
        c => c.currency && c.currency.toLowerCase() === String(locked).toLowerCase()
      );
      if (match) {
        this.state.currency = match.currency.toLowerCase();
        this.updatePriceLists();
        return;
      }
    }
    this.syncCurrencyFromRegion();
  }

  applyDefaultSubscriptionSelection() {
    this.state.priceTab = 'year';
    this.updatePriceLists();
    const candidates = this.state.yearlyUsersPrices || [];
    if (candidates.length === 0) {
      this.state.selectedPrice = null;
      return;
    }
    let chosen = null;
    for (const price of candidates) {
      const dp = this.getDictionaryPrice(price.id);
      if (dp && /business/i.test(dp.name || '')) {
        chosen = price;
        break;
      }
    }
    if (!chosen) {
      chosen = candidates.reduce(
        (best, p) => (this.getPriceUnitAmount(p) > this.getPriceUnitAmount(best) ? p : best),
        candidates[0]
      );
    }
    this.state.selectedPrice = chosen;
    const minUsers = parseInt(chosen.metadata?.['product.startingUsers'] || '0', 10);
    if (this.state.totalAdminUsers < minUsers) {
      this.state.totalAdminUsers = minUsers;
    }
    if (!this.state.totalAdminUsers || this.state.totalAdminUsers < 1) {
      this.state.totalAdminUsers = Math.max(1, minUsers || 1);
    }
  }

  async loadCustomer() {
    if (!this.state.customerId) {
      this.state.customerBillingCurrency = null;
      return;
    }

    try {
      const apiUrl = `${window.sdHosts().api}/api/v1/subscriptions/customers/customer-id/${this.state.customerId}`;

      console.log(`  → GET ${apiUrl}`);
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${this.state.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const customer = await response.json();
        console.log(`  ✓ Customer loaded (ID: ${customer.id}, currency: ${customer?.currency || 'none'})`);
        this.state.customerBillingCurrency = customer?.currency
          ? String(customer.currency).toLowerCase().trim() || null
          : null;
      } else {
        this.state.customerBillingCurrency = null;
        console.warn(`  ⚠ Failed to load customer: ${response.status} ${response.statusText} (may not exist yet)`);
      }
    } catch (error) {
      this.state.customerBillingCurrency = null;
      console.error('❌ Error loading customer:', error);
      // Don't throw - customer might not exist yet
    }
  }

  async loadPaymentMethods() {
    if (!this.state.customerId) return;

    try {
      const apiUrl = `${window.sdHosts().api}/api/v1/subscriptions/customers/customer-id/${this.state.customerId}/payment-methods`;

      console.log(`  → GET ${apiUrl}`);
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${this.state.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const paymentMethods = await response.json();
        this.state.paymentMethods = Array.isArray(paymentMethods) 
          ? paymentMethods.map(pm => ({ ...pm, isDefault: pm.default }))
          : [];
        
        console.log(`  ✓ Payment methods loaded (${this.state.paymentMethods.length} methods)`);
        
        // Set default payment method if available
        const defaultPm = this.state.paymentMethods.find(pm => pm.isDefault || pm.default);
        if (defaultPm) {
          this.state.selectedPaymentMethod = defaultPm;
          this.state.hasDefaultPaymentMethod = true;
          console.log(`  💳 Default payment method found: ${defaultPm.card?.brand || 'card'} •••• ${defaultPm.card?.last4 || ''}`);
        } else {
          console.log(`  ℹ️ No default payment method found`);
        }
      } else {
        console.warn(`  ⚠ Failed to load payment methods: ${response.status} ${response.statusText} (may not exist yet)`);
      }
    } catch (error) {
      console.error('❌ Error loading payment methods:', error);
      // Don't throw - payment methods might not exist yet
    }
  }

  async loadStripePublicKey() {
    try {
      // Try subscription API endpoint first
      const subscriptionApi = window.sdHosts().api + '/api/v1/subscriptions';
      
      try {
        console.log(`  → GET ${subscriptionApi}/subscriptions/public-key`);
        const response = await fetch(`${subscriptionApi}/subscriptions/public-key`, {
          headers: {
            'Authorization': `Bearer ${this.state.accessToken}`,
            'Content-Type': 'application/json'
          }
        });
        if (response.ok) {
          const data = await response.json();
          this.state.stripePublicKey = data.publicKey || data.stripePublicKey || data.key || null;
          console.log(`  ✓ Stripe public key loaded from API`);
        } else {
          console.error(`  ✗ Stripe public key endpoint failed (${response.status}) — payment step unavailable`);
          this.state.stripePublicKey = null;
        }
      } catch (e) {
        console.error(`  ✗ Stripe public key fetch error — payment step unavailable:`, e);
        this.state.stripePublicKey = null;
      }
    } catch (error) {
      console.error(`  ✗ Stripe public key error — payment step unavailable:`, error);
      this.state.stripePublicKey = null;
    }
  }

  updatePriceLists() {
    const currency = this.state.currency;
    if (!currency) {
      this.state.monthlyPrices = [];
      this.state.yearlyPrices = [];
      this.state.monthlyUsersPrices = [];
      this.state.yearlyUsersPrices = [];
      return;
    }

    const prosPrices = this.state.prices.filter(p => {
      if (!p.active) return false;
      if (!p.metadata) return false;
      return p.metadata['product.audience'] === 'pros';
    });

    const usersPrices = this.state.prices.filter(p => {
      if (!p.active) return false;
      if (!p.metadata) return false;
      return p.metadata['product.audience'] === 'users';
    });
    this.state.usersPrices = usersPrices;

    this.state.monthlyPrices = prosPrices.filter(
      p => p.interval === 'month' && 
           p.currency && p.currency.toLowerCase() === currency.toLowerCase()
    );

    const yearlyProsPrices = prosPrices.filter(
      p => p.interval === 'year' && 
           p.currency && p.currency.toLowerCase() === currency.toLowerCase()
    );

    this.state.monthlyUsersPrices = usersPrices.filter(
      p => p.interval === 'month' && 
           p.currency && p.currency.toLowerCase() === currency.toLowerCase()
    );

    this.state.yearlyUsersPrices = usersPrices.filter(
      p => p.interval === 'year' && 
           p.currency && p.currency.toLowerCase() === currency.toLowerCase()
    );

    if (yearlyProsPrices.length === 0) {
      const retailPrices = this.state.prices.filter(p => {
        if (!p.active) return false;
        if (!p.metadata) return false;
        return p.metadata['product.audience'] === 'retail';
      });
      
      this.state.yearlyPrices = retailPrices.filter(
        p => p.interval === 'year' && 
             p.currency && p.currency.toLowerCase() === currency.toLowerCase()
      );
    } else {
      this.state.yearlyPrices = yearlyProsPrices;
    }
  }

  render() {
    let wizardContainer = document.getElementById('tenant-wizard');
    if (!wizardContainer) {
      wizardContainer = document.createElement('div');
      wizardContainer.id = 'tenant-wizard';
      wizardContainer.style.display = 'none';
      const container = document.querySelector('.container');
      if (container) {
        container.appendChild(wizardContainer);
      } else {
        document.body.appendChild(wizardContainer);
      }
    }

    const appContent = document.getElementById('app-content');
    if (appContent) {
      appContent.style.display = 'none';
    }
    wizardContainer.style.display = 'block';

    wizardContainer.innerHTML = `
      <div class="tenant-wizard">
        <div class="wizard-header">
          <h1>${this.getDictionaryValue('tenantsetup_formtitle') || 'Create Your Business Account'}</h1>
          <p>${this.getDictionaryValue('tenantsetup_formdescription') || 'Set up your SideDrawer account in a few simple steps'}</p>
        </div>

        <div class="wizard-stepper">
          <div class="wizard-step ${this.state.currentStep === 0 ? 'active' : this.state.currentStep > 0 ? 'completed' : ''}">
            <div class="wizard-step-circle">${this.state.currentStep > 0 ? '✓' : '1'}</div>
            <div class="wizard-step-label">${this.getDictionaryValue('tenantsetupname_steptitle') || 'Business Info'}</div>
          </div>
          ${!this.state.skipPayment ? `
          <div class="wizard-step ${this.state.currentStep === 1 ? 'active' : this.state.currentStep > 1 ? 'completed' : ''}">
            <div class="wizard-step-circle">${this.state.currentStep > 1 ? '✓' : '2'}</div>
            <div class="wizard-step-label">${this.getDictionaryValue('tenantsetuppayment_steptitle') || 'Payment'}</div>
          </div>
          <div class="wizard-step ${this.state.currentStep === 2 ? 'active' : this.state.currentStep > 2 ? 'completed' : ''}">
            <div class="wizard-step-circle">${this.state.currentStep > 2 ? '✓' : '3'}</div>
            <div class="wizard-step-label">${this.getDictionaryValue('tenantsignupsummary_steptitle') || 'Summary'}</div>
          </div>
          ` : `
          <div class="wizard-step ${this.state.currentStep === 1 ? 'active' : this.state.currentStep > 1 ? 'completed' : ''}">
            <div class="wizard-step-circle">${this.state.currentStep > 1 ? '✓' : '2'}</div>
            <div class="wizard-step-label">${this.getDictionaryValue('tenantsignupsummary_steptitle') || 'Summary'}</div>
          </div>
          `}
        </div>

        <div class="wizard-content">
          ${this.renderStep()}
        </div>

        <div class="wizard-footer">
          ${this.state.currentStep > 0 ? `<button class="btn" onclick="tenantWizardWithCredentials.previousStep()">${this.getDictionaryValue('globalparams_back') || 'Back'}</button>` : '<div></div>'}
          <button class="btn btn-success" ${this.state.loading ? 'disabled' : ''} id="wizard-next-button">
            ${(this.state.skipPayment && this.state.currentStep === 1) || (!this.state.skipPayment && this.state.currentStep === 2)
              ? (this.getDictionaryValue('tenantsetuppayment_primarybutton') || 'Create Account')
              : (this.getDictionaryValue('globalparams_next') || 'Next')}
          </button>
        </div>
      </div>
    `;

    this.attachListeners();
  }

  renderStep() {
    if (this.state.currentStep === 0) {
      return this.renderStep1();
    }
    if (this.state.skipPayment) {
      if (this.state.currentStep === 1) {
        return this.renderStep4();
      }
      return '';
    }
    if (this.state.currentStep === 1) {
      return this.renderStep3();
    }
    if (this.state.currentStep === 2) {
      return this.renderStep4();
    }
    return '';
  }

  renderStep1() {
    const dict = this.state.dictionary || {};
    
    return `
      ${this.state.validationError ? `<div class="validation-error">${this.state.validationError}</div>` : ''}
      
      <div class="wizard-form-group">
        <label class="wizard-form-label">${dict.tenantsetupname_tenantname || 'Business Name'}</label>
        <input 
          type="text" 
          class="wizard-form-input" 
          id="tenant-name-input"
          placeholder="${dict.tenantsetupname_tenantnameplaceholder || 'Enter your business name'}"
          value="${this.state.tenantName || ''}"
        />
        <div class="wizard-form-error" id="tenant-name-error"></div>
      </div>

      <div class="wizard-form-group">
        <label class="wizard-form-label">${dict.tenantsetupname_tenantsubdomain || 'Domain'}</label>
        <div class="domain-input-wrapper">
          <input 
            type="text" 
            class="wizard-form-input domain-input-flex" 
            id="tenant-domain-input"
            placeholder="${dict.tenantsetupname_tenantsubdomainplaceholder || 'your-domain'}"
            value="${this.state.tenantDomain || ''}"
          />
          <span class="domain-suffix">.sidedrawer.com</span>
        </div>
        <div class="wizard-form-error" id="tenant-domain-error"></div>
      </div>

      <div class="wizard-form-group">
        <label class="wizard-form-label">${dict.tenantsetupname_tenantregion || 'Region'}</label>
        <select class="wizard-form-select" id="region-select">
          <option value="">${dict.tenantsetupname_tenantregionplaceholder || 'Select region'}</option>
          ${this.buildRegionSelectOptions().map(({ value: rid, region }) => {
            const sel = String(this.state.region || '').trim() === rid ? 'selected' : '';
            const label = this.getRegionOptionLabel(region);
            return `
            <option value="${rid}" ${sel}>
              ${label}
            </option>`;
          }).join('')}
        </select>
        <div class="wizard-form-error" id="region-error"></div>
      </div>

      <div class="wizard-form-group">
        <label class="wizard-form-label">${dict.tenantsignupsubscription_selectusers || 'Total Admin Users'}</label>
        <input
          type="number"
          id="total-admin-users-input"
          class="wizard-form-input"
          placeholder="${dict.tenantsignupsubscription_userslabel || 'Number of users'}"
          value="${this.state.totalAdminUsers || ''}"
          min="0"
        />
        <div class="wizard-form-error" id="users-error"></div>
      </div>
    `;
  }

  renderStep3() {
    const dict = this.state.dictionary || {};
    
    return `
      ${this.state.validationError ? `<div class="validation-error">${this.state.validationError}</div>` : ''}
      
      ${this.state.paymentMethods.length > 0 ? `
        <div class="mb-24">
          <label class="wizard-form-label">${dict.paymentdetails_selectpaymentmethod || 'Select Payment Method'}</label>
          ${this.state.paymentMethods.map(pm => `
            <div 
              class="price-card payment-method-card ${this.state.selectedPaymentMethod?.id === pm.id ? 'selected' : ''}"
              onclick="tenantWizardWithCredentials.selectPaymentMethod('${pm.id}')"
            >
              <div class="payment-method-info">
                <div>
                  <strong>${pm.card?.brand || (dict.paymentdetails_card || 'Card')} •••• ${pm.card?.last4 || ''}</strong>
                  <div class="payment-method-details">${this.formatCardExpiryLine(dict, pm.card)}</div>
                </div>
                ${this.state.selectedPaymentMethod?.id === pm.id ? '<span>✓</span>' : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="mb-24">
        <label class="wizard-form-label">${dict.paymentdetails_addnewcard || 'Add New Payment Method'}</label>
        
        ${this.state.stripePublicKey ? `
          <div class="stripe-card-element-container">
            <div id="card-element"></div>
            <div id="card-element-error" class="stripe-error"></div>
          </div>
        ` : `
          <div class="validation-error">
            ${dict.paymentdetails_stripenotconfigured || 'Stripe is not configured. Please contact support.'}
          </div>
        `}

        <div class="wizard-form-group wizard-form-group-spaced">
          <label class="wizard-form-label">${dict.paymentdetails_addnewcardname || 'Cardholder Name'}</label>
          <input 
            type="text" 
            class="wizard-form-input" 
            id="cardholder-name-input"
            placeholder="${dict.paymentdetails_addnewcardnameplaceholder || 'John Doe'}"
            value="${this.state.cardholderName || ''}"
          />
        </div>

        <div class="billing-address-section">
          <label class="wizard-form-label">${dict.paymentdetails_addnewcardbillingaddress || 'Billing Address'}</label>
          <button class="btn btn-full-width" onclick="tenantWizardWithCredentials.showBillingAddressDialog()">
            ${this.state.billingAddress 
              ? (dict.paymentdetails_updatebillingaddress || 'Update Billing Address')
              : (dict.paymentdetails_addbillingaddress || 'Add Billing Address')}
          </button>
          ${this.state.billingAddress ? `
            <div class="billing-address-display">
              ${this.state.billingAddress.line1}<br>
              ${this.state.billingAddress.city}, ${this.state.billingAddress.state} ${this.state.billingAddress.postalCode}<br>
              ${this.state.billingAddress.country}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderStep4() {
    const dict = this.state.dictionary || {};
    
    if (!this.state.selectedPrice) {
      return `<div class="validation-error">No subscription plan selected. Please go back and select a plan.</div>`;
    }
    
    const dictPrice = this.getDictionaryPrice(this.state.selectedPrice.id);
    const currencyObj = this.state.currencies.find(c => c && c.currency && c.currency.toLowerCase() === this.state.selectedPrice.currency?.toLowerCase());
    const currencySymbol = currencyObj?.symbol || (this.state.selectedPrice.currency === 'usd' ? '$' : this.state.selectedPrice.currency === 'cad' ? 'C$' : '');
    const currencyLabel = currencyObj?.isoLabel || this.state.selectedPrice.currency?.toUpperCase() || '';
    
    const pricePerUnit = dictPrice ? (dictPrice.pricePerUnit / 100) : ((this.state.selectedPrice.tiers && this.state.selectedPrice.tiers.length > 0 ? this.state.selectedPrice.tiers[0].flat_amount : this.state.selectedPrice.amount) / 100);
    const listPricePerUnit = dictPrice?.listPricePerUnit ? (dictPrice.listPricePerUnit / 100) : null;
    const users = this.state.totalAdminUsers || 0;
    const isYearly = this.state.selectedPrice.interval === 'year';
    const total = isYearly ? pricePerUnit * users * 12 : pricePerUnit * users;
    
    // Show loading/progress if tenant creation is in progress
    if (this.state.loading) {
      const processStepsHtml = this.state.processSteps.map(step => {
        let statusIcon = '○';
        let statusClass = 'pending';
        if (step.status === 'success') {
          statusIcon = '✓';
          statusClass = 'success';
        } else if (step.status === 'processing') {
          statusIcon = '⟳';
          statusClass = 'processing';
        } else if (step.status === 'error') {
          statusIcon = '✗';
          statusClass = 'error';
        }
        return `
          <div class="process-step ${statusClass}">
            <span class="process-step-icon">${statusIcon}</span>
            <span class="process-step-label">${this.getProcessStepLabel(step.key)}</span>
          </div>
        `;
      }).join('');
      
      return `
        <div class="tenant-creation-form-price-selected-resume">
          <div class="process-progress">
            <h3>Creating your account...</h3>
            <div class="process-steps">
              ${processStepsHtml}
            </div>
            ${this.state.validationError ? `<div class="validation-error mt-20">${this.state.validationError}</div>` : ''}
          </div>
        </div>
      `;
    }
    
    // Show payment method info if payment step was skipped
    const paymentMethodInfo = this.state.skipPayment && this.state.selectedPaymentMethod ? `
      <div class="mb-24">
        <h4>${dict.paymentdetails_selectpaymentmethod || 'Payment Method'}</h4>
        <div class="payment-method-display">
          <strong>${this.state.selectedPaymentMethod.card?.brand || (dict.paymentdetails_card || 'Card')} •••• ${this.state.selectedPaymentMethod.card?.last4 || ''}</strong>
          <div class="payment-method-details">${this.formatCardExpiryLine(dict, this.state.selectedPaymentMethod.card)}</div>
        </div>
      </div>
    ` : '';
    
    return `
      ${this.state.validationError ? `<div class="validation-error">${this.state.validationError}</div>` : ''}
      ${paymentMethodInfo}
      <div class="tenant-creation-form-price-selected-resume">
        <div class="tenant-creation-form-price-selected-resume-title">
          <h2>${dictPrice?.name || this.state.selectedPrice.id}</h2>
          ${this.state.fixedStripePriceId ? `
            <div class="tenant-creation-form-price-selected-chip">
              <p>${dict.tenantsignupsummary_fixedpricelabel || 'Pre-selected plan'}</p>
            </div>
          ` : ''}
        </div>
        <p class="tenant-creation-form-price-selected-price">
          ${listPricePerUnit ? `<span class="tenant-creation-form-price-selected-list-price">${currencySymbol}${listPricePerUnit.toFixed(2)}</span>` : ''}
          <span>${currencySymbol}${pricePerUnit.toFixed(2)}</span>
          <span class="tenant-creation-form-price-selected-price">${currencyLabel}</span>
          <span class="tenant-creation-form-price-selected-description">/${isYearly ? 'user/year' : 'user/month'}</span>
        </p>
        <hr class="hr-separator" />
        <h3 class="tenant-creation-form-price-selected-resume-section-title">
          ${dict.tenantsignupsummary_tabletitle?.replace('[[frequency]]', isYearly ? (dict.tenantsignupsubscription_yearlytab || 'yearly').toLowerCase() : (dict.tenantsignupsubscription_monthlytab || 'monthly').toLowerCase()) || 'Recurring ' + (isYearly ? 'yearly' : 'monthly') + ' cost'}
        </h3>
        <div class="tenant-creation-form-price-selected-resume-section-line">
          <span class="tenant-creation-form-price-selected-resume-section-line-title">Subscription</span>
          <span class="tenant-creation-form-price-selected-resume-section-line-amount">
            ${currencySymbol}${total.toFixed(2)} ${currencyLabel}
          </span>
          <p class="tenant-creation-form-price-selected-resume-section-line-description">
            ${currencySymbol}${pricePerUnit.toFixed(2)} ${currencyLabel} x ${users} users${isYearly ? ' x 12' : ''}
          </p>
        </div>
        <hr class="hr-separator" />
        <div class="tenant-creation-form-price-selected-total-section-line">
          <span class="tenant-creation-form-price-selected-total-section-line-title">
            ${dict.tenantsignupsummary_tabletotallabel || "Today's total"}
          </span>
          <span class="tenant-creation-form-price-selected-total-section-line-amount">
            ${currencySymbol}${total.toFixed(2)} ${currencyLabel}
          </span>
        </div>
      </div>
    `;
  }

  getProcessStepLabel(stepKey) {
    const labels = {
      'customerId': 'Creating customer account',
      'paymentMethod': 'Setting up payment method',
      'createTenant': 'Creating tenant',
      'refreshToken': 'Refreshing authentication',
      'createSubscription': 'Creating subscription',
      'getSubscriptionLicenses': 'Getting licenses',
      'assignLicenseToTenantOwner': 'Assigning license',
      'setDefaultParamsForBranding': 'Configuring branding',
      'syncTenantMessages': 'Syncing messages',
      'createOwnerSideDrawer': 'Creating owner account',
      'createSupportInvitation': 'Setting up support',
      'assignRoleToSupportInvitation': 'Assigning support role',
      'createSideDrawerForSupport': 'Creating support account'
    };
    return labels[stepKey] || stepKey;
  }

  // Continue with remaining methods (attachListeners, validateStep1, nextStep, previousStep, etc.)
  // These will be similar to existing wizard but adapted for logged-in flow
  
  async attachListeners() {
    // Step 1 listeners (no email/password)
    if (this.state.currentStep === 0) {
      const nameInput = document.getElementById('tenant-name-input');
      const domainInput = document.getElementById('tenant-domain-input');
      const regionSelect = document.getElementById('region-select');

      if (nameInput) {
        nameInput.addEventListener('input', (e) => {
          this.state.tenantName = e.target.value;
          this.clearError('tenant-name-error');
        });
        nameInput.addEventListener('blur', () => this.validateStep1());
      }

      if (domainInput) {
        domainInput.addEventListener('input', (e) => {
          this.state.tenantDomain = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
          e.target.value = this.state.tenantDomain;
          this.clearError('tenant-domain-error');
        });
        domainInput.addEventListener('blur', () => {
          this.validateStep1();
          this.checkDomainAvailability();
        });
      }

      if (regionSelect) {
        regionSelect.addEventListener('change', (e) => {
          this.state.region = String(e.target.value || '').trim();
          this.clearError('region-error');
          // Currency belongs to the Stripe price / customer when either is set; the
          // region must not override it.
          if (!this.state.fixedStripePriceId && !this.state.customerBillingCurrency) {
            this.syncCurrencyFromRegion();
          }
          // A pre-configured fixedStripePriceId must survive a region change, not be
          // overwritten by the currency-driven default-plan pick.
          if (!this.state.fixedStripePriceId) {
            this.applyDefaultSubscriptionSelection();
          }
          this.render();
        });
      }

      const usersInput = document.getElementById('total-admin-users-input');
      if (usersInput) {
        usersInput.addEventListener('input', (e) => {
          const value = parseInt(e.target.value, 10) || 0;
          this.state.totalAdminUsers = value;
          this.clearError('users-error');
        });
        usersInput.addEventListener('blur', () => {
          if (this.state.selectedPrice) {
            const minUsers = parseInt(this.state.selectedPrice.metadata?.['product.startingUsers'] || '0', 10);
            if (this.state.totalAdminUsers < minUsers) {
              this.state.totalAdminUsers = minUsers;
              usersInput.value = minUsers;
            }
          }
        });
      }

      this.syncRegionFromSelect();
    }

    // Payment step — Initialize Stripe Elements
    if (this.state.currentStep === 1 && !this.state.skipPayment) {
      const cardholderNameInput = document.getElementById('cardholder-name-input');
      if (cardholderNameInput) {
        cardholderNameInput.addEventListener('input', (e) => {
          this.state.cardholderName = e.target.value;
          this.clearValidationError();
        });
      }

      if (this.state.stripePublicKey) {
        setTimeout(async () => {
          try {
            const initialized = await stripeServiceWithCredentials.initialize(this.state.stripePublicKey);
            if (initialized) {
              await stripeServiceWithCredentials.createCardElement('card-element');
            }
          } catch (error) {
            const errorElement = document.getElementById('card-element-error');
            if (errorElement) {
              errorElement.textContent = 'Failed to initialize payment form. Please refresh the page.';
              errorElement.style.display = 'block';
            }
          }
        }, 300);
      }
    }

    // Attach click listener to next button (always, not just summary step)
    const nextButton = document.getElementById('wizard-next-button');
    if (nextButton) {
      // Remove any existing listeners by cloning the button
      const newButton = nextButton.cloneNode(true);
      nextButton.parentNode.replaceChild(newButton, nextButton);
      
      newButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.state.loading) return; // Prevent clicks while loading
        if (window.tenantWizardWithCredentials) {
          window.tenantWizardWithCredentials.nextStep();
        }
      });
    }
  }

  validateStep1() {
    let isValid = true;
    this.state.validationError = null;
    const dict = this.state.dictionary || {};

    this.syncRegionFromSelect();

    // Business name validation
    if (!this.state.tenantName || this.state.tenantName.trim().length === 0) {
      this.showError('tenant-name-error', dict.globalparams_mandatoryfield || 'Business name is required');
      isValid = false;
    }

    // Domain validation
    if (!this.state.tenantDomain || this.state.tenantDomain.trim().length === 0) {
      this.showError('tenant-domain-error', dict.globalparams_mandatoryfield || 'Domain is required');
      isValid = false;
    } else if (!/^[a-z0-9-]+$/.test(this.state.tenantDomain)) {
      this.showError('tenant-domain-error', dict.tenantsetupname_tenantsubdomaininvalid || 'Domain can only contain lowercase letters, numbers, and hyphens');
      isValid = false;
    }

    const regionId = String(this.state.region || '').trim();
    if (!regionId || !this.isKnownDatabaseRegion(regionId)) {
      this.showError('region-error', dict.globalparams_mandatoryfield || 'Region is required');
      isValid = false;
    }

    if (!this.state.totalAdminUsers || this.state.totalAdminUsers < 1) {
      this.showError('users-error', dict.tenantsignupsubscription_usersrequired || 'Please enter the number of admin users');
      isValid = false;
    }

    return isValid;
  }

  async checkDomainAvailability() {
    if (!this.state.tenantDomain) return;

    try {
      const tenantApi = window.sdHosts().tenants + '/api/v1/tenants/';

      const headers = { 'Content-Type': 'application/json' };
      if (this.state.accessToken) {
        headers['Authorization'] = `Bearer ${this.state.accessToken}`;
      }

      const response = await fetch(`${tenantApi}tenant/branding/brand-code/${this.state.tenantDomain}`, { headers });

      if (response.ok) {
        const brand = await response.json();
        if (brand.brandCode !== 'sidedrawer' || this.state.tenantDomain === 'sidedrawer') {
          const dict = this.state.dictionary || {};
          this.showError('tenant-domain-error', dict.tenantsetupname_tenantsubdomaintaken || 'Domain is already taken');
        }
      } else if (response.status === 404) {
        this.clearError('tenant-domain-error');
      }
    } catch (error) {
      console.error('❌ Error checking domain:', error);
    }
  }

  async nextStep() {
    const dict = this.state.dictionary || {};
    
    if (this.state.currentStep === 0) {
      if (!this.validateStep1()) {
        this.state.validationError = dict.globalparams_fillrequiredfields || 'Please fill in all required fields';
        this.render();
        return;
      }
      this.syncWizardCurrency();
      // A pre-configured stripe_price (this.state.fixedStripePriceId, loaded and applied in
      // init() via loadFixedStripePrice()) must be left alone here — this call used to
      // unconditionally re-run the auto-pick logic and silently overwrite it every time the
      // user advanced past step 1, which is why a configured price was never actually honoured.
      if (!this.state.fixedStripePriceId) {
        this.applyDefaultSubscriptionSelection();
      }
      if (!this.state.selectedPrice) {
        this.state.validationError = dict.tenantsetupsubscription_selectplan || 'Please select a subscription plan';
        this.render();
        return;
      }
      if (this.state.skipPayment) {
        this.state.currentStep = 1;
        this.state.validationError = null;
        this.render();
        this.attachListeners();
        return;
      }
      this.state.currentStep = 1;
      this.state.validationError = null;
      this.render();
      this.attachListeners();
      return;
    }

    if (this.state.currentStep === 1 && !this.state.skipPayment) {
      if (!this.state.selectedPaymentMethod && !this.state.stripePublicKey) {
        this.state.validationError = dict.paymentdetails_selectpaymentmethod || 'Please select or add a payment method';
        this.render();
        return;
      }
      
      if (!this.state.selectedPaymentMethod && this.state.stripePublicKey && stripeServiceWithCredentials.cardElement) {
        const cardholderName = document.getElementById('cardholder-name-input')?.value;
        if (!cardholderName) {
          this.state.validationError = dict.paymentdetails_addnewcardname || 'Cardholder name is required';
          this.render();
          return;
        }
        
        if (!this.state.billingAddress) {
          this.state.validationError = dict.paymentdetails_addnewcardbillingaddress || 'Billing address is required';
          this.render();
          return;
        }
        
        const { paymentMethodId: pmId, error } = await stripeServiceWithCredentials.createPaymentMethod({
          name: cardholderName,
          address: {
            line1: this.state.billingAddress.line1,
            city: this.state.billingAddress.city,
            state: this.state.billingAddress.state,
            postal_code: this.state.billingAddress.postalCode,
            country: this.state.billingAddress.country
          }
        });
        
        if (error || !pmId) {
          this.state.validationError = error?.message || 'Failed to create payment method';
          this.render();
          return;
        }
        
        this.state.paymentMethodToken = pmId;
      }
      
      this.state.currentStep = 2;
      this.render();
      this.attachListeners();
      return;
    }

    if ((this.state.skipPayment && this.state.currentStep === 1) ||
        (!this.state.skipPayment && this.state.currentStep === 2)) {
      try {
        await this.createTenant();
      } catch (error) {
        console.error('❌ Error in nextStep:', error);
        const dict = this.state.dictionary || {};
        this.state.validationError = error.message || (dict.globalparams_error || 'Failed to create account');
        this.render();
      }
      return;
    }

    this.state.validationError = null;
    this.render();
  }

  previousStep() {
    if (this.state.currentStep > 0) {
      this.state.currentStep--;
      this.state.validationError = null;
      this.render();
    }
  }

  selectPrice(priceId) {
    const price = this.state.prices.find(p => p.id === priceId);
    if (price) {
      this.state.selectedPrice = price;
      this.state.validationError = null;
      
      const minUsers = parseInt(price.metadata?.['product.startingUsers'] || '0', 10);
      if (this.state.totalAdminUsers < minUsers) {
        this.state.totalAdminUsers = minUsers;
      }
      
      this.render();
      this.attachListeners();
    }
  }

  selectCurrency(currencyCode) {
    this.state.currency = currencyCode;
    this.state.selectedPrice = null;
    this.updatePriceLists();
    this.render();
    this.attachListeners();
  }

  setPriceTab(tab) {
    this.state.priceTab = tab;
    this.updatePriceLists();
    this.render();
    this.attachListeners();
  }

  selectPaymentMethod(paymentMethodId) {
    const pm = this.state.paymentMethods.find(p => p.id === paymentMethodId);
    if (pm) {
      this.state.selectedPaymentMethod = pm;
      this.render();
    }
  }

  showBillingAddressDialog() {
    const dict = this.state.dictionary || {};
    const currentAddress = this.state.billingAddress || {};

    const modalHtml = `
      <div class="modal-overlay" id="billing-address-modal-overlay">
        <div class="modal-dialog modal-dialog-large">
          <div class="modal-header">
            <h3 class="modal-title">${dict.paymentdetails_addnewcardbillingaddress || 'Billing Address'}</h3>
            <button class="modal-close" onclick="tenantWizardWithCredentials.closeBillingAddressModal()">×</button>
          </div>
          <div class="modal-body">
            <form class="billing-address-form" id="billing-address-form" onsubmit="event.preventDefault(); tenantWizardWithCredentials.saveBillingAddress();">
              <div class="wizard-form-group">
                <label class="wizard-form-label">Street Address</label>
                <input type="text" class="wizard-form-input" id="billing-line1" placeholder="${dict.paymentdetails_billingaddressline1 || 'Street address'}" value="${currentAddress.line1 || ''}" required />
              </div>
              <div class="wizard-form-group">
                <label class="wizard-form-label">City</label>
                <input type="text" class="wizard-form-input" id="billing-city" placeholder="${dict.paymentdetails_billingaddresscity || 'City'}" value="${currentAddress.city || ''}" required />
              </div>
              <div class="wizard-form-group">
                <label class="wizard-form-label">State/Province</label>
                <input type="text" class="wizard-form-input" id="billing-state" placeholder="${dict.paymentdetails_billingaddressstate || 'State/Province'}" value="${currentAddress.state || ''}" required />
              </div>
              <div class="wizard-form-group">
                <label class="wizard-form-label">Postal Code</label>
                <input type="text" class="wizard-form-input" id="billing-postal" placeholder="${dict.paymentdetails_billingaddresspostal || 'Postal Code'}" value="${currentAddress.postalCode || ''}" required />
              </div>
              <div class="wizard-form-group">
                <label class="wizard-form-label">Country</label>
                <select class="wizard-form-input country-select" id="billing-country" required>
                  <option value="">${dict.paymentdetails_billingaddresscountry || 'Select Country'}</option>
                  ${this.getCountryOptions().map(country => `
                    <option value="${country.code}" ${currentAddress.country === country.code ? 'selected' : ''}>
                      ${country.code} ${country.name}
                    </option>
                  `).join('')}
                </select>
              </div>
              <div class="wizard-footer modal-footer-spaced">
                <button type="button" class="btn" onclick="tenantWizardWithCredentials.closeBillingAddressModal()">${dict.globalparams_cancel || 'Cancel'}</button>
                <button type="submit" class="btn btn-success">${dict.globalparams_save || 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    const existingModal = document.getElementById('billing-address-modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('billing-address-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'billing-address-modal-overlay') {
        this.closeBillingAddressModal();
      }
    });
  }

  closeBillingAddressModal() {
    const modal = document.getElementById('billing-address-modal-overlay');
    if (modal) {
      modal.remove();
    }
  }

  saveBillingAddress() {
    const line1 = document.getElementById('billing-line1')?.value;
    const city = document.getElementById('billing-city')?.value;
    const state = document.getElementById('billing-state')?.value;
    const postalCode = document.getElementById('billing-postal')?.value;
    const country = document.getElementById('billing-country')?.value;

    if (line1 && city && state && postalCode && country) {
      const cardholderNameInput = document.getElementById('cardholder-name-input');
      if (cardholderNameInput) {
        this.state.cardholderName = cardholderNameInput.value;
      }

      this.state.billingAddress = { line1, city, state, postalCode, country };
      this.closeBillingAddressModal();
      
      const billingAddressSection = document.querySelector('.billing-address-section');
      if (billingAddressSection) {
        const addressDisplay = billingAddressSection.querySelector('.billing-address-display');
        if (addressDisplay) {
          addressDisplay.innerHTML = `
            ${this.state.billingAddress.line1}<br>
            ${this.state.billingAddress.city}, ${this.state.billingAddress.state} ${this.state.billingAddress.postalCode}<br>
            ${this.state.billingAddress.country}
          `;
        } else {
          const displayDiv = document.createElement('div');
          displayDiv.className = 'billing-address-display';
          displayDiv.innerHTML = `
            ${this.state.billingAddress.line1}<br>
            ${this.state.billingAddress.city}, ${this.state.billingAddress.state} ${this.state.billingAddress.postalCode}<br>
            ${this.state.billingAddress.country}
          `;
          billingAddressSection.appendChild(displayDiv);
        }
        
        const updateButton = billingAddressSection.querySelector('button');
        if (updateButton) {
          const dict = this.state.dictionary || {};
          updateButton.textContent = dict.paymentdetails_updatebillingaddress || 'Update Billing Address';
        }
      }
    }
  }

  async createTenant() {
    // This will implement the full Angular API flow
    // For now, placeholder - will be implemented in next step
    this.state.loading = true;
    this.state.validationError = null;
    this.render();

    try {
      await this.createTenantWithAngularFlow();
    } catch (error) {
      console.error('❌ Error creating tenant:', error);
      this.state.loading = false;
      this.state.validationError = error.message || 'Failed to create tenant';
      this.render();
    }
  }

  async createTenantWithAngularFlow() {
    // Phase 2: Sequential API calls following Angular flow
      const userApi = window.sdHosts().api + '/api/v1/users';
    const subscriptionApi = window.sdHosts().api + '/api/v1/subscriptions';
    const tenantApi = window.sdHosts().tenants + '/api/v1/tenants';

    const headers = {
      'Authorization': `Bearer ${this.state.accessToken}`,
      'Content-Type': 'application/json'
    };

    try {
      let customerId = this.state.customerId;
      let paymentMethodId = this.state.selectedPaymentMethod?.id || this.state.paymentMethodToken;

      // Step 1: Create customer ID if needed
      if (!customerId) {
        this.updateProcessStep('customerId', 'processing');
        const cardholderName = document.getElementById('cardholder-name-input')?.value || this.state.account?.firstName || 'User';
        const createCustomerResponse = await fetch(`${subscriptionApi}/customers`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: cardholderName })
        });

        if (!createCustomerResponse.ok) {
          throw new Error('Failed to create customer ID');
        }

        const customerData = await createCustomerResponse.json();
        customerId = customerData.id;
        this.state.customerId = customerId;
        this.updateProcessStep('customerId', 'success');
      }

      // Step 2: Create payment method if needed
      if (!paymentMethodId && this.state.stripePublicKey) {
        this.updateProcessStep('paymentMethod', 'processing');
        
        if (!stripeServiceWithCredentials.cardElement) {
          await stripeServiceWithCredentials.initialize(this.state.stripePublicKey);
          await stripeServiceWithCredentials.createCardElement('card-element');
        }

        const cardholderName = document.getElementById('cardholder-name-input')?.value;
        if (!cardholderName || !this.state.billingAddress) {
          throw new Error('Payment method details incomplete');
        }

        const { paymentMethodId: pmId, error } = await stripeServiceWithCredentials.createPaymentMethod({
          name: cardholderName,
          address: {
            line1: this.state.billingAddress.line1,
            city: this.state.billingAddress.city,
            state: this.state.billingAddress.state,
            postal_code: this.state.billingAddress.postalCode,
            country: this.state.billingAddress.country
          }
        });

        if (error || !pmId) {
          throw new Error(error?.message || 'Failed to create payment method');
        }

        paymentMethodId = pmId;
        this.updateProcessStep('paymentMethod', 'success');
      }

      if (!paymentMethodId) {
        throw new Error('Payment method is required');
      }

      // Step 3: Create tenant using signup endpoint (replaces all subsequent steps)
      this.updateProcessStep('createTenant', 'processing');
      const tenantApiBase = window.sdHosts().api + '/api/v1/tenants';
      
      // Validate required fields
      if (!this.state.selectedPrice?.id) {
        throw new Error('No subscription plan selected');
      }
      const signupResponse = await fetch(`${tenantApiBase}/tenant/signup`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.state.accessToken}`,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        },
        body: JSON.stringify({
          tenantName: this.state.tenantName,
          brandCode: this.state.tenantDomain,
          region: this.getSelectedRegionWireValue(),
          startingQuantity: this.state.totalAdminUsers || 1,
          identityProvider: 'keycloak',
          priceId: this.state.selectedPrice.id,
          ...(this.state.couponId ? { couponId: this.state.couponId } : {})
        })
      });

      if (!signupResponse.ok) {
        const errorData = await signupResponse.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Failed to create tenant');
      }

      const tenant = await signupResponse.json();
      this.updateProcessStep('createTenant', 'success');

      // All steps completed successfully
      this.state.loading = false;
      this.showSuccess();
    } catch (error) {
      console.error('❌ Error in tenant creation flow:', error);
      this.state.loading = false;
      
      // Update the failed step status
      const lastStep = this.state.processSteps[this.state.processSteps.length - 1];
      if (lastStep && lastStep.status === 'processing') {
        lastStep.status = 'error';
      }
      
      // Extract error message
      let errorMessage = 'Failed to create tenant';
      if (error.message) {
        errorMessage = error.message;
      } else if (error.response) {
        try {
          const errorData = await error.response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
        }
      }
      
      this.state.validationError = errorMessage;
      this.render();
      throw error;
    }
  }

  updateProcessStep(stepKey, status) {
    // Track process steps for UI display
    const step = this.state.processSteps.find(s => s.key === stepKey);
    if (step) {
      step.status = status;
    } else {
      this.state.processSteps.push({ key: stepKey, status });
    }
    // Re-render to show progress (always render when loading to show progress)
    if (this.state.loading) {
      this.render();
    }
  }

  getSubscriptionTypeFromPrice(price) {
    // Determine subscription type from price metadata
    if (!price || !price.metadata) return 'users';
    const audience = price.metadata['product.audience'];
    if (audience === 'users') return 'users';
    if (audience === 'pros' || audience === 'retail') return 'sidedrawers';
    return 'users'; // default
  }

  showSuccess() {
    const wizardContainer = document.getElementById('tenant-wizard');
    wizardContainer.innerHTML = `
      <div class="tenant-wizard">
        <div class="success-animation">
          <div class="success-icon">✓</div>
          <h2>Account Created Successfully!</h2>
          <p class="success-text">
            Your SideDrawer account has been created.
          </p>
          <div class="success-actions">
            <button type="button" class="btn btn-success mt-24" onclick="location.reload()">
              Continue
            </button>
            <button type="button" class="btn btn-console-secondary mt-10" onclick="void window.openSideDrawerConsoleSso()">
              Continue tenant configuration in Console
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Helper methods
  /** Stripe REST uses exp_month/exp_year; some clients use expMonth/expYear. */
  formatCardExpiry(card) {
    if (!card) return '';
    const month = card.exp_month ?? card.expMonth;
    const year = card.exp_year ?? card.expYear;
    if (month == null || year == null) return '';
    return `${String(month).padStart(2, '0')}/${year}`;
  }

  formatCardExpiryLine(dict, card) {
    const exp = this.formatCardExpiry(card);
    if (!exp) return '';
    return `${dict.paymentdetails_expires || 'Expires'} ${exp}`;
  }

  getCountryName(countryCode) {
    const countries = {
      'US': 'United States',
      'CA': 'Canada',
      'GB': 'United Kingdom',
      'AU': 'Australia'
    };
    return countries[countryCode] || countryCode;
  }

  getDictionaryPrice(priceId) {
    if (!this.state.dictionary?.collections?.prices) return null;
    return this.state.dictionary.collections.prices.find(p => p.stripePriceId === priceId);
  }

  getDictionaryValue(key) {
    if (!this.state.dictionary) return null;
    return this.state.dictionary[key] || null;
  }

  getCountryOptions() {
    return [
      { code: 'AR', name: 'Argentina' },
      { code: 'AU', name: 'Australia' },
      { code: 'AT', name: 'Austria' },
      { code: 'BE', name: 'Belgium' },
      { code: 'BR', name: 'Brazil' },
      { code: 'CA', name: 'Canada' },
      { code: 'CL', name: 'Chile' },
      { code: 'CN', name: 'China' },
      { code: 'CO', name: 'Colombia' },
      { code: 'CR', name: 'Costa Rica' },
      { code: 'DK', name: 'Denmark' },
      { code: 'FI', name: 'Finland' },
      { code: 'FR', name: 'France' },
      { code: 'DE', name: 'Germany' },
      { code: 'GR', name: 'Greece' },
      { code: 'GT', name: 'Guatemala' },
      { code: 'HN', name: 'Honduras' },
      { code: 'HK', name: 'Hong Kong' },
      { code: 'IN', name: 'India' },
      { code: 'IE', name: 'Ireland' },
      { code: 'IT', name: 'Italy' },
      { code: 'JP', name: 'Japan' },
      { code: 'MX', name: 'Mexico' },
      { code: 'NL', name: 'Netherlands' },
      { code: 'NZ', name: 'New Zealand' },
      { code: 'NO', name: 'Norway' },
      { code: 'PA', name: 'Panama' },
      { code: 'PE', name: 'Peru' },
      { code: 'PH', name: 'Philippines' },
      { code: 'PL', name: 'Poland' },
      { code: 'PT', name: 'Portugal' },
      { code: 'PR', name: 'Puerto Rico' },
      { code: 'SG', name: 'Singapore' },
      { code: 'ZA', name: 'South Africa' },
      { code: 'ES', name: 'Spain' },
      { code: 'SE', name: 'Sweden' },
      { code: 'CH', name: 'Switzerland' },
      { code: 'TW', name: 'Taiwan' },
      { code: 'GB', name: 'United Kingdom' },
      { code: 'US', name: 'United States' },
      { code: 'UY', name: 'Uruguay' },
      { code: 'VE', name: 'Venezuela' }
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = message;
      element.classList.add('show');
    }
  }

  clearError(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = '';
      element.classList.remove('show');
    }
  }

  clearValidationError() {
    this.state.validationError = null;
    const errorElement = document.querySelector('.validation-error');
    if (errorElement) {
      errorElement.remove();
    }
  }
}

// Initialize tenant creation wizard with credentials
const tenantWizardWithCredentials = new TenantCreationWizardWithCredentials();

// Expose to window for onclick handlers
window.tenantWizardWithCredentials = tenantWizardWithCredentials;

if (typeof tenantWizardWithCredentials === 'undefined') {
  console.error('❌ Failed to initialize TenantCreationWizardWithCredentials');
} else {
  console.log('✅ TenantCreationWizardWithCredentials initialized');
}

