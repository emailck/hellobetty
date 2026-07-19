# Hello Betty

少儿英语课后练习产品。学生通过移动端完成作业，教师和管理员可通过 Web 管理台或移动端发布作业、评阅录音并查看学习情况。

## Current Milestone

- 学生手机号注册、登录和本地会话恢复，管理员登录和学生账号概览。
- 向选定学生发布按天或按周重复的作业计划，并为每名学生生成独立的作业触发实例。
- 支持绘本朗读、句子朗读、单词朗读、图片选词、字母排序和图片引导填空。
- 学生按顺序完成练习；客观题由服务端判分，朗读题支持录音、重录和示范音频播放。
- 绘本、句子和单词录音提交后会创建独立的异步语音评测任务；学生和教师可查看标准化评测状态与分数，重录会生成新任务。
- 教师和管理员可在 Web 或移动端为当前朗读录音评定 A-D 等级，并提供可选语音反馈。
- 学生可查看打卡天数、连续学习、口语时长和有效作业时长；工作人员可查看活跃学生的只读学习统计。

异步语音评测适配层已经实现，但尚未选择或接入商业评分供应商；未配置供应商时任务会保留在队列中，且人工 A-D 终评始终独立。短信验证、密码找回、家长绑定、班级模型和通知尚未实现。完整边界见 [产品范围](docs/product-scope.md)，评分架构见 [异步语音评测](docs/speech-assessment.md)。

## Workspace

- `apps/mobile` - Expo / React Native 学生与教师移动端
- `apps/admin` - Next.js Web 管理台
- `services/api` - Fastify / Node.js SQLite API
- `docs` - 产品与架构文档

## Local Development

需要 Node.js 22+ 和 npm 10+。首次运行：

```bash
npm install
npm run db:seed -w @hellobetty/api
npm run dev:api
npm run dev:admin
npm run dev:mobile -- --port 8083
```

后三个开发命令应分别在独立终端运行。默认入口：

- API 健康检查：`http://localhost:4100/health`
- Web 管理台：`http://localhost:3000/login`
- 移动端 Web 预览：Expo 分配的地址，通常为 `http://localhost:8081`

环境变量、本地管理员和端口说明见 [启动指南](docs/getting-started.md)。

## Verification

```bash
npm run typecheck
npm test
npm run build
```

更多设计与接口说明：

- [HTTP API](docs/api.md)
- [作业数据模型](docs/homework-model.md)
- [学习打卡与统计](docs/learning-stats.md)
- [异步语音评测](docs/speech-assessment.md)
