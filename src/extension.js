// FuzzyCal — 弹框计算器与进制转换
// Minimal JS extension (no build step)

const vscode = require('vscode');
const core = require('./core');
let webPanel = undefined; // WebviewPanel for side editor

function activate(context) {
  const disposable = vscode.commands.registerCommand('fuzzycal.calculator', async () => {
    const prefill = getSelectedOrClipboardPrefill();
    const mode = await vscode.window.showQuickPick([
      { label: '表达式计算 (Expression)', description: '如: (2+3*4)/5, sin(pi/6)' },
      { label: '进制转换 (Base Convert)', description: '如: FF -> dec, 1010b -> hex' }
    ], { placeHolder: '选择模式 / Pick a mode' });
    if (!mode) return;

    if (mode.label.startsWith('表达式')) {
      await handleExpression(prefill);
    } else {
      await handleBaseConvert(prefill);
    }
  });

  context.subscriptions.push(disposable);

  // Selection handler + CodeLens provider to show results above selection
  const provider = new AdHocResultCodeLensProvider();
  const selDisposable = vscode.window.onDidChangeTextEditorSelection(createSelectionPopupHandler(provider));
  const lensDisposable = vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider);
  const lensDisposable2 = vscode.languages.registerCodeLensProvider({ scheme: 'untitled' }, provider);
  context.subscriptions.push(selDisposable, lensDisposable, lensDisposable2);

  // Command to copy a chosen result (used by CodeLens buttons)
  const copyCmd = vscode.commands.registerCommand('fuzzycal.copyText', async (text) => {
    if (typeof text !== 'string') return;
    await vscode.env.clipboard.writeText(text);
    await vscode.window.showInformationMessage(`已复制: ${text}`);
  });
  context.subscriptions.push(copyCmd);

  // Open side/bottom panel for editing expression and viewing results
  const openPanelCmd = vscode.commands.registerCommand('fuzzycal.openPanel', async () => {
    ensureWebPanel(context);
  });
  context.subscriptions.push(openPanelCmd);

  // Edit expression for current selection via input box and refresh CodeLens
  const editCmd = vscode.commands.registerCommand('fuzzycal.editExprForSelection', async () => {
    const state = provider.getState && provider.getState();
    if (!state) return;
    const { uri, range, expr, mode } = state;
    const newExpr = await vscode.window.showInputBox({
      title: '编辑计算表达式',
      value: expr || '',
      prompt: mode === 'base' ? '可输入: 255, 0xFF, 1010b, FF -> dec, base2 1010 等' : '支持: + - * / % **、sin, cos, pi 等'
    });
    if (newExpr === undefined) return; // cancelled
    try {
      let items;
      if (mode === 'expr') {
        const value = core.evaluateExpression(newExpr);
        if (typeof value === 'number' && Number.isFinite(value)) {
          items = core.buildNumberResults(value);
        } else {
          const label = String(value);
          items = [{ label, description: 'Result' }];
        }
      } else {
        const result = core.convertBases(newExpr);
        items = [
          { label: result.hex, description: 'Hex' },
          { label: result.dec, description: 'Dec' },
          { label: result.bin, description: 'Bin' },
          { label: result.oct, description: 'Oct' },
        ];
      }
      provider.showForSelection(uri, range, items, { expr: newExpr, mode });
    } catch (err) {
      await vscode.window.showErrorMessage(`更新失败: ${err.message || err}`);
    }
  });
  context.subscriptions.push(editCmd);

  // Reset expression back to the original one for current selection
  const resetCmd = vscode.commands.registerCommand('fuzzycal.resetExprForSelection', async () => {
    const state = provider.getState && provider.getState();
    if (!state) return;
    const { uri, range, mode } = state;
    const expr = state.originalExpr || state.expr || '';
    try {
      let items;
      if (mode === 'expr') {
        const value = core.evaluateExpression(expr);
        if (typeof value === 'number' && Number.isFinite(value)) {
          items = core.buildNumberResults(value);
        } else {
          const label = String(value);
          items = [{ label, description: 'Result' }];
        }
      } else {
        const result = core.convertBases(expr);
        items = [
          { label: result.hex, description: 'Hex' },
          { label: result.dec, description: 'Dec' },
          { label: result.bin, description: 'Bin' },
          { label: result.oct, description: 'Oct' },
        ];
      }
      provider.showForSelection(uri, range, items, { expr, mode, originalExpr: expr });
    } catch (err) {
      await vscode.window.showErrorMessage(`重置失败: ${err.message || err}`);
    }
  });
  context.subscriptions.push(resetCmd);
}

