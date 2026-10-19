import { getOwnAccount } from "@igs/module-identity";
import { Button, Label, Select, Stack, TextField } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { AccountShell } from "../../../../components/account/account-shell";
import { ResultAlert } from "../../../../components/account/result-alert";
import { resultOf } from "../../../../lib/account-area";
import { NAME_MAX } from "../../../../lib/account-forms";
import { accountLocale, accountMetadata } from "../../../../server/account";
import { requireCustomer } from "../../../../server/customer";
import { saveProfile } from "../actions";

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Each language in its own language, so a shopper can find theirs whatever the page is in. */
const LANGUAGES = [
  ["nl", "Nederlands"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["en", "English"],
] as const;

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "profileTitle");
}

/** My details (igs-pharma#115 PR C): the name and the language of the e-mails. Addresses come with checkout. */
export default async function ProfilePage({ params, searchParams }: Props) {
  const locale = accountLocale((await params).locale);
  const session = await requireCustomer(locale, "/account/profile");
  const t = await getTranslations({ locale, namespace: "account" });
  const account = await getOwnAccount({}, session.actor);
  return (
    <AccountShell
      locale={locale}
      section="profile"
      title={t("profileTitle")}
      intro={t("profileIntro")}
    >
      <ResultAlert locale={locale} result={resultOf(await searchParams)} />
      <form action={saveProfile} aria-label={t("profileTitle")}>
        <input type="hidden" name="locale" value={locale} />
        <Stack gap={4}>
          <TextField
            id="profile-name"
            name="name"
            label={t("nameLabel")}
            autoComplete="name"
            required
            maxLength={NAME_MAX}
            defaultValue={account.name}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-language">{t("languageLabel")}</Label>
            <Select
              id="profile-language"
              name="emailLocale"
              defaultValue={account.locale}
              aria-describedby="profile-language-hint"
            >
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code} lang={code}>
                  {label}
                </option>
              ))}
            </Select>
            <p id="profile-language-hint" className="text-sm text-[var(--color-text-subtle)]">
              {t("languageHint")}
            </p>
          </div>
          <Button type="submit" className="self-start">
            {t("profileSave")}
          </Button>
        </Stack>
      </form>
    </AccountShell>
  );
}
