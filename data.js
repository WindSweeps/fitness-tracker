/*
 * FitnessData — dependency-free local data model (window.FitnessData / CommonJS).
 *
 * createDatabase()                 Fresh version 1 database, including catalog.
 * emptyRecord(date)                All optional measurements null; no fake data.
 * normalizeRecord(record)          Typed, normalized record; throws on bad input.
 * normalizeExercise(exercise)      Typed catalog entry; throws on bad input.
 * validateDatabase(value)          Validated deep copy; throws on bad input.
 * load(storage?)                  { ok, db, error }; db is null on read failure.
 * save(db, storage?)               { ok, error }; validates before writing.
 * exportJSON(db) / importJSON(str)  Versioned JSON backup; import throws on error.
 * mergeDatabases(a,b,options?)     { db, conflicts, applied }; conflicts are
 *                                 { records: [date], exercises: [id] }. Unless
 *                                 replaceConflicts:true, conflicts abort merge.
 * intakeTotal(record)              Manual total, otherwise sum of logged meals;
 *                                 returns null when nothing was logged.
 * hasRecordData(record)            Meaningful data check; zero counts as data.
 * isValidDate(str) / safeMediaURL(str) / localDate(date?)
 *
 * Measurements must be numbers or null. Convert blank form inputs to null.
 * Text is plain text, not HTML: render user strings with textContent (or escape
 * them for HTML). Media URLs are validated separately. This module never fetches
 * media, sends health data, or clears a failed/corrupt localStorage entry.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FitnessData = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const STORAGE_KEY = "fitness-tracker:v1";
  const TRAINING_TYPES = Object.freeze([
    "力量训练", "跑步", "骑行", "游泳", "间歇训练", "步行", "灵活性训练", "其他", "休息"
  ]);
  const CATEGORIES = Object.freeze(["胸部", "背部", "肩部", "腿部", "手臂", "核心", "全身", "灵活性"]);
  const RECORD_KEYS = [
    "date", "weight", "gripLeft", "gripRight", "trainingTypes", "duration",
    "activeEnergy", "totalEnergy", "avgHeartRate", "exertion", "fatigue",
    "intake", "meals", "notes", "updatedAt"
  ];
  const EXERCISE_KEYS = ["id", "name", "category", "equipment", "description", "gif", "video"];
  const NUMBER_RULES = Object.freeze({
    weight: [20, 400], gripLeft: [0, 200], gripRight: [0, 200], duration: [0, 1440],
    activeEnergy: [0, 30000], totalEnergy: [0, 30000], avgHeartRate: [20, 250],
    exertion: [1, 10, true], fatigue: [1, 10, true], intake: [0, 30000]
  });
  const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
  const MAX_RECORDS = 30000;
  const MAX_EXERCISES = 3000;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  class DataValidationError extends Error {
    constructor(message) {
      super(message);
      this.name = "DataValidationError";
    }
  }

  function fail(path, message) {
    throw new DataValidationError(path + "：" + message);
  }

  function plainObject(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(path, "必须是对象");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path, "必须是普通对象");
    return value;
  }

  function keysOnly(value, keys, path) {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(path, "包含未知字段 " + key);
    }
  }

  function stringValue(value, path, max, allowEmpty) {
    if (typeof value !== "string") fail(path, "必须是文字");
    // Keep multiline notes, but remove ambiguity from hidden control characters.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      fail(path, "不能包含控制字符");
    }
    const normalized = value.normalize("NFC").trim();
    if (!allowEmpty && !normalized) fail(path, "不能为空");
    if (normalized.length > max) fail(path, "超过 " + max + " 字符");
    return normalized;
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
  }

  function localDate(value) {
    const date = value === undefined ? new Date() : value;
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail("日期", "无效日期对象");
    const result = String(date.getFullYear()).padStart(4, "0") + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    if (!isValidDate(result)) fail("日期", "必须在 0001–9999 年之间");
    return result;
  }

  function timestamp(value, path) {
    if (typeof value !== "string") fail(path, "必须是有效的 ISO 时间戳");
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/);
    if (!match || !isValidDate(match[1]) || Number(match[2]) > 23 ||
        Number(match[3]) > 59 || Number(match[4]) > 59 ||
        (match[6] !== "Z" && (Number(match[8]) > 14 || Number(match[9]) > 59 ||
          (Number(match[8]) === 14 && Number(match[9]) !== 0)))) {
      fail(path, "必须是有效的 ISO 时间戳");
    }
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) fail(path, "必须是有效的 ISO 时间戳");
    return new Date(milliseconds).toISOString();
  }

  function numeric(value, path, min, max, integer) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "必须是数字或 null");
    if (value < min || value > max) fail(path, "必须在 " + min + "–" + max + " 之间");
    if (integer && !Number.isInteger(value)) fail(path, "必须是整数");
    return Object.is(value, -0) ? 0 : value;
  }

  function uniqueStrings(value, path, allowed) {
    if (!Array.isArray(value)) fail(path, "必须是数组");
    const result = [];
    for (const item of value) {
      if (typeof item !== "string" || (allowed && !allowed.includes(item))) fail(path, "包含无效选项");
      if (result.includes(item)) fail(path, "不能包含重复项");
      result.push(item);
    }
    return result;
  }

  function emptyRecord(date) {
    return normalizeRecord({date: date});
  }

  function normalizeRecord(value, options) {
    const path = "记录";
    plainObject(value, path);
    keysOnly(value, RECORD_KEYS, path);
    if (!isValidDate(value.date)) fail("记录.date", "必须是有效的 YYYY-MM-DD 日期");
    const result = {date: value.date};
    for (const [key, rule] of Object.entries(NUMBER_RULES)) {
      result[key] = numeric(value[key], "记录." + key, rule[0], rule[1], rule[2]);
    }
    result.trainingTypes = uniqueStrings(value.trainingTypes === undefined ? [] : value.trainingTypes,
      "记录.trainingTypes", TRAINING_TYPES);
    if (result.trainingTypes.includes("休息") && result.trainingTypes.length > 1) {
      fail("记录.trainingTypes", "休息不能与训练类型同时选择");
    }
    const meals = value.meals === undefined ? [] : value.meals;
    if (!Array.isArray(meals) || meals.length > 100) fail("记录.meals", "必须是最多 100 项的数组");
    result.meals = meals.map(function (meal, index) {
      const mealPath = "记录.meals[" + index + "]";
      plainObject(meal, mealPath);
      keysOnly(meal, ["name", "kcal"], mealPath);
      const name = stringValue(meal.name, mealPath + ".name", 120, false);
      if (!own(meal, "kcal")) fail(mealPath + ".kcal", "缺少热量");
      const kcal = numeric(meal.kcal, mealPath + ".kcal", 0, 30000);
      if (kcal === null) fail(mealPath + ".kcal", "必须是数字");
      return {name: name, kcal: kcal};
    });
    if (result.meals.reduce((sum, meal) => sum + meal.kcal, 0) > 30000) {
      fail("记录.meals", "全天餐食热量总和不能超过 30000 kcal");
    }
    result.notes = stringValue(value.notes === undefined ? "" : value.notes, "记录.notes", 3000, true);
    if (value.updatedAt === undefined && !(options && options.requireTimestamp)) {
      result.updatedAt = new Date().toISOString();
    } else {
      result.updatedAt = timestamp(value.updatedAt, "记录.updatedAt");
    }
    return result;
  }

  function exerciseId(value, path) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
      fail(path, "必须是 1–64 位字母、数字、短横线或下划线，并以字母或数字开头");
    }
    return value;
  }

  function safeMediaURL(value) {
    const url = stringValue(value, "媒体链接", 2048, true);
    if (!url) return "";
    // Backslashes, controls and protocol-relative links have browser-dependent
    // interpretations. Reject them before URL parsing.
    if (/[\\\s<>"'`]/.test(url) || url.startsWith("//")) fail("媒体链接", "包含不安全的字符或路径");
    if (/^https?:\/\//i.test(url)) {
      let parsed;
      try { parsed = new URL(url); } catch (_) { fail("媒体链接", "无效网址"); }
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
        fail("媒体链接", "只接受不含登录信息的 HTTP / HTTPS 网址");
      }
      return parsed.href;
    }
    // Relative file paths work under a GitHub Pages repository subdirectory.
    // Root-relative paths are allowed; traversals, schemes and encoded path
    // separators are rejected, including encodings nested more than once.
    let decoded = url;
    for (let depth = 0; depth < 5; depth += 1) {
      if (/%(?:2f|5c)/i.test(decoded)) fail("媒体链接", "路径分隔符不能使用编码");
      let next;
      try { next = decodeURIComponent(decoded); } catch (_) { fail("媒体链接", "包含无效编码"); }
      if (next === decoded) break;
      decoded = next;
      if (depth === 4 && /%[0-9a-f]{2}/i.test(decoded)) fail("媒体链接", "包含嵌套编码");
    }
    if (/[\\\s<>"'`:\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//")) {
      fail("媒体链接", "只接受 HTTP / HTTPS 或安全的相对文件路径");
    }
    const path = decoded.split(/[?#]/)[0];
    if (!path || path.split("/").includes("..") || !/\.[a-z0-9]{2,8}$/i.test(path)) {
      fail("媒体链接", "请输入媒体文件路径，例如 assets/media/squat.gif");
    }
    if (!/\.(?:gif|png|jpe?g|webp|avif|apng|mp4|webm|mov|m4v|ogg)$/i.test(path)) {
      fail("媒体链接", "相对路径必须指向图片或视频文件");
    }
    return url;
  }

  function normalizeExercise(value) {
    plainObject(value, "动作");
    keysOnly(value, EXERCISE_KEYS, "动作");
    if (!CATEGORIES.includes(value.category)) fail("动作.category", "无效动作分类");
    return {
      id: exerciseId(value.id, "动作.id"),
      name: stringValue(value.name, "动作.name", 120, false),
      category: value.category,
      equipment: stringValue(value.equipment === undefined ? "" : value.equipment, "动作.equipment", 120, true),
      description: stringValue(value.description === undefined ? "" : value.description, "动作.description", 2000, true),
      gif: safeMediaURL(value.gif === undefined ? "" : value.gif),
      video: safeMediaURL(value.video === undefined ? "" : value.video)
    };
  }

  const catalog = Object.freeze([
    ["bench-press", "杠铃卧推", "胸部", "杠铃 · 卧推凳"],
    ["incline-dumbbell-press", "上斜哑铃卧推", "胸部", "哑铃 · 可调训练凳"],
    ["push-up", "俯卧撑", "胸部", "自重"],
    ["pull-up", "引体向上", "背部", "单杠"],
    ["lat-pulldown", "高位下拉", "背部", "绳索器械"],
    ["seated-row", "坐姿划船", "背部", "绳索器械"],
    ["overhead-press", "站姿推举", "肩部", "杠铃"],
    ["lateral-raise", "哑铃侧平举", "肩部", "哑铃"],
    ["reverse-fly", "反向飞鸟", "肩部", "哑铃"],
    ["back-squat", "杠铃深蹲", "腿部", "杠铃 · 深蹲架"],
    ["romanian-deadlift", "罗马尼亚硬拉", "腿部", "杠铃"],
    ["split-squat", "保加利亚分腿蹲", "腿部", "哑铃 · 训练凳"],
    ["biceps-curl", "哑铃弯举", "手臂", "哑铃"],
    ["triceps-pushdown", "绳索下压", "手臂", "绳索器械"],
    ["hammer-curl", "锤式弯举", "手臂", "哑铃"],
    ["plank", "平板支撑", "核心", "自重 · 瑜伽垫"],
    ["dead-bug", "死虫式", "核心", "瑜伽垫"],
    ["hanging-knee-raise", "悬垂举膝", "核心", "单杠"],
    ["kettlebell-swing", "壶铃摆动", "全身", "壶铃"],
    ["burpee", "波比跳", "全身", "自重"],
    ["farmer-carry", "农夫行走", "全身", "哑铃 / 壶铃"],
    ["hip-flexor-stretch", "髋屈肌拉伸", "灵活性", "瑜伽垫"],
    ["thoracic-rotation", "胸椎旋转", "灵活性", "瑜伽垫"],
    ["ankle-mobility", "踝关节活动", "灵活性", "自重"]
  ].map(function (entry) {
    return Object.freeze({id: entry[0], name: entry[1], category: entry[2], equipment: entry[3], description: "", gif: "", video: ""});
  }));

  function createDatabase() {
    return {version: 1, records: {}, exercises: catalog.map(entry => ({...entry})), favorites: []};
  }

  function validateDatabase(value) {
    plainObject(value, "备份");
    keysOnly(value, ["version", "records", "exercises", "favorites"], "备份");
    if (value.version !== 1) fail("备份.version", "不支持此数据版本");
    for (const key of ["records", "exercises", "favorites"]) {
      if (!own(value, key)) fail("备份", "缺少 " + key + " 字段");
    }
    plainObject(value.records, "备份.records");
    const dates = Object.keys(value.records);
    if (dates.length > MAX_RECORDS) fail("备份.records", "记录数量超过限制");
    const records = {};
    for (const date of dates) {
      if (!isValidDate(date)) fail("备份.records", "包含无效日期 " + date);
      const record = normalizeRecord(value.records[date], {requireTimestamp: true});
      if (record.date !== date) fail("备份.records." + date, "记录日期与索引不一致");
      records[date] = record;
    }
    if (!Array.isArray(value.exercises) || value.exercises.length > MAX_EXERCISES) {
      fail("备份.exercises", "必须是最多 " + MAX_EXERCISES + " 项的数组");
    }
    const ids = new Set();
    const exercises = value.exercises.map(function (entry) {
      const normalized = normalizeExercise(entry);
      if (ids.has(normalized.id)) fail("备份.exercises", "动作 ID 重复：" + normalized.id);
      ids.add(normalized.id);
      return normalized;
    });
    const favorites = uniqueStrings(value.favorites, "备份.favorites");
    for (const id of favorites) {
      exerciseId(id, "备份.favorites");
      if (!ids.has(id)) fail("备份.favorites", "收藏的动作不存在：" + id);
    }
    return {version: 1, records: records, exercises: exercises, favorites: favorites};
  }

  function storageObject(provided) {
    const storage = provided === undefined ? globalThis.localStorage : provided;
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("浏览器本地存储不可用，请检查隐私设置");
    }
    return storage;
  }

  function load(storage) {
    try {
      const raw = storageObject(storage).getItem(STORAGE_KEY);
      return {ok: true, db: raw === null ? createDatabase() : importJSON(raw), error: null};
    } catch (error) {
      return {ok: false, db: null, error: "读取本地数据失败；原数据未更改。" + error.message};
    }
  }

  function save(value, storage) {
    try {
      const serialized = exportJSON(value);
      storageObject(storage).setItem(STORAGE_KEY, serialized);
      return {ok: true, error: null};
    } catch (error) {
      return {ok: false, error: "保存失败，当前改动尚未写入本机。" + error.message};
    }
  }

  function exportJSON(value) {
    return JSON.stringify(validateDatabase(value), null, 2);
  }

  function importJSON(text) {
    if (typeof text !== "string") fail("备份", "必须是 JSON 文字");
    if (text.length > MAX_BACKUP_BYTES) fail("备份", "文件过大（最多约 10 MB）");
    let value;
    try { value = JSON.parse(text); } catch (_) { fail("备份", "JSON 格式无效"); }
    return validateDatabase(value);
  }

  function equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function mergeDatabases(current, incoming, options) {
    const a = validateDatabase(current);
    const b = validateDatabase(incoming);
    if (options !== undefined) {
      plainObject(options, "合并选项");
      keysOnly(options, ["replaceConflicts"], "合并选项");
      if (own(options, "replaceConflicts") && typeof options.replaceConflicts !== "boolean") {
        fail("合并选项.replaceConflicts", "必须是布尔值");
      }
    }
    const conflicts = {records: [], exercises: []};
    for (const date of Object.keys(b.records)) {
      if (own(a.records, date) && !equal(a.records[date], b.records[date])) conflicts.records.push(date);
    }
    const currentExercises = new Map(a.exercises.map(entry => [entry.id, entry]));
    for (const exercise of b.exercises) {
      if (currentExercises.has(exercise.id) && !equal(currentExercises.get(exercise.id), exercise)) {
        conflicts.exercises.push(exercise.id);
      }
    }
    conflicts.records.sort();
    if ((conflicts.records.length || conflicts.exercises.length) && !(options && options.replaceConflicts)) {
      return {db: a, conflicts: conflicts, applied: false};
    }
    for (const exercise of b.exercises) currentExercises.set(exercise.id, exercise);
    const merged = {
      version: 1,
      records: Object.assign({}, a.records, b.records),
      exercises: Array.from(currentExercises.values()),
      favorites: Array.from(new Set(a.favorites.concat(b.favorites)))
    };
    return {db: validateDatabase(merged), conflicts: conflicts, applied: true};
  }

  function intakeTotal(record) {
    const normalized = normalizeRecord(record);
    if (normalized.intake !== null) return normalized.intake;
    return normalized.meals.length ? normalized.meals.reduce((sum, meal) => sum + meal.kcal, 0) : null;
  }

  function hasRecordData(record) {
    const normalized = normalizeRecord(record);
    return Object.keys(NUMBER_RULES).some(key => normalized[key] !== null) ||
      normalized.trainingTypes.length > 0 || normalized.meals.length > 0 || normalized.notes.length > 0;
  }

  return Object.freeze({
    STORAGE_KEY, TRAINING_TYPES, CATEGORIES, catalog, DataValidationError,
    createDatabase, emptyRecord, normalizeRecord, normalizeExercise, validateDatabase,
    load, save, exportJSON, importJSON, mergeDatabases, intakeTotal, hasRecordData,
    isValidDate, localDate, safeMediaURL
  });
});
