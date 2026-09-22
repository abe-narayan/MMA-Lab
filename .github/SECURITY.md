# Security policy

## What this project is, from a security point of view

Bout Lab is an offline, self-contained simulation that runs entirely in the
browser. Being specific about that is more useful than a boilerplate promise:

- **No network access at runtime.** No CDN imports, no web fonts, no telemetry,
  no analytics, no external assets, no `fetch`. `dist/standalone.html` opens from
  a `file://` URL on a machine with no network connection.
  `scripts/inline.mjs` re-reads its own output at build time and exits non-zero
  if any script, link, image, media, CSS `url()`, `@import` or sibling-chunk
  import would still cause a request. This was also confirmed at runtime in a
  headless browser: zero network requests, zero console errors.
- **No server component.** There is nothing deployed, nothing listening, and no
  backend to attack. The dev server (`npm run dev`) and the preview server
  (`npm run preview`) are local Vite processes intended for a developer's own
  machine.
- **No user data.** The application collects nothing, stores nothing about you,
  and transmits nothing. There is no database, no cookie, no local-storage
  profile and no identifier of any kind.
- **No authentication, accounts, sessions, secrets or credentials.** There is
  nothing to log in to, so there is no auth surface, no session handling and no
  secret material in the repository.
- **No user-supplied input is executed.** The engine is a pure function of a
  seed, a parameter set and two athlete profiles, all of which are compiled in.
  Replays are loaded from files shipped alongside the page; there is no upload
  path and no evaluation of untrusted content.

The realistic consequence is that the interesting failure modes here are supply
chain and build-time, not runtime.

## The realistic surface

**Dependency vulnerabilities.** This is essentially the whole of it. The runtime
dependency set is deliberately tiny - React, React DOM and Three - and the rest
are development and build tooling (Vite, Vitest, TypeScript, tsx, Playwright,
type packages). An advisory against one of those is the most likely security
report this project will ever receive, and it is worth filing.

Also in scope, if you find one:

- a way to make the built page issue a network request, i.e. a case the
  `scripts/inline.mjs` audit misses
- anything in the repository that turns out to contain a credential or a secret
- a build-time or script-time path that reads or writes outside the project
  directory unexpectedly

Out of scope, because they are properties of the design rather than defects:

- the absence of authentication, rate limiting, CSP or transport security on a
  page that has no server and makes no requests
- the dev and preview servers being reachable on a local network if you choose
  to expose them
- anything about the accuracy or plausibility of the model, which is a modelling
  question and belongs in an issue of that kind

## Supported versions

The latest release on the default branch is the only supported version. This is
a modelling toy maintained on a best-effort basis; there are no backports.

| version | supported |
| --- | --- |
| 1.0.x | yes |
| earlier | no |

## Reporting a vulnerability

Open an issue in this repository. Given the surface described above, a genuine
report here is almost certainly a public dependency advisory, and there is
nothing to be gained from handling it privately - no deployment to patch, no
users to protect, no data at risk.

If you do believe you have found something that should not be public - a secret
committed by mistake, for example - use GitHub's **Report a vulnerability**
button under the Security tab of this repository, which opens a private advisory
visible only to the maintainers.

Please include:

- what you found and where in the repository it lives
- the package and advisory identifier, if it is a dependency issue
- what an attacker would actually be able to do, given that there is no server
  and no user data
- how to reproduce it

Expect a best-effort response. Dependency updates will generally be taken
straight away; anything that would require adding a runtime dependency the
single-file build cannot inline, or that would introduce a network request, will
be discussed in the open first, because those constraints are load-bearing for
what this project is.
