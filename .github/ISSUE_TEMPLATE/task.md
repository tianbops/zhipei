---
name: 任务（AI 可执行）
about: 任何 CLI Agent 读此模板即可接手的标准任务单
title: "[任务] "
labels: task
assignees: ""
---

<!--
使用说明（给提出任务的人）：
- 本模板刻意不含任何 AI 厂商特定语法，任何 CLI Agent 都能读。
- 五项必填，缺任何一项都可能被执行 Agent 误做。
- 一个 Issue 只做一件事。跨多件事请拆成多个 Issue。
-->

## 1. 任务描述

<!-- 要解决什么问题、涉及哪些文件。注意：界面/业务逻辑在 Web 仓，不在本仓。 -->

## 2. 验收标准

<!-- 客户端没有单元测试，验收以"构建绿 + 守卫绿"为准。 -->
- [ ] 
- [ ] `npm run check:bridge` 通过
- [ ] `npm run check:template-drift` 通过
- [ ] `npx cap sync android && cd android && ./gradlew assembleDebug` 成功
- [ ] 若改动涉及桥方法，已跨仓校验：`node scripts/check-bridge-contract.mjs --web <zhipei-one 路径>`

## 3. 约束

- 遵守仓库 `AGENTS.md` 全部条款。
- **零费用**、**不上架商店**、**零人工代码审核**。
- **不得把权限判定放到客户端**（本仓不应存在任何权限逻辑）。
- **不得删改 7 个 `@JavascriptInterface` 桥方法**而不经 Issue 明确批准。
- **不得修改 `AGENTS.md` 本身**。

## 4. 回滚要求

```bash
git checkout -b backup/<任务名>-<YYYYMMDD>
git push -u origin backup/<任务名>-<YYYYMMDD>
```

- 已发版的 APK 无法回滚用户设备，只能发新版本覆盖 → 发版类改动必须格外保守。

## 5. 禁止事项

- ❌ 引入付费 SDK / 付费构建服务
- ❌ 提交 keystore、签名密码、`.env`
- ❌ 在 `www/` 内放业务资源（业务页面在 Web 仓）
- ❌ 改 `android/` 而不改 `android-template/`（必然触发漂移守卫）
- ❌ 在普通提交里改版本号

---

<!-- 以下由执行 Agent 填写 -->

## 执行记录

- 备份分支：
- 改动文件：
- 验证命令与结果：
- 是否涉及桥方法变更：
