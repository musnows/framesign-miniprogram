<p align="center">
  <img src="assets/yingqian-logo.png" width="96" alt="映签 Logo" />
</p>

<h1 align="center">映签 · FrameSign</h1>

<p align="center">每一张，都是你的作品。</p>

映签是一款在设备本地处理照片的微信小程序：为照片添加拍摄参数、相机品牌 Logo 和个人签名，选择喜欢的版式后，逐张编辑或批量导出。

本项目基于 [LeoonLiang/photix-mark-web](https://github.com/LeoonLiang/photix-mark-web) 的照片模板与图像处理实现，进行了微信小程序适配，并作为独立仓库维护。感谢原作者 [LeoonLiang](https://github.com/LeoonLiang) 及原项目贡献者。Web 和 Electron 桌面端请参阅原项目。

## 扫码使用

<p align="center">
  <a href="docs/images/miniprogram-code.jpg"><img src="docs/images/miniprogram-code.jpg" width="300" alt="映签微信小程序码" /></a>
</p>

<p align="center">使用微信扫一扫，扫描小程序码即可打开映签。</p>

点击小程序码可查看并保存原图。

## 模板风格预览

| 经典版式 | 艺术版式 | 杂志版式 |
| :---: | :---: | :---: |
| [![经典版式宣传图](docs/images/promo-classic.png)](docs/images/promo-classic.png) | [![艺术版式宣传图](docs/images/promo-artistic.png)](docs/images/promo-artistic.png) | [![杂志版式宣传图](docs/images/promo-magazine.png)](docs/images/promo-magazine.png) |
| 干净的参数栏与品牌印记 | 模糊背景、圆角与光影 | 照片与拍摄参数分栏排版 |

以上为基于项目模板导出示例制作的宣传图，图内拍摄参数为演示数据。点击图片可查看原图。

## 功能

| 功能 | 说明 |
| --- | --- |
| 本地处理 | 无需登录，照片编辑、水印绘制与导出在设备端完成，照片无需上传服务器。 |
| 照片导入 | 支持从相册、相机或聊天文件选择照片，并可在编辑中继续追加。 |
| 11 款版式 | 包含原图、经典版式、经典边框、品牌印记、艺术版式、Z 系列专版、极简角标、顶部版式、杂志版式、底部版式和个性文字。 |
| 拍摄参数 | 读取照片中的 EXIF，可选择显示字段、编辑水印文字、调整时间格式，并查看完整 EXIF 与元数据。 |
| 设备快捷选择 | 设备信息缺失时，可直接选择常见相机品牌与型号；苹果手机可选型号，其他手机品牌仅使用品牌信息。 |
| 品牌 Logo | 根据品牌使用内置 Logo，支持按品牌替换内置图标或导入自定义图片。 |
| 样式调整 | 文字、背景与阴影颜色支持颜色预览和 RGB 调色；字号、边距等可用选项随模板变化。 |
| 个人签名 | 导入 PNG 签名，可调整颜色、透明度、大小与位置，支持在预览中拖动和缩放。 |
| 批量编辑 | 将当前样式应用到全部或选定照片，同时保留每张照片各自的拍摄参数与设备选择。 |
| 图片与文件导出 | 支持 JPEG、PNG、保存到相册及导出图片文件；多张文件可打包为 ZIP，再通过微信原生转发。 |
| 尺寸自动适配 | 超出画布上限的照片自动按支持的最高分辨率导出，尺寸选项会同步调整。 |
| 隐藏水印 | 将标识写入照片像素，并在本地检测；支持识别项目已有的 V1、V2、V3 格式。 |

## 开始使用

### 环境

- Node.js 22 或更新版本，以及 npm。
- 微信开发者工具，用于导入、预览和真机调试。
- 可选：`tmux`，仓库的浏览器预览和运行测试脚本通过它启动服务。

### 安装与构建

```bash
git clone https://github.com/musnows/framesign-miniprogram.git
cd framesign-miniprogram
npm ci
npm run build
```

构建会生成小程序所需的 `lib/`、`logos/`、`assets/` 和 `workers/` 资源，并检查小程序目录大小。

### 导入微信开发者工具

1. 在微信开发者工具中选择“导入项目”。
2. **项目目录选择本仓库下的 `miniprogram/` 目录**，该目录中包含 `app.json`。
3. 使用自己的小程序 AppID；本地体验也可根据开发者工具提供的选项使用测试模式。
4. 编译后可先使用示例照片体验，再进行相册导入与真机调试。

构建脚本会在 `miniprogram/project.config.json` 缺失时，使用 [project.config.example.json](project.config.example.json) 初始化配置；已存在的本地配置会保留。个人 AppID、`project.config.json` 和 `project.private.config.json` 等本地配置默认由 `.gitignore` 排除。

## 浏览器预览与测试

项目使用 [open-wxa/wxa-runner](https://github.com/open-wxa/wxa-runner) 进行小程序浏览器预览和运行检查。

```bash
# 构建并启动浏览器预览
npm run dev

# 构建并运行单元测试
npm test

# 启动三种屏宽的运行测试服务
npm run test:runtime
```

- `npm run dev` 默认从本地端口 `18320` 开始探测可用端口，请打开终端输出的地址。
- `npm run test:runtime` 启动服务后，需要在浏览器中打开终端输出的三个地址，分别触发 320、375、414 屏宽的检查。
- 运行测试报告保存在 `.ai-docs/miniprogram/runtime-<width>.json`；服务由对应的 `tmux` 会话管理。
- 浏览器运行检查用于功能回归；系统选图、相册权限和原生文件转发等行为仍应结合微信真机调试验收。

## 照片与元数据

- 读取到的 EXIF 取决于选图接口实际提供的文件；信息不足时，可使用设备快捷选择与参数编辑。
- 参数页的文字修改只改变水印显示内容，不会改写原照片的 EXIF。
- 导出时可以选择保留原始 EXIF，或仅保留摄影参数并去除 GPS、设备序列号等额外信息。
- 导出生成新文件，原始照片保持不变。
- 隐藏水印的检测结果可能受压缩、缩放或截图影响。

## 项目结构

```text
framesign-miniprogram/
├── miniprogram/                  小程序入口、页面与组件
│   ├── app.json                  微信开发者工具识别的入口配置
│   ├── pages/                    首页、编辑、检测与元数据页面
│   └── components/               调色等小程序组件
├── src/                          小程序处理逻辑与平台适配
│   └── shared/                   从原项目移植并适配的模板与图像处理代码
├── assets/                       示例照片、品牌 Logo 与产品 Logo
├── docs/images/                  README 宣传图片
├── scripts/                      构建、预览与测试启动脚本
├── tests/                        单元测试及 wxa-runner 运行检查
├── project.config.example.json   可公开的开发者工具配置示例
├── LICENSE                       MIT 许可证
└── package.json                  依赖、脚本与版本信息
```

## 项目来源与致谢

- **原项目：[LeoonLiang/photix-mark-web](https://github.com/LeoonLiang/photix-mark-web)**。映签小程序的模板和图像处理实现以该项目为基础，保留并适配了其中的共享逻辑。
- **原作者：[LeoonLiang](https://github.com/LeoonLiang)**，以及原项目的其他贡献者。
- **小程序预览与运行测试：[open-wxa/wxa-runner](https://github.com/open-wxa/wxa-runner)**。

感谢上述项目提供的基础与工具。

## 许可证

本项目采用 [MIT License](LICENSE)，完整的版权与授权条款见许可证文件。

## 特别鸣谢

感谢 [LINUX DO](https://linux.do) 社区的交流与支持。

<p align="center">
  <a href="https://linux.do">
    <img src="docs/images/linuxdo.png" alt="LINUX DO" width="420" />
  </a>
</p>
<p align="center"><b>学AI，上L站！祝小破站越来越好～</b></p>
