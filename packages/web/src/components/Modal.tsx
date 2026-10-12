import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

let openCount = 0;

/**
 * Accessible modal dialog. When `onSubmit` is given, the body is a <form>
 * and the footer buttons can use type="submit".
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  onSubmit,
  size = 'md',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  size?: 'sm' | 'md' | 'lg';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Captured during the first render, i.e. before autoFocus inside the dialog moves focus.
  const [previouslyFocused] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    openCount += 1;
    document.body.classList.add('modal-open');
    const panel = panelRef.current;
    // Keep focus if a child already took it (autoFocus), otherwise focus the first control.
    if (!panel?.contains(document.activeElement)) {
      const first = panel?.querySelector<HTMLElement>(
        'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not(.modal-close):not([disabled])',
      );
      (first ?? panel)?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab' && panel) {
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openCount -= 1;
      if (openCount === 0) document.body.classList.remove('modal-open');
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [previouslyFocused]);

  const content = (
    <>
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn-icon btn-ghost modal-close" onClick={onClose} aria-label="Schließen">
          <Icon name="x" size={16} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer ? <footer className="modal-footer">{footer}</footer> : null}
    </>
  );

  return createPortal(
    <div
      className="modal-backdrop"
      // Forms only close via button/Escape so a stray click does not discard input.
      onMouseDown={(e) => !onSubmit && e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {onSubmit ? (
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(e);
            }}
          >
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </div>,
    document.body,
  );
}
