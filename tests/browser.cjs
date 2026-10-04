const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const D = require('../data.js');

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,timezoneId:'Asia/Hong_Kong',reducedMotion:'reduce'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = process.env.FORM_TEST_URL || 'http://127.0.0.1:8765';
  const shots = path.join(os.tmpdir(),'form-qa'); await fs.mkdir(shots,{recursive:true});
  const click = selector => page.locator(selector).click();
  const readDB = () => page.evaluate(() => JSON.parse(localStorage.getItem('fitness-tracker:v1')));
  const screenshot = name => page.screenshot({path:path.join(shots,name+'.png'),fullPage:true});
  async function saved() { await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已保存')); }
  try {
    await page.goto(url); await page.waitForSelector('#summary-metrics');
    assert.equal(await page.locator('#record-badge').textContent(),'待记录');
    assert.equal(await readDB(), null);
    await screenshot('mobile-empty');
    const today = await page.locator('#record-date').inputValue();
    // Optional measurements, decimals, zero, mutually exclusive rest, meal sum.
    await page.locator('[name=weight]').fill('67.35');
    await page.locator('[name=gripLeft]').fill('0');
    await page.locator('[name=gripRight]').fill('42.5');
    await click('[data-type="力量训练"]'); await click('[data-type="休息"]');
    assert.equal(await page.locator('[data-type="力量训练"]').getAttribute('aria-pressed'),'false');
    await click('[data-type="力量训练"]'); await click('[data-type="跑步"]');
    await page.locator('[name=duration]').fill('45.5');
    await page.locator('[name=activeEnergy]').fill('420.5');
    await click('[data-fatigue="6"]');
    await page.locator('[name=notes]').fill('浏览器测试记录 <script>window.pwned=1</script>');
    await click('#meal-details summary');
    await page.locator('.meal-kcal').nth(0).fill('400');
    await page.locator('.meal-kcal').nth(1).fill('650.5');
    await click('#save-record'); await saved();
    let database = await readDB();
    assert.equal(database.records[today].weight,67.35);
    assert.equal(database.records[today].gripLeft,0);
    assert.equal(database.records[today].intake,null);
    assert.equal(D.intakeTotal(database.records[today]),1050.5);
    assert.equal(database.records[today].totalEnergy,null);
    await page.reload(); await page.waitForSelector('#summary-metrics');
    assert.equal(await page.locator('[name=weight]').inputValue(),'67.35');
    assert.equal(await page.evaluate(()=>window.pwned),undefined);
    // Keep unsaved edits when navigation is cancelled.
    await page.locator('[name=weight]').fill('68.15');
    await click('[data-view="library"]');
    await page.locator('#confirm-dialog').waitFor({state:'visible'});
    await click('#confirm-cancel');
    assert.equal(await page.locator('[name=weight]').inputValue(),'68.15');
    await click('#save-record'); await saved();
    // Backfill and trend rendering.
    await click('#previous-day');
    await page.locator('[name=weight]').fill('68.8');
    await page.locator('[name=intake]').fill('2100');
    await click('#save-record'); await saved();
    await click('#back-today'); await page.waitForFunction(()=>document.querySelector('#back-today').hidden);
    await page.evaluate(()=>window.scrollTo(0,0)); await screenshot('mobile-today');
    await click('[data-view="history"]');
    assert.equal(await page.locator('.history-row').count(),2);
    assert.equal(await page.locator('#trend-chart circle').count(),2);
    await screenshot('mobile-trends');
    // Library filter, blank media, safe text, custom entry, favorites.
    await click('[data-view="library"]'); assert.equal(await page.locator('.exercise-card').count(),24);
    await click('[data-category="腿部"]');
    assert.ok(await page.locator('.exercise-card').count()>0);
    await page.locator('#exercise-search').fill('不存在的动作');
    assert.equal(await page.locator('.exercise-card').count(),0);
    await click('[data-action="reset-filters"]');
    await screenshot('mobile-library');
    await click('#new-exercise');
    await page.locator('#exercise-name').fill('测试动作 <img src=x onerror=alert(1)>');
    await page.locator('#exercise-equipment').fill('自重');
    await page.locator('#exercise-category').selectOption('全身');
    await page.locator('#exercise-description').fill('仅测试数据');
    await page.locator('#exercise-form button[type=submit]').click();
    await page.locator('#exercise-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('.exercise-card').count(),25);
    const custom = (await readDB()).exercises.find(e=>e.name.startsWith('测试动作'));
    await click(`[data-favorite="${custom.id}"]`); await click('#favorite-filter');
    assert.equal(await page.locator('.exercise-card').count(),1);
    await click(`[data-exercise="${custom.id}"]`);
    assert.ok(await page.locator('.media-placeholder').isVisible());
    await click('#open-media-fields');
    await page.locator('#exercise-video').fill('javascript:alert(1)');
    await page.locator('#exercise-form button[type=submit]').click();
    await page.locator('#exercise-error').waitFor({state:'visible'});
    await page.locator('#exercise-video').fill('assets/media/example.mp4');
    await page.locator('#exercise-form button[type=submit]').click();
    await page.locator('#exercise-dialog').waitFor({state:'hidden'});
    // Export JSON backup and failed import must preserve persisted data.
    await page.locator('.topbar [data-action=settings]').click();
    const downloadPromise=page.waitForEvent('download');await click('#export-data');const download=await downloadPromise;
    const backupPath=path.join(shots,'backup.json');await download.saveAs(backupPath);
    const backup=JSON.parse(await fs.readFile(backupPath,'utf8'));assert.equal(Object.keys(backup.records).length,2);
    await page.locator('#import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":200}')});
    await page.locator('#import-error').waitFor({state:'visible'});
    assert.equal(Object.keys((await readDB()).records).length,2);
    const changed=structuredClone(backup);changed.records[today].weight=69.25;
    await page.locator('#import-file').setInputFiles({name:'conflict.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changed))});
    await page.locator('#confirm-dialog').waitFor({state:'visible'});await click('#confirm-cancel');
    assert.equal((await readDB()).records[today].weight,68.15);
    await page.locator('#import-file').setInputFiles({name:'conflict.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changed))});
    await page.locator('#confirm-dialog').waitFor({state:'visible'});await click('#confirm-ok');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fitness-tracker:v1')).records[document.querySelector('#record-date').value].weight===69.25);
    await page.locator('#settings-dialog [data-close]').first().click();
    // All main views are free of document horizontal overflow on phones/tablets/desktop.
    await click('#favorite-filter');
    for(const width of [320,375,390,768,1280]) {
      await page.setViewportSize({width,height:844});
      for(const tab of ['today','library','history']) {
        await click(`[data-view="${tab}"]`);
        const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
        assert.ok(size.scroll<=size.client,`${width}px ${tab} horizontal overflow: ${JSON.stringify(size)}`);
      }
    }
    await page.setViewportSize({width:1440,height:1040});await click('[data-view="today"]');await screenshot('desktop-today');
    await click('[data-view="library"]');await screenshot('desktop-library');
    // Cross-tab unrelated record saves must not block or lose a dirty draft.
    await click('[data-view="today"]');await page.locator('[name=weight]').fill('70.05');
    const other = await context.newPage();await other.goto(url);
    await other.locator('[name=gripRight]').fill('47.75');await other.locator('#save-record').click();
    await other.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已保存'));
    assert.equal(await page.locator('[name=weight]').inputValue(),'70.05');
    await click('#save-record');await page.locator('#confirm-dialog').waitFor({state:'visible'});await click('#confirm-cancel');
    assert.equal((await readDB()).records[today].weight,69.25);
    assert.equal(await page.locator('[name=weight]').inputValue(),'70.05');
    await click('#save-record');await page.locator('#confirm-dialog').waitFor({state:'visible'});await click('#confirm-ok');await saved();
    assert.equal((await readDB()).records[today].weight,70.05);
    await other.close();
    // Record deletion has explicit confirmation.
    await click('#delete-record');await click('#confirm-ok');
    await page.waitForFunction(()=>document.querySelector('#record-badge').textContent==='待记录');
    assert.equal((await readDB()).records[today],undefined);
    assert.deepEqual(errors,[]);
    console.log('PASS: mobile save/reload, decimals/zero/optional fields, meals, unsaved navigation, backfill, trends, library CRUD/media safety/favorites, export/import conflict protection, responsive widths 320–1440, cross-tab conflicts, record deletion.');
    console.log('Screenshots: '+shots);
  } finally { await context.close(); await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
