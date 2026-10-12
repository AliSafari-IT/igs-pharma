"use server";

import { isDomainError } from "@igs/kernel";
import {
  type SubjectConsents,
  createDsr,
  getConsents,
  recordConsent,
  transitionDsr,
} from "@igs/module-privacy";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CURRENT_POLICY_VERSION } from "../../components/privacy-labels";
import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const brusselsDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" });

/**
 * The moment a request was received, from the form's date (YYYY-MM-DD, Brussels). Today means now;
 * an earlier day means noon UTC of that day, which is the same calendar day in Brussels. A later day
 * is passed through, so the command refuses it (`privacy.received_at_invalid`).
 */
function receivedAtOf(day: string, now: Date): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return day === brusselsDay.format(now) ? now.toISOString() : `${day}T12:00:00.000Z`;
}

/** The New request form. */
export interface DsrFormState {
  readonly error?: string;
  readonly values?: Readonly<Record<string, string>>;
}

export async function createRequest(
  _previous: DsrFormState,
  form: FormData,
): Promise<DsrFormState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const values = {
    type: text(form, "type"),
    subjectRef: text(form, "subjectRef"),
    receivedOn: text(form, "receivedOn"),
    channel: text(form, "channel"),
    note: text(form, "note"),
  };
  let requestId: string;
  try {
    ({ requestId } = await createDsr(
      {
        type: values.type,
        subjectRef: values.subjectRef,
        receivedAt: receivedAtOf(values.receivedOn, new Date()),
        channel: values.channel,
        note: values.note,
      },
      actor,
      { origin: await requestOrigin() },
    ));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code, values };
  }
  revalidatePath("/privacy/requests");
  redirect(`/privacy/requests/${requestId}?created=1`);
}

/** The Change status dialog on a request page. */
export interface DsrStatusState {
  readonly error?: string;
  readonly values?: Readonly<Record<string, string>>;
}

export async function changeStatus(
  _previous: DsrStatusState,
  form: FormData,
): Promise<DsrStatusState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const requestId = text(form, "requestId");
  const values = { to: text(form, "to"), note: text(form, "note") };
  try {
    await transitionDsr({ requestId, to: values.to, note: values.note }, actor, {
      origin: await requestOrigin(),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code, values };
  }
  revalidatePath("/privacy/requests");
  redirect(`/privacy/requests/${encodeURIComponent(requestId)}?moved=${values.to}`);
}

/**
 * The Consents page: look a person up, and record a consent given or withdrawn in the pharmacy or
 * by phone. A POST, so the e-mail address never appears in a URL (or an access log).
 */
export interface ConsentsState {
  readonly error?: string;
  /** Set after a change was recorded. */
  readonly recorded?: boolean;
  readonly lookup?: string;
  readonly consents?: SubjectConsents;
}

export async function consents(previous: ConsentsState, form: FormData): Promise<ConsentsState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const intent = text(form, "intent");
  const subjectRef = text(form, "subjectRef");
  try {
    if (intent === "record") {
      await recordConsent(
        {
          subjectRef,
          purpose: text(form, "purpose"),
          granted: text(form, "granted") === "true",
          policyVersion: CURRENT_POLICY_VERSION,
          source: text(form, "source"),
        },
        actor,
        { origin: await requestOrigin() },
      );
    }
    const found = await getConsents({ subjectRef }, actor);
    return { lookup: subjectRef, consents: found, recorded: intent === "record" };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // a failed lookup must not keep showing the previous person's consents
    const kept = intent === "record" && previous.consents ? { consents: previous.consents } : {};
    return { ...kept, lookup: subjectRef, recorded: false, error: error.code };
  }
}
