"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Container, Stack } from "@igs/ui";
import { type ReactNode, useEffect, useState } from "react";

/** The idle limit for staff sessions (#95); the server enforces it, this only hides the screen. */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;

/** Input that shows the person is there (reading with a still mouse is not typing or clicking). */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/** Events after which the clock must be looked at again: a sleeping laptop or a background tab freezes timers. */
const WAKE_EVENTS = ["focus", "pageshow", "online"] as const;

/** Where tabs of this browser share the last input time (#100: work in one tab keeps the others alive). */
export const ACTIVITY_KEY = "igs.lastActivity";

/** Input is written to the shared key at most this often. */
const WRITE_EVERY_MS = 5_000;

/** The wall-clock check runs this often while the tab is visible (timers may run late; never early). */
const CHECK_EVERY_MS = 15_000;

interface Props {
  readonly children: ReactNode;
}

function readShared(): number {
  try {
    const value = Number(window.localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0; // storage blocked: this tab's own clock is all there is
  }
}

function writeShared(at: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // storage blocked or full: the guard works per tab
  }
}

/**
 * After 30 minutes without input in ANY tab of this browser, the page content is REMOVED from the
 * screen (not just covered: no patient, staff or pharmacy data stays in the DOM) and a sign-in prompt
 * replaces it. The deadline is wall-clock time: the last input is a timestamp (shared between tabs
 * through `localStorage`), checked on an interval and again when the tab wakes (focus, `pageshow`,
 * visibility, online), so a sleeping laptop or a throttled background tab is cleared on return, not
 * 30 minutes after it wakes. It does NOT sign out by itself: another tab may be in use, and the server ends
 * an idle session on its own. Only the person's click on "Sign in again" ends the session. A convenience only: if this never fires, the server still refuses the
 * next request.
 */
export function IdleGuard({ children }: Props) {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (idle) return;
    let last = Math.max(Date.now(), readShared());
    let lastWrite = 0;
    const check = () => {
      last = Math.max(last, readShared());
      if (Date.now() - last >= IDLE_LIMIT_MS) setIdle(true);
    };
    const active = () => {
      const now = Date.now();
      // input after the deadline passed (a frozen timer never got to clear the page) does not revive it
      if (now - Math.max(last, readShared()) >= IDLE_LIMIT_MS) return setIdle(true);
      last = now;
      if (now - lastWrite >= WRITE_EVERY_MS) {
        lastWrite = now;
        writeShared(now);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACTIVITY_KEY) last = Math.max(last, Number(event.newValue) || 0);
    };
    writeShared(last);
    const interval = setInterval(check, CHECK_EVERY_MS);
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, active, { passive: true });
    for (const name of WAKE_EVENTS) window.addEventListener(name, check);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(interval);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, active);
      for (const name of WAKE_EVENTS) window.removeEventListener(name, check);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [idle]);

  /** The person chose to sign in again: end this session first (a live one would skip the sign-in page). */
  const signInAgain = async () => {
    await authClient.signOut().catch(() => undefined);
    window.location.assign("/sign-in?reason=idle");
  };

  if (!idle) return children;
  return (
    <Container asChild size="sm">
      <main className="py-10" data-testid="idle-prompt">
        <Stack gap={6}>
          <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
            Signed out for your safety
          </h1>
          <Alert variant="info" title="No activity for 30 minutes">
            The page was cleared from the screen. Sign in again to continue.
          </Alert>
          <div>
            <Button type="button" onClick={signInAgain}>
              Sign in again
            </Button>
          </div>
        </Stack>
      </main>
    </Container>
  );
}
