/**
 * concentricity-probe.js - the BROWSER half of the corner-concentricity check.
 *
 * `scripts/concentricity.mjs` reads the stylesheet and can only assert that the
 * MECHANISM holds. This file is the instrument that actually MEASURES: it reads
 * every rounded element's laid-out box and its nearest rounded ancestor's box,
 * and checks the rule per corner.
 *
 *     r_inner = r_outer - gap        ONLY WHEN gap < r_outer
 *
 * A corner is judged only when BOTH insets at that corner are smaller than the
 * parent's radius there - that is exactly when the two arcs share corner space.
 * Outside it the formula is degenerate rather than demanding, and applying it
 * anyway is what turned 10 real findings into 17 next door in getforgenta.
 * The counts below are printed so that "0 violations" can be told apart from
 * "0 corners were looked at", which is the failure this whole family invites.
 *
 * HOW TO RUN IT. Paste this file into the DevTools console on a page of the
 * site, then:
 *     conc()                                  // this page
 *     await concSweep(['/', '/tools/'])       // several, via hidden iframes
 * Keep each sweep to two or three paths: a longer one has exceeded the DevTools
 * evaluation timeout on this machine.
 *
 * WHAT IT DOES NOT CATCH: wrong colours, wrong spacing, wrong copy, any corner
 * whose parent is not itself rounded, and anything inside a cross-origin frame.
 *
 * MEASURED BASELINE, 2026-09-14, treforged.com, 12 pages:
 *     110 nested rounded pairs, 440 corners, 0 judged, 0 violations.
 * Every corner was degenerate - no rounded child's corner reaches its parent's
 * curve anywhere on this site, because every padded container's padding exceeds
 * its own radius. Proven able to go red on /services/ by widening .block and
 * .app-block to a 60px radius against their real 37/41/45px insets: 6 corners
 * judged, 6 violations, correct arithmetic (60 - 41 = 19 wanted against 8 set),
 * and back to 0/0 when the mutation was removed.
 */
(function () {
  const px = (v) => parseFloat(v) || 0;
  const CORNERS = [
    ['TopLeft', 'borderTopLeftRadius'],
    ['TopRight', 'borderTopRightRadius'],
    ['BottomLeft', 'borderBottomLeftRadius'],
    ['BottomRight', 'borderBottomRightRadius'],
  ];

  function name(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList.length) s += '.' + [...el.classList].slice(0, 3).join('.');
    return s;
  }

  function measure(doc, win) {
    const findings = [];
    let pairs = 0, judged = 0, degenerate = 0;

    for (const el of doc.querySelectorAll('*')) {
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      if (!CORNERS.some(([, k]) => px(cs[k]) > 0)) continue;

      let p = el.parentElement, ps = null;
      while (p && p.tagName) {
        const t = win.getComputedStyle(p);
        if (CORNERS.some(([, k]) => px(t[k]) > 0)) { ps = t; break; }
        p = p.parentElement;
      }
      if (!ps) continue;

      const pb = p.getBoundingClientRect();
      pairs++;
      const insets = {
        TopLeft: [box.left - pb.left, box.top - pb.top],
        TopRight: [pb.right - box.right, box.top - pb.top],
        BottomLeft: [box.left - pb.left, pb.bottom - box.bottom],
        BottomRight: [pb.right - box.right, pb.bottom - box.bottom],
      };

      for (const [corner, key] of CORNERS) {
        const outer = px(ps[key]), inner = px(cs[key]);
        const [x, y] = insets[corner];
        if (x < -0.5 || y < -0.5) continue;
        if (!(x < outer - 0.01 && y < outer - 0.01)) { degenerate++; continue; }
        judged++;
        const base = { corner, child: name(el), parent: name(p), r_outer: +outer.toFixed(2), r_inner: +inner.toFixed(2) };
        if (Math.abs(x - y) > 1) {
          findings.push({ ...base, inset_x: +x.toFixed(2), inset_y: +y.toFixed(2),
            why: 'the insets differ inside the corner arc, so the arcs cannot share a centre' });
          continue;
        }
        const want = Math.max(0, outer - x);
        if (Math.abs(inner - want) > 1) {
          findings.push({ ...base, gap: +x.toFixed(2), want: +want.toFixed(2), off: +(inner - want).toFixed(2) });
        }
      }
    }

    const seen = new Set(), unique = [];
    for (const f of findings) {
      const k = [f.parent, f.child, f.corner, f.r_inner, f.gap ?? f.inset_x, f.r_outer].join('|');
      if (!seen.has(k)) { seen.add(k); unique.push(f); }
    }
    return { pairs, judged, degenerate, violations: unique.length, findings: unique };
  }

  window.conc = function () {
    const r = measure(document, window);
    r.path = location.pathname;
    return r;
  };

  window.concSweep = async function (paths) {
    const out = [];
    for (const path of paths) {
      const html = await fetch(path).then((r) => r.text());
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1280px;height:2400px;border:0';
      document.body.appendChild(frame);
      await new Promise((done) => {
        frame.onload = done;
        frame.srcdoc = html.replace('<head>', '<head><base href="' + location.origin + path + '">');
      });
      await new Promise((r) => setTimeout(r, 1100));
      const r = measure(frame.contentDocument, frame.contentWindow);
      r.path = path;
      out.push(r);
      frame.remove();
    }
    return out;
  };

  console.log('concentricity probe ready: conc() for this page, concSweep([paths]) for several.');
})();
