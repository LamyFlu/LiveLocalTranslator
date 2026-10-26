// Generated from pinned model catalogs.
export const largeModels=[
  {
    "id": "gemma-4-12B",
    "engine": "gemma12",
    "backend": "litert",
    "title": "Gemma 4 12B · Q4 · 品質優先",
    "provider": "Google",
    "file": "gemma-4-12B-it-gpu.litertlm",
    "vramMB": 7700,
    "bytes": 5986074624,
    "qualityNote": "官方 Chrome 約 7.7GB GPU 記憶體（Mac 測試），本機需另留 Whisper 與影片空間。較大不保證低延遲。"
  },
  {
    "id": "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    "engine": "mlc-llama8",
    "backend": "webllm",
    "title": "Llama 3.1 8B · Q4",
    "provider": "Meta",
    "library": "webllm-libs/Llama-3.1-8B-Instruct-q4f16_1-MLC.wasm",
    "vramMB": 5001,
    "bytes": 4526839046
  },
  {
    "id": "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
    "engine": "mlc-mistral7",
    "backend": "webllm",
    "title": "Mistral 7B v0.3 · Q4 · 實驗（日文不建議）",
    "provider": "Mistral AI",
    "library": "webllm-libs/Mistral-7B-Instruct-v0.3-q4f16_1-MLC.wasm",
    "vramMB": 4573.39,
    "bytes": 4080380123,
    "qualityNote": "本機日文測例誤譯明顯，不建議用於日文直播；保留供比較測試。較大模型不一定比 E4B 好。"
  },
  {
    "id": "Qwen3.5-4B-q4f16_1-MLC",
    "engine": "mlc-qwen4",
    "backend": "webllm",
    "title": "Qwen3.5 4B · Q4 · 中國來源／實驗",
    "provider": "Alibaba Qwen",
    "origin": "China",
    "warning": "中國供應商開發；模型對齊可能造成敏感內容拒譯、刪減、改寫或立場偏差。本機執行不會消除這些特性。音訊與原文留在本機，下載模型需連線。請核對原文與除錯紀錄。",
    "library": "webllm-libs/Qwen3.5-4B-q4f16_1-MLC.wasm",
    "vramMB": 3867.82,
    "bytes": 2390495835,
    "qualityNote": "本機少量測例較快，但曾只替換人名而留下日文；字幕已加入漏譯檢查與專名標記重試，仍需核對，不取代 Gemma 12B 品質選項。"
  }
];
export function largeModel(engine){return largeModels.find(m=>m.engine===engine);}
