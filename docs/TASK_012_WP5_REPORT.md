# TASK-012 WP5 报告：Windows 安装、升级、卸载与真实文档验收

> 记录日期：2026-09-04；本报告为 WP5 的实际执行记录。未进入 WP6。

## 环境与安全状态

- 当前宿主：Windows 10 Home x64（Windows version `2009`）、普通用户 `TieJin\\CodexSandboxOffline`；
- Microsoft Word 16 存在；当前宿主未检测到 WPS Office；没有 Windows 11 x64 主机；
- Defender 未运行，Smart App Control policy state 为 `0`；本机不能提供 Defender 放行或 SmartScreen
  声誉结论；
- portable 与 NSIS 均为未签名（Authenticode `NotSigned`）。本机未签名产物行为不能外推到其他用户。

当前产物 SHA-256：portable `C82EE59A45D372AD2C324C2958A55533734783DB56CA3B397405E9897F1EA92F`；
NSIS `5DC63AA8FDC0B47314BB37DCEDDA2ABEE2075E7F17FDFA2E9F3ABF5F1F472B67`。

## 已完成的 Windows 产物验收

- portable 从唯一临时中文＋空格目录启动。启动器进程树有 5 个进程，实际主窗口句柄非零、标题为“文枢”；
  测试目录及进程树均已清理；
- NSIS 以普通用户静默安装到默认 per-user 路径 `%LOCALAPPDATA%\\Programs\\WenShu`，安装器退出码 `0`；
  安装结果有 `WenShu.exe`、`Uninstall WenShu.exe` 及开始菜单快捷方式 `文枢.lnk`；
- 安装版启动后主窗口句柄非零、标题为“文枢”；
- 同版本静默重装退出码 `0`，耗时 `12,359 ms`；
- 静默卸载退出码 `0`，耗时 `3,287 ms`；安装目录和开始菜单快捷方式均已删除；
- 在安装前创建唯一临时外部工作区及文件 SHA-256/长度清单。安装、同版本重装和卸载后均完全匹配，未修改外部工作区。
- WPS 基础 DOCX 双向往返采用已有 Task 7 手工验收：Windows 11 zh-CN 环境已在 WPS Office 上复核通过，
  见 `TASK_007_COMPLETION_REPORT.md` 第 1 节与第 8.7 节；当时 WPS 版本未记录，故本 WP 不将其描述为
  当前构建的重新实测。

## 已知未完成项

以下项没有被伪造成通过：

- Windows 11 x64 矩阵由项目所有者暂缓；当前没有该主机，不能完成双系统矩阵；
- 当前未安装 WPS，且没有可驱动的真实 Word/WPS GUI 会话，不能对当前发布产物重新记录 Office 双向往返。
  既有 Task 7 的 WPS 手工验收作为历史兼容性证据保留，不能替代本包的重新实测；
- 当前没有 `0.1.0-alpha.0-test` 安装包，不能实测 `alpha.0-test → alpha.1` 覆盖升级；
- 最终安装版/便携版中的 TXT/DOCX 实际打开、编辑、保存、备份、外部冲突、只读/degraded、回收站恢复、
  资源管理器显示与 dirty/saving 关闭保护仍需受控 Windows GUI 人工验收。WP4 E2E 覆盖了 TXT、DOCX、备份、
  About 与 dirty 标签关闭，但不能替代最终加固二进制的完整 GUI 文件验收；
- Defender 未运行且 Smart App Control 关闭，未观察到的 SmartScreen/Defender 行为不得概括为其他机器不会提示。

**WP5 门禁：未通过。** 当前 Windows 10 的安装、重装、卸载、外部工作区不变性和中文路径 portable
启动已有实测证据；但 Windows 11、alpha 升级、真实发布产物文件生命周期、回收站和 Office/WPS 矩阵尚未完成。
