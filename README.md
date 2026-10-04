# FORM · 体能日志

[打开网页](https://windsweeps.github.io/fitness-tracker/)

面向手机的个人健身记录网页，使用纯 HTML、CSS、JavaScript，可直接部署至 GitHub Pages，无构建步骤与第三方运行时依赖。

## 功能

- **今日**：按日期记录体重、左右手握力、训练类型、训练时长、活动能量、全天总消耗、训练平均心率、训练努力程度、主观疲劳等级与备注。
- **摄入估算**：直接填写全天 kcal，或按餐填写估算并加总。全天手动填写值优先，避免重复计算。
- **动作库**：8 个分类、24 个初始占位条目，支持搜索、收藏、新增、编辑和删除。名称只是框架，不代表已经提供完整动作教学。
- **演示**：每个动作留有 GIF / 图片和视频文件地址，可播放自备媒体。
- **趋势**：最近 7 / 30 / 90 天的体重、握力最高值、活动能量、摄入估算、疲劳变化；日历记录可以返回修改。
- **备份**：导出 JSON、导入合并、重复内容替换前确认。没有示例健康数值混入真实记录。

## 数据存在哪里

健康记录、动作编辑与收藏保存于当前浏览器 `localStorage` 的 `fitness-tracker:v1`。不会上传到 GitHub，不支持自动跨设备同步。更换设备、域名、浏览器或清除网站数据前，请在「数据与备份」导出 JSON；新设备再导入。

Apple Watch 指标目前需要手动录入。这是静态网页，不声明连接 Apple 健康或自动获取手表记录。[Apple 官方 HealthKit 配置说明](https://developer.apple.com/documentation/xcode/configuring-healthkit-access)说明了原生应用的能力与授权机制。

所有指标均可选填，空白与数值 `0` 分开保存。疲劳和努力程度为个人记录，不生成健康诊断或热量目标。活动能量是全天总消耗的一部分，二者不相加；网页也不把摄入减活动能量标为热量盈亏。

## 放入自己的 GIF / 视频

1. 把文件放进 `assets/media/`，例如 `assets/media/squat.gif`、`assets/media/squat.mp4`。
2. 提交并推送到 GitHub，等待 Pages 更新。
3. 打开动作卡片，在「GIF 与视频」填写对应相对路径，也可填写可访问的 HTTPS 媒体文件直链。
4. 点击「保存动作」。这一步保存在当前设备；导出备份可带走这些地址。

视频推荐 MP4（H.264）；具体播放支持取决于浏览器。网页链接不是视频文件直链，不支持把普通视频平台页面当作 MP4 播放。媒体可能通过外部地址加载，因此请使用可信来源。

如果希望所有新设备默认带有演示，修改 `data.js` 中 `catalog` 的对应动作。现有设备已有的动作库不会被静默覆盖，可在动作编辑中更新。GIF / 视频文件本身不包含在 JSON 备份中。

GitHub Pages 网站和此仓库中的媒体是公开的，请只提交希望公开的代码与教学素材；不要将个人记录备份提交到仓库。

## 本地运行

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8765`。推荐使用 HTTP 本地预览；`file://` 下的存储行为可能因浏览器而异。

## GitHub Pages

在仓库 Settings → Pages 中选择 **Deploy from a branch**，分支 `codex/publish`，目录 `/ (root)`。入口为 `index.html`，`.nojekyll` 用于直接提供静态资源。所有应用资源采用相对路径，适配仓库子路径。

[GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## 验证

```sh
node --test tests/data.test.cjs
```

浏览器集成检查需要 Playwright 与 Chrome。先启动本地服务，再执行：

```sh
node tests/browser.cjs
node tests/regression.cjs
```

可通过 `CHROME_EXECUTABLE` 指定 Chrome 路径，`FORM_TEST_URL` 指定测试地址。集成检查使用独立临时浏览器上下文，测试记录不写入用户浏览器或仓库。
