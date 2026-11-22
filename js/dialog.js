/* Confirm and prompt dialogs in the page's own style, on the <dialog> element. A modal dialog keeps focus
   inside, Esc cancels, and focus goes back to where it was when the dialog closes. Dangerous actions
   start with focus on Cancel. Text is always set as text, never as HTML. */
const Dialog = (() => {
  'use strict';

  let active = null; // the open dialog's settle function

  function parts() {
    const $ = (id) => document.getElementById(id);
    return {
      dialog: $('dialog'), title: $('dialogTitle'), message: $('dialogMessage'), field: $('dialogField'),
      label: $('dialogLabel'), input: $('dialogInput'), error: $('dialogError'), ok: $('dialogOk'), cancel: $('dialogCancel')
    };
  }

  /**
   * Open the dialog. Resolves to { ok: true, value } when confirmed, or { ok: false } when cancelled
   * (Cancel, Esc, or another dialog taking its place).
   */
  function open(o) {
    const p = parts();
    if (active) active({ ok: false });
    const returnTo = document.activeElement;

    p.title.textContent = o.title;
    p.message.textContent = o.message || '';
    p.message.hidden = !o.message;
    p.ok.textContent = o.confirmLabel || 'OK';
    p.cancel.textContent = o.cancelLabel || 'Cancel';
    p.ok.classList.toggle('danger', !!o.danger);
    p.dialog.classList.toggle('is-danger', !!o.danger);
    p.field.hidden = !o.prompt;
    p.error.textContent = '';
    if (o.prompt) {
      p.label.textContent = o.label || '';
      p.input.value = o.value || '';
      p.input.maxLength = o.maxLength || 80;
    }

    return new Promise((resolve) => {
      const settle = (result) => {
        if (active !== settle) return;
        active = null;
        p.ok.removeEventListener('click', onOk);
        p.cancel.removeEventListener('click', onCancel);
        p.dialog.removeEventListener('cancel', onEsc);
        p.input.removeEventListener('keydown', onEnter);
        if (p.dialog.open) p.dialog.close();
        // Back to where the person was, if that is still on the page.
        if (returnTo && returnTo.isConnected && typeof returnTo.focus === 'function') returnTo.focus();
        resolve(result);
      };
      const onOk = () => {
        if (o.prompt) {
          const value = p.input.value.trim();
          if (!value) {
            p.error.textContent = o.emptyMessage || 'Enter a name.';
            p.input.focus();
            return;
          }
          settle({ ok: true, value });
        } else {
          settle({ ok: true });
        }
      };
      const onCancel = () => settle({ ok: false });
      const onEsc = (e) => {
        e.preventDefault();
        settle({ ok: false });
      };
      const onEnter = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOk();
        }
      };
      active = settle;
      p.ok.addEventListener('click', onOk);
      p.cancel.addEventListener('click', onCancel);
      p.dialog.addEventListener('cancel', onEsc);
      p.input.addEventListener('keydown', onEnter);

      p.dialog.showModal();
      // Where focus starts: the text field for a prompt, Cancel for anything dangerous, otherwise the main button.
      if (o.prompt) {
        p.input.focus();
        p.input.select();
      } else if (o.danger) {
        p.cancel.focus();
      } else {
        p.ok.focus();
      }
    });
  }

  /** Ask a yes or no question. Resolves true for the confirm button. */
  async function confirm(o) {
    return (await open(o)).ok;
  }

  /** Ask for a short text. Resolves to the trimmed text, or null when cancelled. */
  async function prompt(o) {
    const r = await open(Object.assign({}, o, { prompt: true }));
    return r.ok ? r.value : null;
  }

  return { confirm, prompt };
})();
