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
            <Link href="/account">Your account</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
