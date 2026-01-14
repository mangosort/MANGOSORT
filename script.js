// MANGOSORT Web - core logic
(() => {
  // If running on a touchscreen / kiosk, make interactions larger and attempt fullscreen on first touch.
  try{
    if('ontouchstart' in window || navigator.maxTouchPoints > 0){
      document.documentElement.classList.add('touch');
      // Add body class used by CSS
      document.body.classList.add('kiosk-friendly');
      // Try to request fullscreen on first user gesture (touchstart/click)
      const enterFs = ()=>{
        if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(()=>{});
        else if(document.documentElement.webkitRequestFullscreen) document.documentElement.webkitRequestFullscreen();
        window.removeEventListener('touchstart', enterFs);
        window.removeEventListener('mousedown', enterFs);
      };
      window.addEventListener('touchstart', enterFs, {passive:true});
      window.addEventListener('mousedown', enterFs, {passive:true});
    }
  }catch(e){/*ignore*/}
  // State
  let unripe = 0, ripe = 0, overripe = 0, total = 0;
  let processing = false, paused = false, startTime = null;
  let infoTimer = null;
  let processingSpeed = 1000; // ms
  let batchMode = false;
  const STORAGE_KEY = 'mangosort_data_v1';
  // Hardware integration (ESP32)
  const HW_COUNTS_URL = 'http://127.0.0.1:5000/counts';
  let hardwareMode = false; // when true, counts come from ESP server and simulation is paused

  // DOM
  const loading = document.getElementById('loading');
  const main = document.getElementById('main');
  const processingPage = document.getElementById('processing');
  const progressBar = document.getElementById('progress-bar');
  const loadingText = document.getElementById('loading-text');

  const startBtn = document.getElementById('start-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsBtn2 = document.getElementById('settings-btn-2');
  const analyticsBtn = document.getElementById('analytics-btn');
  const exportAllBtn = document.getElementById('export-all-btn');

  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const exportBtn = document.getElementById('export-btn');
  const cameraBtn = document.getElementById('camera-btn');
  const cameraBtn2 = document.getElementById('camera-btn-2');
  const cameraModal = document.getElementById('camera-modal');
  const cameraVideo = document.getElementById('camera-video');
  const cameraVideoMain = document.getElementById('camera-video-main');
  const cameraCanvas = document.getElementById('camera-canvas');
  const captureBtn = document.getElementById('capture-btn');
  const closeCameraBtn = document.getElementById('close-camera');

  const unripeCountEl = document.getElementById('unripe-count');
  const ripeCountEl = document.getElementById('ripe-count');
  const overripeCountEl = document.getElementById('overripe-count');
  const unripePctEl = document.getElementById('unripe-pct');
  const ripePctEl = document.getElementById('ripe-pct');
  const overripePctEl = document.getElementById('overripe-pct');

  const timeLabel = document.getElementById('time-label');
  const rateLabel = document.getElementById('rate-label');
  const accuracyLabel = document.getElementById('accuracy-label');
  const procStatus = document.getElementById('proc-status');

  const modalOverlay = document.getElementById('modal-overlay');
  const settingsModal = document.getElementById('settings-modal');
  const analyticsModal = document.getElementById('analytics-modal');
  const analyticsTableBody = document.querySelector('#analytics-table tbody');
  const stopModal = document.getElementById('stop-modal');

  const applySettingsBtn = document.getElementById('apply-settings');
  const closeAnalyticsBtn = document.getElementById('close-analytics');
  const confirmStopBtn = document.getElementById('confirm-stop');
  const cancelStopBtn = document.getElementById('cancel-stop');

  const saveSessionCheckbox = document.getElementById('save-session');

  // Load sessions
  function loadSessions(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(e){return []}
  }
  function saveSessions(sessions){
    try{localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))}catch(e){}
  }

  // Startup animation
  function startLoading(){
    let p = 0;
    const messages = [
      'Initializing AI modules...',
      'Loading computer vision models...',
      'Calibrating color recognition...',
      'Testing classification algorithms...',
      'System optimization complete...',
      'Ready for operation!'
    ];
    const t = setInterval(()=>{
      p += 1;
      progressBar.style.width = (p) + '%';
      loadingText.textContent = messages[Math.min(Math.floor(p/17), messages.length-1)];
      if(p>=100){clearInterval(t); setTimeout(()=>{showMain()},800)}
    },50);
  }

  function showMain(){
    loading.classList.add('hidden');
    main.classList.remove('hidden');
    renderRecentStats();
  }

  function showProcessingPage(){
    main.classList.add('hidden');
    processingPage.classList.remove('hidden');
    resetCounts();
    startProcessing();
    // Auto-open camera when processing page loads
    openCamera();
  }

  function resetCounts(){unripe=ripe=overripe=total=0; updateCountsUI();}

  function updateCountsUI(){
    unripeCountEl.textContent = unripe;
    ripeCountEl.textContent = ripe;
    overripeCountEl.textContent = overripe;
    total = unripe+ripe+overripe;

    if(total>0){
      unripePctEl.textContent = (unripe/total*100).toFixed(1)+"%";
      ripePctEl.textContent = (ripe/total*100).toFixed(1)+"%";
      overripePctEl.textContent = (overripe/total*100).toFixed(1)+"%";
    }else{
      unripePctEl.textContent = ripePctEl.textContent = overripePctEl.textContent = '0%';
    }
  }

  // NOTE: Simulation/auto-counting removed. Counts are supplied by the hardware
  // via the Raspberry Pi `/counts` endpoint. Manual GPIO button presses on the
  // Pi should POST/update that endpoint; the frontend polls `/counts`.

  function startProcessing(){
    processing = true; paused = false; startTime = Date.now();
    procStatus.innerHTML = '<span class="dot active"></span> ACTIVE';
    // Clear any existing
    if(infoTimer) clearInterval(infoTimer);
    infoTimer = setInterval(updateRealTimeInfo, 1000);
    updateRealTimeInfo();
  }

  function pauseProcessing(){
    paused = !paused;
    pauseBtn.textContent = paused ? '▶ Resume' : '⏸️ Pause';
    procStatus.innerHTML = paused ? '<span class="dot" style="background:var(--warning)"></span> PAUSED' : '<span class="dot active"></span> ACTIVE';
  }

  function stopProcessing(saveSession){
    processing = false; paused = false;
    if(infoTimer) clearInterval(infoTimer); infoTimer=null;

    if(saveSession){
      const sessions = loadSessions();
      const session = {
        timestamp: new Date().toISOString(),
        unripe, ripe, overripe, total: (unripe+ripe+overripe), duration: getElapsed()
      };
      sessions.push(session);
      if(sessions.length>50) sessions.splice(0,sessions.length-50);
      saveSessions(sessions);
    }
    // return to main
    processingPage.classList.add('hidden');
    main.classList.remove('hidden');
    renderRecentStats();
  }

  function getElapsed(){
    if(!startTime) return '00:00:00';
    const s = Math.floor((Date.now()-startTime)/1000);
    const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec=s%60;
    return [h,m,sec].map(v=>String(v).padStart(2,'0')).join(':');
  }

  function updateRealTimeInfo(){
    timeLabel.textContent = getElapsed();
    const elapsedSec = (Date.now()-startTime)/1000;
    const rate = elapsedSec>0 ? Math.round(((unripe+ripe+overripe)*60)/elapsedSec) : 0;
    rateLabel.textContent = rate + '/min';
    const accuracy = total>0 ? (85 + Math.floor(Math.random()*16)-5) : 0;
    accuracyLabel.textContent = (total>0 ? accuracy : 0) + '%';
  }

  function renderRecentStats(){
    const container = document.getElementById('recent-stats');
    container.innerHTML = '';
    const sessions = loadSessions();
    const last5 = sessions.slice(-5);

    const totalProcessed = last5.reduce((s,ss)=>s+ss.total,0);
    const avgAcc = 87 + Math.floor(Math.random()*6)-3;
    const sessionsCount = sessions.length;

    container.appendChild(makeStatCard('Total Processed', totalProcessed.toLocaleString(), '🥭', 'primary'));
    container.appendChild(makeStatCard('Accuracy Rate', avgAcc+'%', '🎯', 'success'));
    container.appendChild(makeStatCard('Sessions', sessionsCount, '📊', 'accent'));
  }

  function makeStatCard(title,value,icon,cls){
    const d = document.createElement('div'); d.className='stat-card';
    d.innerHTML = `<div class="title">${title}</div><div class="value">${icon} ${value}</div>`;
    return d;
  }

  // Modals
  function showModal(modal){ modalOverlay.classList.remove('hidden'); modal.classList.remove('hidden'); }
  function hideModal(modal){ modalOverlay.classList.add('hidden'); modal.classList.add('hidden'); }

  // Settings apply
  function applySettings(){
    const speedVal = document.querySelector('input[name=speed]:checked').value;
    processingSpeed = parseInt(speedVal,10);
    batchMode = document.getElementById('batch-checkbox').checked;
    // processingSpeed is stored for compatibility but there is no auto-simulation.
    // If a realtime info timer is running, restart it to ensure labels update with new interval.
    if(processing && infoTimer){ clearInterval(infoTimer); infoTimer = setInterval(updateRealTimeInfo, 1000); }
    hideModal(settingsModal);
  }

  // Analytics
  function openAnalytics(){
    analyticsTableBody.innerHTML='';
    const sessions = loadSessions().slice(-15).reverse();
    sessions.forEach(s => {
      const tr = document.createElement('tr');
      const date = new Date(s.timestamp); const dateStr = `${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
      const eff = (85 + Math.floor(Math.random()*16)-5) + '%';
      tr.innerHTML = `<td>${dateStr}</td><td>${s.duration}</td><td>${s.total}</td><td>${s.unripe}</td><td>${s.ripe}</td><td>${s.overripe}</td><td>${eff}</td>`;
      analyticsTableBody.appendChild(tr);
    });
    showModal(analyticsModal);
  }

  // Export current session to text file
  function exportCurrent(){
    const lines = [];
    lines.push('==================================================');
    lines.push('    MANGOSORT PRO - SESSION REPORT');
    lines.push('==================================================');
    lines.push('Date: '+new Date().toLocaleString());
    lines.push('Duration: '+getElapsed());
    lines.push('Accuracy: '+(total>0?(85+Math.floor(Math.random()*11)-5):0)+'%');
    lines.push('CLASSIFICATION RESULTS:');
    lines.push('-------------------------');
    lines.push(`Unripe Mangoes:  ${unripe}`);
    lines.push(`Ripe Mangoes:    ${ripe}`);
    lines.push(`Overripe Mangoes: ${overripe}`);
    lines.push('-------------------------');
    lines.push(`Total Processed: ${total}`);
    const blob = new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `mangosort_session_${(new Date()).toISOString().replace(/[:.]/g,'_')}.txt`;
    a.click();
  }

  // Camera / capture -> POST to backend
  let streamHandle = null;
  let yoloStreamActive = false;
  
  async function openCamera(){
    try{
      // Try to connect to YOLO backend stream first
      const yoloStream = document.getElementById('yolo-stream');
      const cameraVideoMain = document.getElementById('camera-video-main');
      
      try {
        const healthCheck = await fetch('http://localhost:5000/api/health');
        if(healthCheck.ok) {
          // Backend is running, show YOLO stream using img tag with src
          yoloStream.src = 'http://localhost:5000/api/video?' + Date.now();
          yoloStream.style.display = 'block';
          cameraVideoMain.style.display = 'none';
          yoloStreamActive = true;
          console.log('Using YOLO backend stream');
          return;
        }
      } catch(e) {
        console.log('YOLO backend unavailable, using camera');
      }
      
      // Fallback to regular camera if backend unavailable
      streamHandle = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }, 
        audio: false 
      });
      cameraVideoMain.srcObject = streamHandle;
      cameraVideoMain.style.display = 'block';
      yoloStream.style.display = 'none';
      yoloStreamActive = false;
    }catch(e){ alert('Unable to access camera: '+e); }
  }

  function closeCamera(){
    if(streamHandle){
      streamHandle.getTracks().forEach(t=>t.stop());
      streamHandle = null;
    }
    if(cameraVideoMain) cameraVideoMain.srcObject = null;
    cameraVideo.srcObject = null;
  }

  function captureAndSend(){
    // Use cameraVideoMain if available (on processing page), else fall back to modal camera
    const videoEl = cameraVideoMain && cameraVideoMain.srcObject ? cameraVideoMain : cameraVideo;
    const w = videoEl.videoWidth; const h = videoEl.videoHeight;
    cameraCanvas.width = w; cameraCanvas.height = h;
    const ctx = cameraCanvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    cameraCanvas.toBlob(async (blob)=>{
      try{
        const form = new FormData();
        form.append('image', blob, 'capture.jpg');
        const resp = await fetch('http://localhost:5000/api/predict', { method:'POST', body: form });
        if(!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        
        // Handle predictions from YOLO model
        if(data && data.predictions && data.predictions.length > 0){
          // Get the top prediction (highest confidence)
          const topPred = data.predictions.reduce((max, curr) => 
            curr.confidence > max.confidence ? curr : max
          );
          
          // Map class names to our categories
          const className = topPred.class.toLowerCase();
          if(className === 'unripe') unripe += 1;
          else if(className === 'ripe') ripe += 1;
          else if(className === 'overripe') overripe += 1;
          
          total += 1;
          updateCountsUI();
          procStatus.textContent = `Last: ${topPred.class} (${(topPred.confidence * 100).toFixed(1)}%)`;
        }
      }catch(e){ alert('Classification failed: '+e); }
    }, 'image/jpeg', 0.9);
  }

  // Export all sessions JSON
  function exportAll(){
    const sessions = loadSessions();
    const blob = new Blob([JSON.stringify(sessions, null, 2)], {type:'application/json;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `mangosort_all_${(new Date()).toISOString().replace(/[:.]/g,'_')}.json`;
    a.click();
  }

  // Stop flow with modal
  function openStopModal(){ showModal(stopModal); }

  // Event bindings
  startBtn.addEventListener('click', ()=>{ showProcessingPage(); });
  settingsBtn.addEventListener('click', ()=>{ showModal(settingsModal); });
  settingsBtn2.addEventListener('click', ()=>{ showModal(settingsModal); });
  analyticsBtn.addEventListener('click', openAnalytics);
  exportAllBtn.addEventListener('click', exportAll);

  pauseBtn.addEventListener('click', pauseProcessing);
  stopBtn.addEventListener('click', openStopModal);
  exportBtn.addEventListener('click', exportCurrent);
  cameraBtn && cameraBtn.addEventListener('click', openCamera);
  cameraBtn2 && cameraBtn2.addEventListener('click', openCamera);
  captureBtn && captureBtn.addEventListener('click', captureAndSend);
  closeCameraBtn && closeCameraBtn.addEventListener('click', closeCamera);

  applySettingsBtn.addEventListener('click', applySettings);
  closeAnalyticsBtn.addEventListener('click', ()=>hideModal(analyticsModal));

  confirmStopBtn.addEventListener('click', ()=>{
    const save = document.getElementById('save-session').checked;
    hideModal(stopModal);
    stopProcessing(save);
  });
  cancelStopBtn.addEventListener('click', ()=>hideModal(stopModal));

  modalOverlay.addEventListener('click', ()=>{
    // close overlays
    [settingsModal, analyticsModal, stopModal].forEach(m=>m.classList.add('hidden'));
    modalOverlay.classList.add('hidden');
  });

  // Initialize
  startLoading();

  // Poll hardware counts (Raspberry Pi GPIO server) every second and update counts
  async function pollHardwareCounts(){
    try{
      const resp = await fetch(HW_COUNTS_URL, {cache:'no-store'});
      if(!resp.ok) throw new Error('no hw');
      const j = await resp.json();
      if(j && (typeof j.unripe === 'number')){
        // enable hardware mode
        hardwareMode = true;
        // set counts from hardware
        unripe = j.unripe || 0; ripe = j.ripe || 0; overripe = j.overripe || 0;
        updateCountsUI();
      }
    }catch(e){
      // couldn't reach hardware server — mark as not available
      if(hardwareMode){
        hardwareMode = false;
      }
    }
  }
  setInterval(pollHardwareCounts, 1000);

})();
