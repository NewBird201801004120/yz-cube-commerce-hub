# 2026-11-17 完整商品接收校验更新

当前本地化版本为`20261117-required-fields-02`，回滚版本为`20261117-adaptation-01`；核心网关仍为`20261117-category-gateway-01`。仅替换localization-integration.js与localization-integration-main.js，2个文件SHA-256检查通过，仅重启本地化API。

公开接口缺售价、库存、重量、尺寸及多项缺失5组请求均返回400和fieldErrors；完整资料、零库存且省略类目能通过完整性检查，复用已存在requestId返回409，未覆盖既有数据。原接收记录GET仍返回200。前后imports=4、sources=3、drafts=4、tasks=0一致，未产生记录、草稿或商品写入。

114项测试、typecheck、build、verify:baseline、Diff Gate通过。外部文档与独立及内嵌JSON Schema已同步标明必填；这是有意收紧接收契约，不再接受不完整资料作为新接收记录。详细证据为output/localization/REQUIRED-FIELDS-VERIFICATION-20261117.json，服务端部署记录为/var/lib/yz-commerce/localization-required-deploy-20261117.json。

---

# 2026-11-17 本地化自动适配修复部署

当前本地化运行版本为`/opt/yz-commerce/localization-integration/releases/20261117-adaptation-01`；中央API运行版本为`/opt/yz-commerce/releases/20261117-category-gateway-01`。本地化包344个文件SHA-256核对通过，保留线上Listing模块；中央API仅修改已运行development.js的属性类目参数校验与归一化，保留视频及其他已部署逻辑。没有数据库迁移、凭据变更或Nginx规则变更。

重启yz-commerce-api、yz-commerce-localization-integration、yz-commerce-localization-console后均active。公网真实属性查询、专用Bearer店铺查询、既有接收请求幂等重放及状态查询通过；真实英文草稿自动适配得到101226/NoBrand/物流4000，缺价格库存和包装尺寸按预期阻止发布。未写入Shopee商品。

回滚点：核心`/opt/yz-commerce/releases/20261115-video-unknown-v2`；本地化`/opt/yz-commerce/localization-integration/releases/20261117-integration-receipts-02`。将对应current符号链接原子切回并重启上述服务；配置和数据目录保持原样。部署记录`/var/lib/yz-commerce/localization-deploy-20261117.json`。

---

# 中台服务器部署

## 2026-11-13：仿真平台接入与本地化审核

四个机器接口已部署并用专用Bearer在公网验证。完整四SKU mock仅导入中台，真实AI文案生成后状态为awaiting_review；同请求重放返回相同记录和草稿，内容冲突返回409，服务重启后草稿与接收记录可恢复。本次没有创建、发布或修改Shopee商品。

- 独立版本：`/opt/yz-commerce/localization-integration/releases/20261117-integration-receipts-02`，运行链接：`/opt/yz-commerce/localization-integration/current`。基础版本662个文件及本次5个路由/控制器热修文件均通过SHA-256核对。
- API：`yz-commerce-localization-integration`，127.0.0.1:4111。提供`/api/v1/localization/`和管理员AI配置接口`/api/v1/settings/ai`；机器Bearer不授权管理员草稿操作或发布。没有注册Listing生成任务接口。
- 本地团队登录会话使用的开发接口`/api/v1/development/localization/imports`及文案重试也转发到4111，并由共享数据库中的DEV会话验证。4110未上架保存测试通道仅接收`/shops/`操作和`/health`；其余本地化开发API不再被该前缀截走。
- 审核页面：`yz-commerce-localization-console`，127.0.0.1:3110。Nginx仅将`/tools/localization`、`/settings/ai`转发到此服务，复用原中台管理员登录Cookie与数据库。
- 接入配置：`/etc/yz-commerce/localization-integrations.json`，root:yz-hub/0640，仅保存令牌摘要。已启用simulation来源和全部已连接店铺范围，生产沿用本次专用令牌。
- 环境文件：`/etc/yz-commerce/localization-integration.env`，root:yz-hub/0640；复用原`app.env`。草稿和接收记录在`/var/lib/yz-commerce/localization`；本项目既有AI配置的加密文件及解密密钥在`/var/lib/yz-commerce/localization-ai`，目录yz-hub/0700、文件0600。未复制个人项目配置或本地Listing任务。
- Nginx include：`/etc/nginx/snippets/yz-localization-integration.conf`。`/_next/static/`使用新版本`web-assets`内原核心与新审核页面的静态资源并集；实测两套页面引用的16项资源全部200。
- 浏览器已验证真实导入记录、生成文案、目标店铺和四SKU草稿。原站点仍沿用原核心构建；Listing组图入口尚未部署，审核页面对该入口的预取会404；既有favicon也404，不影响本次接入和草稿审核。
- 原核心API/Web及4110保存服务继续运行；原核心PID185084/185486未变化。本次仅重载Nginx和新增两个独立服务。
- 公网证据：`output/localization/INTEGRATION-PUBLIC-20261113.json`；审核截图：`output/localization/INTEGRATION-PRODUCTION-REVIEW-20261113.png`。接口交付文档：`docs/LOCALIZATION-INTEGRATION.md`；原始Bearer单独私密交付，不写入此文档。

