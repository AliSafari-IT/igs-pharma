import type React from "react";

/** Text for assistive technology only (e.g. a currency's full name, a table caption). */
export function VisuallyHidden(props: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className="sr-only" {...props} />;
}
