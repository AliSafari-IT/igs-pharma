/** Replaces Next's built-in 404, whose inline style attributes the CSP blocks (T-011). */
export default function NotFoundPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <a className="underline" href="/">
        Back to the dashboard
      </a>
    </main>
  );
}
