# Security Policy

Thanks for helping keep Poseforge and its users safe.

## A note on how Poseforge handles secrets

Poseforge is a **local-first, browser-only** app with **no backend and no server-side state**. Your Gemini and Meshy API keys are stored in your browser (IndexedDB) and are only attached to outbound requests to those providers through the app's own stateless proxy routes. Poseforge never persists your keys on a server, and there is no shared database of user data to breach.

Because of this, most traditional server-side vulnerability classes don't apply. The areas most worth scrutiny are: the proxy API routes (`app/api/*`), client-side handling of your keys, `.poseforge` bundle import (untrusted file parsing), and dependency vulnerabilities.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report privately through GitHub's [private vulnerability reporting](https://github.com/wolfgangjblack/poseforge/security/advisories/new) (Security → Advisories → "Report a vulnerability"). If that isn't enabled, contact the maintainer directly rather than filing a public issue.

When reporting, please include:

- A description of the issue and its potential impact
- Steps to reproduce (a minimal proof-of-concept if possible)
- The affected version / commit and your browser + OS
- Any suggested remediation, if you have one

You can expect an acknowledgement within a few days. We'll work with you to confirm the issue, assess impact, and ship a fix, and we're happy to credit you in the release notes once it's resolved (unless you'd prefer to remain anonymous).

## Scope

In scope: the Poseforge application code in this repository (the app, its API proxy routes, bundle import/export, and its dependencies).

Out of scope: vulnerabilities in the third-party providers themselves (Google Gemini, Meshy, World Labs), and issues that require a user to run a modified build or paste attacker-supplied code into their own browser console. Charges billed by providers to your own keys are a usage/billing matter, not a security vulnerability.

Thank you for reporting responsibly.
