(() => {
  const CONTENT_SELECTOR = 'main.main-content';
  const ADMIN_PATHS = ['/admin', '/admin/products', '/admin/logs', '/admin/settings', '/admin/embed', '/admin/roles'];
  let isNavigating = false;

  function isAdminPath(url) {
    return ADMIN_PATHS.includes(url.pathname);
  }

  function setActiveLink(pathname) {
    document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
      const linkUrl = new URL(link.href, window.location.origin);
      link.classList.toggle('active', linkUrl.pathname === pathname);
    });
  }

  function hasScript(src) {
    return Array.from(document.scripts).some(script => script.src === new URL(src, window.location.origin).href);
  }

  function loadExternalScript(src) {
    if (hasScript(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function runPageScripts(main) {
    const scripts = Array.from(main.querySelectorAll('script'));
    scripts.forEach(script => script.remove());

    await loadExternalScript('/js/common.js');

    for (const original of scripts) {
      if (original.src) {
        if (!original.src.endsWith('/js/common.js')) {
          await loadExternalScript(original.src);
        }
        continue;
      }
      const script = document.createElement('script');
      script.textContent = original.textContent;
      document.body.appendChild(script);
      script.remove();
    }
  }

  async function loadPage(url, pushState = true) {
    const targetUrl = new URL(url, window.location.origin);
    if (!isAdminPath(targetUrl) || isNavigating) return;

    const currentMain = document.querySelector(CONTENT_SELECTOR);
    if (!currentMain || targetUrl.pathname === window.location.pathname) return;

    isNavigating = true;
    currentMain.classList.add('spa-loading');

    try {
      const response = await window.fetch(targetUrl.href, {
        headers: { 'X-Requested-With': 'spa-navigation' },
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`페이지를 불러오지 못했습니다 (${response.status})`);

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nextMain = doc.querySelector(CONTENT_SELECTOR);
      if (!nextMain) throw new Error('관리자 콘텐츠를 찾지 못했습니다.');

      document.title = doc.title || document.title;
      currentMain.replaceWith(nextMain);
      setActiveLink(targetUrl.pathname);
      if (pushState) history.pushState({ adminPath: targetUrl.pathname }, '', targetUrl.href);
      window.scrollTo({ top: 0, behavior: 'auto' });
      await runPageScripts(nextMain);
    } catch (error) {
      console.error('관리자 페이지 전환 실패:', error);
      window.location.assign(targetUrl.href);
    } finally {
      document.querySelector(CONTENT_SELECTOR)?.classList.remove('spa-loading');
      isNavigating = false;
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a.nav-link');
    if (!link || event.defaultPrevented || event.button !== 0) return;
    const url = new URL(link.href, window.location.origin);
    if (!isAdminPath(url) || url.origin !== window.location.origin) return;
    event.preventDefault();
    void loadPage(url.href);
  });

  window.addEventListener('popstate', () => {
    void loadPage(window.location.href, false);
  });

  setActiveLink(window.location.pathname);
})();