恢复时，仅移除站点中的`include /etc/nginx/snippets/yz-localization-integration.conf;`，执行`nginx -t`后reload，再停用上述两个新增服务；保留数据及配置。首次变更前站点副本为`/etc/nginx/sites-available/yz-commerce-aicbec.before-localization-integration-20261113`，恢复前先核对后续其他变更，不直接覆盖整份站点文件。勿停原API、Web或4110保存服务。

## 2026-11-13：独立未上架保存验证通道

用户授权部署最小保存接口，并允许使用mock商品；未授权真实发布。新增 `yz-commerce-localization-save`，以yz-hub运行，监听127.0.0.1:4110；仅路由 `/api/v1/development/localization/` 到该服务。原中台API和Web未重启，原current链接及两份systemd配置保持原样；实际主服务目录核验为 `/opt/yz-commerce/releases/20261111-responsive-01`。

- 保存服务运行链接：`/opt/yz-commerce/localization-save/current`，当前指向 `releases/20261113-save-only-03`；01、02版保留作恢复点。03版增加受限save_variations，完整双规格4SKU商品50821595037已保存并回读UNLIST；核心API/Web未重启。
- 仅13个编译后端模块，复用现有服务器依赖；没有发布前端或ListingService。依赖链接是服务独享目录，未修改原node_modules。
- 服务配置：`/etc/systemd/system/yz-commerce-localization-save.service`；复用既有服务端环境文件，追加非密钥配置 `/etc/yz-commerce/localization-save.env`，限定连接 `cmwbzd7ls0009nd5por0hoswv`。
- 持久目录：`/var/lib/yz-commerce/localization-save-test`，yz-hub/0700；保留创建标记、远端ID与状态。
- Nginx仅增加include `/etc/nginx/snippets/yz-localization-save-only.conf`，原站点备份在 `/etc/nginx/sites-available/yz-commerce-aicbec.before-localization-save-20261113`；nginx -t后reload，原API/Web进程继续运行。
- 真实结果：Home Monitor_PH（618217104）测试商品44671691020，UNLIST，PHP10，库存0，主图1张。complete与publish的真实HTTP请求均被403拒绝，未执行平台发布。
- 该通道使用既有管理员DEV会话鉴权，不是仿真专用Bearer接口。机器导入接口与此前生成的专用令牌未因此上线或启用。

停用此测试通道时，可恢复上述站点备份，执行nginx -t并reload，再停用 `yz-commerce-localization-save`。保留该服务数据目录及已创建的未上架商品，不自动删除。不得将此恢复操作扩大到原中台或其他站点。

## 当前部署（2026-11-11）

- 正式入口：**https://commerce.aicbec.cn**，公共 DNS A 记录指向 **47.98.47.222**。
- 服务器：`hualibo_cubec`，Ubuntu 22.04 / x86_64。
- 发布目录：`/opt/yz-commerce/releases/20261111-ui-04`；运行链接：`/opt/yz-commerce/current`。
- 独立用户：`yz-hub`。前端监听 `127.0.0.1:3100`，后端监听 `127.0.0.1:4100`，PostgreSQL 16 只监听本机 5432。
- systemd：`yz-commerce-api`、`yz-commerce-web`，已启用自动启动和失败重启。
- Nginx：`/etc/nginx/sites-available/yz-commerce-aicbec`，源码配置为 `deployment/server/nginx-aicbec.conf`。
- Let’s Encrypt 证书：`/etc/letsencrypt/live/commerce.aicbec.cn/`，当前有效期至 2027-02-09。`certbot.timer` 已启用；续期部署钩子检查并重新加载 Nginx。

