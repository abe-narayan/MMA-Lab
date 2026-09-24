/**
 * DESIGN-SYSTEM COMPOSITES — Tabs, Dialog (+ confirm), states (empty /
 * loading / error) and toasts with an Undo action.
 *
 * Accessibility contract:
 *  - Tabs follow the WAI-ARIA tabs pattern with automatic activation: arrow
 *    keys move and select, Home/End jump, only the selected tab is tabbable.
 *  - Dialog is modal: focus moves in on open, Tab is trapped inside, Escape
 *    closes, and focus returns to whatever opened it.
 *  - Toasts are announced through a polite live region and stay until their
 *    timer runs out; hovering or focusing one pauses nothing, so the timer is
 *    generous (8 s) for anything carrying an Undo.
 */

import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from 'react';
import { Button } from './primitives';
import { IconAlert, IconX } from './icons';

// --------------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------------

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  count?: number | string;
  countTone?: 'alert';
  hint?: string;
}

export function Tabs<T extends string>({
  items, value, onChange, label, idPrefix,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  idPrefix: string;
}): JSX.Element {
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = items.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          className="ui-tab"
          aria-selected={t.id === value}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          title={t.hint}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className="ui-tab-count" data-tone={t.countTone}>{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  idPrefix, id, active, children,
}: { idPrefix: string; id: string; active: boolean; children: ReactNode }): JSX.Element {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      hidden={!active}
      tabIndex={0}
    >
      {active ? children : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Dialog
// --------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open, onClose, title, description, children, footer, wide = false, initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** CSS selector inside the dialog to focus first. */
  initialFocus?: string;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = `dlg${useId().replace(/:/g, '')}`;

  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const node = ref.current;
    const first = (initialFocus ? node?.querySelector<HTMLElement>(initialFocus) : null)
      ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && typeof back.focus === 'function') back.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const nodes = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        className={`ui-dialog${wide ? ' ui-dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKey}
      >
        <div className="ui-dialog-head">
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <h2 className="ui-dialog-title" id={titleId}>{title}</h2>
            {description ? <p className="ui-dialog-desc">{description}</p> : null}
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close dialog" icon={<IconX />} onClick={onClose} />
        </div>
        {children ? <div className="ui-dialog-body">{children}</div> : null}
        {footer ? <div className="ui-dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * `const [confirm, confirmUi] = useConfirm()` — an awaitable replacement for
 * `window.confirm` that looks like the rest of the app and is keyboard- and
 * screen-reader-friendly. Render `confirmUi` once in the component.
 */
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, JSX.Element | null] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setState({ ...o, resolve });
  }), []);
  const close = (v: boolean): void => {
    state?.resolve(v);
    setState(null);
  };
  const ui = state ? (
    <Dialog
      open
      onClose={() => close(false)}
      title={state.title}
      initialFocus="[data-confirm-cancel]"
      footer={(
        <>
          <Button data-confirm-cancel onClick={() => close(false)}>{state.cancelLabel ?? 'Cancel'}</Button>
          <Button variant={state.danger ? 'danger-solid' : 'primary'} onClick={() => close(true)}>
            {state.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      )}
    >
      {state.body ? <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>{state.body}</div> : null}
    </Dialog>
  ) : null;
  return [confirm, ui];
}

// --------------------------------------------------------------------------
// States
// --------------------------------------------------------------------------

export function EmptyState({
  icon, title, children, actions, compact = false,
}: { icon?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; compact?: boolean }): JSX.Element {
  return (
    <div className={`ui-state${compact ? ' ui-state--compact' : ''}`}>
      {icon ? <span className="ui-state-icon" aria-hidden="true">{icon}</span> : null}
      <p className="ui-state-title">{title}</p>
      {children ? <div className="ui-state-body">{children}</div> : null}
      {actions ? <div className="ui-state-actions">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading…', lines = 0 }: { label?: string; lines?: number }): JSX.Element {
  return (
    <div className="ui-state ui-state--compact" role="status" aria-live="polite">
      <span className="ui-spinner" aria-hidden="true" style={{ width: 22, height: 22 }} />
      <p className="ui-state-body">{label}</p>
      {lines > 0 ? (
        <div style={{ width: 'min(420px, 100%)', display: 'grid', gap: 8, marginTop: 8 }} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <span key={i} className="ui-skeleton" style={{ width: `${90 - i * 12}%` }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong', children, detail, actions,
}: { title?: ReactNode; children?: ReactNode; detail?: string; actions?: ReactNode }): JSX.Element {
  return (
    <div className="ui-state" data-tone="error" role="alert">
      <span className="ui-state-icon" aria-hidden="true"><IconAlert /></span>
      <p className="ui-state-title">{title}</p>
      {children ? <div className="ui-state-body">{children}</div> : null}
      {detail ? <pre>{detail}</pre> : null}
      {actions ? <div className="ui-state-actions">{actions}</div> : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Toasts
// --------------------------------------------------------------------------

export interface ToastInput {
  message: ReactNode;
  tone?: 'default' | 'alert';
  actionLabel?: string;
  onAction?: () => void;
  /** ms; defaults to 8000 with an action, 4500 without. */
  duration?: number;
}

interface ToastItem extends ToastInput { id: number }

const ToastContext = createContext<(t: ToastInput) => void>(() => { /* no provider: toasts are dropped */ });

export function useToast(): (t: ToastInput) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const h = timers.current.get(id);
    if (h !== undefined) window.clearTimeout(h);
    timers.current.delete(id);
  }, []);

  const push = useCallback((t: ToastInput) => {
    counter.current += 1;
    const id = counter.current;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    const ms = t.duration ?? (t.onAction ? 8000 : 4500);
    timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  useEffect(() => () => {
    for (const h of timers.current.values()) window.clearTimeout(h);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toasts" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className="ui-toast" data-tone={t.tone === 'alert' ? 'alert' : undefined} role="status">
            <span className="ui-toast-msg">{t.message}</span>
            {t.onAction ? (
              <Button
                size="sm"
                className="ui-toast-action"
                onClick={() => { t.onAction?.(); dismiss(t.id); }}
              >
                {t.actionLabel ?? 'Undo'}
              </Button>
            ) : null}
            <Button size="sm" iconOnly aria-label="Dismiss notification" icon={<IconX />} onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
