import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* PWA: Android/Chrome インストール */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#FF69B4" />

        {/* PWA: iOS Safari ホーム画面追加 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="学童クラブ" />
        <link rel="apple-touch-icon" href="/assets/images/icon.png" />

        <link rel="icon" href="/favicon.ico" />
        <ScrollViewStyleReset />

        {/* Service Worker登録（Android PWAインストールに必須） */}
        <script dangerouslySetInnerHTML={{
          __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js');});}`
        }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