根域名 aicbec.cn 的已有网站、既有教学站点及 FRP 服务保留。原型文件未修改。

## 私有配置

`/etc/yz-commerce/app.env` 保存数据库连接、Token 加密密钥和登录配置；`/etc/yz-commerce/shopee-apps.json` 保存 App 凭据，权限 root:yz-hub / 0640。初始管理员信息位于 `/etc/yz-commerce/admin-login.txt`；独立审核账号凭据位于 `/etc/yz-commerce/shopee-review-login.json`，两者 root / 0600。密码、Partner Key 和 Token 不进入文档或仓库。

首次部署脚本 `provision.mjs` 默认使用 `https://commerce.aicbec.cn`，也接受显式 HTTPS `HUB_ORIGIN`。重复执行保留已有配置和加密密钥；不能用它接管已有业务数据库。服务器现有 Origin 已切换至 aicbec。切换前配置在 `/etc/yz-commerce/app.env.before-aicbec` 留存。数据库备份必须同时保存加密密钥；备份恢复演练尚未完成。

## 已完成验证

- 公共 DNS、有效 TLS、正常域名下浏览器登录和店铺管理页通过；未使用域名解析覆盖或忽略证书错误。
- 会话读取、Secure/HttpOnly/SameSite Cookie、无效授权回调失败提示、退出后会话失效通过；服务器跨来源写入拒绝通过。
- 独立审核账号最终密码已实测登录、连接入口展示及退出；未插入模拟业务店铺。
- `certbot renew --cert-name commerce.aicbec.cn --dry-run` 成功，续期后钩子已配置。
- Nginx 配置检查通过；既有教学与 FRP 配置散列保持一致，服务仍 active。
- 两份 HTML 原型基线保持不变。真实域名截图：`output/local-development/shops-aicbec-https.png`。

上述部署检查之外，现已通过 CUBE ERP 完成真实授权，详见下文。

## Shopee Live 申请与后续

现有 **YZ Cube Commerce Hub / App 247909 / ERP System** 已实际提交 Live 申请，详情页与 App List 分别读回审核中，列表状态 **Go Live process Review**。产品地址和 Test / Live Redirect URL Domain 均为 `https://commerce.aicbec.cn`。申请使用独立审核账号与实际部署截图，Buyer PII 关闭。详见 [Live 申请记录](SHOPEE-LIVE-APPLICATION.md)。

服务器已新增现有 **CUBE ERP（App 218180 / Online / Live Partner 2010185）** 正式凭据。按用户后续要求，已移除中台的 App 247909 Sandbox 配置，当前仅启用 CUBE ERP Live，新增店铺默认使用该应用；平台上的 App 247909 和申请记录保留。用户亲自完成授权后，API 返回 **Home Monitor_PH（618217104 / PH）**，授权码交换、Token 加密落库、店铺读取及真实续期均成功；中台状态 CONNECTED。z_sweet 尚未验收，不能把紫鸟窗口名作为实际店铺身份。

正式回调已改为中台域名，测试回调保留旧值；不重置密钥、不导入旧 Token。紫鸟拦截中台新域名，本次将平台回调交回原普通浏览器会话完成验证；紫鸟自动回跳未通过。独立审核账号已停用、会话撤销，App 247909 的审核账号因此不再可用。详见 [正式授权验收](SHOPEE-LIVE-AUTHORIZATION.md)。授权阶段完成后停止，不开展商品发布。

团队自助账号管理及数据库备份恢复演练尚未完成，不作为已交付能力。

## 旧域名说明

`commerce.yanzhiedu.cn` 曾返回阿里云接入备案拦截；`commerce.hualibo.cn` 曾完成服务器 HTTPS 测试但未配置公共 DNS。当前统一使用 aicbec 入口，不再要求上述域名作为此次 Live 申请前提，也不改动它们的根域名业务。


## 当前前端

2026-11-11 已将已开发的店铺授权页及公共框架按 HTML 原型对齐：240px 可折叠侧栏、品牌区、纹理背景、顶部查询区、酒红卡片边线、表格密度及页脚。单一 CUBE ERP 下不再展示应用选择。窄屏默认折叠菜单，查询标签与控件保持同行，表格独立横向滚动，操作列固定于右侧；查询与卡片操作按钮右对齐。尚未开发的原型业务菜单继续隐藏，不把原型模拟业务直接作为正式功能。
