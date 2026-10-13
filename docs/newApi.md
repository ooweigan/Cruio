# 本地 New API

Cruio 的「供应商与渠道」「New API 模型管理」直接使用 New API 原生控制台，独立登录。Dashboard 的用户和任务统计仍来自 Cruio；模型目录、供应商、渠道和定价在 New API 中管理。

## 当前部署

- 地址：<http://localhost:3001>
- 版本：`v1.0.0-rc.44`，固定版本，未使用浮动 `latest`。
- 容器：`cruioNewApi`，仅绑定 `127.0.0.1:3001`，自动重启。
- 数据：仓库 `data/newApi/storage/`，SQLite 与日志。
- 初始账号：`data/newApi/credentials.json`，权限 `0600`，已被 Git 忽略。
- 会话密钥：`data/newApi/runtime.env`，权限 `0600`，重建时保留。
- 初始化模式：自用，非演示站点。

Docker Hub 在本机不可达，因此当前使用官方 GitHub Release 的 ARM64 Linux 程序，按官方 `checksums-linux.txt` 验证 SHA256；运行在本机已有的 Debian 容器镜像中，只启动 New API 程序。没有启动该镜像的 Studio 服务。

```sh
docker start cruioNewApi
docker stop cruioNewApi
docker restart cruioNewApi
docker logs --tail 100 cruioNewApi
```

当前部署重建命令（从仓库根目录运行，已有同名容器时先停止并移除容器，保留数据目录）：

```sh
docker run -d --name cruioNewApi --restart unless-stopped --no-healthcheck --user 0 \
  -p 127.0.0.1:3001:3000 \
  --env-file data/newApi/runtime.env \
  -e TZ=Asia/Shanghai -e DEFAULT_LANGUAGE=zh-CN \
  -e SESSION_COOKIE_SECURE=false -e TRUSTED_PROXIES=none \
  -e SQLITE_PATH=/data/one-api.db \
  -v "$PWD/data/newApi/storage:/data" \
  -v "$PWD/data/newApi/newApiLinux:/opt/newApi:ro" \
  -w /data --entrypoint /opt/newApi \
  public.ecr.aws/supabase/studio:2026.06.22-sha-2207d7f
```

根目录 `compose.yaml` 也已增加官方 New API 镜像服务，安装 Compose 且 Docker Hub 可用后，可使用 `docker compose up -d newApi`。须先停止当前容器以释放 3001 端口，两者共用同一数据目录，不能同时启动。不要启动其他无关服务。

## 地址与接入边界

前端默认使用 `http://localhost:3001`。其他环境在构建时设置 `VITE_NEW_API_URL` 为 New API 控制台地址，然后重建前端。该变量只放地址，不放密钥。HTTPS 后台应使用 HTTPS 控制台。

此阶段已替换模型管理界面并完成本地部署。未配置任何供应商密钥，也未创建 Cruio 的调用令牌，**Cruio 生成任务尚未改为经 New API 转发**。不能仅因模型在 New API 中出现，就认定 Cruio 已支持对应类型的生成。

下一步接入需要配置真实上游渠道，创建用于 Cruio 的调用令牌，再按图片/视频接口协议接入并验证任务提交、查询、交付和计费。旧的任务配置快照及服务端版本记录保留，避免破坏历史任务。

官方来源：[发布版本](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.44)、[项目源码](https://github.com/QuantumNous/new-api)。
