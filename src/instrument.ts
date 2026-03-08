import * as Sentry from '@sentry/node'
import pkgJson from '../package.json'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,

    release: `v${pkgJson.version}`,
    sendDefaultPii: false,

    // Trace 20% of CLI invocations to keep costs low
    tracesSampleRate: 0.2,

    includeLocalVariables: true,
  })}
