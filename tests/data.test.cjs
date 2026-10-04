"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Data = require("../data.js");

function example() {
  const db = Data.createDatabase();
  db.records["2026-10-04"] = {...Data.emptyRecord("2026-10-04"), updatedAt: "2026-10-04T08:00:00.000Z"};
  return db;
}

function expectInvalid(mutate, pattern) {
  const db = example();
  mutate(db);
  assert.throws(() => Data.importJSON(JSON.stringify(db)), pattern || Data.DataValidationError);
}

test("catalog has 24 unique editable placeholders in every category", () => {
  assert.equal(Data.catalog.length, 24);
  assert.equal(new Set(Data.catalog.map(item => item.id)).size, 24);
  assert.deepEqual(new Set(Data.catalog.map(item => item.category)), new Set(Data.CATEGORIES));
  assert.ok(Data.catalog.every(item => item.gif === "" && item.video === ""));
  const a = Data.createDatabase();
  a.exercises[0].name = "My action";
  assert.notEqual(Data.createDatabase().exercises[0].name, "My action");
});

test("calendar dates reject impossible days and respect leap centuries", () => {
  for (const date of ["2024-02-29", "2000-02-29", "2026-10-04", "0001-01-01"]) {
    assert.equal(Data.isValidDate(date), true, date);
  }
  for (const date of ["2025-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "0000-01-01", "2026-10-04T00:00:00Z", null]) {
    assert.equal(Data.isValidDate(date), false, String(date));
  }
  expectInvalid(db => { db.records["2026-02-30"] = db.records["2026-10-04"]; });
  expectInvalid(db => { db.records["2026-10-04"].date = "2026-10-05"; }, /日期与索引不一致/);
});

test("missing values stay null while valid zeros remain recorded", () => {
  const empty = Data.emptyRecord("2026-10-04");
  assert.equal(empty.weight, null);
  assert.equal(empty.activeEnergy, null);
  assert.equal(Data.intakeTotal(empty), null);
  assert.equal(Data.hasRecordData(empty), false);
  const zero = Data.normalizeRecord({...empty, gripLeft: 0, duration: 0, activeEnergy: 0, intake: 0});
  assert.equal(zero.gripLeft, 0);
  assert.equal(zero.activeEnergy, 0);
  assert.equal(Data.intakeTotal(zero), 0);
  assert.equal(Data.hasRecordData(zero), true);
  assert.throws(() => Data.normalizeRecord({...empty, activeEnergy: "0"}), /数字或 null/);
  assert.throws(() => Data.normalizeRecord({...empty, weight: ""}), /数字或 null/);
});

test("meal estimates never double-count an explicitly entered daily intake", () => {
  const record = {...Data.emptyRecord("2026-10-04"), meals: [{name: "早餐", kcal: 420}, {name: "午餐", kcal: 680}]};
  assert.equal(Data.intakeTotal(record), 1100);
  assert.equal(Data.intakeTotal({...record, intake: 1800}), 1800);
  assert.equal(Data.intakeTotal({...record, intake: 0}), 0);
  assert.equal(Data.intakeTotal({...record, meals: [{name: "无糖茶", kcal: 0}]}), 0);
  assert.throws(() => Data.normalizeRecord({...record, meals: [{name: "早餐", kcal: null}]}), /必须是数字/);
  assert.throws(() => Data.normalizeRecord({...record, meals: [{name: "早餐", kcal: 20000}, {name: "晚餐", kcal: 20000}]}), /总和/);
});

test("imports reject unexpected schema, wrong types, and invalid numeric values", () => {
  expectInvalid(db => { db.version = 2; }, /版本/);
  expectInvalid(db => { db.version = "1"; }, /版本/);
  expectInvalid(db => { db.other = true; }, /未知字段/);
  expectInvalid(db => { delete db.favorites; }, /缺少/);
  expectInvalid(db => { db.records = []; }, /必须是对象/);
  expectInvalid(db => { db.exercises = {}; }, /必须是最多/);
  expectInvalid(db => { db.records["2026-10-04"].weight = 19; });
  expectInvalid(db => { db.records["2026-10-04"].weight = 401; });
  expectInvalid(db => { db.records["2026-10-04"].activeEnergy = -1; });
  expectInvalid(db => { db.records["2026-10-04"].exertion = 4.5; }, /整数/);
  expectInvalid(db => { db.records["2026-10-04"].fatigue = 0; });
  expectInvalid(db => { db.records["2026-10-04"].duration = true; });
  expectInvalid(db => { db.records["2026-10-04"].notes = {html: "test"}; });
  expectInvalid(db => { db.records["2026-10-04"].calories = 10; }, /未知字段/);
  expectInvalid(db => { db.records["2026-10-04"].trainingTypes = ["unknown"]; });
  expectInvalid(db => { db.records["2026-10-04"].trainingTypes = ["力量训练", "力量训练"]; }, /重复/);
  expectInvalid(db => { db.records["2026-10-04"].trainingTypes = ["休息", "跑步"]; }, /同时选择/);
  assert.throws(() => Data.importJSON("{bad json}"), /JSON 格式无效/);
  assert.throws(() => Data.importJSON("null"), /必须是对象/);
  assert.throws(() => Data.importJSON("{\"version\":1,\"records\":{},\"exercises\":[],\"favorites\":[],\"__proto__\":{}}"), /未知字段/);
  assert.throws(() => Data.normalizeRecord({...Data.emptyRecord("2026-10-04"), duration: Infinity}), /数字或 null/);
  assert.throws(() => Data.normalizeRecord({...Data.emptyRecord("2026-10-04"), duration: NaN}), /数字或 null/);
});

test("timestamps must be explicit valid instants when importing", () => {
  expectInvalid(db => { delete db.records["2026-10-04"].updatedAt; }, /时间戳/);
  for (const stamp of ["yesterday", "2026-02-30T00:00:00Z", "2026-10-04T24:00:00Z", "2026-10-04", "2026-10-04T12:00:00+14:30"]) {
    expectInvalid(db => { db.records["2026-10-04"].updatedAt = stamp; }, /时间戳/);
  }
  const db = example();
  db.records["2026-10-04"].updatedAt = "2026-10-04T16:00:00+08:00";
  assert.equal(Data.validateDatabase(db).records["2026-10-04"].updatedAt, "2026-10-04T08:00:00.000Z");
});

test("exercise ids and favorites stay unique and refer to actual entries", () => {
  expectInvalid(db => { db.exercises.push({...db.exercises[0]}); }, /ID 重复/);
  expectInvalid(db => { db.exercises[0].id = "<script>"; });
  expectInvalid(db => { db.exercises[0].category = "invalid"; });
  expectInvalid(db => { db.favorites = [db.exercises[0].id, db.exercises[0].id]; }, /重复/);
  expectInvalid(db => { db.favorites = ["does-not-exist"]; }, /不存在/);
});

test("media accepts safe local assets and HTTP(S), blocks executable schemes and traversal", () => {
  for (const url of ["", "assets/media/squat.gif", "./assets/推举.mp4", "/media/move.webm", "https://example.com/video.mp4?ref=fitness", "http://localhost:8000/demo.gif"]) {
    assert.equal(typeof Data.safeMediaURL(url), "string", url);
  }
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "file:///tmp/x.mp4", "//evil.test/x.gif", "\\evil.test\\x.gif", "../private.gif", "assets/../private.gif", "assets/%2e%2e/private.gif", "assets/%252e%252e/private.gif", "https://user:password@example.com/a.gif", "assets/bad.svg", "https://example.com/\nfoo.gif", "assets/no-extension", "assets/evil%00.gif", "assets/%2f%2fevil.gif"]) {
    assert.throws(() => Data.safeMediaURL(url), Data.DataValidationError, url);
  }
  expectInvalid(db => { db.exercises[0].video = "javascript:alert(1)"; });
});

