# 商品本地化：本地仿真联调

## 环境

运行 `pnpm dev` 后，本地机器接入地址为 `http://127.0.0.1:3100`。Next 将 `/api/*` 转发到本机 Nest `127.0.0.1:4100`，不会把仿真商品请求转发到中央生产服务。

本地联调令牌由启动脚本首次运行时生成，保存在项目私密目录：

`.local/localization-integration/local-simulation-delivery.txt`

通过项目根目录相对路径访问为 `.local/localization-integration/local-simulation-delivery.txt`。这个文件只用于本地环境，不能替代生产交付令牌。不要把令牌放入浏览器代码、URL、Git 或日志。

## 店铺与数据

调用 `GET /api/v1/localization/integration/shops` 获取本地目标店铺。默认有一个明确标注的测试店铺：`local-sim-ph`，国家 `PH`，币种 `PHP`，默认语言 `English`。该记录是本地夹具，不对应真实 Shopee 店铺或其权限。

仿真商品按生产相同的 v1 JSON 契约提交到本地 `/api/v1/localization/integration/imports`。来源快照、接收回执、AI 文案及目标市场草稿都保存在本机 `.local/localization`；本地页面“仿真接收记录”统一读取生产接收记录，每10秒刷新并展示总数，不混入本地测试回执，不提供删除接口或按钮。本地提交产生的草稿在“已保存的市场版本”中打开。生产接收记录点击“打开本地草稿”后，通过当前账号的服务端 WEB 会话读取生产来源、完整草稿及私有图片，保存为本地工作副本。再次打开保留本地编辑；中文和英文版本独立保存。生产会话 Cookie 留在服务端，退出时撤销；更新前登录的本地会话需要重新登录一次。本地翻译、保存及预览均使用本机副本，不更新生产草稿，真实发布仍受本地模式禁止。AI 使用本项目 `.local/listing` 中配置的文本模型。

本地模式把目标店铺市场资料显示为模拟/未验证状态，并在服务端拒绝 Shopee 商品上传、创建、补全和发布操作。此模式用于验证请求字段、鉴权、幂等、持久化、AI 生成和审核页面；类目、品牌、物流、市场限制和真实发布资格须在生产部署后另行验收。

## 接口

本地的路径、请求头、请求体和成功响应与[生产接口文档](LOCALIZATION-INTEGRATION.md)一致，只有 `API_BASE` 和接入令牌不同：

| 环境 | API_BASE | 令牌文件 |
| --- | --- | --- |
| 本地 | `http://127.0.0.1:3100` | `.local/localization-integration/local-simulation-delivery.txt` |
| 生产 | `https://commerce.aicbec.cn` | `.local/localization-integration/simulation-delivery-20261113.txt` |

仿真端应读取店铺接口返回的 `id`、国家、默认语言及 `supportedLanguages`，不可把本地模拟店铺 ID 带到生产请求。开发者重启本机项目后重新调用店铺查询即可。

共用中台账号仍用于本地团队界面的身份校验；机器仿真令牌、仿真数据和审核草稿独立存放于本机。完成本地验收后，再将同一请求契约切换到生产 API_BASE 和生产令牌。

## AI 请求等待时限

本地 Next 转发等待时限为150秒，高于文本模型单次请求的120秒时限，避免30秒代理默认超时后后台仍继续保存。网关返回非JSON错误时，页面提示先刷新已保存记录核对，禁止据此认定生成未发生或盲目重试。

## 内部市场规则查询（非仿真交付）

以下用于中台维护和排查，不属于仿真平台标准接入流程。相关市场资料查询与自动适配已部署生产。

### 3.5 查询目标市场规则与候选

**GET https://commerce.aicbec.cn/api/v1/localization/integration/shops/{id}/requirements?categoryId={categoryId}**

请求体：无。鉴权与其他接入接口相同，沿用专用Bearer令牌。

| 位置 | 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 路径 | id | string | 是 | 3.1返回的目标店铺连接ID，必须在令牌授权范围且处于CONNECTED状态 |
| 查询 | categoryId | integer | 否 | 正整数，目标末级类目ID；未提供时返回类目/物流/限制，类目专属属性与品牌为空；选择类目后重新查询 |

| 响应字段 | JSON类型 | 说明 |
| --- | --- | --- |
| connectionId | string | 本次查询目标店铺 |
| categoryId | integer或null | 本次查询类目；未提供则为null |
| categories | object[] | 类目候选，含id、name、parentId、hasChildren；发布使用hasChildren=false的有效目标类目 |
| attributes | object[] | 所选类目属性候选，含id、name、required、values；required=true表示目标返回的必填属性，values含id和value |
| brands | object[] | 所选类目品牌候选，含id和name；仅在实际候选允许时使用NoBrand/0 |
| logistics | object[] | 目标物流候选，含id、name、enabled；详细计费和尺寸规则见rules.logistics |
| limits | object | 目标get_item_limit原始限制，包括返回的长度、数量、价格、库存、GTIN等规则；未返回的键不得视为无限制或无需填写 |
| rules.attributes | object或null | 目标get_attribute_tree原始响应，用于查看输入类型、单位、候选及其他规则 |
| rules.brands | object或null | 目标get_brand_list原始响应 |
| rules.logistics | object | 目标get_channel_list原始响应，查看fee_type、size_list、限重尺寸等渠道规则 |
| rules.limits | object | 与limits一致的原始限制 |
| capability / capabilities | object | 已查询的路径、权限与阻断原因；读取成功不等于写入资格已通过 |
| support.path | string | 当前适配路径product；不表示所有店铺均适用此路径 |
| support.unsupportedFeatures | string[] | 当前未完整支持的能力：global_product、tax_info、complaint_policy、size_chart、multi_warehouse_discovery、attribute_dependencies |
| fetchedAt | string | UTC规则读取时间，保存/发布前应重新查询 |

