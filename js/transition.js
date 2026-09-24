/* ============================================================
 * 深海汤屋 · 转场模块（GSAP 黑幕转场）
 * ------------------------------------------------------------
 * 需求：点任意一道汤 → 黑幕从屏幕两侧合拢（或整屏淡入），
 *       在全黑的一瞬间换内容，再让黑幕拉开，露出新场景。
 *
 * 设计要点：
 *   1) 三个阶段严格分离，绝不「盖黑的同时换内容」——
 *      exit（盖黑，=1）  →  swap（黑幕满屏时切内容）→  enter（拉开，=0）。
 *      以前的实现是「盖黑 → 立刻换 → 淡出」，黑幕与换景同时发生，
 *      加上面板入场动画从 opacity:0 起步，视觉上就是「什么都没发生」。
 *   2) 没有 GSAP（离线 / CDN 被墙）也能跑：自动退回 Web Animations / CSS 过渡。
 *   3) 后台标签页里 GSAP 的 ticker 会被冻结，所以 enter 阶段挂了一层
 *      「兜底定时器」：无论如何都会把黑幕收干净，绝不残留黑屏。
 *   4) 尊重 prefers-reduced-motion：直接瞬切，不做动画。
 *
 * 对外 API（window.SoupTransition）：
 *   SoupTransition.available()          → 'gsap' | 'waapi' | 'css' | 'none'
 *   SoupTransition.play({onSwap, tone}) → Promise，动画全部结束后 resolve
 * ============================================================ */

(function (root) {
  "use strict";

  var doc = root.document;
  if (!doc) return;

  var REDUCE = false;
  try {
    var mq = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)");
    REDUCE = !!(mq && mq.matches);
  } catch (e) { /* 忽略 */ }

  function veil() { return doc.getElementById("scene-fade"); }

  /* 黑幕的三态：透明（默认）· 隐藏 · 满屏不透明 */
  function resetVeil(el) {
    el.classList.remove("on");
    el.style.visibility = "hidden";
    el.style.opacity = "0";
  }

  function showVeil(el) {
    el.classList.add("on");
    el.style.visibility = "visible";
  }

  /* 兜底收幕：无论动画有没有跑完，都保证黑幕回透明 */
  var guardTimer = null;
  function armGuard(el, ms) {
    clearTimeout(guardTimer);
    guardTimer = setTimeout(function () { resetVeil(el); }, ms);
  }
  function disarmGuard() {
    clearTimeout(guardTimer);
    guardTimer = null;
  }

  function hasGsap() {
    return !!(root.gsap && typeof root.gsap.to === "function" && typeof root.gsap.timeline === "function");
  }

  function available() {
    if (hasGsap()) return "gsap";
    if (typeof root.Element !== "undefined" && Element.prototype && Element.prototype.animate) return "waapi";
    return doc.documentElement.style ? "css" : "none";
  }

  /* ---------------- 三条实现路径：统一签名 play({onSwap, tone}) ---------------- */

  /* 路径 A：GSAP 时间线（首选）—— exit 盖黑 → swap 换景 → enter 拉开 */
  function playGsap(el, opt) {
    return new Promise(function (resolve) {
      resetVeil(el);
      showVeil(el);
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        disarmGuard();
        resolve();
      };
      var tl = root.gsap.timeline({
        defaults: { ease: "power2.inOut" },
        onComplete: function () {
          /* 收尾必须显式清零：GSAP 会把内联样式留在元素上 */
          root.gsap.set(el, { opacity: 0 });
          el.style.visibility = "hidden";
          el.classList.remove("on");
          finish();
        }
      });
      tl.to(el, {
        opacity: 1,
        duration: 0.22,
        ease: "power2.in",
        onComplete: function () {
          /* 黑幕已经满屏：这一帧才换内容，换完的内容被黑幕完整遮住 */
          if (opt.onSwap) opt.onSwap();
        }
      })
        .to(el, { opacity: 1, duration: 0.07 })          /* 全黑定格，给换景留一瞬 */
        .to(el, { opacity: 0, duration: 0.28, ease: "power2.out" });

      /* 后台标签页会冻结 GSAP ticker：兜底定时器保证一定收幕 + resolve */
      armGuard(el, 1100);
      setTimeout(function () {
        if (done) return;
        disarmGuard();
        resetVeil(el);
        finish();
      }, 950);
    });
  }

  /* 路径 B：Web Animations API（没有 GSAP 时的等价实现） */
  function playWaapi(el, opt) {
    return new Promise(function (resolve) {
      resetVeil(el);
      showVeil(el);
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        disarmGuard();
        resetVeil(el);
        resolve();
      };
      var anim = el.animate(
        [{ opacity: 0 }, { opacity: 1, offset: 0.40 }, { opacity: 1, offset: 0.52 }, { opacity: 0 }],
        { duration: 600, easing: "ease-in-out" }
      );
      /* 黑幕满屏的那一瞬换内容：offset 0.40 → 40% × 600ms ≈ 240ms */
      setTimeout(function () { if (opt.onSwap) opt.onSwap(); }, 240);
      armGuard(el, 1000);
      anim.onfinish = finish;
      anim.oncancel = finish;
    });
  }

  /* 路径 C：CSS 过渡兜底（最老的环境） */
  function playCss(el, opt) {
    return new Promise(function (resolve) {
      resetVeil(el);
      showVeil(el);
      el.style.transition = "opacity .34s ease-in";
      void el.offsetWidth;
      el.style.opacity = "1";
      setTimeout(function () {
        if (opt.onSwap) opt.onSwap();
        el.style.transition = "opacity .42s ease-out";
        el.style.opacity = "0";
        armGuard(el, 1000);
        setTimeout(function () { resetVeil(el); resolve(); }, 460);
      }, 380);
    });
  }

  /* ---------------- 统一入口 ---------------- */

  var busy = false;

  function play(opt) {
    var o = opt || {};
    var el = veil();
    /* 没有遮罩元素 / 用户要求减少动效 / 上一次还没收完：直接换内容 */
    if (!el || REDUCE || busy) {
      if (o.onSwap) o.onSwap();
      return Promise.resolve();
    }
    busy = true;
    var mode = available();
    var p = mode === "gsap" ? playGsap(el, o)
      : mode === "waapi" ? playWaapi(el, o)
        : playCss(el, o);
    return p.then(
      function () { busy = false; },
      function () { busy = false; resetVeil(el); }
    );
  }

  root.SoupTransition = {
    available: available,
    reduced: REDUCE,
    play: play,
    /* 兜底：进汤 / 切屏都先收一次幕，避免上一次异常残留黑屏 */
    clear: function () {
      var el = veil();
      if (el) resetVeil(el);
      disarmGuard();
      busy = false;
    }
  };
})(typeof window !== "undefined" ? window : this);
