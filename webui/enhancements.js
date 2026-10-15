/* Fork WebUI: TEESimulator boot props & friendly application labels. */
(() => {
  'use strict';
  const path = '/data/adb/tricky_store/boot_props_mode';
  const helper = '/data/adb/modules/TA_enhanced/webui/app-labels.sh';
  const modes = new Set(['auto', 'force', 'disable']);
  function exec(command) {
    return new Promise(resolve => {
      if (typeof globalThis.ksu?.exec !== 'function') {
        resolve({ errno: 1, stdout: '', stderr: 'KernelSU exec unavailable' }); return;
      }
      const cb = '__webuiExt_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      globalThis[cb] = (errno, stdout, stderr) => {
        delete globalThis[cb];
        resolve({ errno: Number(errno), stdout: String(stdout || ''), stderr: String(stderr || '') });
      };
      try { globalThis.ksu.exec(command, '{}', cb); }
      catch (error) {
        delete globalThis[cb];
        resolve({ errno: 1, stdout: '', stderr: String(error) });
      }
    });
  }
  function feedback(message, fail) {
    const target = document.getElementById('boot-props-result');
    if (target) { target.textContent = message; target.style.color = fail ? '#ff8593' : ''; }
  }
  async function loadMode() {
    const select = document.getElementById('boot-props-mode');
    if (!select) return;
    const r = await exec('cat ' + path + ' 2>/dev/null');
    const mode = r.errno === 0 ? r.stdout.trim().toLowerCase() : '';
    select.value = modes.has(mode) ? mode : 'auto';
    feedback('当前模式 / Current: ' + select.value);
    const properties = await exec('for p in ro.boot.flash.locked ro.boot.verifiedbootstate ro.boot.vbmeta.device_state; do echo "$p=$(getprop "$p")"; done');
    const observed = document.getElementById('boot-props-observed');
    if (observed && properties.errno === 0) observed.textContent = properties.stdout.trim();
  }
  async function saveMode() {
    const select = document.getElementById('boot-props-mode');
    const button = document.getElementById('boot-props-save');
    if (!select || !button || button.disabled) return;
    const mode = select.value;
    if (!modes.has(mode)) return;
    if (mode === 'force' && !window.confirm(
      'Force 会修改全局启动属性，在 OPPO 上可能影响指纹识别或厂商服务。确认开启并在保存后重启吗？'
    )) { await loadMode(); return; }
    button.disabled = true; feedback('保存中 / Saving...');
    // Only a fixed, validated mode literal enters this shell expression.
    const r = await exec('test -f /data/adb/modules/tricky_store/module.prop && mkdir -p /data/adb/tricky_store && printf "%s\n" ' +
      mode + ' > /data/adb/tricky_store/.boot_props_mode.webui.tmp && chmod 644 /data/adb/tricky_store/.boot_props_mode.webui.tmp && mv -f /data/adb/tricky_store/.boot_props_mode.webui.tmp ' + path);
    button.disabled = false;
    feedback(r.errno === 0 ? '已保存 ' + mode + '。重启后生效 / Reboot required.' :
      '保存失败：请确认已安装 TEESimulator-RS。' + (r.stderr ? ' ' + r.stderr.trim() : ''), r.errno !== 0);
  }
  function setupMode() {
    const dialog = document.getElementById('automation-settings-dialog');
    const save = document.getElementById('boot-props-save');
    if (!dialog || !save) return;
    save.addEventListener('click', saveMode);
    new MutationObserver(() => { if (dialog.hasAttribute('open')) void loadMode(); })
      .observe(dialog, { attributes: true, attributeFilter: ['open'] });
    void loadMode();
  }

  // Native package labels are supplied by ksu.getPackagesInfo on supported hosts.
  // For hosts without that API the original bundle repeats package ID as the label.
  // Resolve missing labels with the bundled aapt on visible cards only.
  let labels = {};
  const storeKey = 'ta-enhanced-labels-v1';
  try { labels = JSON.parse(localStorage.getItem(storeKey) || '{}') || {}; }
  catch (_) { labels = {}; }
  const queue = new Set();
  const processed = new WeakSet();
  const valid = /^[a-zA-Z0-9._]+$/;
  let running = 0;
  function cached(pkg) {
    const v = labels[pkg];
    return v && typeof v.name === 'string' && Date.now() - v.time < 604800000 ? v.name : null;
  }
  function setName(pkg, name) {
    if (!name || name === pkg) return;
    labels[pkg] = { name, time: Date.now() };
    try { localStorage.setItem(storeKey, JSON.stringify(labels)); } catch (_) {}
    document.querySelectorAll('#apps-list .card[data-package]').forEach(card => {
      if (card.dataset.package !== pkg) return;
      const title = card.querySelector('.app-name');
      if (title && (!title.textContent.trim() || title.textContent.trim() === pkg)) title.textContent = name;
    });
    try {
      const key = 'tricky-applist-cache';
      const cache = JSON.parse(localStorage.getItem(key) || 'null');
      if (cache && Array.isArray(cache.entries)) {
        cache.entries.forEach(item => {
          if (item.packageName === pkg && (!item.appName || item.appName === pkg)) item.appName = name;
        });
        localStorage.setItem(key, JSON.stringify(cache));
      }
    } catch (_) {}
  }
  async function drain() {
    while (running < 2 && queue.size) {
      const batch = Array.from(queue).slice(0, 5);
      batch.forEach(pkg => queue.delete(pkg));
      running += 1;
      void (async () => {
        try {
          const r = await exec('sh ' + helper + ' ' + batch.join(' '));
          if (r.errno === 0) r.stdout.split('\n').forEach(line => {
            const separator = line.indexOf('\t');
            if (separator < 0) return;
            const pkg = line.slice(0, separator);
            const name = line.slice(separator + 1).trim();
            if (batch.includes(pkg) && name) setName(pkg, name);
          });
        } finally { running -= 1; void drain(); }
      })();
    }
  }
  function enqueue(pkg) {
    if (!valid.test(pkg) || cached(pkg)) return;
    queue.add(pkg); void drain();
  }
  let observer;
  function inspect(card) {
    if (!(card instanceof Element) || processed.has(card)) return;
    const pkg = card.dataset.package, title = card.querySelector('.app-name');
    if (!pkg || !title) return;
    processed.add(card);
    if (title.textContent.trim() && title.textContent.trim() !== pkg) return;
    const name = cached(pkg);
    if (name) { title.textContent = name; return; }
    if (observer) observer.observe(card); else enqueue(pkg);
  }
  function setupLabels() {
    const list = document.getElementById('apps-list');
    if (!list) return;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          const pkg = entry.target.dataset.package;
          if (pkg) enqueue(pkg);
        });
      }, { rootMargin: '250px' });
    }
    const apply = node => {
      if (!(node instanceof Element)) return;
      if (node.matches('.card[data-package]')) inspect(node);
      node.querySelectorAll('.card[data-package]').forEach(inspect);
    };
    new MutationObserver(entries => entries.forEach(entry => entry.addedNodes.forEach(apply)))
      .observe(list, { childList: true, subtree: true });
    apply(list);
  }
  const init = () => { setupMode(); setupLabels(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
