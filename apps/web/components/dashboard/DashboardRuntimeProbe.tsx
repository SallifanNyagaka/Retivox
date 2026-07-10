/**
 * DashboardRuntimeProbe injects a tiny browser script into the dashboard shell.
 *
 * The script runs outside React so it can reveal whether dashboard JavaScript is
 * executing and surface any global runtime or rejection errors visibly.
 */

/**
 * DashboardRuntimeProbe server component.
 */
export default function DashboardRuntimeProbe() {
  const script = `
    (function () {
      var bannerId = 'dashboard-runtime-probe';

      function ensureBanner() {
        var existing = document.getElementById(bannerId);
        if (existing) {
          return existing;
        }

        var banner = document.createElement('div');
        banner.id = bannerId;
        banner.style.position = 'fixed';
        banner.style.left = '12px';
        banner.style.bottom = '12px';
        banner.style.zIndex = '90';
        banner.style.padding = '8px 12px';
        banner.style.borderRadius = '999px';
        banner.style.fontSize = '12px';
        banner.style.fontWeight = '600';
        banner.style.boxShadow = '0 10px 24px rgba(0,0,0,0.18)';
        banner.style.background = 'var(--color-success-light)';
        banner.style.color = 'var(--color-success)';
        banner.style.border = '1px solid var(--color-success)';
        banner.textContent = 'Dashboard runtime active';
        document.body.appendChild(banner);
        return banner;
      }

      function showError(message) {
        var banner = ensureBanner();
        banner.style.background = 'var(--color-danger-light)';
        banner.style.color = 'var(--color-danger)';
        banner.style.borderColor = 'var(--color-danger)';
        banner.textContent = message.slice(0, 180);
      }

      window.addEventListener('error', function (event) {
        var message = event && event.message ? String(event.message) : 'Dashboard runtime error';
        showError(message);
      });

      window.addEventListener('unhandledrejection', function (event) {
        var reason = event && event.reason ? (event.reason.message || String(event.reason)) : 'Unhandled rejection';
        showError(reason);
      });

      window.addEventListener('DOMContentLoaded', function () {
        ensureBanner();
      }, { once: true });

      if (document.readyState !== 'loading') {
        ensureBanner();
      }
    })();
  `

  return (
    <>
      <div
        id="dashboard-runtime-probe"
        aria-live="polite"
        style={{
          position: 'fixed',
          left: '12px',
          bottom: '12px',
          zIndex: 90,
          padding: '8px 12px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
          background: 'var(--color-success-light)',
          color: 'var(--color-success)',
          border: '1px solid var(--color-success)',
        }}
      >
        Dashboard shell loaded
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </>
  )
}
