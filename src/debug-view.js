export function renderDebugHistory(container,history,query=''){
  const needle=query.trim().toLocaleLowerCase();const rows=history.slice(-200).filter(h=>!needle||JSON.stringify(h).toLocaleLowerCase().includes(needle)).reverse();
  container.replaceChildren();if(!rows.length){container.textContent='尚無符合紀錄。開啟除錯後開始翻譯，新句子會出現在這裡。';return;}
  const table=document.createElement('table');table.className='debug-table';
  const head=document.createElement('thead'),tr=document.createElement('tr');for(const title of ['時間／片段','Whisper 原始辨識','修正後送譯原文','模型原始輸出','最終譯文','狀態／耗時']){const th=document.createElement('th');th.textContent=title;tr.append(th);}head.append(tr);table.append(head);
  const body=document.createElement('tbody');
  for(const h of rows){const d=h.translationDiagnostics||{};const row=document.createElement('tr');if(h.error||d.retryReason)row.className='debug-alert';
    const time=h.at?new Date(h.at).toLocaleTimeString('zh-TW',{hour12:false}):'—';
    const vad=h.asrDiagnostics?.vad;const status=[h.suppressed?'已略過：'+h.skipReason:h.error?'錯誤：'+h.error:'完成',h.sourceLanguage?'語言：'+h.sourceLanguage:'',vad?`人聲 ${Math.round(vad.speechMs||0)} ms／RMS ${(vad.rms||0).toFixed(4)}／最高機率 ${(vad.maxProbability||0).toFixed(2)}`:'',d.cacheHit===true?'命中快取':d.cacheHit===false?'未命中快取':'快取狀態未記錄',d.retryReason?'重試：'+d.retryReason:'',d.model||'',`ASR ${Math.round(h.asrEndMs||0)} ms／翻譯 ${Math.round(h.translationMs||0)} ms`,h.forced?'達片段上限切段':''].filter(Boolean).join('\n');
    for(const text of [`${time}\n#${h.id}`,h.suppressed?'（未送入 Whisper）':h.rawAsr??'（當時未記錄原始 ASR）',h.source,d.firstRawTranslation??d.rawTranslation??'（未記錄）',h.translation||(h.suppressed?'（略過，不顯示字幕）':'（無譯文，顯示原文）'),status]){const td=document.createElement('td');td.textContent=text;row.append(td);}body.append(row);
    const extra=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=6;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='展開：完整提示、重試輸出與診斷';const pre=document.createElement('pre');pre.textContent=JSON.stringify({rawAsr:h.rawAsr,source:h.source,translation:h.translation,error:h.error,asrDiagnostics:h.asrDiagnostics,...d},null,2);details.append(summary,pre);cell.append(details);extra.append(cell);body.append(extra);
  }table.append(body);container.append(table);
}
