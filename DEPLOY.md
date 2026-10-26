# 云端部署说明

目标：把看板部署到一台云服务器，使用固定域名 + HTTPS，电脑关机或重启不影响访问。

## 推荐配置

- 腾讯云轻量应用服务器 / 阿里云轻量服务器
- 2 核 2G、40GB 系统盘、Ubuntu 24.04
- 香港节点：免 ICP 备案，国内访问速度可接受，适合先上线
- 大陆节点：访问更快，但域名需要完成 ICP 备案
- 域名一个，例如 `dashboard.yourcompany.com`

## 1. 准备服务器

在云控制台：

1. 创建 Ubuntu 24.04 服务器。
2. 防火墙放行 `22`、`80`、`443`，不要对公网开放 `4310`。
3. 使用 SSH 密钥登录，不建议使用密码登录。
4. 在域名 DNS 中添加 A 记录，指向服务器公网 IP。

## 2. 上传项目

在本地项目上级目录执行（Windows 可用 PowerShell 的 `tar`）：

```bash
tar --exclude=node_modules --exclude=.cowork-temp -czf dashboard.tar.gz referral-dashboard
scp dashboard.tar.gz root@服务器IP:/opt/
```

登录服务器并解压：

```bash
ssh root@服务器IP
cd /opt
tar -xzf dashboard.tar.gz
cd referral-dashboard
```

> `data/` 目录包含当前数据库和基地账号文件，必须一起上传；它不会被打进 Docker 镜像，而是通过 volume 挂载。

## 3. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

## 4. 配置域名和密钥

```bash
cd /opt/referral-dashboard
cp .env.production.example .env
openssl rand -hex 32
nano .env
```

把 `DOMAIN` 改成自己的域名，把 `SESSION_SECRET` 改成刚生成的随机字符串。不要把 `.env` 提交到代码仓库。

## 5. 启动

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Caddy 会自动申请 HTTPS 证书。DNS 生效后访问：

- 前台登录：`https://你的域名/login`
- 管理后台：`https://你的域名/admin`

首次访问后台如果提示初始化管理员，按页面提示创建；如果已有 `data/dashboard.db`，则沿用原管理员和基地账号。

## 6. 日常备份

```bash
chmod +x scripts/backup.sh
./scripts/backup.sh
```

加入每天凌晨 2 点自动备份：

```bash
crontab -e
```

新增一行：

```cron
0 2 * * * /opt/referral-dashboard/scripts/backup.sh >> /var/log/referral-backup.log 2>&1
```

备份文件在 `backups/`，默认保留 14 天。建议再把备份同步到对象存储或另一台机器。

## 7. 更新版本

本地修改后重新上传项目（不要覆盖服务器上的 `data/` 和 `.env`），然后：

```bash
cd /opt/referral-dashboard
docker compose -f docker-compose.prod.yml up -d --build
```

数据库在 `data/`，重建容器不会丢数据。

## 8. 安全建议

- 公网只开放 `22/80/443`，`4310` 只供容器内部访问。
- 管理员密码使用复杂密码；基地账号通过安全渠道单独发送。
- `data/base-accounts.csv` 含有初始密码，权限设为仅管理员可读。
- 定期检查 `docker compose logs -f dashboard` 和备份文件。
- 如果使用大陆节点，先完成域名 ICP 备案，否则 80/443 可能无法正常访问。

## 费用参考

- 香港轻量 2C2G：约几十元/月
- 域名：约几十元/年
- 具体以云厂商实时价格为准
