# 飞书多维表格作为后台

目标：管理员在飞书多维表格里维护数据，看板从飞书同步后只读展示；基地人员不需要飞书账号，使用看板自己的基地账号登录。

## 1. 创建飞书自建应用

1. 打开飞书开放平台，创建「企业自建应用」。
2. 开通多维表格权限：`bitable:app:readonly`（只读）或 `bitable:app`（需要写回时）。
3. 发布应用，并让企业管理员审核通过。
4. 把应用添加为多维表格的协作者，至少给「可阅读」权限。

## 2. 准备多维表格

建议一个多维表格应用里建 7 张数据表：

| 用途 | 环境变量 |
|---|---|
| 专项表1：销售直推未转化 | `FEISHU_TABLE_DIRECT` |
| 专项表2：分配 leads 未转化 | `FEISHU_TABLE_ASSIGNED` |
| 专项表3：高潜老用户 | `FEISHU_TABLE_HIGH` |
| 专项表4：钻石未消耗 | `FEISHU_TABLE_DIAMOND` |
| 业绩排行：辅导 | `FEISHU_TABLE_RANK_CONSULTANT` |
| 业绩排行：主管 | `FEISHU_TABLE_RANK_SUPERVISOR` |
| 业绩排行：组长 | `FEISHU_TABLE_RANK_LEADER` |

每张表都建议增加一个「基地」字段，值使用完整名称，例如 `武汉基地`。专项表2 可以直接用「城市」字段，系统会识别为基地。

字段名尽量与看板表头一致：

- 专项表1：转介绍日期、高峰、经理、主管、组长、姓名、工号、a、b（老用户）、c（新用户）、活动ID、转化等级、转化金额
- 专项表2：分配日期、拆课时间、年级、用户ID、手机号、城市、高峰、经理、承接人、一线承接销售、转化金额
- 专项表3：老用户ID、新体验用户数量、新正价用户数量、累计金额、销售、工号、高峰、经理、主管、组长、累计体验、累计正价、重点关注
- 专项表4：转介绍日期、高峰、经理、主管、组长、姓名、工号、a、b、c、转化日期、转化金额、应发放钻石
- 排行榜：基地、辅导姓名/主管/组长、辅导业绩或辅导直推业绩、目标、目标完成度

字段名不完全一致时，系统会按去掉空格和括号后的名称匹配；匹配不到会留空。

## 3. 获取 app_token 和 table_id

打开多维表格，URL 通常类似：

```text
https://xxx.feishu.cn/base/bascnXXXXXXXX?table=tblYYYYYYYY&view=vewZZZZ
```

- `bascnXXXXXXXX` 是 `FEISHU_APP_TOKEN`
- `tblYYYYYYYY` 是对应表的 `table_id`

## 4. 配置服务器环境变量

在服务器 `.env` 中填写（不要把 Secret 发到聊天或提交到 Git）：

```bash
FEISHU_APP_ID=cli_xxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
FEISHU_APP_TOKEN=bascnxxxxxxxx

FEISHU_TABLE_DIRECT=tblxxxxxxxx
FEISHU_TABLE_ASSIGNED=tblxxxxxxxx
FEISHU_TABLE_HIGH=tblxxxxxxxx
FEISHU_TABLE_DIAMOND=tblxxxxxxxx
FEISHU_TABLE_RANK_CONSULTANT=tblxxxxxxxx
FEISHU_TABLE_RANK_SUPERVISOR=tblxxxxxxxx
FEISHU_TABLE_RANK_LEADER=tblxxxxxxxx
```

然后重启：

```bash
docker compose -f docker-compose.prod.yml up -d
```

## 5. 同步

后台 →「飞书同步」→「立即同步」。同步完成后：

- 专项明细页使用飞书数据。
- 业绩排行页使用飞书排行榜数据。
- 前台基地账号仍然只看到本基地数据。

同步结果会缓存在 `data/feishu-cache.json`。飞书接口不可用时，看板继续使用上次缓存，不会直接空白。

自动更新：

```bash
FEISHU_SYNC_INTERVAL_SECONDS=60
```

服务端默认每 60 秒拉取一次飞书数据；专项明细和排行榜页面每 30 秒刷新一次。飞书里修改后，通常 1 分钟内会反映到看板。也可以随时在后台点「立即同步」。

## 6. 注意事项

- App Secret 只放在服务器环境变量，前端永远不接触。
- 飞书应用必须被添加为多维表格协作者，否则读取会失败。
- 飞书 API 有频率限制，建议每 5–15 分钟同步一次，不要每次页面请求都调用飞书。
- 当前实现是「飞书只写、看板只读」；如果需要看板写回飞书，再做写入接口和冲突处理。
- 基地隔离依赖每张表的「基地」字段；没有基地字段的记录会显示为「未分配」，基地账号看不到。
- 手机号等敏感字段仍建议只给管理员完整权限，前台继续脱敏。
