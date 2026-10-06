/**
 * Nuclear Music Player - VPN Status Indicator Plugin
 * Author: Chad Longanecker
 * License: MIT
 *
 * Provides a clear, subtle real-time VPN & proxy status indicator
 * positioned directly next to the dark/light mode toggle in Nuclear's top navigation.
 */
'use strict';

const PLUGIN_ID = 'nuclear-vpn-indicator';
const BADGE_ID = 'nuclear-vpn-indicator-badge';
const POPOVER_ID = 'nuclear-vpn-indicator-popover';
const STYLE_ID = 'nuclear-vpn-indicator-styles';

// Known VPN & hosting/datacenter keywords in ISP/Org/AS fields
const KNOWN_VPN_KEYWORDS = [
  'vpn', 'proxy', 'tor', 'nordvpn', 'mullvad', 'proton', 'expressvpn',
  'surfshark', 'cyberghost', 'private internet access', 'pia', 'packethub',
  'm247', 'datacamp', 'tzulo', 'cdn77', 'leaseweb', 'choopa', 'ovh',
  'linode', 'digitalocean', 'vultr', 'hetzner', 'contabo', 'wireguard',
  'openvpn', 'tailscale', 'cloudflare warp', 'hostinger'
];

class VpnIndicatorPlugin {
  constructor() {
    this.api = null;
    this.badgeEl = null;
    this.popoverEl = null;
    this.mutationObserver = null;
    this.pollTimer = null;
    this.isChecking = false;
    this.activePopover = false;

    this.state = {
      isVpn: false,
      ip: null,
      country: null,
      countryCode: null,
      city: null,
      isp: null,
      org: null,
      lastChecked: null,
      error: null
    };

    this.settings = {
      checkInterval: 30, // seconds
      showWhenDirect: true,
      showLocation: true
    };
  }

  async onLoad(api) {
    this.api = api;
    if (this.api?.Settings?.register) {
      await this.api.Settings.register([
        {
          id: 'checkInterval',
          title: 'Check Interval',
          description: 'How frequently to verify VPN connection status',
          category: 'Utilities',
          kind: 'enum',
          options: [
            { value: '15', label: '15 seconds' },
            { value: '30', label: '30 seconds (Default)' },
            { value: '60', label: '60 seconds' },
            { value: '120', label: '2 minutes' }
          ],
          default: '30'
        },
        {
          id: 'showWhenDirect',
          title: 'Show When Direct',
          description: 'Display a subtle indicator even when connected directly without a VPN',
          category: 'Utilities',
          kind: 'boolean',
          default: true,
          widget: { type: 'toggle' }
        },
        {
          id: 'showLocation',
          title: 'Show Location Code',
          description: 'Display country code in badge pill (e.g. VPN · SE)',
          category: 'Utilities',
          kind: 'boolean',
          default: true,
          widget: { type: 'toggle' }
        }
      ]);
    }
  }

  async onEnable(api) {
    this.api = api;
    this.api?.Logger?.info('[VpnIndicator] Enabling VPN Indicator plugin');

    await this.loadSettings();
    this.injectStyles();
    this.setupNetworkListeners();
    this.mountBadge();
    this.startObserver();

    // Initial check
    await this.checkVpnStatus();

    // Start polling loop
    this.startPolling();

    // Listen for setting changes
    if (this.api?.Settings?.subscribe) {
      this.api.Settings.subscribe('checkInterval', (v) => {
        const val = parseInt(v, 10);
        if (!isNaN(val) && val >= 10) {
          this.settings.checkInterval = val;
          this.startPolling();
        }
      });
      this.api.Settings.subscribe('showWhenDirect', (v) => {
        this.settings.showWhenDirect = !!v;
        this.updateBadgeUI();
      });
      this.api.Settings.subscribe('showLocation', (v) => {
        this.settings.showLocation = !!v;
        this.updateBadgeUI();
      });
    }

    this.api?.Logger?.info('[VpnIndicator] VPN Indicator active');
  }

  async loadSettings() {
    if (!this.api?.Settings?.get) return;
    try {
      const interval = await this.api.Settings.get('checkInterval');
      if (interval) {
        const parsed = parseInt(interval, 10);
        if (!isNaN(parsed) && parsed >= 10) this.settings.checkInterval = parsed;
      }
      const direct = await this.api.Settings.get('showWhenDirect');
      if (direct !== undefined) this.settings.showWhenDirect = !!direct;

      const loc = await this.api.Settings.get('showLocation');
      if (loc !== undefined) this.settings.showLocation = !!loc;
    } catch (e) {
      this.api?.Logger?.warn('[VpnIndicator] Failed loading settings, using defaults', e);
    }
  }

  injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BADGE_ID} {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 24px;
        padding: 0 9px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        border: 1px solid transparent;
        font-family: inherit;
        z-index: 40;
      }

      #${BADGE_ID}:hover {
        filter: brightness(1.12);
        transform: translateY(-0.5px);
      }

      #${BADGE_ID}:active {
        transform: translateY(0.5px);
      }

      /* Active VPN state */
      #${BADGE_ID}.vpn-active {
        background: rgba(16, 185, 129, 0.12);
        border-color: rgba(16, 185, 129, 0.32);
        color: #10b981;
      }

      #${BADGE_ID}.vpn-active .vpn-dot {
        background: #10b981;
        box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
      }

      /* Direct connection state */
      #${BADGE_ID}.vpn-direct {
        background: rgba(255, 255, 255, 0.04);
        border-color: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.55);
      }

      #${BADGE_ID}.vpn-direct .vpn-dot {
        background: rgba(255, 255, 255, 0.35);
        box-shadow: none;
      }

      html:not([data-theme="dark"]) #${BADGE_ID}.vpn-direct {
        background: rgba(0, 0, 0, 0.04);
        border-color: rgba(0, 0, 0, 0.12);
        color: rgba(0, 0, 0, 0.55);
      }

      html:not([data-theme="dark"]) #${BADGE_ID}.vpn-direct .vpn-dot {
        background: rgba(0, 0, 0, 0.35);
      }

      html:not([data-theme="dark"]) #${BADGE_ID}.vpn-active {
        background: rgba(5, 150, 105, 0.1);
        border-color: rgba(5, 150, 105, 0.35);
        color: #059669;
      }

      html:not([data-theme="dark"]) #${BADGE_ID}.vpn-active .vpn-dot {
        background: #059669;
        box-shadow: 0 0 6px rgba(5, 150, 105, 0.5);
      }

      /* Dot */
      #${BADGE_ID} .vpn-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: background 0.3s ease, box-shadow 0.3s ease;
      }

      /* Refresh spinning state */
      #${BADGE_ID}.checking .vpn-icon {
        animation: vpn-spin 0.8s linear infinite;
      }

      @keyframes vpn-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* Tooltip popover card */
      #${POPOVER_ID} {
        position: absolute;
        top: 32px;
        right: 0;
        width: 260px;
        background: rgba(22, 24, 29, 0.96);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        padding: 12px 14px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
        color: #f3f4f6;
        font-family: inherit;
        font-size: 11px;
        z-index: 9999;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-4px);
        transition: opacity 0.18s ease, transform 0.18s ease;
      }

      html:not([data-theme="dark"]) #${POPOVER_ID} {
        background: rgba(255, 255, 255, 0.97);
        border: 1px solid rgba(0, 0, 0, 0.12);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.15);
        color: #1f2937;
      }

      #${POPOVER_ID}.visible {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }

      .vpn-popover-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 8px;
        margin-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      html:not([data-theme="dark"]) .vpn-popover-header {
        border-bottom-color: rgba(0, 0, 0, 0.08);
      }

      .vpn-popover-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        font-size: 12px;
      }

      .vpn-popover-status.active {
        color: #10b981;
      }

      .vpn-popover-status.direct {
        color: #9ca3af;
      }

      .vpn-popover-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 5px;
        gap: 8px;
      }

      .vpn-popover-label {
        color: #9ca3af;
        font-weight: 500;
      }

      .vpn-popover-value {
        font-weight: 600;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 160px;
      }

      .vpn-popover-footer {
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10px;
        color: #6b7280;
      }

      .vpn-popover-refresh-btn {
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 10px;
        text-decoration: underline;
        padding: 0;
      }
      .vpn-popover-refresh-btn:hover {
        color: #10b981;
      }
    `;
    document.head.appendChild(style);
  }

  mountBadge() {
    if (document.getElementById(BADGE_ID)) return;

    // Locate the dark/light toggle in Nuclear's header
    const switchBtn = document.querySelector('button[aria-label="Toggle theme"]') ||
                      document.querySelector('button[role="switch"].justify-self-end') ||
                      document.querySelector('button[role="switch"]');

    if (!switchBtn || !switchBtn.parentElement) return;

    const badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.setAttribute('aria-label', 'VPN Status Indicator');

    // Shield Icon SVG + Dot + Label Text
    badge.innerHTML = `
      <svg class="vpn-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <span class="vpn-dot"></span>
      <span class="vpn-text">CHECKING</span>
    `;

    // Tooltip Card Popover
    const popover = document.createElement('div');
    popover.id = POPOVER_ID;
    badge.appendChild(popover);

    // Event handlers
    badge.addEventListener('mouseenter', () => this.showPopover());
    badge.addEventListener('mouseleave', () => this.hidePopover());
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.checkVpnStatus(true);
    });

    // Insert directly to the left of the switch button
    switchBtn.parentElement.insertBefore(badge, switchBtn);
    this.badgeEl = badge;
    this.popoverEl = popover;

    this.updateBadgeUI();
  }

  showPopover() {
    if (!this.popoverEl) return;
    this.renderPopoverContent();
    this.popoverEl.classList.add('visible');
    this.activePopover = true;
  }

  hidePopover() {
    if (!this.popoverEl) return;
    this.popoverEl.classList.remove('visible');
    this.activePopover = false;
  }

  renderPopoverContent() {
    if (!this.popoverEl) return;
    const { isVpn, ip, country, countryCode, city, isp, org, lastChecked, error } = this.state;

    const timeAgo = lastChecked
      ? `${Math.max(0, Math.round((Date.now() - lastChecked) / 1000))}s ago`
      : 'Never';

    const locationStr = [city, country || countryCode].filter(Boolean).join(', ') || 'Unknown';
    const providerStr = isp || org || 'Unknown';

    this.popoverEl.innerHTML = `
      <div class="vpn-popover-header">
        <div class="vpn-popover-status ${isVpn ? 'active' : 'direct'}">
          <span style="width:7px;height:7px;border-radius:50%;background:${isVpn ? '#10b981' : '#9ca3af'};display:inline-block"></span>
          <span>${isVpn ? 'VPN Active' : 'Direct Connection'}</span>
        </div>
      </div>
      <div class="vpn-popover-row">
        <span class="vpn-popover-label">IP Address</span>
        <span class="vpn-popover-value">${ip || (error ? 'Check error' : 'Resolving...')}</span>
      </div>
      <div class="vpn-popover-row">
        <span class="vpn-popover-label">Location</span>
        <span class="vpn-popover-value" title="${locationStr}">${locationStr}</span>
      </div>
      <div class="vpn-popover-row">
        <span class="vpn-popover-label">ISP / Org</span>
        <span class="vpn-popover-value" title="${providerStr}">${providerStr}</span>
      </div>
      <div class="vpn-popover-footer">
        <span>Checked: ${timeAgo}</span>
        <button class="vpn-popover-refresh-btn" type="button">↻ Refresh</button>
      </div>
    `;

    const refreshBtn = this.popoverEl.querySelector('.vpn-popover-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.checkVpnStatus(true);
      });
    }
  }

  updateBadgeUI() {
    if (!this.badgeEl) return;

    const { isVpn, countryCode, error } = this.state;
    const textEl = this.badgeEl.querySelector('.vpn-text');

    if (!this.settings.showWhenDirect && !isVpn) {
      this.badgeEl.style.display = 'none';
      return;
    } else {
      this.badgeEl.style.display = 'inline-flex';
    }

    if (this.isChecking) {
      this.badgeEl.classList.add('checking');
    } else {
      this.badgeEl.classList.remove('checking');
    }

    if (error) {
      this.badgeEl.className = 'vpn-direct';
      if (textEl) textEl.textContent = 'NET: ERR';
      return;
    }

    if (isVpn) {
      this.badgeEl.classList.remove('vpn-direct');
      this.badgeEl.classList.add('vpn-active');
      if (textEl) {
        textEl.textContent = this.settings.showLocation && countryCode
          ? `VPN · ${countryCode}`
          : 'VPN ON';
      }
    } else {
      this.badgeEl.classList.remove('vpn-active');
      this.badgeEl.classList.add('vpn-direct');
      if (textEl) {
        textEl.textContent = this.settings.showLocation && countryCode
          ? `DIRECT · ${countryCode}`
          : 'DIRECT';
      }
    }

    if (this.activePopover) {
      this.renderPopoverContent();
    }
  }

  async fetchHttp(url) {
    if (this.api?.Http?.fetch) {
      try {
        const res = await this.api.Http.fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        if (typeof res.json === 'function') {
          return await res.json();
        }
        if (typeof res.body === 'string') {
          return JSON.parse(res.body);
        }
        if (typeof res.body === 'object' && res.body !== null) {
          return res.body;
        }
      } catch (err) {
        this.api?.Logger?.warn(`[VpnIndicator] api.Http.fetch failed for ${url}:`, err);
      }
    }

    // Standard browser fetch fallback
    const res = await window.fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    return await res.json();
  }

  async checkVpnStatus(isManual = false) {
    if (this.isChecking) return;
    this.isChecking = true;
    this.updateBadgeUI();

    try {
      // Primary check: ip-api.com
      let data = null;
      try {
        data = await this.fetchHttp(
          'http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,isp,org,as,query,proxy,hosting'
        );
      } catch (_) {
        // Fallback: ipinfo.io
        try {
          data = await this.fetchHttp('https://ipinfo.io/json');
          if (data && data.ip) {
            data = {
              status: 'success',
              query: data.ip,
              country: data.country,
              countryCode: data.country,
              city: data.city,
              isp: data.org,
              org: data.org,
              as: data.org,
              hosting: true // unknown, will fall back to keyword match
            };
          }
        } catch (e2) {
          throw new Error('All IP intelligence endpoints failed');
        }
      }

      if (!data || data.status === 'fail') {
        throw new Error(data?.message || 'Failed to resolve network IP');
      }

      const ip = data.query || data.ip;
      const country = data.country || '';
      const countryCode = data.countryCode || data.country || '';
      const city = data.city || '';
      const isp = data.isp || '';
      const org = data.org || '';
      const as = data.as || '';

      const matchText = `${isp} ${org} ${as}`.toLowerCase();
      const hasVpnKeyword = KNOWN_VPN_KEYWORDS.some(kw => matchText.includes(kw));
      const isProxyOrHosting = Boolean(data.proxy || data.hosting);

      // WebRTC tunnel cross-check
      const localTunnels = await this.detectLocalTunnelInterfaces();
      const hasLocalTunnel = localTunnels.length > 0;

      const isVpn = isProxyOrHosting || hasVpnKeyword || hasLocalTunnel;

      this.state = {
        isVpn,
        ip,
        country,
        countryCode,
        city,
        isp,
        org,
        lastChecked: Date.now(),
        error: null
      };

      this.api?.Logger?.info(`[VpnIndicator] Status check: isVpn=${isVpn} (${ip}, ${countryCode})`);
    } catch (err) {
      this.api?.Logger?.warn('[VpnIndicator] VPN check error:', err);
      this.state.error = err.message;
      this.state.lastChecked = Date.now();
    } finally {
      this.isChecking = false;
      this.updateBadgeUI();
    }
  }

  /**
   * Universal WebRTC ICE candidate inspection.
   * Detects local tunnel addresses (10.x.x.x, 100.64.x.x CGNAT, etc.)
   */
  async detectLocalTunnelInterfaces() {
    return new Promise((resolve) => {
      const tunnels = [];
      try {
        const RTCPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (!RTCPC) return resolve([]);

        const pc = new RTCPC({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});

        pc.onicecandidate = (ice) => {
          if (!ice || !ice.candidate || !ice.candidate.candidate) {
            try { pc.close(); } catch (_) {}
            return resolve(tunnels);
          }
          const cand = ice.candidate.candidate;
          const parts = cand.split(' ');
          const ip = parts[4];
          if (ip) {
            // Check for VPN tunnels (10.x.x.x or 100.64.0.0/10 Tailscale/Wireguard)
            if (ip.startsWith('10.') || (ip.startsWith('100.') && this.isCgnatIp(ip))) {
              tunnels.push(ip);
            }
          }
        };

        setTimeout(() => {
          try { pc.close(); } catch (_) {}
          resolve(tunnels);
        }, 600);
      } catch (_) {
        resolve([]);
      }
    });
  }

  isCgnatIp(ip) {
    const parts = ip.split('.').map(Number);
    return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const ms = Math.max(10, this.settings.checkInterval) * 1000;
    this.pollTimer = setInterval(() => {
      this.checkVpnStatus();
    }, ms);
  }

  setupNetworkListeners() {
    this.onlineHandler = () => this.checkVpnStatus(true);
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.onlineHandler);
  }

  startObserver() {
    if (this.mutationObserver) return;

    let debounceTimer = null;
    this.mutationObserver = new MutationObserver(() => {
      if (!document.getElementById(BADGE_ID)) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.mountBadge();
        }, 150);
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  onDisable() {
    this.api?.Logger?.info('[VpnIndicator] Disabling VPN Indicator plugin');
    this.teardown();
  }

  onUnload() {
    this.api?.Logger?.info('[VpnIndicator] Unloading VPN Indicator plugin');
    this.teardown();
  }

  teardown() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      window.removeEventListener('offline', this.onlineHandler);
      this.onlineHandler = null;
    }

    const badge = document.getElementById(BADGE_ID);
    if (badge) badge.remove();

    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();

    this.badgeEl = null;
    this.popoverEl = null;
  }
}

const pluginInstance = new VpnIndicatorPlugin();

module.exports = {
  onLoad: (api) => pluginInstance.onLoad(api),
  onEnable: (api) => pluginInstance.onEnable(api),
  onDisable: (api) => pluginInstance.onDisable(api),
  onUnload: (api) => pluginInstance.onUnload(api)
};