function getSelectedOrClipboardPrefill() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const sel = editor.selection;
    if (!sel.isEmpty) {
      const text = editor.document.getText(sel).trim();
      if (text) return text;
    }
  }
  return undefined;
}

async function handleExpression(prefill) {
  const input = await vscode.window.showInputBox({
    title: 'FuzzyCal — 表达式计算',
    value: prefill || '',
    prompt: '输入表达式，例如: (2+3*4)/5, sin(pi/6), 0xff + 42',
    validateInput: (val) => core.validateExpression(val) || null
  });
  if (!input) return;

  try {
    const value = core.evaluateExpression(input);
    if (typeof value === 'number' && Number.isFinite(value)) {
      const items = core.buildNumberResults(value);
      await showPickAndCopy(items, `结果: ${value}`);
    } else {
      await vscode.window.showInformationMessage(`结果: ${String(value)}`);
    }
  } catch (err) {
    await vscode.window.showErrorMessage(`计算失败: ${err.message || err}`);
  }
}

async function handleBaseConvert(prefill) {
  const input = await vscode.window.showInputBox({
    title: 'FuzzyCal — 进制转换',
    value: prefill || '',
    prompt: '输入数字或指令: 255, FF, 0b1010, 1010b, FF -> dec, 1010 -> hex, 16#FF, base2 1010',
  });
  if (!input) return;

  try {
    const result = core.convertBases(input);
    const items = [
      { label: result.hex, description: 'Hex' },
      { label: result.dec, description: 'Dec' },
      { label: result.bin, description: 'Bin' },
      { label: result.oct, description: 'Oct' },
    ];
    await showPickAndCopy(items, '选择以复制 / Pick to copy');
  } catch (err) {
    await vscode.window.showErrorMessage(`转换失败: ${err.message || err}`);
  }
}

async function showPickAndCopy(items, placeHolder) {
  const picked = await vscode.window.showQuickPick(items, { placeHolder });
  if (picked) {
    await vscode.env.clipboard.writeText(picked.label);
    await vscode.window.showInformationMessage(`已复制: ${picked.label}`);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };

// --- Selection popup (mouse-only) ---

function createSelectionPopupHandler(provider) {
  // Debounce and suppress repeated popups for the same text
  let timer = undefined;
  let lastShownText = '';
  let showing = false;

  return async (e) => {
    try {
      // React to mouse and keyboard selection changes
      if (e && e.kind !== undefined) {
        const k = e.kind;
        const isMouse = k === vscode.TextEditorSelectionChangeKind.Mouse;
        const isKeyboard = k === vscode.TextEditorSelectionChangeKind.Keyboard;
        if (!isMouse && !isKeyboard) return;
      }
      const editor = e && e.textEditor ? e.textEditor : vscode.window.activeTextEditor;
      if (!editor) return;
      // Mirror selection to the web panel if available
      try {
        if (webPanel) {
          const selText = editor.selection && !editor.selection.isEmpty ? editor.document.getText(editor.selection).trim() : '';
          if (selText) {
            const validation = core.validateExpression(selText);
            const mode = isConvertibleNumber(selText) ? 'base' : (validation ? undefined : 'expr');
            if (mode) {
              webPanel.webview.postMessage({ type: 'selection', expr: selText, mode });
            }
          }
        }
      } catch {}
      const sel = editor.selection;
      if (!sel || sel.isEmpty) {
        provider.clear();
        lastShownText = '';
        return;
      }

      const text = editor.document.getText(sel).trim();
      if (!text) { provider.clear(); lastShownText = ''; return; }

      // Limit overly long selections
      if (text.length > 200) { provider.clear(); return; }

      // Prefer base-number detection first; otherwise fall back to expression
      const validation = core.validateExpression(text);
      if (isConvertibleNumber(text)) {
        // Try base conversion
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            const current = editor.document.getText(editor.selection).trim();
            if (current !== text) return;
            let result;
            try {
              result = core.convertBases(text);
            } catch {
              provider.clear();
              return;
            }
            const items = [
              { label: result.hex, description: 'Hex' },
              { label: result.dec, description: 'Dec' },
              { label: result.bin, description: 'Bin' },
              { label: result.oct, description: 'Oct' },
            ];
            showing = true;
            lastShownText = text;
            provider.showForSelection(editor.document.uri, sel, items, { expr: text, mode: 'base', originalExpr: text });
          } finally {
            showing = false;
          }
        }, 250);
        return;
      }
      if (validation) { provider.clear(); return; }

      // Avoid spamming the same selection content
      if (text === lastShownText || showing) return;

      // Debounce brief mouse drags
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          // Double-check current selection still matches the same text
          const current = editor.document.getText(editor.selection).trim();
          if (current !== text) return;

          // Evaluate and show results
          let value;
          try {
            value = core.evaluateExpression(text);
          } catch {
            return; // evaluation failed; silently ignore
          }

          // Build items and show as CodeLens above the selection line
          showing = true;
          lastShownText = text;
          let items;
          if (typeof value === 'number' && Number.isFinite(value)) {
            items = core.buildNumberResults(value);
          } else {
            const label = String(value);
            items = [{ label, description: 'Result' }];
          }
          provider.showForSelection(editor.document.uri, sel, items, { expr: text, mode: 'expr', originalExpr: text });
        } finally {
          showing = false;
        }
      }, 250);
    } catch {
      // noop
    }
  };
}

