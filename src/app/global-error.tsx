'use client';

// Replaces the root layout when it fails, so it carries its own <html> and minimal inline styles.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif",
          background: '#fff8ec',
          color: '#4a3c63',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div style={{ fontSize: 56 }}>🌙</div>
        <h1 style={{ margin: 0 }}>Moonie needs a quick nap</h1>
        <p style={{ margin: 0 }}>Something went wrong while loading the page.</p>
        <button
          onClick={reset}
          style={{ padding: '10px 22px', borderRadius: 999, border: 0, background: '#ffafcc', color: '#3d2c5c', fontWeight: 700, cursor: 'pointer' }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
