/* Guest Web Player client: guest token, live score/chat over WebSocket, guest cart, progressive sign-in. */
(function () {
  'use strict';
  var P = window.__PAGE__ || {};
  var $ = function (id) { return document.getElementById(id); };
  var store = window.sessionStorage;
  var get = function (k) { try { return store.getItem(k); } catch (e) { return null; } };
  var set = function (k, v) { try { if (v === null) store.removeItem(k); else store.setItem(k, v); } catch (e) { /* private mode */ } };
  var wsBase = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    return fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (res) {
        return res.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
          return { status: res.status, ok: res.ok, data: data };
        });
      });
  }

  function say(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  // ---------- guest token (zero login wall) ----------
  var guestToken = get('guest_token');
  var memberToken = get('member_token');
  function ensureGuest() {
    if (guestToken) return Promise.resolve(guestToken);
    return api('/api/v1/guest/token', { method: 'POST' }).then(function (r) {
      if (r.ok) { guestToken = r.data.guest_token; set('guest_token', guestToken); }
      return guestToken;
    });
  }
  function showWho() {
    var who = $('who');
    if (who) who.textContent = memberToken ? 'Signed in' : 'Watching as guest';
  }

  // ---------- live score (per-match WebSocket, reconnects) ----------
  function renderScore(home, away, status) {
    var banner = $('score');
    if (banner) banner.textContent = home + ' - ' + away;
    var ov = $('ovscore');
    if (ov && P.home) ov.textContent = P.home.name + ' ' + home + ' - ' + away + ' ' + P.away.name;
    if (status && status !== 'in_progress' && P.view === 'live') {
      var k = document.querySelector('.hero .kicker');
      if (k) k.textContent = status === 'completed' ? 'FULL TIME' : status.replace('_', ' ').toUpperCase();
    }
  }
  function connect(path, onMessage) {
    var ws;
    try { ws = new WebSocket(wsBase + path); } catch (e) { return; }
    ws.onmessage = function (ev) { try { onMessage(JSON.parse(ev.data)); } catch (e) { /* ignore */ } };
    ws.onclose = function () { setTimeout(function () { connect(path, onMessage); }, 3000); };
  }
  if (P.match_id && $('score')) {
    connect('/ws/matches/' + encodeURIComponent(P.match_id), function (msg) {
      if (msg.type === 'match.event_appended' && msg.data && msg.data.score) renderScore(msg.data.score.home, msg.data.score.away, msg.data.status);
    });
  }

  // ---------- video (HLS from the self-hosted media server) ----------
  var video = $('video');
  function startVideo() {
    if (!video || !P.stream_path) return;
    var url = location.protocol + '//' + location.hostname + ':8888/' + P.stream_path + '/index.m3u8';
    var note = $('videonote');
    if (window.Hls && window.Hls.isSupported()) {
      var hls = new window.Hls({ lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () { if (note) note.hidden = true; video.play().catch(function () {}); });
      hls.on(window.Hls.Events.ERROR, function (e, d) { if (d && d.fatal) { hls.destroy(); setTimeout(startVideo, 5000); } });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      if (note) note.hidden = true;
    }
    var resume = Number(get('resume_at') || new URLSearchParams(location.search).get('t') || 0);
    if (resume > 0) video.addEventListener('loadedmetadata', function () { video.currentTime = resume; set('resume_at', null); }, { once: true });
  }
  window.addEventListener('load', startVideo);

  // ---------- progressive auth modal ----------
  var modal = $('authmodal');
  var pending = null;
  function openModal(reason, after) {
    if (!modal) return;
    pending = after || null;
    if (video && !isNaN(video.currentTime)) set('resume_at', String(Math.floor(video.currentTime)));
    say($('authwhy'), reason);
    modal.hidden = false;
    var email = $('authemail');
    if (email) email.focus();
  }
  function closeModal() { if (modal) modal.hidden = true; }
  if (modal) {
    $('authcancel').addEventListener('click', closeModal);
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    $('authform').addEventListener('submit', function (e) {
      e.preventDefault();
      say($('autherr'), '');
      api('/api/v1/auth/login', { method: 'POST', body: { email: $('authemail').value, password: $('authpass').value } })
        .then(function (r) {
          if (!r.ok) { say($('autherr'), 'That email or password is not right. Please try again.', 'err'); return null; }
          memberToken = r.data.token;
          set('member_token', memberToken);
          showWho();
          return api('/api/v1/guest/cart/merge', { method: 'POST', token: memberToken, body: { guest_token: guestToken } });
        })
        .then(function (m) {
          if (!m) return;
          if (m.ok && m.data && m.data.active_cart) {
            cartItems = m.data.active_cart.items;
            $('cartcount').textContent = String(m.data.active_cart.total_items);
          }
          closeModal();
          var resume = Number(get('resume_at') || 0);
          if (video && resume > 0) { video.currentTime = resume; set('resume_at', null); }
          if (pending) { var fn = pending; pending = null; fn(); }
        });
    });
  }

  // ---------- guest cart ----------
  var cartItems = [];
  var addBtn = $('addcart');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      addBtn.disabled = true;
      ensureGuest().then(function (tok) {
        return api('/api/v1/guest/cart', { method: 'POST', token: tok, body: { variant_id: 'var-jersey-001-L', quantity: 1 } });
      }).then(function (r) {
        if (r.ok) {
          cartItems = r.data.items;
          $('cartcount').textContent = String(r.data.total_items);
          say($('cartmsg'), 'Added to your cart.', 'ok');
        } else {
          say($('cartmsg'), r.data && r.data.error && r.data.error.code === 'OUT_OF_STOCK' ? 'Sorry, that size just sold out.' : 'Could not add to cart. Please try again.', 'err');
        }
      }).finally(function () { addBtn.disabled = false; });
    });
    $('checkout').addEventListener('click', function () {
      if (!memberToken) { openModal('Sign in to check out. Your cart is kept.', doCheckout); return; }
      doCheckout();
    });
  }
  function doCheckout() {
    if (!cartItems.length) { say($('cartmsg'), 'Your cart is empty.', 'err'); return; }
    api('/api/v1/store/checkout', { method: 'POST', token: memberToken,
      body: { order_id: 'web-' + Date.now().toString(36), items: cartItems.map(function (i) { return { variant_id: i.variant_id, quantity: i.quantity }; }), payment: { token: 'tok_success' } } })
      .then(function (r) {
        if (r.ok) {
          say($('cartmsg'), 'Order ' + r.data.order_id + ' paid: PKR ' + (r.data.total_minor / 100).toFixed(2) + '.', 'ok');
          cartItems = [];
          $('cartcount').textContent = '0';
        } else {
          say($('cartmsg'), 'Payment could not be completed. Please try again.', 'err');
        }
      });
  }

  // ---------- chat (guests are blocked by the server, then invited to sign in) ----------
  var list = $('chatlist');
  var seen = {};
  function addMessage(m) {
    if (!list || !m) return;
    var key = m.chat_room_id + ':' + (m.seq || m.message_id);
    if (seen[key]) return;
    seen[key] = true;
    var li = document.createElement('li');
    var who = document.createElement('strong');
    who.textContent = m.sender;
    li.appendChild(who);
    li.appendChild(document.createTextNode(' ' + m.text));
    if (m.flagged) li.className = 'flagged';
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }
  var form = $('chatform');
  if (form) {
    var room = form.getAttribute('data-room');
    api('/api/v1/public/chat/' + encodeURIComponent(room)).then(function (r) { if (r.ok) r.data.messages.forEach(addMessage); });
    connect('/ws/chat/' + encodeURIComponent(room), function (msg) { if (msg.type === 'chat.message') addMessage(msg.data); });
    var send = function () {
      var input = $('chatinput');
      var text = input.value.trim();
      if (!text) return;
      var token = memberToken || guestToken;
      api('/api/v1/chat', { method: 'POST', token: token, body: { chat_room_id: room, text: text } }).then(function (r) {
        if (r.status === 403 && r.data && r.data.error && r.data.error.code === 'GUEST_WRITE_FORBIDDEN') {
          openModal('Sign in to join the chat. Your message is kept.', send);
          return;
        }
        if (r.ok) {
          input.value = '';
          if (r.data && r.data.message) addMessage(Object.assign({ chat_room_id: room }, r.data.message));
          if (r.data && r.data.accepted === false) say($('cartmsg'), 'Your message was not posted (too many repeated characters).', 'err');
        } else if (r.status === 429) {
          say($('cartmsg'), 'Slow down: you are sending messages too quickly.', 'err');
        } else if (r.status === 403) {
          say($('cartmsg'), 'You have been muted in this chat.', 'err');
        }
      });
    };
    form.addEventListener('submit', function (e) { e.preventDefault(); ensureGuest().then(send); });
  }

  ensureGuest().then(function (tok) {
    if (!tok || !$('cartcount')) return;
    api('/api/v1/guest/cart', { token: tok }).then(function (r) {
      if (r.ok) { cartItems = r.data.items; $('cartcount').textContent = String(r.data.total_items); }
    });
  });
  showWho();
}());
