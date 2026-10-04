/* FORM: static, device-local journal. No analytics or remote health storage. */
(() => {
  'use strict';
  const D = window.FitnessData;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    dashboard:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    dumbbell:'<path d="m6.5 6.5 11 11M5 4 3 6l3 3 3-3-3-3M18 15l-3 3 3 3 3-3-3-3M9 3l3 3-6 6-3-3M21 15l-3-3-6 6 3 3"/>',
    trend:'<path d="M3 4v16h18M6 15l5-5 4 3 6-8M17 5h4v4"/>',
    archive:'<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M3 3h18v4H3zM9 11h6M12 15v3"/>',
    pulse:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    body:'<rect x="4" y="3" width="16" height="18" rx="4"/><path d="M8 9a4 4 0 0 1 8 0M12 9l2-3M8 16h8"/>',
    battery:'<rect x="2" y="6" width="18" height="12" rx="3"/><path d="M23 10v4M6 10v4M10 10v4M14 10v4"/>',
    bowl:'<path d="M3 11h18a9 9 0 0 1-18 0ZM7 21h10M8 7V3M12 7V2M16 7V3"/>',
    watch:'<rect x="5" y="5" width="14" height="14" rx="4"/><path d="M8 5V2h8v3M8 19v3h8v-3M12 8v4l3 2"/>',
    device:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 18h2"/>',
    chevronLeft:'<path d="m14 5-7 7 7 7"/>',chevronRight:'<path d="m9 5 7 7-7 7"/>',
    check:'<path d="m5 12 4 4L19 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
    film:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
    play:'<path d="m9 5 10 7-10 7V5Z"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h1M15 15h1"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.dumbbell}</svg>`;
  function hydrateIcons(root = document) { $$('[data-icon]', root).forEach(el => el.innerHTML = icon(el.dataset.icon)); }
  const form = $('#daily-form');
  const loaded = D.load();
  let db = loaded.db || D.createDatabase();
  let storageBlocked = !loaded.ok;
  let selectedDate = D.localDate();
  let knownToday = selectedDate;
  let dirty = false;
  let recordBaseline = 'null';
  let recordRevision = 0;
  let view = 'today';
  let category = '全部';
  let onlyFavorites = false;
  let trendRange = 7;
  let exerciseDirty = false;
  let activeExerciseId = null;
  let exerciseBaseline = 'null';
  let toastTimer;
  const numericFields = ['weight','gripLeft','gripRight','duration','activeEnergy','totalEnergy','avgHeartRate','exertion','fatigue','intake'];
  const numberValue = el => el.value.trim() === '' ? null : Number(el.value);
  const dateFrom = value => new Date(value + 'T12:00:00');
  const shiftDate = (date, n) => { const d = dateFrom(date); d.setDate(d.getDate() + n); return D.localDate(d); };
  const humanDate = date => dateFrom(date).toLocaleDateString('zh-CN', {month:'long',day:'numeric',weekday:'long'});
  const displayNumber = number => number === null || number === undefined ? '—' : Number(number).toLocaleString('zh-CN', {maximumFractionDigits:1});
  const recordFor = date => db.records[date] || D.emptyRecord(date);
  const grip = record => record.gripLeft === null && record.gripRight === null ? null : Math.max(record.gripLeft ?? 0, record.gripRight ?? 0);
  const snapshot = value => JSON.stringify(value ?? null);
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200); }
  function showError(target, message) { $(target).textContent = message; $(target).hidden = !message; }
  function confirmAction(title, message, okay = '确认', cancel = '取消') {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title; $('#confirm-message').textContent = message; $('#confirm-ok').textContent = okay; $('#confirm-cancel').textContent = cancel;
    dialog.returnValue = ''; dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once:true}));
  }
  function persist(next, recovery = false) {
    if (storageBlocked && !recovery) { toast('本地存储暂不可用，请先处理上方提示。'); return false; }
    const result = D.save(next);
    if (!result.ok) { showError('#storage-alert', `保存失败：${result.error}。你填写的内容仍在当前页面，请勿关闭。`); return false; }
    db = next; storageBlocked=false; showError('#storage-alert',''); return true;
  }
  function readLatest() {
    const latest = D.load();
    storageBlocked = !latest.ok;
    if (!latest.ok) { showError('#storage-alert',`${latest.error} 保存已暂停；可在“数据与备份”导出原始数据，或导入有效备份恢复。当前填写内容仍保留在页面。`); return false; }
    db = latest.db;
    return true;
  }
  // Serialize same-origin writes when Web Locks is available. Every operation
  // also rereads storage immediately before writing and mutates only its entry.
  const withWriteLock = task => navigator.locks?.request
    ? navigator.locks.request(D.STORAGE_KEY + ':write', task)
    : Promise.resolve().then(task);
  async function commitMutation(build, conflict) {
    let approved = undefined;
    for (;;) {
      const result = await withWriteLock(() => {
        if (!readLatest()) return {state:'failed'};
        const current = conflict ? conflict.read(db) : null;
        const version = snapshot(current);
        if (conflict && version !== conflict.baseline && version !== approved) return {state:'conflict',version,missing:!current};
        const next = build(db);
        return {state:next && persist(next) ? 'saved' : 'failed'};
      });
      if (result.state !== 'conflict') return result.state === 'saved';
      const message = result.missing && conflict.missingMessage ? conflict.missingMessage : conflict.message;
      if (!await confirmAction(conflict.title,message,conflict.okay || '保存我的修改','继续编辑')) return false;
      approved = result.version;
    }
  }
  function markDirty() { dirty = true; recordRevision += 1; $('#save-record').disabled=false; $('#save-status').textContent = '有未保存的修改'; $('#save-record').innerHTML = icon('check') + '保存记录'; showError('#form-error',''); updateMeals(); }
  async function leaveRecord() { if (!dirty) return true; return await confirmAction('还有未保存的记录', '离开会放弃本次修改。你也可以继续填写并保存。', '放弃修改', '继续填写'); }
  function addMealRow(name = '', kcal = null) {
    const row = document.createElement('div'); row.className = 'meal-row';
    row.innerHTML = `<label class="field"><span class="sr-only">餐食名称</span><input class="meal-name" type="text" maxlength="120" placeholder="餐食名称" value="${escape(name)}"></label><label class="field"><span class="sr-only">该餐热量估算</span><div class="input-unit"><input class="meal-kcal" type="number" inputmode="decimal" min="0" max="30000" step="any" placeholder="—" value="${kcal ?? ''}"><span>kcal</span></div></label><button type="button" class="icon-button remove-meal" aria-label="移除这一餐">${icon('close')}</button>`;
    row.querySelector('.remove-meal').addEventListener('click', () => { row.remove(); markDirty(); });
    $('#meal-rows').append(row);
  }
  function updateMeals() {
    const values = $$('.meal-kcal').map(numberValue).filter(v => v !== null && Number.isFinite(v));
    const sum = values.reduce((a,b) => a + b, 0);
    $('#meal-total').textContent = values.length ? `${displayNumber(sum)} kcal 合计` : '尚未填写';
  }
  function updateFatigue() {
    const n = numberValue($('#fatigue'));
    $$('#fatigue-scale button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.fatigue) === n)));
    $('#fatigue-label').textContent = n === null ? '尚未记录' : `${n} / 10 · 再点可取消`;
  }
  function populateForm() {
    const r = recordFor(selectedDate);
    recordBaseline = snapshot(db.records[selectedDate]);
    recordRevision += 1;
    $('#record-date').value = selectedDate;
    numericFields.forEach(key => form.elements[key].value = r[key] ?? '');
    form.elements.notes.value = r.notes;
    $$('#training-types button').forEach(b => b.setAttribute('aria-pressed', String(r.trainingTypes.includes(b.dataset.type))));
    $('#meal-rows').replaceChildren();
    if (r.meals.length) r.meals.forEach(m => addMealRow(m.name, m.kcal));
    else ['早餐','午餐','晚餐','加餐'].forEach(name => addMealRow(name));
    $('#meal-details').open = r.meals.length > 0;
    updateMeals(); updateFatigue(); dirty = false; showError('#form-error','');
    $('#save-status').textContent = db.records[selectedDate] ? '已保存 · 可随时修改' : '填写任意一项即可保存';
    $('#save-record').innerHTML = icon('check') + '保存记录';
    $('#save-record').disabled = true;
    showError('#day-alert','');
    refreshDateControls();
    renderOverview();
  }
  function refreshDateControls() {
    $('#record-date').max = D.localDate();
    $('#next-day').disabled = selectedDate >= D.localDate();
    $('#back-today').hidden = selectedDate === D.localDate();
    $('#today-title').innerHTML = (selectedDate === D.localDate() ? '今日状态' : '每日状态') + '<span class="accent-dot">.</span>';
  }
  function refreshDay() {
    const today = D.localDate();
    refreshDateControls();
    if (today === knownToday) return;
    const priorToday = knownToday;
    knownToday = today;
    if (selectedDate === priorToday && !dirty) { selectedDate = today; populateForm(); }
    else if (dirty) showError('#day-alert',`今天已是 ${today}。未保存的内容仍属于 ${selectedDate}；点击保存会记入该日期。保存后可点“回到今天”继续记录。`);
    if (view === 'history') renderHistory();
  }
  function collectRecord() {
    const r = D.emptyRecord(selectedDate);
    numericFields.forEach(key => r[key] = numberValue(form.elements[key]));
    r.notes = form.elements.notes.value;
    r.trainingTypes = $$('#training-types button[aria-pressed=true]').map(b => b.dataset.type);
    r.meals = $$('.meal-row').filter(row => $('.meal-kcal', row).value !== '').map(row => ({name:$('.meal-name', row).value.trim() || '餐食',kcal:numberValue($('.meal-kcal', row))}));
    r.updatedAt = new Date().toISOString();
    return D.normalizeRecord(r);
  }
  function renderOverview() {
    const r = recordFor(selectedDate);
    const exists = Boolean(db.records[selectedDate]);
    const groups = [r.weight !== null || grip(r) !== null, r.trainingTypes.length > 0 || r.activeEnergy !== null || r.duration !== null || r.totalEnergy !== null || r.avgHeartRate !== null || r.exertion !== null, r.fatigue !== null || Boolean(r.notes), D.intakeTotal(r) !== null];
    const count = groups.filter(Boolean).length;
    $('#record-badge').textContent = exists ? '已记录' : '待记录'; $('#record-badge').classList.toggle('saved',exists);
    $('#delete-record').hidden = !exists;
    $('#completion-value').innerHTML = `${count}<span>/ 4</span>`; $('#completion-ring').style.setProperty('--progress', `${count * 25}%`); $('#completion-ring').setAttribute('aria-label',`已记录 ${count} 类，共 4 类`);
    $('#summary-caption').textContent = exists ? humanDate(selectedDate) : '属于你的身体记录';
    $('#summary-state').textContent = exists ? (count === 4 ? '这一天，记录完整' : '状态，已记下') : '从今天开始';
    $('#jump-to-form').textContent = exists ? '修改这一天的记录' : '开始记录';
    $('#summary-note').textContent = exists ? (r.fatigue !== null ? `疲劳体感 ${r.fatigue} / 10${r.trainingTypes.length ? ' · ' + r.trainingTypes.join(' / ') : ''}` : '已记录 ' + count + ' 类状态 · 按自己的节奏来') : '按需填写，留空的项目不会记为 0。';
    const metrics = [['体重',r.weight,'kg'],['握力最高值',grip(r),'kg'],['活动能量',r.activeEnergy,'kcal'],['摄入估算',D.intakeTotal(r),'kcal']];
    $('#summary-metrics').innerHTML = metrics.map(([name,value,unit]) => `<div class="summary-metric"><p>${name}</p><strong class="${value === null ? 'empty' : ''}">${displayNumber(value)}</strong><small>${unit}</small></div>`).join('');
    const dates = Array.from({length:7},(_,i)=>shiftDate(selectedDate,i-6));
    $('#week-count').textContent = `${dates.filter(d => db.records[d]).length} 天有记录`;
    $('#week-strip').innerHTML = dates.map(d => `<button type="button" class="week-day ${db.records[d] ? 'has-record' : ''}" data-date="${d}" ${d === selectedDate ? 'aria-current="date"' : ''} aria-label="${escape(humanDate(d))}${db.records[d] ? '，已有记录' : '，未记录'}"><span>${['日','一','二','三','四','五','六'][dateFrom(d).getDay()]}</span><strong>${dateFrom(d).getDate()}</strong></button>`).join('');
  }
  async function selectDate(date) {
    if (!D.isValidDate(date) || date > D.localDate()) { $('#record-date').value = selectedDate; return; }
    if (date === selectedDate) return;
    if (!await leaveRecord()) { $('#record-date').value = selectedDate; return; }
    selectedDate = date; populateForm();
  }
  async function navigate(next, date) {
    if (!['today','library','history'].includes(next)) next = 'today';
    if (next !== view && !await leaveRecord()) { history.replaceState(null,'','#'+view); return; }
    if (next !== view && dirty) populateForm();
    view = next;
    $$('.view').forEach(v => v.hidden = v.id !== 'view-'+next);
    $$('[data-view]').forEach(b => { if(b.dataset.view===next) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
    history.replaceState(null,'','#'+next);
    if (next === 'library') renderLibrary();
    if (next === 'history') renderHistory();
    if (next === 'today' && date) await selectDate(date);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function renderLibrary() {
    const query = $('#exercise-search').value.trim().toLocaleLowerCase();
    const exercises = db.exercises.filter(e => (category === '全部' || e.category === category) && (!onlyFavorites || db.favorites.includes(e.id)) && (!query || (e.name+' '+e.equipment+' '+e.category).toLocaleLowerCase().includes(query)));
    $('#exercise-count').textContent = `${exercises.length} 个动作${category !== '全部' ? ' · '+category : ''}`;
    $('#exercise-grid').innerHTML = exercises.length ? exercises.map(e => {
      const index = D.CATEGORIES.indexOf(e.category) % 3;
      const favorite = db.favorites.includes(e.id);
      return `<article class="exercise-card"><button type="button" class="exercise-open" data-exercise="${escape(e.id)}" aria-label="查看和编辑${escape(e.name)}"><div class="exercise-art art-${index}">${e.gif ? `<img src="${escape(e.gif)}" alt="${escape(e.name)}演示" loading="lazy" decoding="async">` : `<span class="art-icon">${icon('dumbbell')}</span>`}<span class="media-tag">${icon(e.gif || e.video ? 'play' : 'film')}${e.gif || e.video ? '查看演示' : '待添加演示'}</span></div><div class="exercise-info"><span class="category">${escape(e.category)}</span><h3>${escape(e.name)}</h3><p>${escape(e.equipment || '器械待补充')}</p></div></button><button type="button" class="icon-button favorite-button" data-favorite="${escape(e.id)}" aria-label="${favorite ? '取消收藏' : '收藏'}${escape(e.name)}" aria-pressed="${favorite}">${icon('bookmark')}</button></article>`;
    }).join('') : `<div class="empty-state">${icon('search')}<h3>还没有匹配的动作</h3><p>试试其他名称或分类，<br>也可以添加你自己的训练动作。</p><button type="button" class="button secondary" data-action="reset-filters">清除筛选</button></div>`;
    $$('#exercise-grid img').forEach(img => img.addEventListener('error', () => { const fallback = document.createElement('span'); fallback.className='art-icon'; fallback.innerHTML=icon('film'); img.replaceWith(fallback); }, {once:true}));
  }
  function renderMedia(exercise) {
    const media = $('#exercise-media'); media.replaceChildren();
    [['gif','GIF / 图片演示'],['video','视频演示']].forEach(([key,label]) => {
      if (!exercise[key]) return;
      const block = document.createElement('div'); block.className='media-block';
      const title = document.createElement('p'); title.textContent=label; block.append(title);
      const element = document.createElement(key === 'video' ? 'video' : 'img');
      if (key === 'video') { element.controls=true; element.playsInline=true; element.preload='metadata'; }
      else { element.alt=exercise.name+'演示'; element.loading='lazy'; }
      element.src=exercise[key];
      element.addEventListener('error', () => { const error = document.createElement('div');error.className='media-error'; error.textContent='演示暂时无法加载，请检查下方地址是否为可访问的媒体文件。'; element.replaceWith(error); }, {once:true});
      block.append(element);media.append(block);
    });
    if (!exercise.gif && !exercise.video) media.innerHTML=`<div class="media-placeholder">${icon('film')}<p>给这个动作留一段演示</p><small>GIF 动图 / MP4 视频</small><button type="button" class="text-button" id="open-media-fields">${icon('plus')}添加演示地址</button></div>`;
  }
  function openExercise(id) {
    const e = db.exercises.find(e => e.id === id) || {id:'',name:'',category:category === '全部' ? '全身' : category,equipment:'',description:'',gif:'',video:''};
    activeExerciseId=id || null; exerciseDirty=false;
    exerciseBaseline=snapshot(db.exercises.find(entry=>entry.id===id));
    ['id','name','category','equipment','description','gif','video'].forEach(key => $('#exercise-'+key).value=e[key]);
    $('#exercise-dialog-title').textContent = id ? '动作详情' : '添加动作'; $('#delete-exercise').hidden=!id;
    $('#media-settings').open=false; showError('#exercise-error','');renderMedia(e);$('#exercise-dialog').showModal();
  }
  function metricValue(record, metric) { return metric === 'grip' ? grip(record) : metric === 'intake' ? D.intakeTotal(record) : record[metric]; }
  function renderHistory() {
    const dates = Object.keys(db.records).sort().reverse();
    $('#total-days').textContent = `${dates.length} 天记录`;
    $('#history-list').innerHTML = dates.length ? dates.map(date => {
      const r = db.records[date];
      const values=[r.weight !== null ? `${displayNumber(r.weight)} kg` : '',grip(r) !== null ? `握力 ${displayNumber(grip(r))} kg` : '',r.activeEnergy !== null ? `消耗 ${displayNumber(r.activeEnergy)} kcal` : '',D.intakeTotal(r) !== null ? `摄入 ${displayNumber(D.intakeTotal(r))} kcal` : '',r.fatigue !== null ? `疲劳 ${r.fatigue}/10` : ''].filter(Boolean);
      return `<button type="button" class="history-row" data-history-date="${date}"><span class="history-date"><strong>${dateFrom(date).getDate()}</strong><small>${dateFrom(date).getMonth()+1} 月</small></span><span class="history-info"><strong>${escape(r.trainingTypes.join(' · ') || '日常状态')}<span class="sr-only"> ${date}</span></strong><p>${escape(values.join(' · ') || r.notes || (r.duration !== null ? `训练 ${r.duration} 分钟` : '已记录'))}</p><small class="muted">${date}</small></span>${icon('chevronRight')}</button>`;
    }).join('') : `<div class="empty-state">${icon('calendar')}<h3>变化，从第一条记录开始</h3><p>记录体重、握力或今天的状态，<br>你的训练日历会慢慢长出来。</p><button type="button" class="button primary" data-action="go-today">记录今天</button></div>`;
    renderChart();
  }
  function renderChart() {
    const metric=$('#trend-metric').value, today=D.localDate(), start=shiftDate(today,1-trendRange);
    const points=Object.keys(db.records).sort().filter(date=>date>=start && date<=today).map(date=>({date,value:metricValue(db.records[date],metric)})).filter(p=>p.value!==null && p.value!==undefined);
    const unit={weight:'kg',grip:'kg',activeEnergy:'kcal',intake:'kcal',fatigue:'/ 10'}[metric];
    if (!points.length) { $('#trend-summary').innerHTML='';$('#trend-chart').innerHTML=`<div class="chart-empty">${icon('trend')}<p>这段时间还没有相关数据</p><small>保存记录后，这里会显示你的变化趋势。</small></div>`; return; }
    const latest=points[points.length-1], first=points[0],delta=Math.round((latest.value-first.value)*10)/10;
    $('#trend-summary').innerHTML=`<div><span class="trend-value">${displayNumber(latest.value)}<small>${unit}</small></span><p>${latest.date.slice(5).replace('-','/')} 最近一次</p></div><div><strong>${points.length>1 ? (delta>0?'+':'')+displayNumber(delta)+' '+unit : '—'}</strong><p>${points.length>1 ? '较区间首条记录' : '再记录一天即可对比'}</p></div><p>${points.length} 天有数据</p>`;
    const width=620,height=230,left=48,right=20,top=20,bottom=39;
    const values=points.map(p=>p.value),low=Math.min(...values),high=Math.max(...values),padding=Math.max((high-low)*.2,metric==='weight' || metric==='grip' ? .5 : metric==='fatigue' ? 1 : 20);
    const min=Math.max(0,low-padding),max=high+padding;
    const x=date=>left+Math.round((dateFrom(date)-dateFrom(start))/86400000)/(trendRange-1)*(width-left-right);
    const y=value=>height-bottom-(value-min)/(max-min)*(height-top-bottom);
    const line=points.map((p,i)=>`${i?'L':'M'}${x(p.date).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
    const grid=Array.from({length:4},(_,i)=>{const v=min+(max-min)*i/3;return `<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}" stroke="#e8edde" stroke-dasharray="3 5"/><text x="${left-9}" y="${y(v)+4}" text-anchor="end" fill="#728064" font-size="12">${displayNumber(v)}</text>`;}).join('');
    const dates=[start,shiftDate(start,Math.floor((trendRange-1)/2)),today];
    $('#trend-chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape($('#trend-metric').selectedOptions[0].textContent)}，最近 ${trendRange} 天，${points.length} 条记录"><title>已记录数据趋势</title>${grid}${points.length>1?`<path d="${line} L${x(latest.date)},${height-bottom} L${x(first.date)},${height-bottom} Z" fill="#e5efcc" opacity=".7"/><path d="${line}" fill="none" stroke="#5d7c37" stroke-width="2.5" stroke-linejoin="round"/>`:''}${points.map(p=>`<circle cx="${x(p.date)}" cy="${y(p.value)}" r="4.5" fill="#5d7c37" stroke="white" stroke-width="2"><title>${p.date}：${p.value} ${unit}</title></circle>`).join('')}${dates.map(d=>`<text x="${x(d)}" y="${height-10}" text-anchor="middle" fill="#728064" font-size="12">${d.slice(5).replace('-','/')}</text>`).join('')}</svg><details class="chart-data"><summary>查看图表数据</summary><ul>${points.map(p=>`<li>${p.date}：${p.value} ${unit}</li>`).join('')}</ul></details>`;
  }
  function openSettings() { $('#backup-summary').textContent=`${Object.keys(db.records).length} 天记录 · ${db.exercises.length} 个动作 · ${db.favorites.length} 个收藏`;showError('#import-error','');$('#settings-dialog').showModal(); }
  function download(content,name) { const blob=new Blob([content],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000); }

  hydrateIcons();
  $('#record-date').max=D.localDate();
  $('#training-types').innerHTML=D.TRAINING_TYPES.map(type=>`<button type="button" class="type-chip" data-type="${type}" aria-pressed="false">${type}</button>`).join('');
  $('#fatigue-scale').innerHTML=Array.from({length:10},(_,i)=>`<button type="button" data-fatigue="${i+1}" aria-label="疲劳等级 ${i+1}" aria-pressed="false">${i+1}</button>`).join('');
  $('#exertion').insertAdjacentHTML('beforeend',Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1} / 10${i===0?' · 很轻松':i===9?' · 极为吃力':''}</option>`).join(''));
  $('#exercise-category').innerHTML=D.CATEGORIES.map(c=>`<option>${c}</option>`).join('');
  $('#category-filters').innerHTML=['全部',...D.CATEGORIES].map(c=>`<button type="button" data-category="${c}" aria-pressed="${c==='全部'}">${c}</button>`).join('');
  if (!loaded.ok) showError('#storage-alert',`本地数据未能读取：${loaded.error}。为保护原记录，已暂停保存。可在“数据与备份”导出原始数据，或导入有效备份恢复；原始记录未被覆盖。`);
  populateForm();
  navigate(location.hash.slice(1) || 'today');

  form.addEventListener('input',markDirty);
  form.addEventListener('change',markDirty);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    try {
      refreshDay();
      const record=collectRecord();
      if (!D.hasRecordData(record)) { showError('#form-error','先填写任意一项，再保存这一天。'); return; }
      const date=selectedDate, revision=recordRevision, baseline=recordBaseline;
      if (!await commitMutation(current=>({...current,records:{...current.records,[date]:record}}),{
        read:current=>current.records[date],baseline,title:'这一天的记录已更新',
        message:`另一页面修改了 ${date} 的记录。保存会用当前填写内容替换这一天，其他日期的记录保留。`,
        missingMessage:`另一页面删除了 ${date} 的记录。保存会用当前填写内容重新建立这一天。`
      })) return;
      if(selectedDate===date){recordBaseline=snapshot(db.records[date]);if(recordRevision===revision){dirty=false;$('#save-record').disabled=true;$('#save-status').textContent='已保存到当前设备';$('#save-record').innerHTML=icon('check')+'已保存';showError('#form-error','');showError('#day-alert','');}renderOverview();}
      toast('这一天，记下了。');
    } catch(error) { showError('#form-error',error.message); }
  });
  $('#training-types').addEventListener('click',event=>{
    const button=event.target.closest('[data-type]');if(!button)return;
    const selecting=button.getAttribute('aria-pressed')!=='true';
    if(selecting){if(button.dataset.type==='休息') $$('#training-types button').forEach(b=>b.setAttribute('aria-pressed','false'));else $('#training-types [data-type="休息"]').setAttribute('aria-pressed','false');}
    button.setAttribute('aria-pressed',String(selecting));markDirty();
  });
  $('#fatigue-scale').addEventListener('click',event=>{const button=event.target.closest('[data-fatigue]');if(!button)return;$('#fatigue').value=$('#fatigue').value===button.dataset.fatigue?'':button.dataset.fatigue;updateFatigue();markDirty();});
  $('#add-meal').addEventListener('click',()=>{if($$('.meal-row').length>=100){toast('最多添加 100 餐');return;}addMealRow();markDirty();$$('.meal-name').at(-1).focus();});
  $('#record-date').addEventListener('change',event=>selectDate(event.target.value));
  $('#previous-day').addEventListener('click',()=>selectDate(shiftDate(selectedDate,-1)));
  $('#next-day').addEventListener('click',()=>selectDate(shiftDate(selectedDate,1)));
  $('#back-today').addEventListener('click',()=>selectDate(D.localDate()));
  $('#jump-to-form').addEventListener('click',()=>form.querySelector('.form-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));
  $('#delete-record').addEventListener('click',async()=>{
    const date=selectedDate, baseline=recordBaseline;
    if(!db.records[date])return;
    if(!await confirmAction('删除这一天的记录？',`${date} 的状态记录会从当前设备移除。你可以先导出备份。`,'删除记录'))return;
    if(await commitMutation(current=>{const records={...current.records};delete records[date];return {...current,records};},{
      read:current=>current.records[date],baseline,title:'这一天的记录已变化',message:`另一页面更新了 ${date} 的记录。仍要删除最新的记录吗？`,missingMessage:'这一天已在另一页面删除。继续将同步删除状态。',okay:'确认删除'
    })){if(selectedDate===date)populateForm();toast('这一天的记录已删除');}
  });
  $('#week-strip').addEventListener('click',event=>{const button=event.target.closest('[data-date]');if(button)selectDate(button.dataset.date);});
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
  window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
  window.addEventListener('beforeunload',event=>{if(dirty || exerciseDirty){event.preventDefault();event.returnValue='';}});
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-action]');if(!target)return;
    const action=target.dataset.action;
    if(action==='settings')openSettings();
    if(action==='go-today')navigate('today',D.localDate());
    if(action==='reset-filters'){$('#exercise-search').value='';category='全部';onlyFavorites=false;$('#favorite-filter').setAttribute('aria-pressed','false');$$('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category==='全部')));renderLibrary();}
  });
  async function closeExercise() { if(exerciseDirty && !await confirmAction('动作有未保存的修改','关闭会放弃这次编辑。','放弃修改','继续编辑'))return;exerciseDirty=false;$('#exercise-dialog').close(); }
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>b.dataset.close==='exercise-dialog'?closeExercise():$('#'+b.dataset.close).close()));
  $('#exercise-dialog').addEventListener('cancel',event=>{event.preventDefault();closeExercise();});
  $('#exercise-dialog').addEventListener('close',()=>{$$('#exercise-media video').forEach(v=>v.pause());});
  $('#exercise-dialog').addEventListener('click',event=>{if(event.target.closest('#open-media-fields')){$('#media-settings').open=true;$('#exercise-gif').focus();}});
  $('#exercise-search').addEventListener('input',renderLibrary);
  $('#favorite-filter').addEventListener('click',()=>{onlyFavorites=!onlyFavorites;$('#favorite-filter').setAttribute('aria-pressed',String(onlyFavorites));renderLibrary();});
  $('#category-filters').addEventListener('click',event=>{const b=event.target.closest('[data-category]');if(!b)return;category=b.dataset.category;$$('[data-category]').forEach(c=>c.setAttribute('aria-pressed',String(c===b)));renderLibrary();});
  $('#new-exercise').addEventListener('click',()=>openExercise(null));
  $('#exercise-grid').addEventListener('click',async event=>{
    const fav=event.target.closest('[data-favorite]');if(fav){const id=fav.dataset.favorite;if(await commitMutation(current=>{if(!current.exercises.some(e=>e.id===id)){toast('这个动作已在另一页面删除。');return null;}const favorites=current.favorites.includes(id)?current.favorites.filter(x=>x!==id):[...current.favorites,id];return {...current,favorites};}))renderLibrary();return;}
    const button=event.target.closest('[data-exercise]');if(button)openExercise(button.dataset.exercise);
  });
  $('#exercise-form').addEventListener('input',()=>exerciseDirty=true);
  $('#exercise-form').addEventListener('change',()=>exerciseDirty=true);
  $('#exercise-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{
      const entry={};['id','name','category','equipment','description','gif','video'].forEach(key=>entry[key]=$('#exercise-'+key).value);
      entry.id=activeExerciseId || 'custom-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36));
      const normalized=D.normalizeExercise(entry);
      const id=normalized.id, baseline=exerciseBaseline;
      if(!await commitMutation(current=>({...current,exercises:current.exercises.some(e=>e.id===id)?current.exercises.map(e=>e.id===id?normalized:e):[...current.exercises,normalized]}),{
        read:current=>current.exercises.find(e=>e.id===id),baseline,title:'这个动作已变化',
        message:'另一页面更新了这个动作。保存会用当前编辑内容替换它，其他动作与记录保留。',
        missingMessage:'这个动作已在另一页面删除。保存会根据当前编辑内容重新创建它。'
      }))return;exerciseDirty=false;exerciseBaseline=snapshot(normalized);$('#exercise-dialog').close();renderLibrary();toast('动作已保存');
    }catch(error){showError('#exercise-error',error.message);}
  });
  $('#delete-exercise').addEventListener('click',async()=>{if(!activeExerciseId)return;const id=activeExerciseId,baseline=exerciseBaseline;if(!await confirmAction('删除这个动作？','会移除当前设备中的动作、演示地址和收藏。已放在项目里的媒体文件不受影响。','删除动作'))return;if(await commitMutation(current=>({...current,exercises:current.exercises.filter(e=>e.id!==id),favorites:current.favorites.filter(x=>x!==id)}),{
    read:current=>current.exercises.find(e=>e.id===id),baseline,title:'这个动作已变化',message:'另一页面更新了这个动作。仍要删除最新的动作内容吗？',missingMessage:'这个动作已在另一页面删除。继续将同步删除状态。',okay:'确认删除'
  })){exerciseDirty=false;$('#exercise-dialog').close();renderLibrary();toast('动作已删除');}});
  $('#trend-metric').addEventListener('change',renderChart);
  $$('[data-range]').forEach(b=>b.addEventListener('click',()=>{trendRange=Number(b.dataset.range);$$('[data-range]').forEach(c=>c.setAttribute('aria-pressed',String(c===b)));renderChart();}));
  $('#history-list').addEventListener('click',event=>{const b=event.target.closest('[data-history-date]');if(b)navigate('today',b.dataset.historyDate);});
  $('#export-data').addEventListener('click',()=>{
    try{
      if(!readLatest()){
        const raw=localStorage.getItem(D.STORAGE_KEY);
        if(raw===null)throw new Error('无法读取可导出的原始数据，请检查浏览器存储权限。');
        download(raw,'form-recovery-raw-'+D.localDate()+'.json');
        showError('#import-error','已导出未经校验的原始数据，便于保留和修复。它可能需要修复后才能重新导入；页面草稿不包含在内。');
        toast('原始数据已导出，现有存储未更改。');return;
      }
      download(D.exportJSON(db),'form-backup-'+D.localDate()+'.json');toast(dirty?'备份已导出；当前未保存的修改尚未包含。':'备份已导出');
    }catch(error){showError('#import-error',error.message);}
  });
  $('#import-data').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try{
      if(file.size>10*1024*1024)throw new Error('备份不能超过 10 MB。');
      const incoming=D.importJSON(await file.text());
      if(dirty && !await confirmAction('导入前还有未保存的修改','导入会刷新当前表单。请先保存，或放弃本次修改后继续。','放弃修改并导入','返回保存'))return;
      let approvedVersion, approvedRaw;
      for(;;){
        const outcome=await withWriteLock(()=>{
          const latest=D.load();
          if(!latest.ok){
            storageBlocked=true;
            const raw=localStorage.getItem(D.STORAGE_KEY);
            if(raw!==approvedRaw)return {state:'damaged',raw};
            return {state:persist(incoming,true)?'saved':'failed'};
          }
          db=latest.db;storageBlocked=false;
          let merged=D.mergeDatabases(db,incoming);
          if(!merged.applied){
            const version=snapshot(db);
            if(version!==approvedVersion)return {state:'conflict',version,counts:`${merged.conflicts.records.length} 天记录、${merged.conflicts.exercises.length} 个动作`};
            merged=D.mergeDatabases(db,incoming,{replaceConflicts:true});
          }
          return {state:persist(merged.db)?'saved':'failed'};
        });
        if(outcome.state==='failed')return;
        if(outcome.state==='saved')break;
        if(outcome.state==='damaged'){
          if(!await confirmAction('用备份恢复本地数据？','当前本地数据无法通过校验。建议先取消并导出原始数据留存。继续会用这个已校验的备份完整替换损坏的数据。','替换损坏数据','取消'))return;
          approvedRaw=outcome.raw;
        }else{
          if(!await confirmAction('备份中有重复内容',`检测到 ${outcome.counts} 与当前设备不同。继续将用备份中的内容替换这些条目，其余数据保留。建议先导出当前备份。`,'替换并导入','取消'))return;
          approvedVersion=outcome.version;
        }
      }
      dirty=false;populateForm();renderLibrary();renderHistory();$('#backup-summary').textContent=`${Object.keys(db.records).length} 天记录 · ${db.exercises.length} 个动作 · ${db.favorites.length} 个收藏`;showError('#import-error','');toast('备份已导入');
    }catch(error){showError('#import-error','未导入：'+error.message);}
  });
  function refreshFromStorage() {
    const before=snapshot(db), wasBlocked=storageBlocked;
    if(!readLatest())return;
    if(snapshot(db)===before && !wasBlocked)return;
    if(dirty || exerciseDirty)showError('#storage-alert','已载入另一页面的更新；你的未保存内容仍保留。保存时如同一天或同一动作已被修改，会先请你确认，其他记录会保留。');
    else showError('#storage-alert','');
    if(!dirty)populateForm();else renderOverview();
    if($('#exercise-dialog').open && activeExerciseId && !exerciseDirty){
      const current=db.exercises.find(e=>e.id===activeExerciseId);
      if(current){
        if(snapshot(current)!==exerciseBaseline){['id','name','category','equipment','description','gif','video'].forEach(key=>$('#exercise-'+key).value=current[key]);renderMedia(current);exerciseBaseline=snapshot(current);}
        showError('#exercise-error','');
      }else showError('#exercise-error','这个动作已在另一页面删除。当前内容仍保留，点击保存可确认重新创建。');
    }
    if(view==='library')renderLibrary();if(view==='history')renderHistory();
    $('#backup-summary').textContent=`${Object.keys(db.records).length} 天记录 · ${db.exercises.length} 个动作 · ${db.favorites.length} 个收藏`;
  }
  window.addEventListener('storage',event=>{if(event.key===D.STORAGE_KEY || event.key===null){refreshFromStorage();refreshDay();}});
  function resumePage(){refreshDay();refreshFromStorage();}
  window.addEventListener('pageshow',resumePage);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumePage();});
  setInterval(refreshDay,60000);
})();