// Ensure the side webview panel exists and is revealed
function ensureWebPanel(context) {
  if (webPanel) {
    try { webPanel.reveal(vscode.ViewColumn.Beside, true); } catch {}
    return webPanel;
  }
  webPanel = vscode.window.createWebviewPanel(
    'fuzzycalPanel',
    'FuzzyCal 面板',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  webPanel.webview.html = getWebPanelHtml();
  webPanel.onDidDispose(() => { webPanel = undefined; });
  webPanel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        // Optionally seed with current selection
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
          const t = editor.document.getText(editor.selection).trim();
          if (t) {
            const validation = core.validateExpression(t);
            const mode = isConvertibleNumber(t) ? 'base' : (validation ? undefined : 'expr');
            if (mode) webPanel.webview.postMessage({ type: 'selection', expr: t, mode });
          }
        }
      } else if (msg.type === 'compute') {
        const { expr, mode } = msg;
        let items;
        if (mode === 'expr') {
          try {
            const value = core.evaluateExpression(expr);
            if (typeof value === 'number' && Number.isFinite(value)) {
              items = core.buildNumberResults(value);
            } else {
              const label = String(value);
              items = [{ label, description: 'Result' }];
            }
            webPanel.webview.postMessage({ type: 'result', items });
          } catch (err) {
            webPanel.webview.postMessage({ type: 'result', error: String(err && err.message || err) });
          }
        } else if (mode === 'base') {
          try {
            const result = core.convertBases(expr);
            items = [
              { label: result.hex, description: 'Hex' },
              { label: result.dec, description: 'Dec' },
              { label: result.bin, description: 'Bin' },
              { label: result.oct, description: 'Oct' },
            ];
            webPanel.webview.postMessage({ type: 'result', items });
          } catch (err) {
            webPanel.webview.postMessage({ type: 'result', error: String(err && err.message || err) });
          }
        }
      } else if (msg.type === 'copy' && typeof msg.text === 'string') {
        await vscode.env.clipboard.writeText(msg.text);
        vscode.window.showInformationMessage(`已复制: ${msg.text}`);
      }
    } catch {}
  });
  return webPanel;
}

