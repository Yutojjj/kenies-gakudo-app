import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes" />

        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#FF69B4" />

        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="学童クラブ" />
        <link rel="apple-touch-icon" href="/icon-192.png" />

        <link rel="icon" href="/favicon.ico" />
        <ScrollViewStyleReset />

        {/* iOSでinput/textareaフォーカス時の自動ズームを防ぐ（16px未満だとiOSが自動拡大する仕様への対処） */}
        <style dangerouslySetInnerHTML={{ __html: `
          input, textarea, select {
            font-size: 16px !important;
          }
          @media (hover: hover) and (pointer: fine) {
            button:not(:disabled):hover:not(:has(button:hover, a:hover, [role="button"]:hover)),
            a:hover:not(:has(button:hover, a:hover, [role="button"]:hover)),
            [role="button"]:not([aria-disabled="true"]):hover:not(:has(button:hover, a:hover, [role="button"]:hover)) {
              filter: brightness(0.9);
              cursor: pointer;
            }
            button:focus-visible,
            a:focus-visible,
            [role="button"]:focus-visible {
              outline: 2px solid #00AEB8;
              outline-offset: 2px;
            }
          }
          @media print {
            .no-print { display: none !important; }
          }
          body.printing-cert .no-print { display: none !important; }
          @media print {
            body.printing-cert > div > div > div:not(.cert-print-target) { display: none !important; }
            body.printing-cert .cert-print-target { display: block !important; }
          }
        `}} />

        <script dangerouslySetInnerHTML={{
          __html: `
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function () {
                navigator.serviceWorker.register('/sw.js');
              });
            }
          `
        }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