本接口为可选高级能力，标准仿真接入不需要调用。中台内部读取顺序：先查店铺，再不带categoryId查询类目，匹配目标类目后带categoryId查询属性和品牌；组装3.2.5对应市场草稿。要求超出support范围时不得省略字段强行提交。该端点返回规则与候选，不承诺覆盖全部地区、特殊类目和规则依赖，不是Shopee写入接口。

### 8.5 查询市场规则

```sh
curl --request GET "$API_BASE/api/v1/localization/integration/shops/$CONNECTION_ID/requirements?categoryId=$CATEGORY_ID" \
  --header "Authorization: Bearer $LOCALIZATION_TOKEN"
```

以下仅用于高级调用方排查规则，非仿真标准接入必做步骤。先用3.1取得CONNECTION_ID，不带categoryId查询类目后，再将实际目标末级类目ID设为CATEGORY_ID。新增接口和字段须待本次更新部署后才可在生产调用。


## 2026-11-17 自动适配验证状态

本地实现：按商品事实匹配目标末级类目；按来源参数匹配真实属性候选；匹配品牌或目标真实 NoBrand；按包裹限制筛选店铺已启用物流。保留人工编辑、市场隔离、适配失败可重试；适配本身不调用商品写入接口。

验证：113项测试、typecheck、build、verify:baseline、Diff Gate通过。真实本地HTTP读取中央店铺规则返回502“无法连接团队服务”，随后请求触发限流；真实自动适配未通过，不把模拟结果视作真实结果。生产新增字段及自动适配实现未部署。对外文档可用于开发对接，生产验收仍需部署后恢复规则查询并验证完整链路。

### 中央规则错误定位（2026-11-17）

只读核验线上当前编译文件与真实Shopee调用：线上开发网关仅接受category_id，并原样发给get_attribute_tree；Shopee HTTP200返回product.error_param及CategoryIdList is required，中央包装为HTTP502。服务器直接改用category_id_list调用同一店铺同一类目成功。类目、物流、发布限制、品牌接口本次均返回200。

生产审计记录UTC10:13该分钟共57次DEV_READ，其中品牌查询50次；UTC10:14又有3次已执行读取。线上开发接口按账号60次/60秒限流；属性与品牌并行导致属性失败后品牌分页继续执行。该统计不含在限流前被拒绝的请求，不能作为拒绝总数。

本地修复：属性成功后才读取品牌；单次适配品牌分页最多3页，未读完显式标记candidatesIncomplete，不冒充完整候选或把未命中判断为品牌不支持。生产网关类目参数映射修复已在本地代码中，未部署，本次未修改生产服务或商品。

## 2026-11-17 生产修复部署验收

新本地化版本20261117-adaptation-01，中央网关版本20261117-category-gateway-01已切换运行，保留原版本以便回滚。前述未部署、502和限流是修复前状态，已由本节结果取代。

- 公网健康检查、审核页面及原店铺页200；审核页12个、店铺页10个JS/CSS资源全部200。
- 原专用Bearer查询店铺200，缺Bearer为401；两种类目参数查询真实属性均200。
- 目标类目101226读取7个属性、300个品牌候选，NoBrand在真实候选内；超过3页明确提示候选未读完整。
- 现有英文接收请求原样重放201，返回原回执和原草稿；状态查询200，publishTasks为空。带新增售价/库存字段重放相同requestId得到409内容冲突，说明新增结构通过解析且没有覆盖既有资料。此次未新建接收记录。
- 英文草稿真实自动适配成功：类目101226、品牌0、物流4000；缺最终售价、库存和包装尺寸时保持needs_input，保留原文案和来源快照。
- 本次没有调用Shopee商品创建、修改或发布接口。此前UNLIST验证结果不等于本次完成公开发布验收。
- 114项测试、typecheck、build、verify:baseline及Diff Gate通过。令牌和配置未变，仿真继续使用原API_BASE/SOURCE_SYSTEM/Bearer。

## 2026-11-17 严格接收契约上线（取代此前不完整资料接收行为）

生产版本20261117-required-fields-02要求非空标题描述、至少1张商品图、正包装重量与完整正长宽高、全部SKU的正最终售价及非负整数库存。类目不必填，品牌/属性/物流ID继续由中台适配。缺项在任何来源/草稿/接收记录创建或AI调用之前返回400，错误包含fieldErrors数组，历史GET查询不受影响。

真实5组拒绝请求全部400，完整且无类目/零库存数据通过完整性检查后被已有requestId幂等冲突保护拒绝409；未创建测试接收记录。前后4接收记录、3来源、4草稿、0发布任务一致。旧不完整请求重新POST会400；补齐旧内容另用新requestId，防止覆盖历史快照。
