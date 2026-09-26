/* ============================================================
 * 深海汤屋 · 图标库（2026-09-26：全面去 emoji 化）
 * ------------------------------------------------------------
 * 真人做的项目不会往界面里贴 emoji，这里把全部图形换成同一套
 * 手绘线性 SVG：24×24 视框、圆头描边、stroke=currentColor，
 * 尺寸由外层字号控制（.ic 默认 1em），颜色自动跟随文字/主题。
 *
 * 用法：
 *   window.SoupIcon(name)            → '<span class="ic"…><svg…></span>'
 *   window.SoupIcon.raw(name)        → 裸 <svg> 字符串（自带样式的场合用）
 *   window.SoupIcon.svg              → 图标表（favicon 等静态构建也读它）
 * ============================================================ */
(function (root) {
  "use strict";

  /* 统一外壳：viewBox 24，圆头描边；个别图标自带 fill */
  function s(inner, extra) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extra || "") + ">" + inner + "</svg>";
  }

  var SVG = {
    /* 汤锅：锅身 + 双耳 + 三缕热气 */
    pot: s('<path d="M4.5 10.5h15"/><path d="M6 10.5v5.2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-5.2"/><path d="M4.5 10.5H3m18 0h-1.5"/><path d="M9.2 7.3c-.6-1 .6-1.7 0-2.7M12 7.3c-.6-1 .6-1.7 0-2.7M14.8 7.3c-.6-1 .6-1.7 0-2.7"/>'),

    /* 随机骰子 */
    dice: s('<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.8" cy="8.8" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.2" cy="15.2" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.2" cy="8.8" r="1.15" fill="currentColor" stroke="none"/><circle cx="8.8" cy="15.2" r="1.15" fill="currentColor" stroke="none"/>'),

    /* 汤库：三本书 */
    books: s('<path d="M5 5.5h3.8v14H5z"/><path d="M9.8 5.5h3.7v14H9.8z"/><path d="M14.6 6.7l3.7.8-2.9 12.6-3.7-.8"/>'),

    /* 多人汤屋：房子 */
    house: s('<path d="M4.5 11.2 12 4.6l7.5 6.6"/><path d="M6.4 10v8.9a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1V10"/><path d="M10.2 20v-4.7a1.8 1.8 0 0 1 3.6 0V20"/>'),

    /* AI 汤主：方脑袋 + 天线 + 眼睛 */
    robot: s('<rect x="5" y="8" width="14" height="10.8" rx="2.8"/><path d="M12 8V5.2"/><circle cx="12" cy="3.9" r="1.2" fill="currentColor" stroke="none"/><circle cx="9.2" cy="13.3" r="1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.3" r="1" fill="currentColor" stroke="none"/><path d="M10 16.4h4"/>'),

    /* 音乐：双符头八分音符 */
    music: s('<path d="M9.2 17V5.8l8.8-1.9V15"/><ellipse cx="6.9" cy="17.2" rx="2.3" ry="1.9"/><ellipse cx="15.7" cy="15.2" rx="2.3" ry="1.9"/>'),

    play: s('<path d="M8 5.2v13.6L19 12z"/>'),
    pause: s('<path d="M9 5.2v13.6M15 5.2v13.6"/>'),

    /* 音效：喇叭 + 声波 / 静音：喇叭 + 叉 */
    volume: s('<path d="M4 9.2v5.6h3.5L12.5 19V5L7.5 9.2z"/><path d="M15.5 9.3a4.4 4.4 0 0 1 0 5.4M18 6.8a8 8 0 0 1 0 10.4"/>'),
    mute: s('<path d="M4 9.2v5.6h3.5L12.5 19V5L7.5 9.2z"/><path d="m16 9.8 5 4.4M21 9.8l-5 4.4"/>'),

    /* 氛围特效：大星 + 小星（替代 ✨） */
    spark: s('<path d="M12 3.4 13.7 9l5.6 1.7-5.6 1.7L12 18l-1.7-5.6L4.7 10.7 10.3 9z"/><path d="m18.7 3.5.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"/>'),

    /* 装饰四角星（替代 ✦，自带 fill） */
    spark4: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.9 5.5 4.5 9.1 10 10-5.5.9-9.1 4.5-10 10-.9-5.5-4.5-9.1-10-10 5.5-.9 9.1-4.5 10-10z"/></svg>',

    /* 沙漏（替代 ⏳）：下泡自带一点沙 */
    hourglass: s('<path d="M6.8 3.6h10.4M6.8 20.4h10.4"/><path d="M7.8 3.6v3c0 2.2 4.2 4 4.2 5.4s-4.2 3.2-4.2 5.4v3M16.2 3.6v3c0 2.2-4.2 4-4.2 5.4s4.2 3.2 4.2 5.4v3"/><path d="M9.6 17.6c.4-1.2 4.4-1.2 4.8 0" fill="currentColor" stroke="none"/>'),

    /* 问答记录：带挂夹的清单板 */
    clipboard: s('<rect x="5.4" y="4.6" width="13.2" height="16" rx="2.2"/><path d="M9.4 4.6v-1a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6v1" transform="translate(0 1)"/><path d="M8.9 10h6.2M8.9 13h6.2M8.9 16h4"/>'),

    /* 猜底手账：唇形 + 竖指（替代 🤫，安静保密的意思） */
    secret: s('<path d="M4.8 12c2.2-2.5 12.2-2.5 14.4 0-2.2 2.5-12.2 2.5-14.4 0z"/><path d="M12 10.6c-.7.5-2.5 1.5-4 1.3M12 13.4c1.5.3 3-.6 3.8-1.3"/><path d="M8.4 4.6v2.6"/>'),

    /* 备忘录 / 手账：侧线圈本 + 书签 */
    notebook: s('<rect x="6.2" y="3.6" width="13" height="16.8" rx="2"/><path d="M9.6 3.6v16.8"/><path d="M12.4 3.6h4.2v5l-2.1-1.3-2.1 1.3z"/>'),

    /* 房间聊天：对白泡 + 三点 */
    chat: s('<path d="M4.5 11.6a6.8 6.8 0 0 1 6.9-6.7h1.2a6.8 6.8 0 0 1 6.9 6.7 6.5 6.5 0 0 1-4 6l2.3 3-4.2-1.6a9.6 9.6 0 0 1-4.7.4A6.7 6.7 0 0 1 4.5 12.7z"/><circle cx="9" cy="11.5" r=".95" fill="currentColor" stroke="none"/><circle cx="12.6" cy="11.5" r=".95" fill="currentColor" stroke="none"/><circle cx="16.2" cy="11.5" r=".95" fill="currentColor" stroke="none"/>'),

    /* 奖杯（替代 🏆） */
    trophy: s('<path d="M7.6 4h8.8v5.1a4.4 4.4 0 0 1-8.8 0z"/><path d="M7.6 5.3H5.3a2.6 2.6 0 0 0 2.7 4.1M16.4 5.3h2.3a2.6 2.6 0 0 1-2.7 4.1"/><path d="M12 13.6V17M8.7 20.3h6.6M10.1 17h3.8l.9 3.3H9.2z"/>'),

    /* 举手准备（替代 🙋）：小人 + 高举的手 */
    hand: s('<circle cx="12.6" cy="6" r="2.4"/><path d="M9 20.4v-3.8a3.6 3.6 0 0 1 3.6-3.6 3.6 3.6 0 0 1 3.6 3.6v3.8"/><path d="M6.9 12V5.5"/><circle cx="6.9" cy="4.2" r="1.3" fill="currentColor" stroke="none"/>'),

    /* 眼睛（替代 👀） */
    eye: s('<path d="M2.8 12s3.9-5.5 9.2-5.5S21.2 12 21.2 12s-3.9 5.5-9.2 5.5S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.5"/>'),

    /* 白旗（替代 🏳️） */
    flag: s('<path d="M6 20.4V3.6"/><path d="M6 4.6c3.6-1.8 7 1.9 12.2.3v8.6c-5.2 1.6-8.6-2.1-12.2-.3z"/>'),

    /* 彩带球（替代 🎊） */
    party: s('<circle cx="12" cy="14.6" r="5.3"/><path d="m11 9.7 2.3-5.8 3 6.9"/><path d="M5.4 5.2 7 7M3.3 9.6h2M18.9 5.6l-1.6 1.7"/>'),

    /* 礼炮（替代 🎉） */
    popper: s('<path d="M5.2 18.8 8.3 12l3.7 3.7-6.8 3.1z"/><path d="m11 10.5 2.8-2.8m-4.6 6.5-2.1 2.1"/><path d="M15.2 3.4v3M19.8 5.8l-2 2M20.6 10.6h-3"/>'),

    /* 报喜铃（替代 ✨ 双铃位）：铃铛 + 喜星 */
    bell: s('<path d="M7.7 15.6V11a4.3 4.3 0 0 1 8.6 0v4.6l1.4 1.9H6.3z"/><path d="M10.5 19.8a1.7 1.7 0 0 0 3 0"/><path d="m18.8 3.2.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>'),

    /* 奖牌：圆牌 + 绶带 + 名次数字（名次牌用 medalFor(1|2|3)，其余名次回退星形牌） */
    medal: s('<circle cx="12" cy="9.6" r="5.3"/><path d="m9 14-2.6 6 5.6-2.9 5.6 2.9L15 14"/><path d="m12 6.9.85 1.7 1.9.3-1.35 1.35.3 1.9-1.7-.9-1.7.9.3-1.9L9.15 8.9l1.9-.3z"/>'),

    /* 汤碗（替代未说破的 🥣） */
    bowl: s('<path d="M3.6 11.4h16.8a8.4 8.4 0 0 1-8.4 8.2 8.4 8.4 0 0 1-8.4-8.2z"/><path d="M2.4 11.4h19.2" stroke-width="1.4"/><path d="M8.6 8.3c-.5-.8.5-1.4 0-2.2M12 8.3c-.5-.8.5-1.4 0-2.2M15.4 8.3c-.5-.8.5-1.4 0-2.2"/>'),

    /* 钥匙（替代 🔑） */
    key: s('<circle cx="8.2" cy="8" r="3.7"/><path d="m10.9 10.7 8 8"/><path d="m14.8 16.4 1.8-1.8M17.6 19.2l1.8-1.8"/>'),

    /* 赞同 / 反对（替代 👍👎） */
    thumbUp: s('<path d="M7 10.8v8.6H4.4v-8.6z"/><path d="M7 10.8 9.8 4a2.2 2.2 0 0 1 2.1 2.9L11.2 9.7h5.4a2 2 0 0 1 2 2.5l-1.4 5.3a2 2 0 0 1-2 1.9H7"/>'),
    thumbDown: s('<path d="M17 13.2V4.6h2.6v8.6z"/><path d="M17 13.2 14.2 20a2.2 2.2 0 0 1-2.1-2.9l.7-2.8H7.4a2 2 0 0 1-2-2.5l1.4-5.3a2 2 0 0 1 2-1.9H17"/>'),

    /* 对勾 / 叉（状态用，比文字 ✓✗ 更统一） */
    check: s('<path d="m5 12.6 4.6 4.6L19 7.4"/>'),
    cross: s('<path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8"/>'),

    /* 判定圆点（替代 🔴🟡🟢⚪）：同色系描边 + 实心 */
    dotG: s('<circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8" stroke-width="1.3" opacity=".5"/>'),
    dotY: s('<circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8" stroke-width="1.3" opacity=".5"/>'),
    dotR: s('<circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8" stroke-width="1.3" opacity=".5"/>'),
    dotW: s('<circle cx="12" cy="12" r="4.6" stroke-width="1.6"/><circle cx="12" cy="12" r="8" stroke-width="1.2" opacity=".45"/>')
  };

  /* 名次奖牌：1/2/3 名用带数字的圆牌（数字直接画进 SVG），其余用星形奖牌 */
  function medalFor(rank) {
    if (rank >= 1 && rank <= 3) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.7" stroke-linecap="round" aria-hidden="true">' +
        '<path d="m8.8 13.4-2.7 6.8 5.9-3 5.9 3-2.7-6.8"/>' +
        '<circle cx="12" cy="9.3" r="5.6"/>' +
        '<text x="12" y="11.7" text-anchor="middle" font-size="6.6" font-weight="700" ' +
        'fill="currentColor" stroke="none" font-family="inherit">' + rank + "</text></svg>";
    }
    return SVG.medal;
  }

  function raw(name) {
    var m = /^(medal)([123])$/.exec(name || "");
    if (m) return medalFor(Number(m[2]));
    return SVG[name] || "";
  }

  function icon(name, cls) {
    var svg = raw(name);
    if (!svg) return "";
    return '<span class="ic' + (cls ? " " + cls : "") + '" aria-hidden="true">' + svg + "</span>";
  }

  root.SoupIcon = icon;
  root.SoupIcon.raw = raw;
  root.SoupIcon.svg = SVG;

  /* Node 侧（favicon / 静态构建脚本）也复用同一份图标表 */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SVG: SVG, icon: icon, raw: raw, medalFor: medalFor };
  }
})(typeof window !== "undefined" ? window : this);
