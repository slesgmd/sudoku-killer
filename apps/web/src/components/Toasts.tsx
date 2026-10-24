// Avisos breves (docs/diseno.md §5.6 y §9): duran 6 s y se pausan con el cursor encima o con el foco
// (decisión 4 de entrega-f8.md). Los errores propios son `alert`; el resto, `status`.
import { useEffect, useRef, useState } from "react";
import type { Toast } from "../game/state.ts";
import { Icon } from "./Icon.tsx";

export const TOAST_MS = 6000;

function ToastItem({
  toast,
  onDismiss,
}: {
  readonly toast: Toast;
  readonly onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_MS);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, toast.id, onDismiss]);
  const isError = toast.role === "alert";
  return (
    <div
      className={`toast${isError ? " err" : ""}`}
      tabIndex={0}
      role={toast.role}
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
    >
      <Icon name={isError ? "alert" : "info"} />
      <span>{toast.text}</span>
    </div>
  );
}

export function Toasts({
  toasts,
  onDismiss,
}: {
  readonly toasts: readonly Toast[];
  readonly onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.slice(-2).map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
