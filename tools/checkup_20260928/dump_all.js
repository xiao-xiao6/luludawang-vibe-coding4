// 2026-09-28 全库体检：把 100 精品 + 1480 汤库 归一化成一份 all.json
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');

const vm = require('vm');
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/data-more.js'), 'utf8'));
const curated = globalThis.PUZZLES;

const s = fs.readFileSync(path.join(root, 'data/library/library.data.js'), 'utf8');
vm.runInThisContext(s);
const lib = globalThis.SOUP_LIBRARY;

const out = [];
for (const o of curated) {
  out.push({
    tier: 'curated', id: o.id, title: o.title, dispTitle: o.title,
    surface: o.surface, truth: o.truth, cats: o.cats || [o.tag].filter(Boolean),
    src: 'handcrafted', srcNo: null, srcUrl: '', lang: 'zh', mode: 'truth',
    quality: 'curated', truthSource: 'original', rawTags: [],
  });
}
for (const o of lib) {
  out.push({
    tier: 'library', id: o.id, title: o.title, dispTitle: o.dispTitle,
    surface: o.surface, truth: o.truth, cats: o.cats || [],
    src: o.src, srcNo: o.srcNo, srcUrl: o.srcUrl, lang: o.lang, mode: o.mode,
    quality: o.quality, truthSource: o.truthSource, rawTags: o.rawTags || [],
    alsoIn: o.alsoIn, hasTruth: o.hasTruth,
  });
}
fs.writeFileSync(path.join(__dirname, 'all.json'), JSON.stringify(out));
const by = {};
for (const o of out) by[o.tier] = (by[o.tier] || 0) + 1;
console.log('total', out.length, by);
