# Lextures CLI Proposal

This document outlines the proposed command-line interface for `lextures`.

## Command Structure

The CLI follows a resource-oriented structure:
`lextures <resource> <action> [args] [--flags]`

### Global Flags
- `--config <path>`: Path to configuration file (default: `~/.lextures.yaml`)
- `--api-key <key>`: API key for authentication
- `--server <url>`: Lextures server URL
- `--json`: Output results in JSON format

---

### Resources

#### 1. Courses (`courses`)
Manage courses within the platform.

- `lextures courses list [--org <id>] [--term <term>]`: List courses.
- `lextures courses create --name <name> --code <code> [--org <id>]`: Create a new course.
- `lextures courses get <id>`: Get details of a specific course.
- `lextures courses delete <id>`: Delete a course.

#### 2. Users (`users`)
Manage users and their roles.

- `lextures users list`: List all users.
- `lextures users create --email <email> --name <name> [--role <role>]`: Create a user.
- `lextures users enroll --course <id> --user <id> --role <role>`: Enroll a user in a course.
- `lextures users get <id>`: Get user details.

#### 3. Assignments (`assignments`)
Manage course assignments.

- `lextures assignments list --course <id>`: List assignments for a course.
- `lextures assignments create --course <id> --title <title> [--points <points>]`: Create an assignment.
- `lextures assignments submit --assignment <id> --file <path>`: Submit an assignment.
- `lextures assignments get <id>`: Get assignment details.

#### 4. Grades (`grades`)
Manage grading and feedback.

- `lextures grades list --course <id> [--user <id>]`: List grades.
- `lextures grades update --submission <id> --score <score> [--comment <text>]`: Grade a submission.
- `lextures grades export --course <id> --format csv`: Export grades to CSV.

#### 5. Question Bank (`questions`)
Manage questions and item pools.

- `lextures questions list [--bank <id>]`: List questions.
- `lextures questions create --bank <id> --type <type> --content <json/file>`: Create a question.
- `lextures questions import --file <qti-path>`: Import questions (e.g., QTI format).

#### 6. Organizations (`orgs`)
Manage multi-tenancy organizations.

- `lextures orgs list`: List organizations.
- `lextures orgs create --name <name>`: Create a new organization.

#### 7. Auth (`auth`)
Handle authentication and session management.

- `lextures auth login`: Interactive login.
- `lextures auth logout`: Clear local session.
- `lextures auth status`: Show current auth status.

---

## Examples

```bash
# Create a course
lextures courses create --name "Intro to Computer Science" --code "CS101"

# Enroll a student
lextures users enroll --course CS101 --user student@example.com --role student

# Submit an assignment
lextures assignments submit --assignment 456 --file ./homework.pdf

# List grades for a course
lextures grades list --course 123 --json
```

## Implementation Plan

1. **Phase 1: Foundation**
   - Implement `root` command and configuration handling.
   - Implement `auth` commands (token storage).
2. **Phase 2: Core Resources**
   - Implement `courses` and `users` commands.
3. **Phase 3: Learning Workflow**
   - Implement `assignments`, `submissions`, and `grades`.
4. **Phase 4: Advanced Features**
   - `questions` bank management.
   - `orgs` and multi-tenancy management.
