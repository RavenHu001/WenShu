# 文枢文档中心

简体中文 | [English](./README.en.md)

[返回项目首页](../README.md) · [发布文档](./releases/README.md)

## 从这里开始

- 了解项目、功能和快速启动：[项目 README](../README.md)。
- 查看发布范围、使用方法和已知限制：[发布文档索引](./releases/README.md)。
- 搭建开发环境：[开发环境说明](./development/DEVELOPMENT_ENVIRONMENT.md)。
- 执行自动检查、手工验收和生产构建验证：[测试指南](./development/TESTING.md)。
- 理解产品范围、架构和安全约束：[项目定义与技术基线](./architecture/PROJECT_BASELINE.md)。
- 追溯具体功能的规划、实施和验收：[任务档案索引](./tasks/README.md)。

## 文档分类

| 目录                | 内容                                                 | 入口                                         |
| ------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `releases/`         | 面向使用者的发布说明，中英文成对维护                 | [发布索引](./releases/README.md)             |
| `development/`      | 环境初始化、日常命令、故障处理与测试验收             | [开发指南](./development/README.md)          |
| `architecture/`     | 项目定义、产品范围、技术架构与开发约束               | [架构基线](./architecture/README.md)         |
| `plans/`            | 跨任务设计与规划，保留各文档的实施状态               | [规划与设计](./plans/README.md)              |
| `tasks/task-NNN/`   | 按任务编号归档的规划、执行提示、工作包报告与完成报告 | [任务档案](./tasks/README.md)                |
| `visual-baselines/` | 界面验收截图，按任务分组                             | [Task 11 截图](./visual-baselines/task-011/) |

任务规划描述当时的目标与验收要求；了解实际交付结果应阅读同一任务的完成报告。UI 优化计划已由 Task 11 实施，不能仅凭文件名将其视为未完成待办。当前发布工程的逐项结果见 [Task 12 完成报告](./tasks/task-012/TASK_012_COMPLETION_REPORT.md)。

## 发布、许可与安全

- [v0.1.0-alpha.1 发布说明](./releases/v0.1.0-alpha.1.md) · [English](./releases/v0.1.0-alpha.1.en.md)
- [变更记录](../CHANGELOG.md)（英文）
- [安全政策与漏洞报告](../SECURITY.md)（英文）
- [MIT License](../LICENSE)
- [第三方组件与许可声明](../THIRD_PARTY_NOTICES.txt)

## 维护约定

- 中文 Markdown 的原文件名保留为默认入口；对应英文版本使用 `.en.md` 后缀，并在页首提供双向语言切换。
- 文档中心、发布说明、开发指南、架构、规划和任务档案均提供中英文版本；更新时同步维护两种语言，保留历史事实、可执行示例和语言切换链接。
- 新任务使用 `tasks/task-NNN/` 目录，保留 `TASK_NNN_` 文件名前缀；将规划、提示词、工作包和完成报告放在同一任务目录，并更新任务索引。
- 移动文档时同步更新相对链接、正文中的仓库路径、相关配置和索引；命令示例仍从仓库根目录运行，除非文档另有说明。
- 发布状态、历史标签、构建产物和验收证据应保持各自的时间与范围，翻译和目录整理不改变原有结论。
