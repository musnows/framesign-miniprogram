export function androidDeviceFixture(width, height) {
  return {
    brand: 'Android', model: 'Android camera import test', platform: 'android', system: 'Android 15',
    version: '8.0.50', SDKVersion: '3.7.0', language: 'zh_CN', fontSizeSetting: 16, pixelRatio: 2,
    screenWidth: width, screenHeight: height, windowWidth: width, windowHeight: height - 68, statusBarHeight: 24,
    safeArea: { left: 0, top: 24, right: width, bottom: height, width, height: height - 24 },
    benchmarkLevel: 1, memorySize: 4096, abi: 'arm64', deviceAbi: 'arm64', theme: 'light', enableDebug: false
  }
}
