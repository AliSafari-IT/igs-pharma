/**
 * Colour tokens: the ASafariM OS look (asafarim-os packages/theme/theme.css, the same values as
 * Breinhap). Light: cool light blue with navy actions. Dark: true charcoal with light-blue accents.
 * Both have a dark charcoal header. Availability is always text first, colour second.
 */
export interface Palette {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  onPrimary: string;
  header: string;
  onHeader: string;
  /** Availability chips and notices: a tint behind dark/light text, never the only signal. */
  ok: string;
  warn: string;
  stop: string;
  notice: string;
}

export const palettes = {
  light: {
    background: "#D8E6F1",
    surface: "#FFFFFF",
    text: "#15212B",
    muted: "#4B5B69",
    border: "#B9CFDF",
    primary: "#0F4C6E",
    onPrimary: "#FFFFFF",
    header: "#222222",
    onHeader: "#F4F4F4",
    ok: "#DCEFE4",
    warn: "#FBEFD5",
    stop: "#F6DEDC",
    notice: "#EAF2F8",
  },
  dark: {
    background: "#262626",
    surface: "#1C1C1C",
    text: "#F2F2F2",
    muted: "#B5B5B5",
    border: "#3D3D3D",
    primary: "#7FB0DC",
    onPrimary: "#0D1B26",
    header: "#161616",
    onHeader: "#F2F2F2",
    ok: "#1F3A2B",
    warn: "#3D3320",
    stop: "#43262A",
    notice: "#1E3550",
  },
} satisfies Record<string, Palette>;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;
export const fontSize = { small: 14, body: 16, title: 20, big: 26 } as const;
