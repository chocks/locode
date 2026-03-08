import * as Sentry from '@sentry/node'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,

    sendDefaultPii: false,

    // Trace 20% of CLI invocations to keep costs low
    tracesSampleRate: 0.2,

    includeLocalVariables: true,
  })}
