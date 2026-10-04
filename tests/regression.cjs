'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const Data = require('../data.js');
const base = process.env.TEST_URL || 'http://127.0.0.1:8765';

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({timezoneId:'Asia/Hong_Kong',acceptDownloads:true});
  await context.addInitScript(() => {
    const RealDate = Date;
    window.__fitnessNow = RealDate.parse('2026-10-04T04:00:00Z');
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [window.__fitnessNow])); }
      static now() { return window.__fitnessNow; }
    };
  });
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const resumeTomorrow = () => page.evaluate(() => {
    window.__fitnessNow = Date.parse('2026-10-05T04:00:00Z');
    window.dispatchEvent(new Event('pageshow'));
  });
  const wait = () => page.waitForTimeout(80);
  try {
    await page.goto(base);
    assert.equal(await page.locator('#save-record').isDisabled(),true);
    await resumeTomorrow();
    assert.equal(await page.locator('#record-date').inputValue(),'2026-10-05');
    assert.equal(await page.locator('#record-date').getAttribute('max'),'2026-10-05');
    assert.match(await page.locator('#today-title').textContent(),/今日状态/);

    await page.reload();
    await page.locator('[name=weight]').fill('67.35');
    assert.equal(await page.locator('[name=weight]').evaluate(el=>el.checkValidity()),true);
    await resumeTomorrow();
    assert.equal(await page.locator('#record-date').inputValue(),'2026-10-04');
    assert.equal(await page.locator('[name=weight]').inputValue(),'67.35');
    assert.match(await page.locator('#day-alert').textContent(),/仍属于 2026-10-04/);
    await page.locator('#save-record').click();
    await page.waitForFunction(()=>document.querySelector('#save-record').disabled);
    let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(FitnessData.STORAGE_KEY)));
    assert.equal(saved.records['2026-10-04'].weight,67.35);
    assert.equal(saved.records['2026-10-05'],undefined);
    await page.locator('#back-today').click();
    assert.equal(await page.locator('#record-date').inputValue(),'2026-10-05');

    await page.evaluate(()=>localStorage.setItem(FitnessData.STORAGE_KEY,'damaged { original'));
    await page.reload();
    assert.equal(await page.locator('#storage-alert').isVisible(),true);
    await page.locator('.topbar [data-action=settings]').click();
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#export-data').click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/^form-recovery-raw-/);
    const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(),'damaged { original');
    assert.equal(await page.evaluate(()=>localStorage.getItem(FitnessData.STORAGE_KEY)),'damaged { original');
    const backup=Data.createDatabase();
    backup.records['2026-10-04']={...Data.emptyRecord('2026-10-04'),weight:65.25,totalEnergy:1842.7};
    await page.locator('#import-file').setInputFiles({name:'valid-backup.json',mimeType:'application/json',buffer:Buffer.from(Data.exportJSON(backup))});
    await page.locator('#confirm-dialog').waitFor({state:'visible'});
    assert.match(await page.locator('#confirm-title').textContent(),/恢复本地数据/);
    await page.locator('#confirm-ok').click();
    await page.waitForFunction(()=>document.querySelector('#storage-alert').hidden);
    await page.locator('#settings-dialog [data-close=settings-dialog]').last().click();
    assert.equal(await page.locator('[name=weight]').inputValue(),'65.25');
    await page.locator('[name=weight]').fill('65.35');
    assert.equal(await page.locator('#daily-form').evaluate(el=>el.checkValidity()),true);
    await page.locator('#save-record').click();
    await page.waitForFunction(()=>document.querySelector('#save-record').disabled);
    saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(FitnessData.STORAGE_KEY)));
    assert.equal(saved.records['2026-10-04'].weight,65.35);
    assert.equal(saved.records['2026-10-04'].totalEnergy,1842.7);
    assert.deepEqual(errors,[]);
    console.log('PASS: midnight clean advance, dirty draft retention, decimal re-save, raw recovery export, confirmed backup recovery');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
