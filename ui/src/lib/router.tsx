import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { BASE } from "./api";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/** Current path inside the app, without the base path the app may be mounted under. */
export function currentPath(): string {
  const path = window.location.pathname;
  return (BASE && path.startsWith(BASE) ? path.slice(BASE.length) : path) || "/";
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

export function navigate(to: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"](null, "", BASE + to);
  listeners.forEach((listener) => listener());
  window.scrollTo(0, 0);
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={BASE + to} onClick={handle} {...rest} />;
}
