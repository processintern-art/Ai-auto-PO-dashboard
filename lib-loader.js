/* ============================================================
   AI Auto PO Dashboard — Library Loader
   Loads each external dependency from a list of CDN mirrors,
   trying the next mirror only if the previous one fails to
   actually define its expected global (not just "the request
   didn't error" — some networks serve a 200 OK error page for
   blocked domains, which would otherwise pass silently).

   Exposes a promise at window.POLibsReady that resolves once
   every library is confirmed loaded, or rejects with the list
   of libraries that could not be loaded from any mirror.
   ============================================================ */
(function () {
  'use strict';

  // Each entry: a global name to check for, and a list of CDN URLs to try in order.
  const LIBS = [
    {
      name: 'XLSX',
      check: () => typeof window.XLSX !== 'undefined',
      urls: [
        'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
        'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'
      ]
    },
    {
      name: 'Chart',
      check: () => typeof window.Chart !== 'undefined',
      urls: [
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/chart.js/4.4.4/chart.umd.min.js',
        'https://unpkg.com/chart.js@4.4.4/dist/chart.umd.min.js'
      ]
    },
    {
      name: 'jsPDF',
      check: () => typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF !== 'undefined',
      urls: [
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
      ]
    },
    {
      name: 'jsPDF-AutoTable',
      // autoTable attaches itself to the jsPDF prototype, so we check for the method instead of a separate global
      check: () => typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF !== 'undefined' && typeof window.jspdf.jsPDF.API.autoTable !== 'undefined',
      urls: [
        'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
        'https://unpkg.com/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'
      ],
      // Must load strictly after jsPDF itself, since it patches the jsPDF prototype
      dependsOn: 'jsPDF'
    },
    {
      name: 'PptxGenJS',
      check: () => typeof window.PptxGenJS !== 'undefined',
      urls: [
        'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js',
        'https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
      ]
    }
  ];

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = false; // preserve execution order within this loader
      script.onload = () => resolve(url);
      script.onerror = () => reject(new Error('Failed to load ' + url));
      document.head.appendChild(script);
    });
  }

  /**
   * Try each URL for a lib in order. After each script tag finishes loading,
   * verify the expected global actually exists before declaring success —
   * this catches cases where a CDN serves a 200 response with non-JS content
   * (e.g. a blocked-domain placeholder page) that would otherwise look fine.
   */
  async function loadLib(lib) {
    if (lib.check()) return true; // already loaded (e.g. duplicate entries)
    for (const url of lib.urls) {
      try {
        await loadScript(url);
        // Give the script a brief tick to finish executing/registering globals
        await new Promise(r => setTimeout(r, 0));
        if (lib.check()) return true;
      } catch (e) {
        // try next mirror
      }
    }
    return false;
  }

  async function loadAll() {
    const failed = [];
    const byName = {};
    LIBS.forEach(l => { byName[l.name] = l; });

    for (const lib of LIBS) {
      if (lib.dependsOn) {
        const dep = byName[lib.dependsOn];
        // dependency should already be processed since LIBS is in order; nothing extra needed here,
        // loadLib() for this lib will simply fail its check() if the dependency didn't load.
      }
      const ok = await loadLib(lib);
      if (!ok) failed.push(lib.name);
    }
    return failed;
  }

  window.POLibsReady = loadAll().then(failed => {
    if (failed.length) {
      const banner = document.getElementById('libLoadError');
      const list = document.getElementById('libLoadErrorList');
      if (banner) {
        if (list) list.textContent = failed.join(', ');
        banner.style.display = 'block';
      }
      throw new Error('Failed to load: ' + failed.join(', '));
    }
    return true;
  });
})();
