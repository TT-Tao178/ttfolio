# 内嵌终端（FR-12.2 / C-60 预留位）

当前阶段**不实现**内嵌终端。本目录为未来 PTY/进程管理模块预留：
- `pty.ts`：节点侧伪终端管理（node-pty 适配）
- `session.ts`：终端会话与前端 WebSocket 桥

现状只提供「在此打开终端」（系统终端，见 core/openExternal.ts）。
