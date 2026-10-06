# Nuclear VPN Status Indicator Plugin (`nuclear-vpn-indicator`)

> A subtle, real-time VPN and proxy connection indicator built for [Nuclear Music Player](https://nuclearplayer.com). Positioned directly adjacent to the top navigation dark/light mode toggle switch.

![Nuclear VPN Status Indicator](https://raw.githubusercontent.com/HuggingBunny/nuclear-vpn-indicator/main/preview.png)

---

## Overview

When streaming music over VPN connections, streaming providers (such as YouTube CDN nodes) frequently throttle or drop connections with HTTP 403 Forbidden errors due to bot detection and datacenter IP flagging.

**Nuclear VPN Status Indicator** provides immediate visual awareness of your active network routing directly inside Nuclear's header bar:
- **Zero clutter**: Styled as a compact rounded-pill badge (`h-6`, `text-xs`) that natively blends with Nuclear's interface in both light and dark themes.
- **Header Placement**: Placed directly to the left of the theme toggle switch (`Toggle theme`) in the top right window controls area.
- **Glassmorphic Tooltip Card**: Hovering over the badge displays public IP address, geographic location (City, Country), ISP / organization name, and connection status. Clicking triggers an instant manual re-check.
- **Multi-Tiered Detection**: Combines CORS-free IP intelligence with WebRTC local tunnel interface inspection.

---

## Visual States

| State | Visual Badge | Popover Details |
|---|---|---|
| **VPN / Proxy Active** | Emerald glowing dot + `VPN · <Country>` (e.g. `VPN · SE`) | `● VPN Active` · Public IP · Hosting/VPN Provider · Location · Last Checked |
| **Direct Connection** | Muted dot + `DIRECT · <Country>` (e.g. `DIRECT · PL`) | `○ Direct Connection` · Public IP · ISP Organization · Location · Last Checked |
| **Checking / Refresh** | Rotating shield icon animation | Real-time query in progress |

---

## Detection Architecture

The plugin uses a universal multi-tier detection pipeline designed to operate reliably across Linux, macOS, and Windows:

1. **Native CORS-Free IP Intelligence**:
   - Queries `http://ip-api.com/json/?fields=status,message,country,countryCode,city,isp,org,as,query,proxy,hosting` through Nuclear's Tauri backend HTTP bridge (`api.Http.fetch`).
   - Evaluates `proxy: true` and `hosting: true` flags (identifies commercial VPN exit nodes, datacenter relays, and Tor/proxy exits).
   - Secondary fallback to `https://ipinfo.io/json`.
2. **Provider & ASN Keyword Matching**:
   - Matches Autonomous System Numbers (ASNs) and Organization names against a comprehensive directory of VPN providers (NordVPN, Mullvad, ProtonVPN, WireGuard, Tailscale, PacketHub, M247, DataCamp, Tzulo, CDN77, etc.).
3. **WebRTC Local ICE Tunnel Analysis**:
   - Uses zero-server `RTCPeerConnection` candidate probing to identify local virtual tunnel interfaces (`10.x.x.x` ranges or Carrier-Grade NAT `100.64.0.0/10` Tailscale/WireGuard endpoints) on the client machine.
4. **DOM Mutation Resilience**:
   - Uses an active `MutationObserver` on `document.body` to automatically re-mount the indicator whenever Nuclear's header re-renders during route navigation or theme switches.

---

## Configurable Settings

The plugin registers with Nuclear's native Settings subsystem (`api.Settings`):

- **Check Interval**: Frequency of automatic background checks (`15s`, `30s` (Default), `60s`, `120s`).
- **Show When Direct**: Toggle whether to show a muted badge when connected directly without a VPN (Default: `true`).
- **Show Location Code**: Toggle display of country code in the badge pill (e.g., `VPN · SE` vs `VPN ON`) (Default: `true`).

---

## Installation

### Manual Installation (Local)

1. Clone or copy this repository into your Nuclear plugins directory:
   ```bash
   mkdir -p ~/.local/share/com.nuclearplayer/plugins/nuclear-vpn-indicator/1.0.0
   cp package.json index.js README.md LICENSE ~/.local/share/com.nuclearplayer/plugins/nuclear-vpn-indicator/1.0.0/
   ```
2. Enable the plugin in `~/.local/share/com.nuclearplayer/plugins.json` or open Nuclear → **Settings** → **Plugins** and click **Add Plugin**.
3. Restart Nuclear.

---

## Development & Packaging

Create a distributable `.zip` archive for distribution or submission to the Nuclear Plugin Registry:

```bash
npm run package
```

Produces `nuclear-vpn-indicator.zip` containing `package.json`, `index.js`, `README.md`, and `LICENSE`.

---

## License

MIT License © 2026 Chad Longanecker
