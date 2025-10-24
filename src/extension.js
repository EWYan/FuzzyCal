// FuzzyCal — 弹框计算器与进制转换
// Minimal JS extension (no build step)

const vscode = require('vscode');
const core = require('./core');

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

      // Try expression first; if not valid expression, try base-convert pattern
      const validation = core.validateExpression(text);
      if (validation) {
        // Not a valid expression. Check numeric/base notations.
        if (!isConvertibleNumber(text)) { provider.clear(); return; }

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
            provider.showForSelection(editor.document.uri, sel, items);
          } finally {
            showing = false;
          }
        }, 250);
        return;
      }

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
          provider.showForSelection(editor.document.uri, sel, items);
        } finally {
          showing = false;
        }
      }, 250);
    } catch {
      // noop
    }
  };
}

function isConvertibleNumber(text) {
  const s = text.trim();
  if (!s) return false;
  // Known explicit forms
  const reExplicit = /^\s*[+-]?(?:0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|[0-9][0-9_]*|[0-9a-f_]+h|[01_]+b|[0-7_]+o|\d{1,2}\#[0-9a-z_]+|base\s*\d{1,2}\s+[0-9a-z_]+)\s*$/i;
  if (reExplicit.test(s)) return true;
  // Aggressive heuristics:
  // - Pure hex letters/digits with at least one A-F -> treat as hex
  if (/^[+-]?[0-9a-f_]+$/i.test(s) && /[a-f]/i.test(s)) return true;
  // - Pure binary digits
  if (/^[+-]?[01_]+$/.test(s)) return true;
  // - Pure octal digits (2-7 present) — may overlap with dec, acceptable
  if (/^[+-]?[0-7_]+$/.test(s)) return true;
  // - Alphanumeric up to 32 chars -> treat as base36 candidate
  if (/^[+-]?[0-9a-z_]{2,32}$/i.test(s)) return true;
  return false;
}

class AdHocResultCodeLensProvider {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this._emitter.event;
    this._state = undefined; // { uri: Uri, range: Range, items: [{label, description}] }
  }

  provideCodeLenses(document) {
    if (!this._state) return [];
    if (document.uri.toString() !== this._state.uri.toString()) return [];
    const { range, items } = this._state;
    const topOfLine = new vscode.Range(range.start.line, 0, range.start.line, 0);
    const lenses = [];
    for (const it of items) {
      const title = it.description ? `${it.description}: ${it.label}` : it.label;
      lenses.push(new vscode.CodeLens(topOfLine, {
        title,
        command: 'fuzzycal.copyText',
        arguments: [it.label]
      }));
    }
    return lenses;
  }

  showForSelection(uri, range, items) {
    this._state = { uri, range, items };
    this._emitter.fire();
  }

  clear() {
    if (this._state) {
      this._state = undefined;
      this._emitter.fire();
    }
  }
}
