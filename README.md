# 风眼台风实况

一个静态台风实况网站，数据来自浙江省水利厅主办的“浙江省台风路径实时发布系统”，通过 GitHub Actions 每 15 分钟抓取并发布到 GitHub Pages。

网站展示：

- 台风名称、编号和英文名
- 最新经纬度位置
- 移动方向与移动速度
- 台风等级、最大风速、风力等级和中心气压
- 最近 24 个官方实况路径点
- 中国气象台预报路径
- 浙江省官方接口返回的台风事件记录
- 数据观测时间、同步时间、来源和延迟状态

当官方接口没有活跃台风时，页面会明确显示“当前无活跃台风”，并展示本年度最近一条已结束的真实记录，不会将历史记录标记为当前实况。

## 数据来源

- 发布机构：浙江省水利厅
- 官方系统：[浙江省台风路径实时发布系统](https://typhoon.slt.zj.gov.cn/)
- 活跃台风接口：`https://typhoon.slt.zj.gov.cn/Api/TyhoonActivity`
- 台风详情接口：`https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/{id}`
- 官方事件接口：`https://typhoon.slt.zj.gov.cn/Api/TyphoonEvent/{id}/False`

本站与发布机构无隶属关系。公开接口的结构、使用条件和可用性可能由数据提供方调整，正式上线前应再次确认数据使用许可。请以官方最新发布作为防灾决策依据。

## 自动更新与发布

[.github/workflows/update-and-deploy.yml](.github/workflows/update-and-deploy.yml) 配置如下：

1. 每 15 分钟按 UTC 的整点、15、30、45 分触发一次。
2. 使用 Python 标准库请求官方接口，失败时重试。
3. 将字段归一化并写入 `data/current.json`。
4. 生成 `_site` 静态发布目录。
5. 通过 GitHub Pages Actions 部署。

GitHub 的定时任务可能因平台负载出现数分钟延迟。页面会显示数据同步时间，超过 45 分钟未更新时会标记“数据可能延迟”。

也可以在仓库的 Actions 页面手动运行 `Update typhoon data and deploy`。

## 本地运行

项目无需安装前端依赖。抓取数据需要 Python 3.9 或更高版本：

```bash
python3 scripts/fetch_typhoons.py --output data/current.json
python3 scripts/build_site.py
python3 -m http.server 8080 --directory _site
```

然后访问 `http://localhost:8080`。

也可以直接启动仓库根目录：

```bash
python3 -m http.server 8080
```

此时访问 `http://localhost:8080`，页面会读取 `data/current.json`。

## 文件说明

- [index.html](index.html)：页面结构与数据占位
- [styles.css](styles.css)：响应式视觉样式
- [app.js](app.js)：官方 JSON 渲染、路径地图、事件和交互
- [scripts/fetch_typhoons.py](scripts/fetch_typhoons.py)：官方数据抓取和标准化
- [scripts/build_site.py](scripts/build_site.py)：生成 GitHub Pages 发布目录
- [data/current.json](data/current.json)：最近一次生成的官方数据快照
- [docs/PLAN.md](docs/PLAN.md)：产品与开发计划

## 当前状态

- [x] 接入浙江省官方台风数据接口
- [x] 页面渲染真实路径、强度、预报和官方事件
- [x] 增加每 15 分钟更新工作流
- [x] 增加数据延迟和接口异常状态
- [x] 增加无活跃台风状态和最近结束记录
- [ ] 启用 GitHub Pages 并完成线上验收
