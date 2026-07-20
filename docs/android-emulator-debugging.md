# Android Emulator Debugging

## 适用范围

本文档是 Windows 上启动 Hello Betty Android 模拟器的固定流程，覆盖本地 API、Expo/Metro、端口转发、安装验证和常见故障。

关键原则：

- Expo 命令必须从 `apps/mobile/` 运行，不能从仓库根目录启动 Metro。
- Android 本地 API 固定使用 `http://127.0.0.1:4100`，必须配置 `adb reverse`。
- Metro 端口、`adb reverse` 端口和开发菜单中的 Bundle Location 必须一致。
- 调试构建无法稳定收包时，使用内置最新 JavaScript 的 release 构建完成模拟器验收。

## 环境准备

本机当前使用以下路径；环境变化后先按实际安装位置调整：

```powershell
$repo = 'D:\code\hellobetty'
$env:JAVA_HOME = 'D:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'D:\androidsdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'

& $adb devices
```

从 `adb devices` 输出选择正在运行的模拟器，不要长期假设设备编号不变：

```powershell
$env:ANDROID_SERIAL = 'emulator-5554'
& $adb -s $env:ANDROID_SERIAL get-state
```

预期输出为 `device`。包名固定为 `com.anonymous.hellobetty`。

## 推荐启动流程

### 1. 启动 API

在第一个 `pwsh` 终端运行：

```powershell
Set-Location 'D:\code\hellobetty'
npm run dev:api
```

另开终端确认 API 正常：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4100/health
```

预期状态码为 `200`。

### 2. 配置端口转发

选择一个空闲的 Metro 端口，默认使用 `8082`：

```powershell
$env:ANDROID_SERIAL = 'emulator-5554'
$adb = 'D:\androidsdk\platform-tools\adb.exe'

& $adb -s $env:ANDROID_SERIAL reverse tcp:4100 tcp:4100
& $adb -s $env:ANDROID_SERIAL reverse tcp:8082 tcp:8082
& $adb -s $env:ANDROID_SERIAL reverse --list
```

列表中必须包含 `tcp:4100` 和 `tcp:8082`。

### 3. 从正确目录启动 Android

在第二个 `pwsh` 终端运行：

```powershell
Set-Location 'D:\code\hellobetty\apps\mobile'

$env:JAVA_HOME = 'D:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'D:\androidsdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_SERIAL = 'emulator-5554'

npx expo run:android --port 8082
```

不要在 `D:\code\hellobetty` 根目录运行该命令。正确日志中的项目入口应为 `apps\mobile\index.ts`。

### 4. 强制使用 ADB 回环链路

重新安装 debug APK 后，开发客户端可能默认连接 `10.0.2.2`。出现连接或分块响应问题时：

1. 在模拟器按 `Ctrl+M`，或运行：

   ```powershell
   & $adb -s $env:ANDROID_SERIAL shell input keyevent 82
   ```

2. 选择 `Change Bundle Location`。
3. 输入 `127.0.0.1:8082`。
4. 选择 `APPLY CHANGES`，再选择 `Reload`。

此设置必须与 `adb reverse tcp:8082 tcp:8082` 使用同一端口。

## 稳定验收模式

如果调试客户端持续卡在 `Bundling 100%`，使用 release 构建绕过 Metro 下载。该模式没有 Fast Refresh，但适合确认最新界面和 API 行为：

```powershell
Set-Location 'D:\code\hellobetty\apps\mobile'

$env:JAVA_HOME = 'D:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'D:\androidsdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_SERIAL = 'emulator-5554'
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'

& $adb -s $env:ANDROID_SERIAL reverse tcp:4100 tcp:4100
npx expo run:android --variant release --no-bundler
```

release APK 会内置当前 JavaScript。每次需要验收新的前端代码时必须重新构建。release 网络策略只允许 `127.0.0.1` 和 `localhost` 的明文 HTTP，其他明文地址仍被阻止。

## 故障处理

### 模拟器仍显示旧界面

最常见原因是 Metro 从仓库根目录启动，或旧的 `8081` 进程仍在提供错误入口。

```powershell
Get-NetTCPConnection -State Listen | Where-Object LocalPort -In 8081,8082,8083,8084 |
  Select-Object LocalAddress, LocalPort, OwningProcess

$metroPid = (Get-NetTCPConnection -LocalPort 8082 -State Listen).OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId = $metroPid" |
  Select-Object ProcessId, CommandLine
```

确认命令行确实是错误目录启动的 Metro 后，运行 `Stop-Process -Id $metroPid`，再从 `apps/mobile/` 重新启动。不要仅因为端口存在就结束未知进程。

### 卡在 `Bundling 100%`

先查看应用日志：

```powershell
$appPid = & $adb -s $env:ANDROID_SERIAL shell pidof com.anonymous.hellobetty
& $adb -s $env:ANDROID_SERIAL logcat -d --pid=$appPid -t 500 |
  Select-String -Pattern 'ProtocolException|Callback failure|Bundle'
```

如果出现以下错误，先执行“强制使用 ADB 回环链路”：

- `Expected leading [0-9a-fA-F] character but was 0xd`
- `unexpected end of stream`

仍无法加载时直接使用“稳定验收模式”，不要重复重装同一个 debug APK。

### 显示 `Unable to load script`

检查三处端口是否完全一致：

- Expo 启动参数 `--port 8082`
- `adb reverse tcp:8082 tcp:8082`
- Bundle Location `127.0.0.1:8082`

同时确认 Metro 正在监听：

```powershell
Get-NetTCPConnection -LocalPort 8082 -State Listen
```

### 登录提示网络连接失败

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4100/health
& $adb -s $env:ANDROID_SERIAL reverse tcp:4100 tcp:4100
& $adb -s $env:ANDROID_SERIAL reverse --list
```

release 安装可能清除本地登录态，这是正常现象；重新登录即可。

## 完成检查

启动结束后至少执行：

```powershell
& $adb -s $env:ANDROID_SERIAL shell pidof com.anonymous.hellobetty
& $adb -s $env:ANDROID_SERIAL reverse --list
```

进程命令应返回 PID，转发列表应包含 `tcp:4100`。需要确认页面文字或无障碍状态时：

```powershell
& $adb -s $env:ANDROID_SERIAL shell uiautomator dump /sdcard/hellobetty-window.xml
& $adb -s $env:ANDROID_SERIAL shell cat /sdcard/hellobetty-window.xml
```
