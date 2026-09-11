# WenShu documentation

[简体中文](./README.md) | English

[Project home](../README.en.md) · [Release documentation](./releases/README.en.md)

## Start here

- Learn about the project, features, and quick start: [project README](../README.en.md).
- Review release scope, usage, and known limitations: [release index](./releases/README.en.md).
- Set up the development environment: [development environment](./development/DEVELOPMENT_ENVIRONMENT.en.md).
- Run automated checks, manual acceptance, and production-build verification: [testing guide](./development/TESTING.en.md).
- Understand product scope, architecture, and security constraints: [project definition and technical baseline](./architecture/PROJECT_BASELINE.en.md).
- Trace feature planning, implementation, and acceptance: [task archive index](./tasks/README.en.md).

## Categories

| Directory           | Contents                                                                                      | Entry point                                          |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `releases/`         | Release notes for users, maintained in Chinese and English                                    | [Release index](./releases/README.en.md)             |
| `development/`      | Environment setup, daily commands, troubleshooting, and testing                               | [Development guides](./development/README.en.md)     |
| `architecture/`     | Project definition, product scope, architecture, and development constraints                  | [Architecture baseline](./architecture/README.en.md) |
| `plans/`            | Design and planning across tasks, with each document's implementation status preserved        | [Plans and design](./plans/README.en.md)             |
| `tasks/task-NNN/`   | Plans, execution prompts, work-package reports, and completion reports grouped by task number | [Task archive](./tasks/README.en.md)                 |
| `visual-baselines/` | UI acceptance screenshots grouped by task                                                     | [Task 11 screenshots](./visual-baselines/task-011/)  |

Task plans describe the goals and acceptance requirements at the time they were written. Read the corresponding completion report for the actual delivery results. The UI optimization plan was implemented in Task 11; its filename does not make it an outstanding backlog item. For the detailed results of the current release engineering work, see the [Task 12 completion report](./tasks/task-012/TASK_012_COMPLETION_REPORT.en.md).

## Releases, licensing, and security

- [v0.1.0-alpha.1 release notes](./releases/v0.1.0-alpha.1.en.md) · [简体中文](./releases/v0.1.0-alpha.1.md)
- [Changelog](../CHANGELOG.md)
- [Security policy and vulnerability reporting](../SECURITY.md)
- [MIT License](../LICENSE)
- [Third-party components and license notices](../THIRD_PARTY_NOTICES.txt)

## Maintenance conventions

- The original Chinese Markdown filenames remain the default entry points. English counterparts use the `.en.md` suffix, with language links in both directions at the top of each page.
- The documentation hub, release notes, development guides, architecture, plans, and task records are available in both languages. Update both versions together and preserve historical facts, executable examples, and language links.
- Create new tasks under `tasks/task-NNN/`, retaining the `TASK_NNN_` filename prefix. Keep the plan, prompts, work-package reports, and completion report together, and update the task index.
- When moving documents, update relative links, repository paths in the text, related configuration, and indexes. Command examples still run from the repository root unless a document says otherwise.
- Preserve the dates and scope of release status, historical tags, artifacts, and acceptance evidence. Translation and reorganization do not change the original conclusions.
