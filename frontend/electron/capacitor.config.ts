import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.anurag.thinking-space',
  appName: 'Thinking Space',
  webDir: 'dist',
  server: {
    cleartext: true,
  },
  ios: {
    scheme: 'Thinking Space',
    // 'never' = edge-to-edge webview. 'automatic' let UIKit inset the web
    // content below the top screen edge, which showed as a pale bar above the
    // status bar once dark backdrops landed. viewport-fit=cover +
    // env(safe-area-inset-top) own the insets instead.
    contentInset: 'never',
    scrollEnabled: false,
    allowsLinkPreview: false,
  },
  plugins: {
    // Route fetch() / XHR through the native HTTP layer on iOS so external
    // HTTPS requests (RSS feeds, etc.) are not blocked by WKWebView's CORS policy.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

// @capacitor-community/electron reads this but the base type doesn't include it
(config as any).electron = { customUrlScheme: 'ltm-app' };

export default config;
