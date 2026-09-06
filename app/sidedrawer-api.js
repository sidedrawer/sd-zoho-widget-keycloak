/**
 * SideDrawer API Helper
 * 
 * This module provides helper functions for making authenticated
 * API calls to SideDrawer after OAuth authentication is complete.
 */

class SideDrawerAPI {
  constructor() {
    this.baseURL = window.sdHosts().userApi;
    this.tenantURL = window.sdHosts().tenants;
    this.storageKeys = {
      accessToken: 'sidedrawer_access_token',
      refreshToken: 'sidedrawer_refresh_token',
      tokenExpiry: 'sidedrawer_token_expiry'
    };
  }

  /**
   * Get the current access token
   */
  getAccessToken() {
    return localStorage.getItem(this.storageKeys.accessToken);
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    const token = this.getAccessToken();
    const expiry = localStorage.getItem(this.storageKeys.tokenExpiry);
    
    if (!token || !expiry) return false;
    
    // Check if token is expired
    return Date.now() < parseInt(expiry);
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint (e.g., '/users/me', '/documents')
   * @param {object} options - Fetch options (method, body, etc.)
   */
  async request(endpoint, options = {}) {
    const token = this.getAccessToken();
    
    if (!token) {
      throw new Error('Not authenticated. Please connect to SideDrawer first.');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
    
    const defaultHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers
      }
    };

    try {
      const response = await fetch(url, config);
      
      if (response.status === 401) {
        throw new Error('Authentication expired. Please reconnect.');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('SideDrawer API Error:', error);
      throw error;
    }
  }

  /**
   * Get current user information
   */
  async getCurrentUser() {
    return this.request('/me');
  }

  /**
   * Get tenant information
   * @returns {Promise<object>} Tenant information including tenantId, brandCode, and region
   */
  async getTenantInfo() {
    const token = this.getAccessToken();
    
    if (!token) {
      throw new Error('Not authenticated. Please connect to SideDrawer first.');
    }

    const response = await fetch(`${this.tenantURL}/api/v1/tenants/tenant/shared`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get tenant info: ${response.status}`);
    }

    const data = await response.json();
    
    if (data && data.length > 0) {
      const tenant = data[0];
      return { 
        tenantId: tenant.id || "", 
        brandCode: tenant.defaultBrandCode || "", 
        region: tenant.region || "",
        tenant: tenant // Include full tenant object for additional data
      };
    }
    
    throw new Error('No tenant data available');
  }

  /**
   * Get user's documents
   * @param {object} params - Query parameters (limit, offset, etc.)
   */
  async getDocuments(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = `/documents${queryString ? '?' + queryString : ''}`;
    return this.request(endpoint);
  }

  /**
   * Get a specific document by ID
   * @param {string} documentId - Document ID
   */
  async getDocument(documentId) {
    return this.request(`/documents/${documentId}`);
  }

  /**
   * Upload a document
   * @param {FormData} formData - Form data with file and metadata
   */
  async uploadDocument(formData) {
    const token = this.getAccessToken();
    
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${this.baseURL}/documents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
        // Don't set Content-Type - browser will set it with boundary for FormData
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Share a document with a client
   * @param {string} documentId - Document ID
   * @param {object} shareData - Share configuration (email, permissions, etc.)
   */
  async shareDocument(documentId, shareData) {
    return this.request(`/documents/${documentId}/share`, {
      method: 'POST',
      body: JSON.stringify(shareData)
    });
  }

  /**
   * Get clients list
   * @param {object} params - Query parameters
   */
  async getClients(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = `/clients${queryString ? '?' + queryString : ''}`;
    return this.request(endpoint);
  }

  /**
   * Get a specific client by ID
   * @param {string} clientId - Client ID
   */
  async getClient(clientId) {
    return this.request(`/clients/${clientId}`);
  }

  /**
   * Create a new client
   * @param {object} clientData - Client information
   */
  async createClient(clientData) {
    return this.request('/clients', {
      method: 'POST',
      body: JSON.stringify(clientData)
    });
  }

  /**
   * Update client information
   * @param {string} clientId - Client ID
   * @param {object} clientData - Updated client information
   */
  async updateClient(clientId, clientData) {
    return this.request(`/clients/${clientId}`, {
      method: 'PATCH',
      body: JSON.stringify(clientData)
    });
  }

  /**
   * Get folders/vaults
   * @param {object} params - Query parameters
   */
  async getFolders(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = `/folders${queryString ? '?' + queryString : ''}`;
    return this.request(endpoint);
  }

  /**
   * Search across documents
   * @param {string} query - Search query
   * @param {object} filters - Additional filters
   */
  async search(query, filters = {}) {
    return this.request('/search', {
      method: 'POST',
      body: JSON.stringify({ query, ...filters })
    });
  }

  /**
   * Get activity/audit log
   * @param {object} params - Query parameters (startDate, endDate, etc.)
   */
  async getActivity(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = `/activity${queryString ? '?' + queryString : ''}`;
    return this.request(endpoint);
  }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.SideDrawerAPI = SideDrawerAPI;
}