test("backup round-trip preserves plain text without executing it", () => {
  const db = example();
  db.records["2026-10-04"].notes = "今天精神不错\n<img src=x onerror=alert(1)>";
  db.records["2026-10-04"].weight = 67.4;
  const restored = Data.importJSON(Data.exportJSON(db));
  assert.deepEqual(restored, Data.validateDatabase(db));
  assert.match(restored.records["2026-10-04"].notes, /<img/);
  restored.exercises[0].name = "Changed";
  assert.notEqual(db.exercises[0].name, "Changed");
});

test("merge aborts atomically on record or exercise conflicts until explicitly replaced", () => {
  const current = example();
  current.records["2026-10-04"].weight = 70;
  const incoming = example();
  incoming.records["2026-10-04"].weight = 71;
  incoming.records["2026-10-05"] = Data.emptyRecord("2026-10-05");
  incoming.exercises[0].gif = "assets/media/bench.gif";
  incoming.favorites = [incoming.exercises[0].id];
  const blocked = Data.mergeDatabases(current, incoming);
  assert.equal(blocked.applied, false);
  assert.deepEqual(blocked.conflicts.records, ["2026-10-04"]);
  assert.deepEqual(blocked.conflicts.exercises, [current.exercises[0].id]);
  assert.equal(blocked.db.records["2026-10-04"].weight, 70);
  assert.equal(blocked.db.records["2026-10-05"], undefined);
  assert.equal(blocked.db.favorites.length, 0);
  const applied = Data.mergeDatabases(current, incoming, {replaceConflicts: true});
  assert.equal(applied.applied, true);
  assert.equal(applied.db.records["2026-10-04"].weight, 71);
  assert.ok(applied.db.records["2026-10-05"]);
  assert.equal(applied.db.exercises[0].gif, "assets/media/bench.gif");
  assert.deepEqual(applied.db.favorites, incoming.favorites);
  assert.equal(current.records["2026-10-04"].weight, 70, "input was not mutated");
  assert.equal(Data.mergeDatabases(current, current).applied, true, "identical data is not a conflict");
  assert.throws(() => Data.mergeDatabases(current, incoming, {replaceConflicts: "yes"}), /布尔值/);
});

