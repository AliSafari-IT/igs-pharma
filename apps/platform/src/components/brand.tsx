import icon from "@igs/ui/brand/icon.svg";
import logo from "@igs/ui/brand/logo.svg";

/** The IGS Pharma icon (the leafy cross on its mint tile), beside the wordmark. Decorative. */
export function BrandIcon({ size = 36 }: { readonly size?: number }) {
  return (
    <img src={icon.src} width={size} height={size} alt="" aria-hidden="true" className="shrink-0" />
  );
}

/** The full IGS Pharma · Pharmacie Laaroussi logo. */
export function BrandLogo({ width = 200, alt }: { readonly width?: number; readonly alt: string }) {
  const height = Math.round((width * logo.height) / logo.width);
  return (
    <img
      src={logo.src}
      width={width}
      height={height}
      alt={alt}
      className="rounded-[var(--radius-lg)]"
    />
  );
}
