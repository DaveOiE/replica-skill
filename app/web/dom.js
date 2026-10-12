// Tiny element builder. Text always goes in as a text node, never as HTML, so nothing a user types can run.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/** A labelled select. `options` is [[value, label], ...]. */
export function select(id, label, options, value, onchange, disabled = false) {
  const el = h('select', { id, class: 'input', disabled, onchange: (e) => onchange?.(e.target.value) },
    options.map(([v, l]) => { const o = h('option', { value: v }, l); if (String(v) === String(value ?? '')) o.selected = true; return o; }));
  return h('div', { class: 'field' }, h('label', { for: id }, label), el);
}

export function field(id, label, attrs = {}) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, name: id, class: 'input', ...attrs }));
}

/** Short message in a polite live region. */
export function toast(message, isError = false) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('p', { class: isError ? 'toast toast-error' : 'toast' }, message);
  box.append(t);
  setTimeout(() => t.remove(), 4500);
}
