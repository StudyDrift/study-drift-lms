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

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up your MongoDB connection string in `.env` file:

   ```bash
   MONGODB_URI=<your_mongodb_connection_string>
   ```

   We do provide a docker-compose.yml file for convenience with the mongo image.

   ```bash
   docker-compose up -d
   ```

4. Run the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) to view the app in your browser.

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
