# 建置與發布

開發環境：Windows、Node.js 24、pnpm 10，以及 Windows .NET Framework 4.x C# 編譯器。一般使用者執行 Setup 不需要 Node.js 或 pnpm。

~~~powershell
pnpm install --frozen-lockfile
node --test tests/*.test.mjs
node build.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File installer/build-installer.ps1
~~~

dist 是可載入的擴充功能；Setup 產物在儲存庫上一層 releases/版本名稱。模型、測試音訊與 Chrome 設定檔不進 Git。重建使用已鎖定的依賴及隨原始碼附帶的編譯函式庫，不需要為每次建置重新轉換模型。

public/webllm-libs 是模型推論程式碼，並非模型權重；其來源及雜湊見 NOTICE.txt。installer/prepare-*.mjs 用於維護者更新目錄或函式庫，會連線下載，不屬於一般離線建置必要步驟。更新模型後須重新審查來源、授權、版本、檔案大小與 SHA256。

保持 installer/extension-key.txt 與 extension-id.txt 以延續現有使用者的 Chrome 擴充功能身分；此檔是公開金鑰。私密程式碼簽章憑證不可放進儲存庫。此預覽版 Setup 未加 Authenticode 簽章，發布前應如實標示；是否採用簽章由維護者另行決定。