test("conflict-free merge retains both databases' unique records and favorites", () => {
  const current = example();
  current.favorites = [current.exercises[0].id];
  const incoming = Data.createDatabase();
  incoming.records["2026-10-03"] = Data.emptyRecord("2026-10-03");
  incoming.favorites = [incoming.exercises[1].id];
  const result = Data.mergeDatabases(current, incoming);
  assert.equal(result.applied, true);
  assert.deepEqual(Object.keys(result.db.records).sort(), ["2026-10-03", "2026-10-04"]);
  assert.equal(result.db.favorites.length, 2);
});

test("localStorage failures are explicit and corrupt data is never silently replaced", () => {
  let saved = null;
  let writes = 0;
  const storage = {getItem: () => saved, setItem: (_key, value) => { writes += 1; saved = value; }};
  assert.equal(Data.load(storage).ok, true);
  assert.equal(writes, 0);
  assert.equal(Data.save(example(), storage).ok, true);
  assert.equal(writes, 1);
  assert.equal(Data.load(storage).db.records["2026-10-04"].date, "2026-10-04");
  saved = "corrupt";
  const failed = Data.load(storage);
  assert.equal(failed.ok, false);
  assert.equal(failed.db, null);
  assert.match(failed.error, /原数据未更改/);
  assert.equal(saved, "corrupt");
  assert.equal(writes, 1);
  assert.equal(Data.save({version: 2}, storage).ok, false);
  assert.equal(writes, 1);
  const quotaStorage = {getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }};
  assert.match(Data.save(example(), quotaStorage).error, /QuotaExceededError/);
  assert.equal(Data.load(null).ok, false);
});
