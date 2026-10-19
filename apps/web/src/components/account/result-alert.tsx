import { Alert } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { type AccountResult, isSuccessResult, resultMessageKey } from "../../lib/account-area";

interface Props {
  readonly locale: string;
  readonly result: AccountResult | null;
}

/** What the last form did (`?result=`): a status for a screen reader, nothing when there was no form. */
export async function ResultAlert({ locale, result }: Props) {
  if (!result) return null;
  const t = await getTranslations({ locale, namespace: "account" });
  const success = isSuccessResult(result);
  return (
    <Alert
      variant={success ? "success" : "error"}
      role={success ? "status" : "alert"}
      title={t(resultMessageKey(result))}
      data-testid={`result-${result}`}
    />
  );
}
