# Security policy

The threat model, the review checklist, the findings and how each one was resolved are documented in [docs/seguridad.md](docs/seguridad.md) (in Spanish). Highlights: the solution never leaves the server, every incoming message is validated with Zod, connections are rate-limited and capped per instance and per IP, and the deployment requires a group access key.

## Supported versions

Only the current `main` branch is maintained.

## Reporting a vulnerability

Please do not open a public issue. Report it privately instead:

- through GitHub: **Security → Report a vulnerability** on this repository (a private security advisory), or
- if that option is unavailable to you, by opening an issue that only asks for a private contact channel, without any technical details (GitHub has no private issues).

Include the affected component, steps to reproduce and the impact you observed. You can expect an acknowledgement within a few days. Please give a reasonable window for a fix before any public disclosure.
