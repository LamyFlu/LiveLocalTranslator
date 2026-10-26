# 來源與授權

本專案是獨立的 Chrome／Windows 本機直播翻譯工具，參考 [rictirse/TranslationGateway](https://github.com/rictirse/TranslationGateway) 的直播翻譯與專有名詞詞彙表思路，來源參考版本為 [1.0.0.016a7f5](https://github.com/rictirse/TranslationGateway/releases/tag/1.0.0.016a7f5)。不是原專案的官方版本，請勿向上游回報本專案特有問題。

本專案原始碼採 MIT 授權；保留上游 MIT 聲明於 TranslationGateway-LICENSE.txt。第三方 JavaScript／WASM／Silero 元件各依自身授權，建置結果保留 THIRD-PARTY-NOTICES.txt、VAD-NOTICE.txt 與 public/webllm-libs/NOTICE.txt。模型權重不隨安裝包發行，各模型仍適用其授權條款，不因本專案採 MIT 而改變。

installer/extension-key.txt 是 Chrome manifest 使用的公開金鑰，用來保持擴充功能 ID；不是私密簽章金鑰。發行此儲存庫不需要公開任何私人憑證、API token 或模型下載帳號。
