# 螢幕休眠檢查（2026-10-26）

本程式未呼叫 navigator.wakeLock、chrome.power、SetThreadExecutionState 或 PowerSetRequest；manifest 沒有 power 權限。音訊擷取使用 audio only、video:false；延後畫面使用 canvas，沒有額外播放隱藏影片。模型常駐不主動要求螢幕保持開啟。

Chrome 播放可見的 YouTube 影片時，本身可能取得螢幕喚醒鎖。這與本程式主動取得喚醒鎖不同，不能用本擴充功能的 releaseKeepAwake 解除 Chrome 原生播放器或其他程式的要求。參考 [Chromium Wake Lock 說明](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/modules/wake_lock/README.md) 與 [Chrome power API](https://developer.chrome.com/docs/extensions/reference/api/power)。

只需聆聽時，可先退出子母畫面，將 Chrome 最小化或切換到沒有播放影片的分頁，再觀察系統原定螢幕關閉時間。是否解除仍取決於 Chrome、其他影片／擴充功能、音效與顯示裝置驅動的要求。整台電腦睡眠後，不會繼續本機翻譯。

0.4.1 已補上分頁隱藏時停止字幕重繪及延後影格緩衝並釋放影格參照；返回時重新建立同步緩衝。停止翻譯會停止擷取軌道並關閉 AudioContext；模型仍可常駐。這是背景資源整理，不代表已強制解除 YouTube 原生喚醒鎖。

本次嘗試 powercfg /requests 被 Windows 拒絕，要求系統管理員權限，因此未能確認測試電腦「目前」的 DISPLAY/SYSTEM 阻擋者，也未做實際顯示器睡眠驗收。沒有變更 Windows 電源計畫、關閉時間或全域 powercfg requestsoverride。

若最小化、停止翻譯後仍不休眠，可自行用系統管理員身分開啟終端機，執行唯讀的 `powercfg /requests`，比較播放／停止前後的 DISPLAY 與 SYSTEM 項目。DISPLAY 是螢幕關閉阻擋，SYSTEM 是整機睡眠阻擋；兩者不要混為一談。
