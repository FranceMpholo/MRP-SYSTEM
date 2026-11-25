import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Render outside the independently scrolling workspace. Keep the panel anchored
// to its trigger while constraining it to the visible viewport, including zoom.
export default function CardInfoPopover({ id, title, triggerRef, onClose, children }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const dismiss = () => {
      onClose();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
    const position = () => {
      if (!trigger?.isConnected) return;
      const viewport = window.visualViewport;
      const originX = viewport?.offsetLeft || 0, originY = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const margin = 12;
      panel.style.width = `${Math.min(380, Math.max(0, width - margin * 2))}px`;
      panel.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
      const anchor = trigger.getBoundingClientRect(), rect = panel.getBoundingClientRect();
      const bottom = originY + height - margin;
      const below = anchor.bottom + 8;
      const preferredTop = below + rect.height <= bottom ? below : anchor.top - rect.height - 8;
      panel.style.left = `${Math.max(originX + margin, Math.min(anchor.right - rect.width, originX + width - rect.width - margin))}px`;
      panel.style.top = `${Math.max(originY + margin, Math.min(preferredTop, bottom - rect.height))}px`;
      panel.style.visibility = "visible";
    };
    const outside = (event) => {
      if (panel.contains(event.target) || trigger?.contains(event.target)) return;
      // Let another info trigger switch panels without the old one stealing focus.
      if (event.target.closest?.("[data-production-info]")) return;
      dismiss();
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    position();
    closeRef.current?.focus({ preventScroll: true });
    // Dismiss after pointer focus has settled so an outside click cannot undo
    // focus restoration by blurring the trigger during the same gesture.
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    return () => {
      document.removeEventListener("click", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      observer.disconnect();
    };
  }, [onClose, triggerRef]);

  function close() {
    onClose();
    triggerRef.current?.focus({ preventScroll: true });
  }

  return createPortal(<section ref={panelRef} className="plex-sans production-card-popover" id={`overview-${id}-information`} role="dialog" aria-labelledby={`overview-${id}-information-title`} aria-describedby={`overview-${id}-information-content`} style={{ visibility: "hidden" }}>
    <header><h3 id={`overview-${id}-information-title`}>{title} information</h3><button ref={closeRef} type="button" onClick={close} aria-label={`Close ${title} information`}><X size={16} aria-hidden="true" /></button></header>
    <div id={`overview-${id}-information-content`} className="production-card-popover-content">{children}</div>
  </section>, document.body);
}
