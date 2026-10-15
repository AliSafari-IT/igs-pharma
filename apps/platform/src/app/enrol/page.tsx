import { AuthFrame } from "../../components/auth-frame";
import { RedeemEnrolment } from "../../components/redeem-enrolment";

export const metadata = { title: "Welcome · IGS-Pharma Platform" };

/** Landing page of a bootstrap enrolment link (36b): `/enrol#token=…`. */
export default function EnrolPage() {
  return (
    <AuthFrame title="Welcome to the back-office">
      <p className="text-[var(--color-text-muted)]">
        Next you set up 2-step login, so only you can sign in to your account.
      </p>
      <RedeemEnrolment />
    </AuthFrame>
  );
}
