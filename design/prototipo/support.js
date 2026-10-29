/* Sudoku Killer — motor mínimo del prototipo.
   Cada artboard es un archivo .dc.html con una plantilla dentro de <x-dc> y una clase
   Component (extends DCLogic) cuyo renderVals() alimenta la plantilla:
   - {{ruta.con.puntos}} en texto y atributos (un atributo que es solo {{x}} recibe el valor tal cual);
   - <sc-if value>, <sc-for list as> con $index, <dc-import name> para montar otro artboard;
   - eventos onClick, onKeyDown, onChange, onInput y onSubmit;
   - state, setState, componentDidMount y componentDidUpdate.
   La plantilla se lee del archivo fuente con fetch (el analizador del navegador reordena tablas),
   así que el prototipo necesita un servidor estático: npx serve design/prototipo.
   No forma parte de la aplicación: es solo para ver el prototipo. */
(function () {
  "use strict";

  var hide = document.createElement("style");
  hide.textContent = "x-dc{display:none}dc-import{display:contents}";
  document.head.appendChild(hide);

  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var RAW = { style: 1, script: 1, textarea: 1 };
  var BOOL = { checked: 1, selected: 1, disabled: 1, hidden: 1, open: 1, readonly: 1, required: 1, autofocus: 1, multiple: 1, novalidate: 1 };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var nextId = 1;

  // ---------- Análisis de la plantilla ----------

  var decoder = document.createElement("textarea");
  function decode(s) {
    if (s.indexOf("&") < 0) return s;
    decoder.innerHTML = s;
    return decoder.value;
  }

  function parse(src) {
    var root = { tag: "#root", attrs: [], children: [], id: nextId++ };
    var stack = [root];
    var i = 0;
    var n = src.length;
    function top() { return stack[stack.length - 1]; }
    function text(t) { if (t) top().children.push({ text: decode(t), id: nextId++ }); }
    while (i < n) {
      var lt = src.indexOf("<", i);
      if (lt < 0) { text(src.slice(i)); break; }
      text(src.slice(i, lt));
      if (src.startsWith("<!--", lt)) {
        var endC = src.indexOf("-->", lt + 4);
        i = endC < 0 ? n : endC + 3;
        continue;
      }
      if (src[lt + 1] === "/") {
        var gt = src.indexOf(">", lt);
        var name = src.slice(lt + 2, gt).trim().toLowerCase();
        for (var k = stack.length - 1; k > 0; k--) {
          if (stack[k].tag.toLowerCase() === name) { stack.length = k; break; }
        }
        i = gt + 1;
        continue;
      }
      var m = /^<([A-Za-z][\w:-]*)/.exec(src.slice(lt, lt + 64));
      if (!m) { text("<"); i = lt + 1; continue; }
      var tag = m[1];
      var j = lt + m[0].length;
      var attrs = [];
      var selfClose = false;
      while (j < n) {
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === ">") { j++; break; }
        if (src[j] === "/" && src[j + 1] === ">") { selfClose = true; j += 2; break; }
        var an = /^[^\s=>\/]+/.exec(src.slice(j, j + 128));
        if (!an) { j++; continue; }
        var aname = an[0];
        j += aname.length;
        while (j < n && /\s/.test(src[j])) j++;
        var aval = null;
        if (src[j] === "=") {
          j++;
          while (j < n && /\s/.test(src[j])) j++;
          var q = src[j];
          if (q === '"' || q === "'") {
            var endQ = src.indexOf(q, j + 1);
            aval = src.slice(j + 1, endQ);
            j = endQ + 1;
          } else {
            var uv = /^[^\s>]+/.exec(src.slice(j, j + 512));
            aval = uv ? uv[0] : "";
            j += aval.length;
          }
          aval = decode(aval);
        }
        attrs.push([aname, aval]);
      }
      var node = { tag: tag, attrs: attrs, children: [], id: nextId++ };
      top().children.push(node);
      var lower = tag.toLowerCase();
      if (RAW[lower]) {
        var close = src.toLowerCase().indexOf("</" + lower, j);
        node.children.push({ text: src.slice(j, close), id: nextId++, raw: true });
        j = src.indexOf(">", close) + 1;
      } else if (!selfClose && !VOID[lower]) {
        stack.push(node);
      }
      i = j;
    }
    return root;
  }

  function attr(node, name) {
    for (var k = 0; k < node.attrs.length; k++) if (node.attrs[k][0] === name) return node.attrs[k][1];
    return null;
  }

  // ---------- Carga de componentes ----------

  var defs = {};

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (update, cb) {
    var patch = typeof update === "function" ? update(this.state, this.props) : update;
    if (patch) this.state = Object.assign({}, this.state, patch);
    schedule(cb);
  };
  DCLogic.prototype.forceUpdate = function (cb) { schedule(cb); };
  window.DCLogic = DCLogic;

  function between(src, open, close) {
    var a = src.indexOf(open);
    if (a < 0) return null;
    var b = src.indexOf(close, a + open.length);
    return src.slice(a + open.length, b);
  }

  function compile(name, src) {
    var body = between(src, "<x-dc>", "</x-dc>") || "";
    var scriptTag = /<script type="text\/x-dc"[^>]*data-props='([^']*)'[^>]*>([\s\S]*?)<\/script>/.exec(src);
    var propsDecl = {};
    try { propsDecl = scriptTag ? JSON.parse(decode(scriptTag[1])) : {}; } catch (e) { propsDecl = {}; }
    var Ctor = scriptTag ? new Function("DCLogic", scriptTag[2] + "\nreturn Component;")(DCLogic) : DCLogic;
    var tree = parse(body);
    var helmet = [];
    tree.children = tree.children.filter(function (c) {
      if (c.tag && c.tag.toLowerCase() === "helmet") { helmet = helmet.concat(c.children); return false; }
      return true;
    });
    var headLinks = [];
    var head = between(src, "<head>", "</head>") || "";
    head.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (_, href) { headLinks.push(href); return ""; });
    var imports = [];
    (function walk(nodes) {
      nodes.forEach(function (c) {
        if (!c.tag) return;
        if (c.tag.toLowerCase() === "dc-import") imports.push(attr(c, "name"));
        walk(c.children);
      });
    })(tree.children);
    var defaults = {};
    Object.keys(propsDecl).forEach(function (k) {
      if (k.charAt(0) !== "$" && propsDecl[k] && propsDecl[k].editor !== null && "default" in propsDecl[k]) defaults[k] = propsDecl[k].default;
    });
    return { name: name, Ctor: Ctor, tree: tree, helmet: helmet, headLinks: headLinks, imports: imports, defaults: defaults };
  }

  var loading = {};
  function load(name, srcText) {
    if (loading[name]) return loading[name];
    var p = (srcText !== undefined ? Promise.resolve(srcText) : fetch("./" + name + ".dc.html").then(function (r) {
      if (!r.ok) throw new Error("No se pudo cargar " + name + ".dc.html (" + r.status + ")");
      return r.text();
    })).then(function (src) {
      var def = compile(name, src);
      defs[name] = def;
      applyHead(def);
      return Promise.all(def.imports.map(function (x) { return load(x); })).then(function () { return def; });
    });
    loading[name] = p;
    return p;
  }

  var applied = {};
  function applyHead(def) {
    def.headLinks.forEach(function (href) {
      var abs = new URL(href, location.href).href;
      if (applied[abs] || document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) { applied[abs] = 1; return; }
      applied[abs] = 1;
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      document.head.appendChild(l);
    });
    def.helmet.forEach(function (c) {
      if (!c.tag) return;
      var tag = c.tag.toLowerCase();
      var key = tag + ":" + (tag === "link" ? attr(c, "href") : c.children.map(function (t) { return t.text; }).join(""));
      if (applied[key]) return;
      applied[key] = 1;
      var el = document.createElement(tag);
      c.attrs.forEach(function (a) { el.setAttribute(a[0], a[1] === null ? "" : a[1]); });
      if (tag === "style") el.textContent = c.children.map(function (t) { return t.text; }).join("");
      document.head.appendChild(el);
    });
  }

  // ---------- Evaluación ----------

  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]*?)\s*\}\}$/;

  function lookup(path, scope) {
    if (path === "true") return true;
    if (path === "false") return false;
    if (path === "null") return null;
    if (path === "undefined" || path === "") return undefined;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split(".");
    var v = scope;
    for (var k = 0; k < parts.length; k++) {
      if (v === null || v === undefined) return undefined;
      v = v[parts[k]];
    }
    return v;
  }
  function str(v) { return v === null || v === undefined || v === false || v === true ? "" : String(v); }
  function evalAttr(raw, scope) {
    if (raw === null) return true;
    var w = WHOLE.exec(raw);
    if (w) return lookup(w[1], scope);
    if (raw.indexOf("{{") < 0) return raw;
    return raw.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v === null || v === undefined ? "" : String(v); });
  }
  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  // Plantilla + valores → nodos virtuales con clave estable (nodo de la plantilla + iteración)
  function renderNodes(nodes, scope, prefix, svg, out) {
    nodes.forEach(function (node) {
      var key = prefix + node.id;
      if (!node.tag) {
        var t = node.raw ? node.text : node.text.indexOf("{{") < 0 ? node.text : node.text.replace(HOLE, function (_, p) { return str(lookup(p, scope)); });
        out.push({ k: key, text: t });
        return;
      }
      var lower = node.tag.toLowerCase();
      if (lower === "sc-if") {
        if (evalAttr(attr(node, "value"), scope)) renderNodes(node.children, scope, key + "/", svg, out);
        return;
      }
      if (lower === "sc-for") {
        var list = evalAttr(attr(node, "list"), scope) || [];
        var as = attr(node, "as") || "item";
        Array.prototype.forEach.call(list, function (item, idx) {
          var s = Object.create(scope);
          s[as] = item;
          s.$index = idx;
          renderNodes(node.children, s, key + "#" + idx + "/", svg, out);
        });
        return;
      }
      if (lower === "dc-import") {
        var props = {};
        node.attrs.forEach(function (a) {
          if (a[0] === "name" || a[0].indexOf("hint-") === 0) return;
          props[camel(a[0])] = evalAttr(a[1], scope);
        });
        out.push({ k: key, comp: attr(node, "name"), props: props });
        return;
      }
      var isSvg = svg || lower === "svg";
      var attrs = {};
      node.attrs.forEach(function (a) { attrs[a[0]] = evalAttr(a[1], scope); });
      var kids = [];
      renderNodes(node.children, scope, key + "/", isSvg, kids);
      out.push({ k: key, tag: node.tag, svg: isSvg, attrs: attrs, kids: kids });
    });
    return out;
  }

  // ---------- Aplicación al DOM ----------

  var EVENTS = { onClick: "click", onKeyDown: "keydown", onKeyUp: "keyup", onInput: "input", onSubmit: "submit", onFocus: "focusin", onBlur: "focusout", onPointerDown: "pointerdown" };

  function setAttr(el, name, v, rec) {
    if (/^on[A-Z]/.test(name)) {
      var type = EVENTS[name];
      if (name === "onChange") type = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio" ? "change" : "input";
      if (!type) type = name.slice(2).toLowerCase();
      rec.ev = rec.ev || {};
      if (!rec.ev[type]) {
        rec.ev[type] = { fn: null };
        var holder = rec.ev[type];
        el.addEventListener(type, function (e) { if (typeof holder.fn === "function") holder.fn(e); });
      }
      rec.ev[type].fn = v;
      return;
    }
    if (name === "className") name = "class";
    if (name === "htmlFor") name = "for";
    var lname = name.toLowerCase();
    if (lname === "value" && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) {
      var sv = str(v);
      if (el.value !== sv) el.value = sv;
      return;
    }
    if (BOOL[lname]) {
      var on = v === true || v === "" || v === lname || (typeof v === "string" && v !== "false" && v.length > 0);
      if (on) el.setAttribute(name, ""); else el.removeAttribute(name);
      if (lname === "checked" || lname === "selected") el[lname] = on;
      if (lname === "disabled") el.disabled = on;
      return;
    }
    if (v === null || v === undefined) { el.removeAttribute(name); return; }
    if (lname.indexOf("aria-") === 0 || lname.indexOf("data-") === 0) { el.setAttribute(name, String(v)); return; }
    if (v === false) { el.removeAttribute(name); return; }
    if (v === true) { el.setAttribute(name, ""); return; }
    if (name === "style" && typeof v === "object") { el.removeAttribute("style"); Object.assign(el.style, v); return; }
    var s = String(v);
    if (el.getAttribute(name) !== s) el.setAttribute(name, s);
  }

  function create(v, queue) {
    if ("text" in v) return { v: v, dom: document.createTextNode(v.text) };
    if (v.comp) {
      var wrap = document.createElement("dc-import");
      wrap.setAttribute("data-name", v.comp);
      var def = defs[v.comp];
      var inst = new def.Ctor(Object.assign({}, v.props));
      inst.props = Object.assign({}, v.props);
      if (!inst.state) inst.state = {};
      var rec = { v: v, dom: wrap, inst: inst, def: def, kids: [] };
      renderComp(rec, queue);
      queue.push(function () { if (inst.componentDidMount) inst.componentDidMount(); });
      return rec;
    }
    var el = v.svg ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
    var r = { v: v, dom: el, kids: [], set: {} };
    patchKids(el, r, v.kids, queue);
    applyAttrs(r, v.attrs);
    return r;
  }

  function applyAttrs(r, attrs) {
    Object.keys(r.set).forEach(function (n) {
      if (!(n in attrs)) { if (/^on[A-Z]/.test(n)) setAttr(r.dom, n, null, r); else r.dom.removeAttribute(n); }
    });
    r.set = {};
    // value y selected después de los hijos, para que <select> ya tenga sus opciones
    Object.keys(attrs).forEach(function (n) { r.set[n] = 1; setAttr(r.dom, n, attrs[n], r); });
  }

  function same(a, b) {
    if ("text" in a || "text" in b) return "text" in a && "text" in b;
    if (a.comp || b.comp) return a.comp === b.comp;
    return a.tag === b.tag && a.svg === b.svg;
  }

  function update(r, v, queue) {
    if ("text" in v) { if (r.v.text !== v.text) r.dom.nodeValue = v.text; r.v = v; return r; }
    if (v.comp) {
      var prevProps = r.inst.props;
      var prevState = r.prevState || r.inst.state;
      r.inst.props = Object.assign({}, v.props);
      r.v = v;
      renderComp(r, queue);
      var inst = r.inst;
      queue.push(function () { if (inst.componentDidUpdate) inst.componentDidUpdate(prevProps, prevState); });
      return r;
    }
    r.v = v;
    patchKids(r.dom, r, v.kids, queue);
    applyAttrs(r, v.attrs);
    return r;
  }

  function unmount(r) {
    if (r.inst && r.inst.componentWillUnmount) r.inst.componentWillUnmount();
    (r.kids || []).forEach(unmount);
  }

  function patchKids(parent, r, vnodes, queue) {
    var old = {};
    r.kids.forEach(function (c) { old[c.v.k] = c; });
    var next = vnodes.map(function (v) {
      var o = old[v.k];
      if (o && same(o.v, v)) { delete old[v.k]; return update(o, v, queue); }
      return create(v, queue);
    });
    Object.keys(old).forEach(function (k) { unmount(old[k]); if (old[k].dom.parentNode === parent) parent.removeChild(old[k].dom); });
    next.forEach(function (c, idx) {
      if (parent.childNodes[idx] !== c.dom) parent.insertBefore(c.dom, parent.childNodes[idx] || null);
    });
    r.kids = next;
  }

  function renderComp(r, queue) {
    var vals = r.inst.renderVals ? r.inst.renderVals() || {} : {};
    var vnodes = renderNodes(r.def.tree.children, vals, "", false, []);
    patchKids(r.dom, r, vnodes, queue);
    r.prevState = r.inst.state;
  }

  // ---------- Arranque ----------

  var rootRec = null;
  var pending = false;
  var callbacks = [];
  function schedule(cb) {
    if (cb) callbacks.push(cb);
    if (pending) return;
    pending = true;
    Promise.resolve().then(flush);
  }
  function flush() {
    pending = false;
    if (!rootRec) return;
    var queue = [];
    renderComp(rootRec, queue);
    var prevProps = rootRec.inst.props;
    var inst = rootRec.inst;
    queue.push(function () { if (inst.componentDidUpdate) inst.componentDidUpdate(prevProps, inst.state); });
    queue.forEach(function (f) { f(); });
    var cbs = callbacks;
    callbacks = [];
    cbs.forEach(function (f) { f(); });
  }

  function fail(err) {
    var box = document.createElement("pre");
    box.style.cssText = "margin:16px;padding:12px;border:2px solid #A6463D;background:#F7E6E1;color:#25251F;font:13px/18px monospace;white-space:pre-wrap";
    box.textContent = "No se pudo mostrar el artboard: " + (err && err.message ? err.message : err) + "\nAbre el prototipo con un servidor estático: npx serve design/prototipo";
    document.body.appendChild(box);
    if (window.console) console.error(err);
  }

  function boot() {
    var host = document.querySelector("x-dc");
    if (!host) return;
    var name = decodeURIComponent(location.pathname.split("/").pop() || "").replace(/\.dc(\.html)?$/, "");
    fetch(location.href).then(function (r) { return r.text(); }).then(function (src) {
      return load(name, src);
    }).then(function (def) {
      var queue = [];
      var props = Object.assign({}, def.defaults);
      var inst = new def.Ctor(props);
      inst.props = props;
      if (!inst.state) inst.state = {};
      // El navegador ya analizó la plantilla dentro de <x-dc>: se descarta y se monta desde la fuente
      host.textContent = "";
      rootRec = { v: { k: "root", comp: name, props: props }, dom: host, inst: inst, def: def, kids: [] };
      renderComp(rootRec, queue);
      host.style.display = "contents";
      queue.push(function () { if (inst.componentDidMount) inst.componentDidMount(); });
      queue.forEach(function (f) { f(); });
      document.documentElement.setAttribute("data-ready", "");
    }).catch(fail);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
