/**
 * Tenant Creation Wizard - Complete Frontend Implementation
 * Extracted from widget.html for better code organization
 * 
 * Dependencies:
 * - OAUTH_CONFIG (global)
 * - auth (SideDrawerAuth instance, global)
 * - Stripe.js library (loaded via CDN)
 */

// Stripe Service for PCI-compliant payment processing
class StripeService {
  constructor() {
    this.stripe = null;
    this.elements = null;
    this.cardElement = null;
    this.stripePublicKey = null; // Will be set from config or environment
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
      
      // Listen for errors
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

// Initialize Stripe service (will be initialized when needed with public key)
const stripeService = new StripeService();

// Tenant Creation Wizard - Complete Frontend Implementation
class TenantCreationWizard {
  constructor() {
    this.state = {
      currentStep: 0,
      // Step 1: Tenant Info
      email: '',
      password: '',
      confirmPassword: '',
      tenantName: '',
      tenantDomain: '',
      region: '',
      // Step 2: Subscription
      selectedPrice: null,
      currency: null,
      priceTab: 'year', // 'month' or 'year' (subscription step hidden; default yearly)
      prices: [],
      monthlyPrices: [],
      yearlyPrices: [],
      usersPrices: [], // Prices with product.audience === 'users'
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
      paymentMethodToken: null, // Stores Stripe payment method token created on step 2
      stripePublicKey: null,
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

  async init() {
    try {
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

      // Fetch dictionary FIRST (needed for currencies)
      await this.loadDictionary();
      
      // Load prices
      await this.loadPrices();
      
      // Load regions from dictionary
      await this.loadRegions();
      
      // Load currencies from dictionary and set default from region (CA→CAD, US→USD)
      await this.loadCurrencies();
      if (this.state.fixedStripePriceId) {
        await this.loadFixedStripePrice();
      } else {
        this.applyDefaultSubscriptionSelection();
      }

      // Get Stripe public key from backend/config API
      await this.loadStripePublicKey();

      // Render wizard
      this.render();
    } catch (error) {
      throw error;
    }
  }

  async loadDictionary() {
    try {
      const apiUrl = window.sdHosts().api + '/api/v1/configs/content/dictionaries/console_20210501/locale/en-CA';

      const response = await fetch(apiUrl);
      if (response.ok) {
        const data = await response.json();
        this.state.dictionary = data;
        this.state.databaseRegions = this.mergeDictionaryDatabaseRegions(data);
        // Filter currencies - match Angular's dicCurrenciesSelector (filter by enabled)
        const rawCurrencies = data.collections?.currencies || [];
        this.state.currencies = Array.isArray(rawCurrencies) 
          ? rawCurrencies.filter(c => c && c.enabled === true && c.currency) 
          : [];
      }
    } catch (error) {
      throw error;
    }
  }

  async loadPrices() {
    try {
      const apiUrl = window.sdHosts().api + '/api/v1/subscriptions/prices';

      const token = await auth.getAccessToken();
      const headers = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(apiUrl, { headers });
      if (response.ok) {
        const prices = await response.json();
        this.state.prices = Array.isArray(prices) ? prices.filter(p => p.active === true) : [];
        // Store dictionary prices if available
        if (this.state.dictionary?.collections?.prices) {
          this.state.dictionaryPrices = this.state.dictionary.collections.prices;
        }
        // Update price lists if currency is already set
        if (this.state.currency) {
          this.updatePriceLists();
        }
      }
    } catch (error) {
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

    // Try to find in already-loaded list first
    let price = (this.state.prices || []).find(p => p.id === priceId);

    if (!price) {
      // Fetch individually from backend
      try {
        const apiBase = window.sdHosts().api + '/api/v1';
        const token = await auth.getAccessToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
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
      // Ensure the price currency is reflected
      if (price.currency) {
        this.state.currency = price.currency.toLowerCase();
        this.updatePriceLists();
      }
      const minUsers = parseInt(price.metadata?.['product.startingUsers'] || '0', 10);
      if (!this.state.totalAdminUsers || this.state.totalAdminUsers < Math.max(1, minUsers)) {
        this.state.totalAdminUsers = Math.max(1, minUsers || 1);
      }
    } else {
      // Price not found — fall back to default selection
      console.warn(`⚠ Falling back to default price selection (stripe_price "${priceId}" could not be loaded)`);
      this.applyDefaultSubscriptionSelection();
    }
  }

  /**
   * Merge all CMS shapes that carry database region rows (tenant data region, not payment).
   */
  mergeDictionaryDatabaseRegions(data) {
    const col = data?.collections || {};
    const a = col.databaseregions;
    const b = col.databaseRegions;
    const parts = [];
    if (Array.isArray(a)) parts.push(...a);
    if (Array.isArray(b)) parts.push(...b);
    return parts;
  }

  /**
   * Resolve option value / API region: CMS uses many keys; rows may be plain strings.
   * Payment currency is separate — this must list every tenant region row that exists.
   */
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

  /**
   * Unique <select> values (handles duplicate slugs in CMS) — use for validation and currency mapping.
   */
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
      this.syncCurrencyFromRegion();
    }
  }

  /** Resolve unit amount in smallest currency unit for comparing tiers. */
  getPriceUnitAmount(price) {
    if (!price) return 0;
    if (price.tiers && price.tiers.length > 0) {
      return price.tiers[0].flat_amount ?? 0;
    }
    return price.amount ?? 0;
  }

  /**
   * CA → CAD, US → USD when enabled; otherwise USD preferred or first enabled currency.
   */
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
   * Yearly pay-per-user Business: CMS name matches /business/i, else highest unit price among yearly users prices.
   */
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

  async loadStripePublicKey() {
    try {
      const apiBase = window.sdHosts().api + '/api/v1';
      
      // Try to get Stripe public key from subscriptions API
      try {
        const response = await fetch(`${apiBase}/subscriptions/subscriptions/public-key`);
        if (response.ok) {
          const data = await response.json();
          this.state.stripePublicKey = data.publicKey || data.stripePublicKey || data.key || null;
        } else {
          console.error('Stripe public key endpoint failed:', response.status);
          this.state.stripePublicKey = null;
        }
      } catch (e) {
        console.error('Stripe public key fetch error:', e);
        this.state.stripePublicKey = null;
      }
    } catch (error) {
      console.error('Stripe public key error:', error);
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

    // Filter by product.audience === 'pros' (matching Angular's pricesListProSelector)
    const prosPrices = this.state.prices.filter(p => {
      if (!p.active) return false;
      if (!p.metadata) return false;
      
      // Exact match as Angular: p.metadata['product.audience'] === 'pros'
      return p.metadata['product.audience'] === 'pros';
    });

    // Filter by product.audience === 'users' (matching Angular's pricesListUsersSelector)
    const usersPrices = this.state.prices.filter(p => {
      if (!p.active) return false;
      if (!p.metadata) return false;
      
      return p.metadata['product.audience'] === 'users';
    });
    this.state.usersPrices = usersPrices;

    // Monthly prices: filter pros prices by interval 'month' (matching pricesListProByIntervalSelector)
    // Angular filters by currency in template using isHidden(), but we filter here for efficiency
    this.state.monthlyPrices = prosPrices.filter(
      p => p.interval === 'month' && 
           p.currency && p.currency.toLowerCase() === currency.toLowerCase()
    );

    // Yearly prices: filter pros prices by interval 'year' (matching pricesListProByIntervalSelector)
    const yearlyProsPrices = prosPrices.filter(
      p => p.interval === 'year' && 
           p.currency && p.currency.toLowerCase() === currency.toLowerCase()
    );

    // Monthly users prices: filter users prices by interval 'month' and currency
    this.state.monthlyUsersPrices = usersPrices.filter(
      p => p.interval === 'month' && 
           p.currency && p.currency.toLowerCase() === currency.toLowerCase()
    );

    // Yearly users prices: filter users prices by interval 'year' and currency
    this.state.yearlyUsersPrices = usersPrices.filter(
      p => p.interval === 'year' && 
           p.currency && p.currency.toLowerCase() === currency.toLowerCase()
    );

    // Fallback: If no pros yearly prices, show retail yearly prices
    // This handles cases where yearly prices use 'retail' audience
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
      console.error('❌ tenant-wizard container not found, creating it...');
      // Create the container if it doesn't exist
      wizardContainer = document.createElement('div');
      wizardContainer.id = 'tenant-wizard';
      wizardContainer.style.display = 'none';
      const container = document.querySelector('.container');
      if (container) {
        container.appendChild(wizardContainer);
      } else {
        document.body.appendChild(wizardContainer);
      }
      console.log('✅ Created tenant-wizard container');
    }

    // Hide main content, show wizard
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
          <div class="wizard-step ${this.state.currentStep === 1 ? 'active' : this.state.currentStep > 1 ? 'completed' : ''}">
            <div class="wizard-step-circle">${this.state.currentStep > 1 ? '✓' : '2'}</div>
            <div class="wizard-step-label">${this.getDictionaryValue('tenantsetuppayment_steptitle') || 'Payment'}</div>
          </div>
          <div class="wizard-step ${this.state.currentStep === 2 ? 'active' : this.state.currentStep > 2 ? 'completed' : ''}">
            <div class="wizard-step-circle">${this.state.currentStep > 2 ? '✓' : '3'}</div>
            <div class="wizard-step-label">${this.getDictionaryValue('tenantsignupsummary_steptitle') || 'Summary'}</div>
          </div>
        </div>

        <div class="wizard-content">
          ${this.renderStep()}
        </div>

        <div class="wizard-footer">
          ${this.state.currentStep > 0 ? `<button class="btn" onclick="tenantWizard.previousStep()">${this.getDictionaryValue('globalparams_back') || 'Back'}</button>` : '<div></div>'}
          <button class="btn btn-success" onclick="if(window.tenantWizard){window.tenantWizard.nextStep();}else{console.error('tenantWizard not found');}" ${this.state.loading ? 'disabled' : ''} id="wizard-next-button">
            ${this.state.currentStep === 2 
              ? (this.getDictionaryValue('tenantsetuppayment_primarybutton') || 'Create Account')
              : (this.getDictionaryValue('globalparams_next') || 'Next')}
          </button>
        </div>
      </div>
    `;

    // Attach event listeners
    this.attachListeners();
  }

  renderStep() {
    if (this.state.currentStep === 0) {
      return this.renderStep1();
    } else if (this.state.currentStep === 1) {
      return this.renderStep3();
    } else if (this.state.currentStep === 2) {
      return this.renderStep4();
    }
    return '';
  }

  renderStep1() {
    const dict = this.state.dictionary || {};
    return `
      ${this.state.validationError ? `<div class="validation-error">${this.state.validationError}</div>` : ''}
      
      <div class="wizard-form-group">
        <label class="wizard-form-label">${dict.signup_email || 'Email Address'}</label>
        <input 
          type="email" 
          class="wizard-form-input" 
          id="email-input"
          placeholder="${dict.signup_emailplaceholder || 'your.email@example.com'}"
          value="${this.state.email || ''}"
        />
        <div class="wizard-form-error" id="email-error"></div>
      </div>

      <div class="wizard-form-group">
        <label class="wizard-form-label">${dict.signup_password || 'Password'}</label>
        <input 
          type="password" 
          class="wizard-form-input" 
          id="password-input"
          placeholder="${dict.signup_passwordplaceholder || 'Enter a secure password'}"
          value="${this.state.password || ''}"
        />
        <div class="wizard-form-error" id="password-error"></div>
      </div>

      <div class="wizard-form-group">
        <label class="wizard-form-label">${dict.signup_confirmpassword || 'Confirm Password'}</label>
        <input 
          type="password" 
          class="wizard-form-input" 
          id="confirm-password-input"
          placeholder="${dict.signup_confirmpasswordplaceholder || 'Confirm your password'}"
          value="${this.state.confirmPassword || ''}"
        />
        <div class="wizard-form-error" id="confirm-password-error"></div>
      </div>

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
              onclick="tenantWizard.selectPaymentMethod('${pm.id}')"
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
          <button class="btn btn-full-width" onclick="tenantWizard.showBillingAddressDialog()">
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
    
    // Debug logging
    if (!this.state.selectedPrice) {
      console.warn('⚠️ renderStep4: selectedPrice is null', this.state);
      return `<div class="validation-error">No subscription plan selected. Please go back and select a plan.</div>`;
    }
    
    const dictPrice = this.getDictionaryPrice(this.state.selectedPrice.id);
    if (!dictPrice) {
      console.warn('⚠️ renderStep4: dictPrice not found for price', this.state.selectedPrice.id, 'Available prices:', this.state.dictionary?.collections?.prices?.map(p => p.stripePriceId));
      // Fallback: use price data directly if dictionary price not found
      const currencyObj = this.state.currencies.find(c => c && c.currency && c.currency.toLowerCase() === this.state.selectedPrice.currency?.toLowerCase());
      const currencySymbol = currencyObj?.symbol || (this.state.selectedPrice.currency === 'usd' ? '$' : this.state.selectedPrice.currency === 'cad' ? 'C$' : '');
      const currencyLabel = currencyObj?.isoLabel || this.state.selectedPrice.currency?.toUpperCase() || '';
      const amount = this.state.selectedPrice.tiers && this.state.selectedPrice.tiers.length > 0 
        ? this.state.selectedPrice.tiers[0].flat_amount 
        : this.state.selectedPrice.amount;
      const pricePerUnit = amount / 100;
      const users = this.state.totalAdminUsers || 0;
      const isYearly = this.state.selectedPrice.interval === 'year';
      const total = isYearly ? pricePerUnit * users * 12 : pricePerUnit * users;
      
      return `
        <div class="tenant-creation-form-price-selected-resume">
          <div class="tenant-creation-form-price-selected-resume-title">
            <h2>${this.state.selectedPrice.id}</h2>
            ${this.state.fixedStripePriceId ? `
              <div class="tenant-creation-form-price-selected-chip">
                <p>${dict.tenantsignupsummary_fixedpricelabel || 'Pre-selected plan'}</p>
              </div>
            ` : ''}
          </div>
          <p class="tenant-creation-form-price-selected-price">
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
    
    const currencyObj = this.state.currencies.find(c => c && c.currency && c.currency.toLowerCase() === this.state.selectedPrice.currency?.toLowerCase());
    const currencySymbol = currencyObj?.symbol || (this.state.selectedPrice.currency === 'usd' ? '$' : this.state.selectedPrice.currency === 'cad' ? 'C$' : '');
    const currencyLabel = currencyObj?.isoLabel || this.state.selectedPrice.currency?.toUpperCase() || '';
    
    const pricePerUnit = dictPrice.pricePerUnit / 100;
    const listPricePerUnit = dictPrice.listPricePerUnit ? dictPrice.listPricePerUnit / 100 : null;
    const users = this.state.totalAdminUsers || 0;
    const isYearly = this.state.selectedPrice.interval === 'year';
    
    // Calculate amounts
    const baseAmount = listPricePerUnit || pricePerUnit;
    const amount = isYearly ? baseAmount * users * 12 : baseAmount * users;
    const discount = listPricePerUnit ? (isYearly ? (listPricePerUnit - pricePerUnit) * users * 12 : (listPricePerUnit - pricePerUnit) * users) : 0;
    const total = isYearly ? pricePerUnit * users * 12 : pricePerUnit * users;
    
    // Amount description
    const amountDescription = isYearly 
      ? `${currencySymbol}${baseAmount} ${currencyLabel} x ${users} users x 12`
      : `${currencySymbol}${baseAmount} ${currencyLabel} x ${users} users`;
    
    // Features list
    const featuresHtml = dictPrice.features || '';
    const featuresMatch = featuresHtml.match(/<ul>(.*?)<\/ul>/s);
    const featuresList = featuresMatch ? featuresMatch[1].split('</li>').map(li => li.replace(/<li>/g, '').trim()).filter(f => f) : [];
    const displayFeatures = featuresList.slice(0, 4);
    const hasMoreFeatures = featuresList.length > 4;
    
    // Features description (text before <ul>)
    const featuresDescMatch = featuresHtml.match(/<p>(.*?)<\/p>/);
    const featuresDescription = featuresDescMatch ? featuresDescMatch[1] : '';
    
    return `
      <div class="tenant-creation-form-price-selected-resume">
        <div class="tenant-creation-form-price-selected-resume-title">
          <h2>${dictPrice.name}</h2>
          ${this.state.fixedStripePriceId ? `
            <div class="tenant-creation-form-price-selected-chip">
              <p>${dict.tenantsignupsummary_fixedpricelabel || 'Pre-selected plan'}</p>
            </div>
          ` : ''}
          ${dictPrice.remark ? `
            <div class="tenant-creation-form-price-selected-chip">
              <p>${dictPrice.remark}</p>
            </div>
          ` : ''}
        </div>
        
        <p class="tenant-creation-form-price-selected-price">
          ${listPricePerUnit ? `
            <span class="tenant-creation-form-price-selected-list-price">
              ${currencySymbol}${listPricePerUnit.toFixed(2)}
            </span>
          ` : ''}
          <span>${currencySymbol}${pricePerUnit.toFixed(2)}</span>
          <span class="tenant-creation-form-price-selected-price">${currencyLabel}</span>
          <span class="tenant-creation-form-price-selected-description">/${isYearly ? 'user/year' : 'user/month'}</span>
        </p>
        
        ${featuresDescription ? `
          <p class="tenant-creation-form-price-selected-features-description">${featuresDescription}</p>
        ` : ''}
        
        ${featuresList.length > 0 ? `
          <ul class="tenant-creation-form-price-selected-features">
            ${displayFeatures.map(feature => `
              <li>
                <span class="checkmark-primary">✓</span>
                <span>${feature}</span>
              </li>
            `).join('')}
          </ul>
          ${hasMoreFeatures ? `
            <div class="tenant-creation-form-price-selected-features-button">
              <a href="#" onclick="event.preventDefault(); this.parentElement.previousElementSibling.innerHTML = \`${featuresList.map(f => `<li><span style='color: var(--primaryColor); margin-right: 8px;'>✓</span><span>${f}</span></li>`).join('')}\`; this.style.display='none';" class="link-text">
                ${dict.tenantsignupsummary_displayfeatures || 'Display all features'}
              </a>
            </div>
          ` : ''}
        ` : ''}
        
        <hr class="hr-separator" />
        
        <h3 class="tenant-creation-form-price-selected-resume-section-title">
          ${dict.tenantsignupsummary_tabletitle?.replace('[[frequency]]', isYearly ? (dict.tenantsignupsubscription_yearlytab || 'yearly').toLowerCase() : (dict.tenantsignupsubscription_monthlytab || 'monthly').toLowerCase()) || 'Recurring ' + (isYearly ? 'yearly' : 'monthly') + ' cost'}
        </h3>
        
        <div class="tenant-creation-form-price-selected-resume-section-line">
          <span class="tenant-creation-form-price-selected-resume-section-line-title">${dictPrice.name}</span>
          <span class="tenant-creation-form-price-selected-resume-section-line-amount">
            ${currencySymbol}${amount.toFixed(2)} ${currencyLabel}
          </span>
          <p class="tenant-creation-form-price-selected-resume-section-line-description">${amountDescription}</p>
        </div>
        
        ${discount > 0 ? `
          <div class="tenant-creation-form-price-selected-resume-section-line">
            <span class="tenant-creation-form-price-selected-resume-section-line-title">
              ${dict.tenantsignupsummary_tablediscountlabel || 'Discount applied'}
            </span>
            <span class="tenant-creation-form-price-selected-resume-section-line-amount discount-amount discount-amount-primary">
              ${currencySymbol}${discount.toFixed(2)} ${currencyLabel}
            </span>
          </div>
        ` : ''}
        
        <hr class="hr-separator" />
        
        <div class="tenant-creation-form-price-selected-total-section-line">
          <span class="tenant-creation-form-price-selected-total-section-line-title">
            ${dict.tenantsignupsummary_tabletotallabel || "Today's total"}
          </span>
          <span class="tenant-creation-form-price-selected-total-section-line-amount">
            ${currencySymbol}${total.toFixed(2)} ${currencyLabel}
          </span>
          <p class="tenant-creation-form-price-selected-total-section-line-description">
            ${dict.tenantsignupsummary_tabledisclaimerlabel || 'Annual packages function the same as monthly packages with a yearly charge with a discount applied.'}
          </p>
        </div>
      </div>
    `;
  }

  async attachListeners() {
    // Step 1 listeners
    if (this.state.currentStep === 0) {
      const emailInput = document.getElementById('email-input');
      const passwordInput = document.getElementById('password-input');
      const confirmPasswordInput = document.getElementById('confirm-password-input');
      const nameInput = document.getElementById('tenant-name-input');
      const domainInput = document.getElementById('tenant-domain-input');
      const regionSelect = document.getElementById('region-select');

      if (emailInput) {
        emailInput.addEventListener('input', (e) => {
          this.state.email = e.target.value;
          this.clearError('email-error');
        });
        emailInput.addEventListener('blur', () => this.validateStep1());
      }

      if (passwordInput) {
        passwordInput.addEventListener('input', (e) => {
          this.state.password = e.target.value;
          this.clearError('password-error');
        });
        passwordInput.addEventListener('blur', () => this.validateStep1());
      }

      if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', (e) => {
          this.state.confirmPassword = e.target.value;
          this.clearError('confirm-password-error');
        });
        confirmPasswordInput.addEventListener('blur', () => this.validateStep1());
      }

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
    if (this.state.currentStep === 1) {
      const cardholderNameInput = document.getElementById('cardholder-name-input');
      if (cardholderNameInput) {
        cardholderNameInput.addEventListener('input', (e) => {
          this.state.cardholderName = e.target.value;
          this.clearValidationError();
        });
      }

      // Initialize Stripe Elements if public key is available
      if (this.state.stripePublicKey) {
        setTimeout(async () => {
          try {
            const initialized = await stripeService.initialize(this.state.stripePublicKey);
            if (initialized) {
              const cardElement = await stripeService.createCardElement('card-element');
              if (cardElement) {
                // Listen for card element errors
                cardElement.on('change', (event) => {
                  const errorElement = document.getElementById('card-element-error');
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
              }
            }
          } catch (error) {
            // Stripe initialization failed
            const errorElement = document.getElementById('card-element-error');
            if (errorElement) {
              errorElement.textContent = 'Failed to initialize payment form. Please refresh the page.';
              errorElement.style.display = 'block';
            }
          }
        }, 300);
      } else {
        // Try to reload Stripe key if it's not available yet
        await this.loadStripePublicKey();
        if (this.state.stripePublicKey) {
          setTimeout(async () => {
            try {
              const initialized = await stripeService.initialize(this.state.stripePublicKey);
              if (initialized) {
                await stripeService.createCardElement('card-element');
              }
            } catch (error) {
              // Stripe initialization failed
            }
          }, 300);
        }
      }
    }

    // Summary step — direct handler on primary button (avoids double-submit with inline onclick)
    if (this.state.currentStep === 2) {
      const nextButton = document.getElementById('wizard-next-button');
      if (nextButton) {
        // Remove any existing listeners
        const newButton = nextButton.cloneNode(true);
        nextButton.parentNode.replaceChild(newButton, nextButton);
        
        // Add new listener
        newButton.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.tenantWizard) {
            window.tenantWizard.nextStep();
          } else {
            console.error('❌ tenantWizard not found in window');
          }
        });
      }
    }
  }

  validateStep1() {
    let isValid = true;
    this.state.validationError = null;
    const dict = this.state.dictionary || {};

    this.syncRegionFromSelect();

    // Email validation
    if (!this.state.email || this.state.email.trim().length === 0) {
      this.showError('email-error', dict.globalparams_mandatoryfield || 'Email is required');
      isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.state.email)) {
      this.showError('email-error', dict.signup_emailinvalid || 'Please enter a valid email address');
      isValid = false;
    }

    // Password validation
    if (!this.state.password || this.state.password.length === 0) {
      this.showError('password-error', dict.globalparams_mandatoryfield || 'Password is required');
      isValid = false;
    } else if (this.state.password.length < 8) {
      this.showError('password-error', dict.signup_passwordminlength || 'Password must be at least 8 characters');
      isValid = false;
    }

    // Confirm password validation
    if (!this.state.confirmPassword || this.state.confirmPassword.length === 0) {
      this.showError('confirm-password-error', dict.signup_confirmpasswordrequired || 'Please confirm your password');
      isValid = false;
    } else if (this.state.password !== this.state.confirmPassword) {
      this.showError('confirm-password-error', dict.signup_passwordsdonotmatch || 'Passwords do not match');
      isValid = false;
    }

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

    // Region validation (must match a row from the CMS databaseregions collection;
    // the id is the option id, not the wire value — the CMS default row resolves to '')
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
      const token = await auth.getAccessToken();
      const tenantApi = window.sdHosts().tenants + '/api/v1/tenants/';

      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${tenantApi}tenant/branding/brand-code/${this.state.tenantDomain}`, { headers });

      if (response.ok) {
        const brand = await response.json();
        if (brand.brandCode !== 'sidedrawer' || this.state.tenantDomain === 'sidedrawer') {
          const dict = this.state.dictionary || {};
          this.showError('tenant-domain-error', dict.tenantsetupname_tenantsubdomaintaken || 'Domain is already taken');
        }
      } else if (response.status === 404) {
        // Domain is available
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
      this.syncCurrencyFromRegion();
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
      this.state.currentStep = 1;
      await this.loadPaymentMethods();
      this.state.validationError = null;
      this.render();
      this.attachListeners();
      return;
    } else if (this.state.currentStep === 1) {
      // Validate payment method
      if (!this.state.selectedPaymentMethod && !this.state.stripePublicKey) {
        this.state.validationError = dict.paymentdetails_selectpaymentmethod || 'Please select or add a payment method';
        this.render();
        return;
      }
      
      // If using Stripe Elements, create payment method token now (before moving to summary)
      if (!this.state.selectedPaymentMethod && this.state.stripePublicKey && stripeService.cardElement) {
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
        
        // Create payment method token
        const { paymentMethodId: pmId, error } = await stripeService.createPaymentMethod({
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
        
        // Store payment method token in state
        this.state.paymentMethodToken = pmId;
      }
      
      this.state.currentStep = 2;
      this.render();
      this.attachListeners();
      return;
    } else if (this.state.currentStep === 2) {
      // Final step: create tenant
      try {
        await this.createTenant();
      } catch (error) {
        console.error('❌ Error in nextStep (summary):', error);
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
      
      // Set minimum users from price metadata
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
    this.state.selectedPrice = null; // Clear selection when currency changes
    this.updatePriceLists();
    this.render();
    this.attachListeners();
  }

  setPriceTab(tab) {
    this.state.priceTab = tab;
    // Update price lists to ensure correct filtering
    this.updatePriceLists();
    this.render();
    this.attachListeners();
  }

  showCurrencySelector() {
    const currencies = this.state.currencies.filter(c => c && c.currency && c.enabled);
    if (currencies.length === 0) {
      return;
    }

    const dict = this.state.dictionary || {};
    const currentCurrency = this.state.currency;

    const modalHtml = `
      <div class="modal-overlay" id="currency-modal-overlay">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3 class="modal-title">${dict.selectcurrencydialog_title || 'Select Currency'}</h3>
            <button class="modal-close" onclick="tenantWizard.closeCurrencyModal()">×</button>
          </div>
          <div class="modal-body">
            <div class="modal-description">
              ${dict.selectcurrencydialog_description || 'Choose your preferred currency'}
            </div>
            <div class="currency-list">
              ${currencies.map(currency => {
                const isSelected = currency.currency.toLowerCase() === currentCurrency;
                const flagUrl = `/assets/flags/${currency.flag?.toLowerCase() || currency.currency.toLowerCase()}.svg`;
                return `
                  <div 
                    class="currency-item ${isSelected ? 'selected' : ''}"
                    onclick="tenantWizard.selectCurrencyFromModal('${currency.currency.toLowerCase()}')"
                  >
                    <img src="${flagUrl}" alt="${currency.currency}" class="currency-flag" onerror="this.style.display='none'">
                    <div class="currency-info">
                      <div class="currency-iso">${currency.isoLabel || currency.currency.toUpperCase()}</div>
                      <div class="currency-name">${currency.currencyName || ''}</div>
                    </div>
                    ${isSelected ? '<span class="currency-check">✓</span>' : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('currency-modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Close on overlay click
    document.getElementById('currency-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'currency-modal-overlay') {
        this.closeCurrencyModal();
      }
    });
  }

  closeCurrencyModal() {
    const modal = document.getElementById('currency-modal-overlay');
    if (modal) {
      modal.remove();
    }
  }

  selectCurrencyFromModal(currencyIso) {
    this.state.currency = currencyIso;
    this.updatePriceLists();
    this.state.selectedPrice = null; // Clear selection when currency changes
    this.closeCurrencyModal();
    this.render();
  }

  async loadPaymentMethods() {
    try {
      const token = await auth.getAccessToken();
      if (!token) return;

      // Get user account to find customer ID
      const userApi = window.sdHosts().userApi;

      const userResponse = await fetch(`${userApi}/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (userResponse.ok) {
        const user = await userResponse.json();
        
        // Get customer ID (assuming it's stored in user metadata or separate call)
        // For now, we'll create customer if needed during payment method addition
      }
    } catch (error) {
      console.error('❌ Error loading payment methods:', error);
    }
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
            <button class="modal-close" onclick="tenantWizard.closeBillingAddressModal()">×</button>
          </div>
          <div class="modal-body">
            <form class="billing-address-form" id="billing-address-form" onsubmit="event.preventDefault(); tenantWizard.saveBillingAddress();">
              <div class="wizard-form-group">
                <label class="wizard-form-label">Street Address</label>
                <input 
                  type="text" 
                  class="wizard-form-input" 
                  id="billing-line1"
                  placeholder="${dict.paymentdetails_billingaddressline1 || 'Street address'}"
                  value="${currentAddress.line1 || ''}"
                  required
                />
              </div>

              <div class="wizard-form-group">
                <label class="wizard-form-label">City</label>
                <input 
                  type="text" 
                  class="wizard-form-input" 
                  id="billing-city"
                  placeholder="${dict.paymentdetails_billingaddresscity || 'City'}"
                  value="${currentAddress.city || ''}"
                  required
                />
              </div>

              <div class="wizard-form-group">
                <label class="wizard-form-label">State/Province</label>
                <input 
                  type="text" 
                  class="wizard-form-input" 
                  id="billing-state"
                  placeholder="${dict.paymentdetails_billingaddressstate || 'State/Province'}"
                  value="${currentAddress.state || ''}"
                  required
                />
              </div>

              <div class="wizard-form-group">
                <label class="wizard-form-label">Postal Code</label>
                <input 
                  type="text" 
                  class="wizard-form-input" 
                  id="billing-postal"
                  placeholder="${dict.paymentdetails_billingaddresspostal || 'Postal Code'}"
                  value="${currentAddress.postalCode || ''}"
                  required
                />
              </div>

              <div class="wizard-form-group">
                <label class="wizard-form-label">Country</label>
                <select 
                  class="wizard-form-input country-select" 
                  id="billing-country"
                  required
                >
                  <option value="">${dict.paymentdetails_billingaddresscountry || 'Select Country'}</option>
                  ${this.getCountryOptions().map(country => `
                    <option value="${country.code}" ${currentAddress.country === country.code ? 'selected' : ''}>
                      ${country.code} ${country.name}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="wizard-footer modal-footer-spaced">
                <button type="button" class="btn" onclick="tenantWizard.closeBillingAddressModal()">
                  ${dict.globalparams_cancel || 'Cancel'}
                </button>
                <button type="submit" class="btn btn-success">
                  ${dict.globalparams_save || 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('billing-address-modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Close on overlay click
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
      // Save cardholder name before re-rendering
      const cardholderNameInput = document.getElementById('cardholder-name-input');
      if (cardholderNameInput) {
        this.state.cardholderName = cardholderNameInput.value;
      }

      this.state.billingAddress = {
        line1,
        city,
        state,
        postalCode,
        country
      };
      this.closeBillingAddressModal();
      
      // Update only the billing address display without re-rendering the entire step
      // This preserves the Stripe card element and cardholder name
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
          // If display doesn't exist, create it
          const displayDiv = document.createElement('div');
          displayDiv.className = 'billing-address-display';
          displayDiv.innerHTML = `
            ${this.state.billingAddress.line1}<br>
            ${this.state.billingAddress.city}, ${this.state.billingAddress.state} ${this.state.billingAddress.postalCode}<br>
            ${this.state.billingAddress.country}
          `;
          billingAddressSection.appendChild(displayDiv);
        }
        
        // Update button text
        const updateButton = billingAddressSection.querySelector('button');
        if (updateButton) {
          const dict = this.state.dictionary || {};
          updateButton.textContent = dict.paymentdetails_updatebillingaddress || 'Update Billing Address';
        }
      }
    }
  }

  async createTenant() {
    const dict = this.state.dictionary || {};
    
    // Validate payment method
    if (!this.state.selectedPaymentMethod && !this.state.stripePublicKey) {
      console.warn('⚠️ No payment method available');
      this.state.validationError = dict.paymentdetails_selectpaymentmethod || 'Please add a payment method';
      this.render();
      return;
    }

    // If using Stripe Elements, create payment method first
    let paymentMethodId = this.state.selectedPaymentMethod?.id || this.state.paymentMethodToken;
    
    // If no payment method selected but Stripe is available, try to create one from card element
    // Note: On step 3, the card element container might not exist, so we use the stored token
    if (!paymentMethodId && this.state.stripePublicKey) {
      // Check if Stripe is initialized and card element exists
      if (!stripeService.stripe) {
        try {
          await stripeService.initialize(this.state.stripePublicKey);
        } catch (error) {
          console.error('❌ Failed to initialize Stripe:', error);
          this.state.validationError = 'Failed to initialize payment system. Please refresh the page.';
          this.render();
          return;
        }
      }

      // Check if card element exists, if not try to create it
      if (!stripeService.cardElement) {
        const cardElementContainer = document.getElementById('card-element');
        if (!cardElementContainer) {
          console.error('❌ card-element container not found in DOM');
          this.state.validationError = 'Payment form not available. Please go back to payment step and complete the form.';
          this.render();
          return;
        }
        try {
          await stripeService.createCardElement('card-element');
        } catch (error) {
          console.error('❌ Failed to create card element:', error);
          this.state.validationError = 'Payment form not ready. Please complete the payment form.';
          this.render();
          return;
        }
      }

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

      // Create payment method token
      const { paymentMethodId: pmId, error } = await stripeService.createPaymentMethod({
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

      paymentMethodId = pmId;
    }

    // Final validation: must have payment method ID
    if (!paymentMethodId) {
      this.state.validationError = dict.paymentdetails_selectpaymentmethod || 'Please add a payment method';
      this.render();
      return;
    }

    this.state.loading = true;
    this.state.validationError = null;
    this.render();

    try {
      // Call secure backend signup endpoint
      await this.signupAndCreateTenant(paymentMethodId);
    } catch (error) {
      console.error('❌ Error creating tenant:', error);
      this.state.loading = false;
      this.state.validationError = error.message || 'Failed to create tenant';
      this.render();
    }
  }

  async signupAndCreateTenant(paymentMethodId) {
    try {
      // Collect signup data from state
      const signupData = {
        email: this.state.email,
        password: this.state.password,
        firstName: this.state.tenantName.split(' ')[0] || this.state.tenantName,
        lastName: this.state.tenantName.split(' ').slice(1).join(' ') || '',
        tenantName: this.state.tenantName,
        brandCode: this.state.tenantDomain,
        region: this.getSelectedRegionWireValue(),
        priceId: this.state.selectedPrice?.id,
        paymentMethodId: paymentMethodId
      };

      if (!signupData.email || !signupData.password) {
        this.state.validationError = 'Email and password are required';
        this.state.loading = false;
        this.render();
        return;
      }

      // Prepare request body for backend
      const requestBody = {
        email: signupData.email,
        password: signupData.password,
        firstName: signupData.firstName,
        lastName: signupData.lastName,
        tenantName: signupData.tenantName,
        brandCode: signupData.brandCode,
        region: signupData.region,
        priceId: signupData.priceId,
        startingQuantity: this.state.totalAdminUsers || 1,
        paymentMethodId: signupData.paymentMethodId,
        ...(this.state.couponId ? { couponId: this.state.couponId } : {})
      };

      // Call secure backend signup endpoint
      const backendUrl = window.sdHosts().api + '/api/v1/tenants/tenant/signup';

      // Sanitize request body for logging (mask sensitive fields)
      const sanitizedBody = { ...requestBody };
      if (sanitizedBody.password) {
        sanitizedBody.password = '***REDACTED***';
      }

      const headers = {
        'Content-Type': 'application/json'
      };

      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error_description || errorData.error || 'Signup failed');
      }

      const result = await response.json();

      // Store tokens
      if (result.accessToken && result.idToken) {
        await auth.setZohoSession({
          accessToken: result.accessToken,
          idToken: result.idToken,
          expiresAt: (Date.now() + (result.expiresIn * 1000)).toString(),
          refreshToken: result.refreshToken || ''
        });

        // Show success
        this.showSuccess();
      } else {
        throw new Error('No tokens received from backend');
      }

    } catch (error) {
      console.error('❌ Signup error:', error);
      
      // If backend endpoint doesn't exist yet (404), show ready message
      if (error.message.includes('404') || error.message.includes('Failed to fetch')) {
        this.showBackendPendingMessage(paymentMethodId);
      } else {
        this.state.loading = false;
        this.state.validationError = error.message || 'Failed to create account';
        this.render();
      }
    }
  }

  showBackendPendingMessage(paymentMethodId) {
    const wizardContainer = document.getElementById('tenant-wizard');
    wizardContainer.innerHTML = `
      <div class="tenant-wizard">
        <div class="success-animation">
          <div class="success-icon">✓</div>
          <h2>Frontend Ready</h2>
          <p class="success-text">
            All frontend validation is complete. Backend endpoint integration pending.
          </p>
          <div class="info-box-gray">
            <h3 class="info-box-title">Account Details Ready:</h3>
            <p><strong>Business Name:</strong> ${this.state.tenantName}</p>
            <p><strong>Domain:</strong> ${this.state.tenantDomain}.sidedrawer.com</p>
            <p><strong>Region:</strong> ${(() => {
              const regionObj = this.findRegionRowBySelectValue(this.state.region);
              return regionObj ? this.getRegionOptionLabel(regionObj) : this.state.region;
            })()}</p>
            <p><strong>Subscription:</strong> ${this.state.selectedPrice?.id}</p>
            <p><strong>Payment Method:</strong> ${paymentMethodId ? 'Token: ' + paymentMethodId.substring(0, 20) + '...' : 'Selected'}</p>
          </div>
          <div class="info-box-blue">
            <h3 class="info-box-title">Backend Endpoint Ready:</h3>
            <p class="monospace fs-13 mb-0">
              <strong>POST</strong> /api/v1/auth/signup-and-login
            </p>
            <p class="fs-13 text-muted mt-12">
              The frontend will automatically call this endpoint when it's available.
              Request body includes: email, password, firstName, lastName, tenantName, 
              tenantDomain, region, priceId, paymentMethodId
            </p>
          </div>
          <button class="btn btn-success mt-24" onclick="location.reload()">
            Close
          </button>
        </div>
      </div>
    `;
  }

  showSuccess() {
    const wizardContainer = document.getElementById('tenant-wizard');
    wizardContainer.innerHTML = `
      <div class="tenant-wizard">
        <div class="success-animation">
          <div class="success-icon">✓</div>
          <h2>Account Created Successfully!</h2>
          <p class="success-text">
            Your SideDrawer account has been created and you are now logged in.
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

  getCurrencyFlag(currency) {
    const flags = {
      'usd': '🇺🇸',
      'cad': '🇨🇦',
      'gbp': '🇬🇧',
      'eur': '🇪🇺',
      'aud': '🇦🇺'
    };
    return flags[currency.toLowerCase()] || '💳';
  }

  formatPrice(amount, currency) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100);
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

// Initialize tenant creation wizard FIRST (before auth, so it's available when needed)
const tenantWizard = new TenantCreationWizard();

// Expose to window for onclick handlers and for SideDrawerAuth to access
window.tenantWizard = tenantWizard;

// Make sure it's available globally
if (typeof tenantWizard === 'undefined') {
  console.error('❌ Failed to initialize TenantCreationWizard');
} else {
  console.log('✅ TenantCreationWizard initialized');
}

