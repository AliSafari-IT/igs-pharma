import { Button } from "@igs/ui";

/**
 * The preview key form (igs-pharma#91): a plain HTML form (no script) that POSTs the key to
 * `/preview`, so the key never appears in a URL, a proxy log or the browser history.
 */
export default function PreviewKeyPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        method="post"
        action="/preview"
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-8 shadow-sm"
      >
        <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
          Storefront preview
        </h1>
        <p className="text-[var(--color-text-subtle)]">
          Enter the preview key to see the shop before it opens. It is not public.
        </p>
        <label htmlFor="preview-key" className="font-medium">
          Preview key
        </label>
        <input
          id="preview-key"
          name="key"
          type="password"
          required
          autoComplete="off"
          maxLength={512}
          className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2"
        />
        <Button type="submit">Open the preview</Button>
      </form>
    </main>
  );
}
