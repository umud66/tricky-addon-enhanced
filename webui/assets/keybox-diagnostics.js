/* TA Enhanced v5.53.3 Diag4 keybox diagnostics patch.
 * Only augments WebUI feedback. Does NOT patch or replace the Rust backend,
 * keybox content, network endpoints, configuration, or private-key storage.
 */
(function () {
  'use strict';
  const SOURCES = { yurikey: 'Yurikey', upstream: 'KOWX712', daredevil: 'DareDevilEx', meowdump: 'MeowDump', custom: 'Custom URL' };
  let lastReport = '';
  let inFlight = false;
  const clean = value => String(value == null ? '' : value)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .slice(0, 20000);
  const sourceName = name => SOURCES[name] || name;

  function getUI() {
    let root = document.getElementById('ta-keybox-diagnostic-overlay');
    if (root) return root;
    const style = document.createElement('style');
    style.id = 'ta-keybox-diagnostic-style';
    style.textContent = `
      #ta-keybox-diagnostic-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.77);display:none;align-items:center;justify-content:center;padding:15px;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif;color:#f4f4f4}
      #ta-keybox-diagnostic-overlay.ta-show{display:flex}
      #ta-keybox-diagnostic-overlay .ta-panel{max-width:680px;width:100%;max-height:min(86vh,900px);overflow-y:auto;background:#181d22;border:1px solid #46515b;border-radius:18px;padding:20px;box-shadow:0 22px 70px #0009;box-sizing:border-box}
      #ta-keybox-diagnostic-overlay h2{font-size:19px;font-weight:700;margin:0 0 14px}
      #ta-keybox-diagnostic-overlay h3{font-size:14px;font-weight:650;margin:18px 0 8px;color:#afd6ed}
      #ta-keybox-diagnostic-overlay .ta-summary{line-height:1.65;white-space:pre-wrap;background:#262e36;border-left:4px solid #ffac4d;padding:11px;border-radius:8px;font-size:13px;word-break:break-word}
      #ta-keybox-diagnostic-overlay .ta-success{border-left-color:#36cd88}
      #ta-keybox-diagnostic-overlay .ta-row{font-size:13px;line-height:1.55;margin:7px 0;padding:10px;border-radius:7px;background:#22292f;word-break:break-word;white-space:pre-wrap}
      #ta-keybox-diagnostic-overlay .ta-row strong{display:block;color:#a8c9e3;margin-bottom:3px}
      #ta-keybox-diagnostic-overlay pre{font-size:11px;line-height:1.55;background:#0d1217;border-radius:8px;border:1px solid #303942;padding:10px;max-height:175px;overflow:auto;white-space:pre-wrap;word-break:break-all;user-select:text;-webkit-user-select:text}
      #ta-keybox-diagnostic-overlay .ta-hint{font-size:12px;color:#b2bec7;line-height:1.5;margin-top:12px}
      #ta-keybox-diagnostic-overlay .ta-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-top:20px}
      #ta-keybox-diagnostic-overlay button{appearance:none;border:0;border-radius:9px;padding:10px 15px;background:#34424e;color:#fff;font-size:13px;font-weight:600;cursor:pointer}
      #ta-keybox-diagnostic-overlay #ta-kb-copy{background:#146e72}
      #ta-keybox-diagnostic-overlay button:active{opacity:.7}
    `;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = 'ta-keybox-diagnostic-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '密钥操作诊断结果');
    root.innerHTML = '<div class="ta-panel" role="document"><h2 id="ta-kb-title"></h2><div id="ta-kb-summary" class="ta-summary"></div><h3>失败阶段 / 执行步骤</h3><div id="ta-kb-stages"></div><h3>后端原始输出（用于排查）</h3><pre id="ta-kb-output"></pre><div id="ta-kb-hint" class="ta-hint"></div><div class="ta-actions"><button id="ta-kb-copy" type="button">复制诊断信息</button><button id="ta-kb-close" type="button">关闭</button></div></div>';
    document.body.appendChild(root);
    const close = () => {root.classList.remove('ta-show');};
    document.getElementById('ta-kb-close').addEventListener('click', close);
    root.addEventListener('click', event => {if (event.target === root) close();});
    document.addEventListener('keydown', event => {if (event.key === 'Escape' && root.classList.contains('ta-show')) close();});
    document.getElementById('ta-kb-copy').addEventListener('click', async event => {
      let ok = false;
      try {if (navigator.clipboard && navigator.clipboard.writeText) {await navigator.clipboard.writeText(lastReport); ok = true;}} catch (_) {}
      if (!ok) {
        const textarea = document.createElement('textarea');
        textarea.value = lastReport;
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(textarea);
        textarea.select();
        try {ok = document.execCommand('copy');} catch (_) {}
        textarea.remove();
      }
      event.target.textContent = ok ? '已复制' : '复制失败，请长按日志选择复制';
      setTimeout(() => {if (event.target.isConnected) event.target.textContent = '复制诊断信息';}, 2000);
    });
    return root;
  }

  function classify(reason, kind) {
    const str = (reason + ' ' + (kind || '')).toLowerCase();
    if (/compat: legacy|pkcs#8 conversion|格式兼容/.test(str)) return '③ PEM 格式兼容转换';
    if (/backup|rotate backup|create keybox backup|备份/.test(str)) return '⑤ 备份旧密钥';
    if (/write keybox|permission denied|read-only file system|failed to write keybox/.test(str)) return '⑥ 写入密钥文件';
    if (/rejected|certif|revok|expired|mismatch|invalid key|chain|验证|校验|keybox validation failed|private.key/.test(str)) return '④ 密钥与证书校验';
    if (/parse failed|xml|parse error/.test(str)) return '③ XML 解析';
    if (/base64|hex decode|utf-8|decode/.test(str)) return '② 下载数据解码';
    if (/download|http|dns|network|tls|timeout|connection|resolve host|ureq/.test(str)) return '① 网络下载';
    if (/config|toml/.test(str)) return '初始化 / 配置读取';
    return '未确定（查看原始错误）';
  }

  function analyze(result, operation) {
    const errno = Number(result && result.errno);
    const stdout = clean(result && result.stdout);
    const stderr = clean(result && result.stderr);
    const raw = (stderr + '\n' + stdout).trim();
    const rows = [];
    const seen = new Set();
    let downloadFailure = false;
    const add = (stage, detail) => {
      const key = stage + '|' + detail;
      if (!seen.has(key)) { rows.push({ stage, detail }); seen.add(key); }
    };
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const text = line.trim();
      let match = text.match(/keybox source (yurikey|upstream|daredevil|meowdump|custom) failed:\s*(.+)$/i);
      if (match) {
        const reason = match[2].trim();
        const stage = classify(reason);
        add(stage, `${sourceName(match[1].toLowerCase())}：${reason}`);
        if (stage.startsWith('①')) downloadFailure = true;
        continue;
      }
      match = text.match(/keybox from (yurikey|upstream|daredevil|meowdump|custom) (parse failed|rejected):\s*(.+)$/i);
      if (match) {
        const stage = match[2] === 'rejected' ? '④ 密钥与证书校验' : '③ XML 解析';
        add(stage, `${sourceName(match[1].toLowerCase())}：${match[3].trim()}`);
        continue;
      }
      if (/certificate validation detail:|certificate validation stage:|compat: legacy/i.test(text)) {
        add(classify(text), text.slice(0,450)); continue;
      }
      match = text.match(/backup failed before install:\s*(.+)$/i);
      if (match) { add('⑤ 备份旧密钥', match[1]); continue; }
      match = text.match(/Error:\s*(.+)$/i);
      if (match && !/all keybox sources failed/i.test(match[1])) add(classify(match[1]), match[1].trim());
    }
    if (errno !== 0 && rows.length === 0) {
      const best = lines.map(l => l.trim()).filter(Boolean).reverse().find(l => /Error:|failed|denied|error|拒绝|失败/i.test(l)) || stderr.trim() || stdout.trim() || '后端没有返回详细错误。';
      add(classify(best), best.slice(0, 650));
    }
    const fallback = /keybox fetched from existing\b/i.test(stdout);
    const successfulSource = (stdout.match(/keybox fetched from\s+(yurikey|upstream|daredevil|meowdump|custom)\b/i) || [])[1];
    let title, summary;
    if (errno === 0 && operation === 'fetch') {
      title = fallback ? '远程密钥未更新（旧密钥保留）' : '密钥获取操作完成';
      summary = fallback
        ? '远程来源均未成功，但检测到有效的旧 keybox.xml，已保留旧文件。返回码为 0，不代表下载成功。'
        : `返回码 0：后端报告已从 ${sourceName(successfulSource || '未知来源')} 获取密钥。若内容相同，后端可能跳过写入。`;
    } else if (errno === 0) {
      title = '密钥操作成功';
      summary = '后端操作完成，返回码 0。';
    } else {
      title = '密钥操作失败：已定位执行阶段';
      summary = `后端退出码：${Number.isFinite(errno) ? errno : '未知'}。${rows.length ? '下面按日志逐项列出失败步骤；不代表所有步骤均已执行。' : '未取得详细阶段信息。'}`;
    }
    if (operation === 'AOSP 数据解码' && errno !== 0 && rows.length) {
      rows.forEach(row => {row.stage = 'AOSP 数据解码';});
    }
    if (operation === 'generate' && errno !== 0 && rows.length) {
      rows.forEach(row => { if (row.stage === '未确定（查看原始错误）') row.stage = '设备密钥生成 / 本地安装'; });
    }
    if (operation === 'local-write' && errno !== 0 && rows.length) {
      rows.forEach(row => { if (row.stage === '未确定（查看原始错误）') row.stage = '本地导入 / 备份 / 写入'; });
    }
    if (fallback) add('回退：旧密钥保留', '远程更新失败，已有有效 keybox.xml，因此没有写入新的密钥。');
    if (successfulSource) add('完成：' + sourceName(successfulSource), '后端返回码 0。');
    return { errno, stdout, stderr, rows, downloadFailure, fallback, title, summary, operation };
  }

  function render(info, networkProbe) {
    const root = getUI();
    const setText = (id, value) => {document.getElementById(id).textContent = value;};
    setText('ta-kb-title', info.title);
    setText('ta-kb-summary', info.summary);
    document.getElementById('ta-kb-summary').classList.toggle('ta-success', info.errno === 0 && !info.fallback);
    const stages = document.getElementById('ta-kb-stages');
    stages.replaceChildren();
    function addRow(stage, detail) {
      const element = document.createElement('div');
      element.className = 'ta-row';
      const heading = document.createElement('strong');
      heading.textContent = stage;
      element.appendChild(heading);
      element.appendChild(document.createTextNode(detail));
      stages.appendChild(element);
    }
    info.rows.forEach(item => addRow(item.stage, item.detail));
    if (!info.rows.length) addRow(info.errno === 0 ? '完成' : '无法确认更细阶段', info.errno === 0 ? '未检测到失败记录。' : '二进制程序未提供细化日志，请查看下方原始 stderr。');
    if (networkProbe) addRow('附加网络探测（只读）', clean(networkProbe));
    const combined = `stdout:\n${info.stdout || '（空）'}\n\nstderr:\n${info.stderr || '（空）'}`;
    setText('ta-kb-output', combined);
    setText('ta-kb-hint', '故障信息取自本次命令 stderr/stdout，不使用旧日志推测。为避免页面卡顿，已取消失败后的自动网络复测；如需进一步检查，可在终端手动执行模块 common/keybox-netdiag.sh。');
    lastReport = [
      'TA Enhanced v5.53.3 keybox diagnostic',
      'Time: ' + new Date().toISOString(),
      'Operation: ' + info.operation,
      'Exit code: ' + info.errno,
      'Summary: ' + info.summary,
      '',
      ...info.rows.map(item => `[${item.stage}] ${item.detail}`),
      networkProbe ? '\n[Read-only network probe]\n' + clean(networkProbe) : '',
      '\n' + combined
    ].join('\n');
    // The automation settings uses md-dialog (native top layer). Close it so
    // the diagnosis panel is never obscured behind that dialog.
    const parentDialog = document.getElementById('automation-settings-dialog');
    if (parentDialog && typeof parentDialog.close === 'function') {
      try { parentDialog.close(); } catch (_) {}
    }
    root.classList.add('ta-show');
  }

  async function execute(operation, button, command, exec, toast, successToast) {
    if (inFlight || (button && button.disabled)) {
      try { window.ksu?.toast?.('已有密钥操作正在运行，请勿重复提交'); } catch (_) {}
      return;
    }
    inFlight = true;
    if (button) button.disabled = true;
    const icon = button && button.querySelector('md-icon');
    const original = icon && icon.textContent;
    if (icon) icon.textContent = 'hourglass_empty';
    // This notification never launches another command. The native exec
    // bridge may continue to run even if the JavaScript side becomes slow.
    const slowTimer = setTimeout(() => {
      if (!inFlight) return;
      if (typeof toast === 'function') {
        try {toast('密钥操作超过 25 秒仍未返回，后端可能在等待网络；请勿重复点击。', false, 6000);} catch (_) {}
      }
    }, 25000);
    try {
      // Info level is needed for per-source errors; no extra HTTP probes.
      const result = await exec('RUST_LOG=info ' + command);
      const info = analyze(result, operation);
      if (typeof toast === 'function') {
        toast(info.errno === 0 && !info.fallback ? successToast :
          info.fallback ? '远程源未更新，保留了本地旧密钥' : 'prompt_key_set_error',
          info.errno === 0);
      }
      // Success needs only a small toast, not a blocking modal.
      // Failure/fallback retains the full original backend diagnostics.
      if (info.errno !== 0 || info.fallback) render(info, '');
    } catch (error) {
      if (typeof toast === 'function') toast('prompt_key_set_error', false);
      render(analyze({errno: 1, stderr: 'WebUI 命令执行失败：' + String(error)}, operation), '');
    } finally {
      clearTimeout(slowTimer);
      inFlight = false;
      if (button) button.disabled = false;
      if (icon) icon.textContent = original;
    }
  }

  window.TAKeyboxDiagnostics = {
    isBusy: () => inFlight || !!window.TAProxyFetch?.isBusy?.(),
    isBusyExceptProxy: () => inFlight,
    fetch: (button, binary, exec, toast) => window.TAProxyFetch
      ? window.TAProxyFetch.fetch(button, binary, exec, toast)
      : execute('fetch', button, binary + ' keybox fetch', exec, toast, 'prompt_valid_key_set'),
    generate: (binary, exec, toast) => execute('generate', null, binary + ' keybox generate', exec, toast, 'prompt_unknown_key_set'),
    localWriteFailed: (result, error) => render(analyze(Object.assign({errno:1,stdout:'',stderr: ''}, result || {}, {stderr: clean((result && result.stderr) || error || '本地密钥写入失败')}), 'local-write'), ''),
    report: (result, operation) => render(analyze(result, operation || 'fetch'), '')
  };
})();