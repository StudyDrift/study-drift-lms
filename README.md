
<!-- TEXT_SECTION:header:START -->
<p align="center">
  <a href="https://github.com/StudyDrift/lextures" target="_blank" rel="noopener noreferrer">
    <img width="150" src="clients/web/public/logo-trimmed.svg" alt="Lextures logo">
  </a> 
</p>
<h1 align="center">
  Lextures
</h1>
<h3 align="center">
 The first truly adaptive learning environment
</h3>
<p align="center">
  Lextures uses AI to streamline the process of course creation, quiz generation, and content management, enabling educators and learners to get to the content as quickly as possible
</p>
<p align="center">
  <a href="/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL_3.0-blue" alt="Lextures is released under the AGPL 3.0 license." />
  </a>
  <a href="/CODE_OF_CONDUCT.md">
    <img src="https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg" alt="Contributor Covenant 2.1" />
  </a>
  <a href="https://github.com/StudyDrift/lextures/actions/workflows/deploy-demo.yml">
    <img src="https://github.com/StudyDrift/lextures/actions/workflows/deploy-demo.yml/badge.svg" alt="Deploy Demo GitHub Action status." />
  </a>
</p>
<p align="center">
  <a href="https://demo.lextures.com/">Live Demo</a>
</p>
<!-- TEXT_SECTION:header:END -->

<br/>

# Lextures

Open-source learning platform for running courses end to end: structured modules, calendars, grading, and enrollments—with AI hooks when you want them—so instructors and students spend less time on tooling and more on teaching and learning.

## Features

- **Adaptive delivery**: Quizzes that adjust difficulty in real time using Item Response Theory (IRT 2PL/3PL) to match learner mastery levels.
- **Course workspace**: Build structured modules with TipTap-powered rich content, assignments, and drag-and-drop organization.
- **Teaching & learning flows**: Integrated calendars, gradebooks, enrollment management, and an inbox for course communication.
- **Standards-based grading**: Map assignments to NGSS, CCSS, or custom standards and track mastery by objective with full audit trails.
- **Integrations**: LTI 1.3 provider/consumer support for Canvas, Moodle, and Blackboard; SAML 2.0, OIDC, and SCIM for enterprise identity.
- **AI-ready**: Optional OpenRouter integration for AI-assisted quiz generation, misconception detection, and automated hint scaffolding.
- **14+ question types**: From multiple choice and essays to live code execution and audio/video responses.
- **Fast, typed stack**: Go 1.25 API (Chi) + React 19 SPA (Vite, TypeScript, Tailwind CSS v4).
- **Data layer**: PostgreSQL 16 (relational) and MongoDB 7 (documents).

## Tech stack 


| Layer             | Choices                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| **Web app**       | React 19, Vite, TypeScript, Tailwind CSS v4, React Router, TipTap, Vitest |
| **API**           | Go 1.25, Chi, pgx, Argon2id passwords, JWT access tokens                  |
| **Data**          | PostgreSQL 16, MongoDB 7                                                  |
| **AI (optional)** | OpenRouter API (`OPEN_ROUTER_API_KEY` / `OPENROUTER_API_KEY`)             |


For architecture notes (Compose port layout, dev vs prod web, testing conventions), see [docs/ARCH.md](docs/ARCH.md).

## Getting started

See **[Getting started](docs/getting-started.md)** for prerequisites, Docker commands, and local development without full Docker.

## Contributing

Contributions are welcome. Everyone who participates is expected to follow the **[Code of Conduct](CODE_OF_CONDUCT.md)** (Contributor Covenant 2.1).

1. Fork the repository and create a branch for your change.
2. Make focused commits with clear messages.
3. Open a pull request describing what changed and why.

## License

This project is licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

---

**Lextures** — getting to the content, faster.
