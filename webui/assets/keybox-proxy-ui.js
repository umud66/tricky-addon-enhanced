/* TA Enhanced v5.53.1 Diag4: proxy-prefix and asynchronous job UX.
 * No keybox material is passed through JavaScript or logged to the browser.
 */
(function () {
  'use strict';
  const DEFAULT = 'https://gh-proxy.org/';
  const regex = /^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]{1,5})?(?:\/[a-zA-Z0-9._~%+\/-]*)?\/?$/;
  const normalize = value => String(value || '').trim().replace(/\/+$/, '') + '/';
  const shellQuote = str => "'" + String(str).replace(/'/g, "'\\''") + "'";
  let active = false, isHidden = false, elapsedTimer = null, timer = null, startedAt = 0;
  let execFn, toastFn, currentButton, currentId, scriptPath;
  function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
  function root() { return document.getElementById('ta-proxy-progress'); }
  function applyButton(busy) {
    if (currentButton) currentButton.disabled = busy;
    const icon = currentButton && currentButton.querySelector('md-icon');
    if (icon) icon.textContent = busy ? 'hourglass_empty' : 'key';
  }
  function showProgress(title) {
    let el = root(); if (!el) return;
    isHidden = false;
    el.hidden = false;
    el.classList.remove('done');
    setText('ta-proxy-progress-title', title || '后台正在获取密钥');
    setText('ta-proxy-progress-detail', '等待后台任务初始化…');
    setText('ta-proxy-progress-time', '已运行 0 秒');
    clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => {
      if (!active) return;
      setText('ta-proxy-progress-time', '已运行 ' + Math.floor((Date.now() - startedAt) / 1000) + ' 秒 · 页面可继续操作');
    }, 1000);
  }
  function hideProgress() {
    if (root()) root().hidden = true;
    isHidden = true;
  }
  function finish(state, message, logfile) {
    active = false;
    clearTimeout(timer);
    clearInterval(elapsedTimer);
    applyButton(false);
    const okay = state === 'success';
    if (okay) {
      const el = root();
      if (el) {el.classList.add('done'); el.hidden = false;}
      setText('ta-proxy-progress-title', '密钥更新完成');
      setText('ta-proxy-progress-detail', message || '后端已验证并安装');
      setText('ta-proxy-progress-time', '可以继续使用 WebUI');
      if (typeof toastFn === 'function') toastFn('密钥已校验并安装', true);
      setTimeout(() => {if (!active) hideProgress();}, 6500);
    } else {
      hideProgress();
      const code = state === 'kept' ? 0 : 1;
      const output = state === 'kept' ? 'keybox fetched from existing\n' : '';
      window.TAKeyboxDiagnostics?.report?.({errno: code, stdout: output, stderr: (logfile || '') + '\n' + (message || '')}, 'fetch');
      if (typeof toastFn === 'function') toastFn(state === 'kept' ? '远程源失败，旧密钥已保留' : 'prompt_key_set_error', code === 0);
    }
  }
  const parseStatus = raw => {
    const parts = String(raw || '').split('\n');
    const hdr = (parts.shift() || '').split('|');
    const splitIndex = parts.indexOf('__LOG_START__');
    const logs = splitIndex < 0 ? '' : parts.slice(splitIndex + 1).join('\n').slice(-14000);
    return {state: hdr[0] || 'unknown', source: hdr[1] || '', stage: hdr[2] || '', message: hdr[3] || '', logs};
  };
  async function poll() {
    if (!active || !execFn || !currentId) return;
    try {
      const result = await execFn('sh ' + shellQuote(scriptPath) + ' status ' + shellQuote(currentId));
      if (!active) return;
      if (result.errno !== 0) throw new Error(result.stderr || result.stdout || '任务状态读取失败');
      const status = parseStatus(result.stdout);
      setText('ta-proxy-progress-title', `${status.source || '密钥'}：${status.stage || '处理中'}`);
      setText('ta-proxy-progress-detail', status.message || '后端正在处理…');
      if (['success', 'failed', 'kept'].includes(status.state)) {
        finish(status.state, `${status.source} / ${status.stage}：${status.message}`, status.logs);
        return;
      }
      if (status.state !== 'running') throw new Error('未知任务状态：' + status.state);
      // Native KSU exec API resolves asynchronously; no network I/O is done on WebUI JS thread.
      timer = setTimeout(poll, 1200);
    } catch (e) {
      if (!active) return;
      poll.errors = (poll.errors || 0) + 1;
      if (poll.errors >= 5) {
        finish('failed', '读取后台任务状态失败：' + String(e), 'Error: UI status bridge failed');
      } else {
        setText('ta-proxy-progress-detail', '暂时读取不到任务进度，正在重试…');
        timer = setTimeout(poll, 2000);
      }
    }
  }
  function helperFromBinary(bin) {
    const result = String(bin).replace(/\/bin\/[^/]+\/ta-enhanced$/, '/common/keybox-proxy-fetch.sh');
    return result === bin ? '/data/adb/modules/TA_enhanced/common/keybox-proxy-fetch.sh' : result;
  }
  async function fetchKeybox(button, binary, exec, toast) {
    if (active || window.TAKeyboxDiagnostics?.isBusyExceptProxy?.()) {
      if (typeof toast === 'function') toast('已有密钥操作正在进行', false);
      return;
    }
    if (!button || button.disabled) return;
    currentButton = button;
    scriptPath = helperFromBinary(binary);
    execFn = exec;
    toastFn = toast;
    applyButton(true);
    active = true;
    startedAt = Date.now();
    showProgress('正在创建异步下载任务');
    const dialog = document.getElementById('automation-settings-dialog');
    try {if (dialog && typeof dialog.close === 'function') dialog.close();} catch (_) {}
    try {
      const selector = document.getElementById('ta-kb-manual-source');
      const source = ['auto','yurikey','upstream','daredevil','meowdump'].includes(selector?.value)
        ? selector.value : 'auto';
      const start = await exec('sh ' + shellQuote(scriptPath) + ' start ' + shellQuote(source));
      const match = String(start.stdout || '').match(/^(?:STARTED|BUSY):([0-9]+-[0-9]+)/m);
      if ((!match && start.errno !== 0) || !match) throw new Error((start.stderr || start.stdout || '任务启动失败').trim());
      currentId = match[1];
      if (String(start.stdout).startsWith('BUSY:')) setText('ta-proxy-progress-detail', '正在接管已运行的任务');
      poll.errors = 0;
      timer = setTimeout(poll, 200);
    } catch (error) {
      finish('failed', '启动阶段失败：' + String(error), 'Error: worker start failed');
    }
  }
  function prefixError(value) {
    if (!regex.test(value) || value.length > 200 || value.includes('..'))
      return '请输入合法的 HTTPS 前缀，例如 https://gh-proxy.org/（不支持参数、账号、空格）';
    return '';
  }
  async function initialize() {
    const mode = document.getElementById('ta-kb-proxy-mode');
    const input = document.getElementById('ta-kb-proxy-prefix');
    const sourceSelector = document.getElementById('ta-kb-manual-source');
    const save = document.getElementById('ta-kb-proxy-save');
    if (!mode || !input || !save || !sourceSelector || save.dataset.initialized) return;
    save.dataset.initialized = 'yes';
    const getScript = () => {
      // The actual module path may be prefixed with "." while disabled.
      return scriptPath || '/data/adb/modules/TA_enhanced/common/keybox-proxy-fetch.sh';
    };
    const exec = async cmd => {
      // This helper runs only short load/save/status commands.
      if (typeof window.ksu?.exec !== 'function') throw new Error('未找到 KernelSU/Magisk WebUI 命令桥接');
      const name = 'ta_proxy_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      return await new Promise((resolve, reject) => {
        window[name] = (errno, stdout, stderr) => {delete window[name]; resolve({errno,stdout,stderr});};
        try {window.ksu.exec(cmd, '{}', name);} catch (e) {delete window[name]; reject(e);}
      });
    };
    const toggle = () => {input.disabled = mode.value === 'direct';};
    mode.addEventListener('change', toggle);
    toggle();
    const status = document.getElementById('ta-kb-proxy-config-status');
    try {
      const result = await exec('sh ' + shellQuote(getScript()) + ' load');
      if (result.errno === 0) {
        const [remoteMode, remotePrefix, remoteSource] = result.stdout.trim().split('\n');
        mode.value = ['proxy','multi','direct'].includes(remoteMode) ? remoteMode : 'direct';
        sourceSelector.value = ['auto','yurikey','upstream','daredevil','meowdump'].includes(remoteSource) ? remoteSource : 'auto';
        input.value = remotePrefix || DEFAULT;
        toggle();
        if (status) status.textContent = '当前模式已加载；自动模式在原生直连下仍使用旧版内置来源。';
      } else if (status) status.textContent = '读取配置失败，请确认已安装对应模块补丁。';
    } catch (_) {if (status) status.textContent = '读取配置失败；请确认模块已安装且 WebUI 具有 Root 命令权限。';}
    save.addEventListener('click', async () => {
      const prefix = normalize(input.value);
      const err = prefixError(prefix);
      if (err) {status.textContent = err; return;}
      save.disabled = true; status.textContent = '正在保存…';
      try {
        const res = await exec('sh ' + shellQuote(getScript()) + ' save ' + shellQuote(mode.value) + ' ' + shellQuote(prefix) + ' ' + shellQuote(sourceSelector.value));
        if (res.errno !== 0) throw new Error(res.stderr || res.stdout);
        input.value = prefix;
        status.textContent = '已保存：' + mode.options[mode.selectedIndex].text + '；首选 ' + sourceSelector.options[sourceSelector.selectedIndex].text + '。';
      } catch (e) {status.textContent = '保存失败：' + String(e);}
      finally {save.disabled = false;}
    });
  }
  const start = () => {initialize(); document.getElementById('ta-proxy-hide')?.addEventListener('click', hideProgress);};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.TAProxyFetch = {fetch: fetchKeybox, isBusy: () => active, init: initialize};
})();