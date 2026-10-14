"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Container, Stack } from "@igs/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** The idle limit for staff sessions (#95); the server enforces it, this only hides the screen. */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;

/** Input that shows the person is there (reading with a still mouse is not typing or clicking). */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

interface Props {
  readonly children: ReactNode;
}

/**
 * After 30 minutes without input in this tab, the page content is REMOVED from the screen (not just
 * covered: no patient, staff or pharmacy data stays in the DOM) and a sign-in prompt replaces it.
 * It also signs the session out. A convenience only: if this timer never fires, the server still
 * refuses the next request.
 */
export function IdleGuard({ children }: Props) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (idle) return;
    const arm = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setIdle(true), IDLE_LIMIT_MS);
    };
    arm();
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, arm, { passive: true });
    return () => {
      clearTimeout(timer.current);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, arm);
    };
  }, [idle]);

  useEffect(() => {
    // the tab is idle for as long as the server's limit: end the session for real, so "sign in
    // again" is one passkey away and nothing can pick the session up where it was left
    if (idle) void authClient.signOut().catch(() => undefined);
  }, [idle]);

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
            <Button type="button" onClick={() => window.location.assign("/sign-in?reason=idle")}>
              Sign in again
            </Button>
          </div>
        </Stack>
      </main>
    </Container>
  );
}
