// `server-only` throws when imported outside a React Server Components build. The worker is a
// plain Node server process, so the bundle aliases it to this empty module (see tsup.config.ts).
export {};
