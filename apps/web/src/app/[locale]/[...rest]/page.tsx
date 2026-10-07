import { notFound } from "next/navigation";

/**
 * Unknown paths under a locale render [locale]/not-found.tsx inside the (dynamic) locale layout,
 * not Next's prerendered root 404, whose scripts would carry no CSP nonce (T-011).
 */
export default function CatchAllPage() {
  notFound();
}