function getWebPanelHtml() {
  const nonce = String(Math.random()).slice(2);
  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>FuzzyCal 面板</title>
      <style>
        body { font-family: var(--vscode-font-family); padding: 8px; }
        .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
        input[type=text] { flex: 1; padding: 4px 6px; }
        button { padding: 4px 8px; }
        .results { display: grid; grid-template-columns: 1fr; gap: 4px; }
        .item { display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--vscode-editorWidget-border); padding: 4px 6px; border-radius: 3px; }
        .item .desc { opacity: 0.7; }
      </style>
    </head>
    <body>
      <div class="row">
        <label>模式</label>
        <select id="mode">
          <option value="expr">表达式</option>
          <option value="base">进制</option>
        </select>
        <label style="margin-left:auto"><input type="checkbox" id="follow" checked /> 跟随选中</label>
      </div>
      <div class="row">
        <input id="expr" type="text" placeholder="输入表达式或数字…" />
        <button id="run">计算</button>
      </div>
      <div id="status" class="row" style="display:none"></div>
      <div id="results" class="results"></div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const dom = (id)=>document.getElementById(id);
        function setStatus(text) {
          const s = dom('status');
          if (text) { s.textContent = text; s.style.display='block'; }
          else { s.textContent=''; s.style.display='none'; }
        }
        function renderResults(items, error) {
          const list = dom('results');
          list.innerHTML = '';
          if (error) { setStatus('错误: ' + error); return; }
          setStatus('');
          (items||[]).forEach(it => {
            const div = document.createElement('div');
            div.className = 'item';
            const left = document.createElement('div');
            left.textContent = it.label;
            const right = document.createElement('button');
            right.textContent = it.description ? it.description : '复制';
            right.addEventListener('click', ()=>{
              vscode.postMessage({ type:'copy', text: it.label });
            });
            const wrap = document.createElement('div');
            const desc = document.createElement('span');
            desc.className = 'desc'; desc.textContent = it.description ? it.description + ':' : '';
            wrap.appendChild(desc);
            list.appendChild(div);
            div.appendChild(left); div.appendChild(right);
          });
        }
        function compute() {
          const expr = dom('expr').value || '';
          const mode = dom('mode').value;
          vscode.postMessage({ type:'compute', expr, mode });
        }
        dom('run').addEventListener('click', compute);
        dom('expr').addEventListener('keydown', (e)=>{ if (e.key==='Enter') compute(); });
        window.addEventListener('message', (ev)=>{
          const msg = ev.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'selection') {
            if (dom('follow').checked) {
              dom('expr').value = msg.expr || '';
              if (msg.mode) dom('mode').value = msg.mode;
              compute();
            }
          } else if (msg.type === 'result') {
            renderResults(msg.items, msg.error);
          }
        });
        vscode.postMessage({ type:'ready' });
      </script>
    </body>
  </html>`;
}

function isConvertibleNumber(text) {
  const s = text.trim();
  if (!s) return false;
  // Known explicit forms (alphanumeric-only tokens)
  const reExplicit = /^\s*[+-]?(?:0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|[0-9][0-9_]*|[0-9a-f_]+h|[01_]+b|[0-7_]+o)\s*$/i;
  if (reExplicit.test(s)) return true;
  // Aggressive heuristics:
  // - Pure hex letters/digits with at least one A-F -> treat as hex
  if (/^[+-]?[0-9a-f_]+$/i.test(s) && /[a-f]/i.test(s)) return true;
  // - Pure binary digits
  if (/^[+-]?[01_]+$/.test(s)) return true;
  // - Pure octal digits (2-7 present) — may overlap with dec, acceptable
  if (/^[+-]?[0-7_]+$/.test(s)) return true;
  return false;
}

class AdHocResultCodeLensProvider {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this._emitter.event;
    this._state = undefined; // { uri, range, items, expr, mode, originalExpr }
  }

  provideCodeLenses(document) {
    if (!this._state) return [];
    if (document.uri.toString() !== this._state.uri.toString()) return [];
    const { range, items, expr } = this._state;
    const topOfLine = new vscode.Range(range.start.line, 0, range.start.line, 0);
    const belowLineIdx = Math.min(range.start.line + 1, Math.max(range.start.line, document.lineCount - 1));
    const belowLine = new vscode.Range(belowLineIdx, 0, belowLineIdx, 0);
    const lenses = [];
    for (const it of items) {
      const title = it.description ? `${it.description}: ${it.label}` : it.label;
      lenses.push(new vscode.CodeLens(topOfLine, {
        title,
        command: 'fuzzycal.copyText',
        arguments: [it.label]
      }));
    }
    if (typeof expr === 'string') {
      const shown = expr.length > 40 ? expr.slice(0, 37) + '…' : expr;
      lenses.push(new vscode.CodeLens(belowLine, {
        title: `Expr: ${shown}`,
        command: 'fuzzycal.editExprForSelection',
        arguments: []
      }));
      lenses.push(new vscode.CodeLens(belowLine, {
        title: '↺',
        command: 'fuzzycal.resetExprForSelection',
        arguments: []
      }));
    }
    return lenses;
  }

  showForSelection(uri, range, items, opts) {
    const expr = opts && typeof opts.expr === 'string' ? opts.expr : undefined;
    const mode = opts && (opts.mode === 'expr' || opts.mode === 'base') ? opts.mode : undefined;
    const originalExpr = opts && typeof opts.originalExpr === 'string'
      ? opts.originalExpr
      : (this._state && this._state.originalExpr) || expr;
    this._state = { uri, range, items, expr, mode, originalExpr };
    this._emitter.fire();
  }

  clear() {
    if (this._state) {
      this._state = undefined;
      this._emitter.fire();
    }
  }

  getState() {
    return this._state;
  }

  
}
