# Lextures

**Learn by Learning & Teach by Teaching**

Open-source learning platform for running courses end to end: structured modules, calendars, grading, and enrollments—with AI hooks when you want them—so instructors and students spend less time on tooling and more on teaching and learning.

## Features

- **Course workspace**: Create courses, edit syllabi, and build modules with rich content (TipTap) and assignments—organized with drag-and-drop where it helps.
- **Teaching & learning flows**: Per-course and workspace calendars, gradebook, enrollment management, and an inbox for staying on top of course communication.
- **Accounts & permissions**: Sign up and sign in with JWT-backed sessions; role-aware navigation and actions across the app shell.
- **AI-ready settings**: Optional [OpenRouter](https://openrouter.ai) integration for AI-assisted features (configure API keys and model preferences in Settings).
- **Fast, typed stack**: **Rust** HTTP API (**Axum** on **Tokio**) plus a **React 19** SPA built with **Vite**, **TypeScript**, and **Tailwind CSS v4**.
- **Data layer**: **PostgreSQL** (users, courses, and relational data via **sqlx** migrations); **MongoDB** is wired in for future document-style workloads.

## Tech stack


| Layer             | Choices                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| **Web app**       | React 19, Vite, TypeScript, Tailwind CSS v4, React Router, TipTap, Vitest |
| **API**           | Rust, Axum, serde, sqlx, Argon2 passwords, JWT access tokens              |
| **Data**          | PostgreSQL 16, MongoDB 7                                                  |
| **AI (optional)** | OpenRouter API (`OPEN_ROUTER_API_KEY` / `OPENROUTER_API_KEY`)             |


For architecture notes (Compose port layout, dev vs prod web, testing conventions), see [docs/tech-decisions.md](docs/tech-decisions.md).

## Getting started

See **[Getting started](docs/getting-started.md)** for prerequisites, Docker commands, and local development without full Docker.

## Contributing

Contributions are welcome.

1. Fork the repository and create a branch for your change.
2. Make focused commits with clear messages.
3. Open a pull request describing what changed and why.

## License

This project is licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

---

**Lextures** — getting to the content, faster.