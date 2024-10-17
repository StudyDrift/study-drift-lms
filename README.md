<!-- TEXT_SECTION:header:START -->
<p align="center">
  <a href="https://linear.app" target="_blank" rel="noopener noreferrer">
    <img width="150" src="public/logo-trimmed.svg" alt="Linear logo">
  </a> 
</p>
<h1 align="center">
  Study Drift
</h1>
<h3 align="center">
  Learn by Learning & Teach by Teaching
</h3>
<p align="center">
  Study Drift uses AI to streamlines the process of course creation, quiz generation, and content management, enabling educators and learners to get to the content as quickly as possible
</p>
<p align="center">
  <a href="/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL_3.0-blue" alt="Study Drift is released under the AGPL 3.0 license." />
  </a>
  <a href="https://github.com/StudyDrift/study-drift-lms/actions/workflows/nextjs.yml">
    <img src="https://github.com/StudyDrift/study-drift-lms/actions/workflows/nextjs.yml/badge.svg" alt="Build github action status." />
  </a>
</p>
<!-- TEXT_SECTION:header:END -->

<br/>

# Study Drift LMS

**Study Drift LMS** is an open-source Learning Management System (LMS) built for modern education. Designed with AI integration at its core, it aims to streamline the process of course creation, quiz generation, and content management, enabling educators and learners to get to the content as quickly as possible.

## Features

- **AI-Powered Course Creation**: Automatically generate course outlines, lessons, and quizzes.
- **Seamless Content Management**: Organize and manage course materials with ease.
- **Student and Instructor Dashboards**: Clean and intuitive interfaces tailored to the needs of both students and instructors.
- **Next.js**: Built with Next.js for a fast, scalable, and modern web application.
- **MongoDB**: A flexible and powerful NoSQL database for storing courses, users, and quiz data.

## Tech Stack

- **Frontend**: Next.js (React)
- **Backend**: Node.js
- **Database**: MongoDB
- **AI Integration**: AI-driven tools to assist with content generation

## Getting Started

### Prerequisites

- Node.js (v14.x or higher)
- MongoDB (self-hosted or MongoDB Atlas)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/study-drift-lms.git
   cd study-drift-lms
   ```

1. Install dependencies:

   ```bash
   npm install
   ```

1. Set up your MongoDB connection string in `.env.local` file:

   ```bash
   cp .env.example .env.local
   ```

   We do provide a docker-compose.yml file for convenience with the mongo image.

   ```bash
   docker-compose up -d
   ```

1. Run the development server:

   ```bash
   npm run dev
   ```

1. Open [http://localhost:3000](http://localhost:3000) to view the app in your browser.

## Contributing

We welcome contributions from the community! To get started:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature-branch`).
3. Commit your changes (`git commit -m 'Add some feature'`).
4. Push to the branch (`git push origin feature-branch`).
5. Open a Pull Request.

## License

This project is licensed under the GNU Affero General Public License v3.0 License - see the [LICENSE](LICENSE) file for details.

---

**Study Drift LMS** - Getting to the content, faster.
