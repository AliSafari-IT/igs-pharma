import { Link } from "@igs/ui";

export default function DashboardPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-[var(--color-primary)]">IGS-Pharma Platform</h1>
      <nav aria-label="Back-office" className="mt-4">
        <ul className="flex flex-col gap-2">
          <li>
            <Link href="/products">Products</Link>
          </li>
          <li>
            <Link href="/categories">Categories</Link>
          </li>
          <li>
            <Link href="/stock">Stock</Link>
          </li>
          <li>
            Privacy
            <ul className="mt-2 ml-4 flex flex-col gap-2">
              <li>
                <Link href="/privacy/requests">Data requests</Link>
              </li>
              <li>
                <Link href="/privacy/consents">Consents</Link>
              </li>
            </ul>
          </li>
          <li>
            <Link href="/staff">Staff</Link>
          </li>
          <li>
            <Link href="/account">Your account</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
