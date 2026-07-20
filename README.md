# Hello Betty

少儿英语课后练习产品。学生通过移动端完成作业，教师和管理员可通过 Web 管理台或移动端发布作业、评阅录音并查看学习情况。

## Current Milestone

- 学生手机号注册、登录和本地会话恢复；管理员可创建、启停教师和学生账号，并维护班级成员。
- 管理员和教师可登录 Web 或移动端工作台。教师只能操作已分配的活跃班级，权限以数据库中的当前账号和班级关系为准。
- 向选定学生发布按天或按周重复的作业计划，并为每名学生生成独立的作业触发实例；教师发布必须选择班级，管理员可使用不限定班级的流程。
- 支持绘本朗读、句子朗读、单词朗读、图片选词、字母排序和图片引导填空。
- 学生按顺序完成练习；客观题由服务端判分，朗读题支持录音、重录和示范音频播放。
- 学生作业列表用彩色图标区分未查看、未完成、已完成和老师已批改；作业弹层居中展示并完整适配作业图片，提交后可继续同一作业的下一项，整份完成后可从聊天卡片或按钮进入下一份未完成作业。
- 绘本、句子和单词录音提交后会创建独立的异步语音评测任务；学生只查看完成或失败的标准化评测结果，老师端可查看完整队列状态与分数，重录会生成新任务。
- 教师和管理员可在 Web 或移动端为当前朗读录音评定 A-D 等级，并提供可选语音反馈。
- Web 管理台可查看作业完成进度、暂停/恢复或终态归档作业，并查看、筛选和重试失败的语音评测任务。
- 学生可查看打卡天数、连续学习、口语时长和有效作业时长；工作人员可查看活跃学生的只读学习统计。
- 学生“我的”中心支持维护昵称、英文名、学校、年级和学习目标，并以积分等级、近七日图表和完整作业历史呈现学习成长。
- Web 管理台支持按班级设置每日打卡、作业完成和连续打卡里程碑奖励；规则修改只影响之后产生的积分。

异步语音评测适配层和运营队列已经实现，但尚未选择或接入商业评分供应商；未配置供应商时任务会保留在队列中，客户端对未变化任务的轮询最多持续五分钟，人工 A-D 终评始终独立。短信验证、密码找回、家长绑定、真实通知、对象存储和商业评分供应商仍未接入。完整边界见 [产品范围](docs/product-scope.md)，运营边界见 [运营闭环里程碑](docs/operations-milestone.md)，评分架构见 [异步语音评测](docs/speech-assessment.md)。

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
npm run web -w @hellobetty/mobile -- --port 8083
```

后三个开发命令应分别在独立终端运行。默认入口：

- API 健康检查：`http://localhost:4100/health`
- Web 管理台：`http://localhost:3000/login`
- 移动端 Web 预览：`http://localhost:8083`

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
- [学生作业连续交互](docs/homework-flow.md)
- [学习打卡与统计](docs/learning-stats.md)
- [异步语音评测](docs/speech-assessment.md)
- [运营闭环里程碑](docs/operations-milestone.md)
- [学生积分与个人中心](docs/student-engagement.md)
