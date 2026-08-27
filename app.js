/* Wettbuch — private betting book (Vanilla JS, no dependencies)
 * State lives in localStorage. Two payout modes per bet:
 *   - "fixed": each wager locks the decimal odds at placement time (payout = stake * lockedOdds)
 *   - "pool":  parimutuel — the whole pool is split among winners proportional to stake
 * A house commission (%) is skimmed off the payout and the result is rounded to whole euros.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'wettbuch.v1';
  var DEFAULT_PAYPAL = 'Moritz975';   // PayPal.Me default recipient (editable in the ⋯ menu)
  var $app = document.getElementById('app');

  // ---------------------------------------------------------------- state
  var state = load();
  var route = { name: 'list', betId: null };
  var draft = null;       // editor working copy
  var openMenuFlag = false;

  function blankState() { return { version: 1, bets: [], paypalHandle: DEFAULT_PAYPAL }; }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankState();
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.bets)) return blankState();
      if (typeof data.paypalHandle !== 'string') data.paypalHandle = '';
      return data;
    } catch (e) {
      console.warn('load failed', e);
      return blankState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Speichern fehlgeschlagen (Speicher voll?)');
      console.error(e);
    }
  }

  var _idc = 0;
  function uid(prefix) {
    _idc++;
    return prefix + '-' + Date.now().toString(36) + _idc.toString(36) +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function getBet(id) {
    for (var i = 0; i < state.bets.length; i++) if (state.bets[i].id === id) return state.bets[i];
    return null;
  }

  // ---------------------------------------------------------------- helpers
  var euro2 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  var euro0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });

  function fmt(x) { return euro2.format(x || 0); }
  function fmt0(x) { return euro0.format(Math.round(x || 0)); }
  function fmtOdds(o) { return (o == null || !isFinite(o)) ? '—' : o.toFixed(2).replace('.', ','); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function parseAmount(s) {
    if (s == null) return NaN;
    var n = Number(String(s).trim().replace(/\s/g, '').replace(/€/g, '').replace(',', '.'));
    return isFinite(n) ? n : NaN;
  }

  function totalPool(bet) { var s = 0; for (var i = 0; i < bet.wagers.length; i++) s += bet.wagers[i].amount; return s; }
  function stakeOnOutcome(bet, oid) {
    var s = 0; for (var i = 0; i < bet.wagers.length; i++) if (bet.wagers[i].outcomeId === oid) s += bet.wagers[i].amount; return s;
  }
  function liveOdds(bet, oid) { var s = stakeOnOutcome(bet, oid); return s > 0 ? totalPool(bet) / s : null; }
  function outcomeLabel(bet, oid) {
    for (var i = 0; i < bet.outcomes.length; i++) if (bet.outcomes[i].id === oid) return bet.outcomes[i].label;
    return '?';
  }
  function roundEuro(x, mode) {
    if (mode === 'up') return Math.ceil(x - 1e-9);
    if (mode === 'down') return Math.floor(x + 1e-9);
    return Math.round(x);
  }

  function modeName(m) { return m === 'fixed' ? 'Feste Quote' : m === 'weighted' ? 'Quoten-Pool' : 'Pool-Aufteilung'; }
  function modeBadgeHtml(m) {
    var cls = m === 'fixed' ? 'mode-fixed' : m === 'weighted' ? 'mode-weighted' : 'mode-pool';
    var lbl = m === 'fixed' ? 'Feste Quote' : m === 'weighted' ? 'Quoten-Pool' : 'Pool';
    return '<span class="badge ' + cls + '">' + lbl + '</span>';
  }

  // Compute payouts for a given result object (used for both saved result and live preview)
  function computeWith(bet, result) {
    if (!result || !result.winningOutcomeId) return null;
    var pool = totalPool(bet);
    var winStake = stakeOnOutcome(bet, result.winningOutcomeId);
    var c = Math.max(0, Math.min(100, Number(result.commissionPct) || 0));
    var rounding = result.rounding || 'nearest';
    var base = bet.commissionBase === 'profit' ? 'profit' : 'payout';
    // sum of (stake × frozen odds) over winners — used for the odds-weighted pool mode
    var totalClaim = 0;
    if (bet.mode === 'weighted') {
      bet.wagers.forEach(function (w) {
        if (w.outcomeId === result.winningOutcomeId) totalClaim += w.amount * (w.oddsAtTime || 0);
      });
    }
    var rows = bet.wagers.map(function (w) {
      var isWinner = w.outcomeId === result.winningOutcomeId;
      var gross = 0, afterCommission = 0;
      if (isWinner) {
        if (bet.mode === 'fixed') gross = w.amount * (w.oddsAtTime || 0);
        else if (bet.mode === 'weighted') gross = totalClaim > 0 ? pool * (w.amount * (w.oddsAtTime || 0)) / totalClaim : 0;
        else gross = winStake > 0 ? pool * (w.amount / winStake) : 0;
        if (base === 'profit') {
          var prof = gross - w.amount; if (prof < 0) prof = 0;
          afterCommission = w.amount + prof * (1 - c / 100);   // stake untouched, only profit taxed
        } else {
          afterCommission = gross * (1 - c / 100);             // commission on the whole payout
        }
      }
      var rounded = isWinner ? roundEuro(afterCommission, rounding) : 0;
      return { w: w, isWinner: isWinner, gross: gross, afterCommission: afterCommission, rounded: rounded, profit: rounded - w.amount };
    });
    var sumGross = 0, sumAfter = 0, sumRounded = 0;
    rows.forEach(function (r) { sumGross += r.gross; sumAfter += r.afterCommission; sumRounded += r.rounded; });
    return {
      pool: pool, winStake: winStake, c: c, rounding: rounding, base: base, rows: rows,
      sumGross: sumGross, sumAfter: sumAfter, sumRounded: sumRounded,
      provision: sumGross - sumAfter, houseRest: pool - sumRounded,
      effectiveOdds: winStake > 0 ? pool / winStake : null
    };
  }
  function settlement(bet) { return computeWith(bet, bet.result); }

  // ---------------------------------------------------------------- toast
  var toastTimer = null;
  function toast(msg) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2200);
  }

  // ================================================================ RENDER
  function render() {
    openMenuFlag = false;
    if (route.name === 'editor') return renderEditor();
    if (route.name === 'detail') {
      var bet = getBet(route.betId);
      if (!bet) { route = { name: 'list' }; return render(); }
      return renderDetail(bet);
    }
    return renderList();
  }

  // ---------------------------------------------------------------- list
  function renderList() {
    var bets = state.bets.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var html = '';
    html += topbar('Wettbuch', bets.length + (bets.length === 1 ? ' Wette' : ' Wetten'), { menu: true });
    html += '<div class="content">';

    if (!bets.length) {
      html += '<div class="empty"><div class="big">🎲</div><p>Noch keine Wetten.<br>Tippe auf <b>+</b>, um deine erste Wette anzulegen.</p></div>';
    } else {
      bets.forEach(function (bet) {
        var pool = totalPool(bet);
        var isSettled = !!bet.result;
        var modeBadge = modeBadgeHtml(bet.mode);
        var statusBadge = isSettled
          ? '<span class="badge settled">Abgerechnet</span>'
          : '<span class="badge open">Offen</span>';
        var winLine = '';
        if (isSettled) winLine = '<div class="meta-row"><span>Gewinner: <b>' + esc(outcomeLabel(bet, bet.result.winningOutcomeId)) + '</b></span></div>';
        html += '<div class="card tap" data-act="open" data-id="' + bet.id + '">'
          + '<div class="card-head"><div class="grow">'
          + '<h2>' + esc(bet.title || 'Ohne Titel') + '</h2>'
          + (bet.description ? '<p class="desc">' + esc(bet.description) + '</p>' : '')
          + '</div>' + modeBadge + '</div>'
          + '<div class="meta-row">'
          + '<span>Pool: <b>' + fmt(pool) + '</b></span>'
          + '<span>' + bet.wagers.length + ' ' + (bet.wagers.length === 1 ? 'Einsatz' : 'Einsätze') + '</span>'
          + '<span>' + bet.outcomes.length + ' Ausgänge</span>'
          + statusBadge
          + '</div>'
          + winLine
          + '</div>';
      });
    }
    html += '</div>';
    html += '<button class="fab" data-act="new" aria-label="Neue Wette">+</button>';
    if (openMenuFlag) html += menuHtml();
    $app.innerHTML = html;
  }

  function menuHtml() {
    return '<div class="menu">'
      + '<button data-act="paypal-setup">💶 PayPal-Empfänger</button>'
      + '<button data-act="export">💾 Wetten sichern (Export)</button>'
      + '<button data-act="import">📂 Backup laden (Import)</button>'
      + '</div>';
  }

  function topbar(title, sub, opts) {
    opts = opts || {};
    var left = opts.back
      ? '<button class="icon ghost" data-act="' + esc(opts.back) + '" aria-label="Zurück">‹</button>'
      : '';
    var right = '';
    if (opts.menu) right = '<button class="icon ghost" data-act="toggle-menu" aria-label="Menü">⋯</button>';
    if (opts.rightHtml) right = opts.rightHtml;
    return '<div class="topbar">' + left
      + '<h1>' + esc(title) + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</h1>'
      + right + '</div>';
  }

  // ---------------------------------------------------------------- editor
  function renderEditor() {
    var isNew = !draft.id;
    var html = '';
    html += topbar(isNew ? 'Neue Wette' : 'Wette bearbeiten', null, { back: 'cancel-editor' });
    html += '<div class="content">';
    html += '<div class="card">';

    html += '<label for="f-title">Titel</label>';
    html += '<input id="f-title" type="text" placeholder="z. B. Wer gewinnt das Finale?" value="' + esc(draft.title) + '" />';

    html += '<label for="f-desc">Beschreibung (optional)</label>';
    html += '<textarea id="f-desc" placeholder="Details zur Wette …">' + esc(draft.description) + '</textarea>';

    html += '<label>Gewinnmodell</label>';
    html += '<div id="mode-cards">';
    [['pool', 'Pool-Aufteilung'], ['fixed', 'Feste Quote'], ['weighted', 'Quoten-Pool (voll ausgeschüttet)']].forEach(function (m) {
      var active = draft.mode === m[0];
      html += '<button type="button" class="mode-card' + (active ? ' active' : '') + '" data-mode="' + m[0] + '">'
        + '<span class="mc-check">' + (active ? '●' : '○') + '</span>'
        + '<span class="mc-body"><span class="mc-title">' + m[1] + '</span>'
        + '<span class="mc-desc">' + modeHint(m[0]) + '</span></span>'
        + '</button>';
    });
    html += '</div>';

    var base = draft.commissionBase === 'profit' ? 'profit' : 'payout';
    html += '<label>Provision am Ende abziehen von</label>';
    html += '<div class="segment" id="seg-commbase">'
      + '<button type="button" data-commbase="payout" class="' + (base === 'payout' ? 'active' : '') + '">Auszahlung</button>'
      + '<button type="button" data-commbase="profit" class="' + (base === 'profit' ? 'active' : '') + '">nur Gewinn</button>'
      + '</div>';
    html += '<p class="hint">' + commBaseHint(base) + '</p>';

    html += '<label>Mögliche Ausgänge</label>';
    draft.outcomes.forEach(function (o, i) {
      html += '<div class="outcome-row">'
        + '<input type="text" data-outcome-idx="' + i + '" placeholder="Ausgang ' + (i + 1) + ' (z. B. Name oder „Unentschieden“)" value="' + esc(o.label) + '" />'
        + (draft.outcomes.length > 2 ? '<button type="button" class="danger" data-act="del-outcome" data-idx="' + i + '">✕</button>' : '')
        + '</div>';
    });
    html += '<button type="button" class="ghost block" data-act="add-outcome">+ Ausgang hinzufügen</button>';

    html += '<div class="spacer"></div>';
    html += '<div class="btn-row" style="margin-top:16px">';
    html += '<button type="button" class="ghost" data-act="cancel-editor">Abbrechen</button>';
    html += '<button type="button" class="primary" data-act="save-bet">Speichern</button>';
    html += '</div>';
    html += '</div></div>';
    $app.innerHTML = html;
  }

  function modeHint(mode) {
    if (mode === 'fixed') return 'Quote wird beim Einsatz eingefroren. Gewinn = Einsatz × Quote. Die Summe kann vom Pool abweichen (Rest bleibt beim Haus).';
    if (mode === 'weighted') return 'Wie „Feste Quote“, aber auf den Pool normiert: Auszahlung = Pool × (Einsatz × Quote) ÷ Σ. Quoten zählen, es wird immer alles ausgeschüttet.';
    return 'Ganzer Pool wird proportional zum Einsatz unter den Gewinnern aufgeteilt (parimutuel). Eingefrorene Quoten zählen für die Auszahlung nicht.';
  }

  function commBaseHint(base) {
    if (base === 'profit') return 'Reine Gewinnbeteiligung: Der Einsatz kommt voll zurück, nur der Gewinn wird um die Provision gekürzt.';
    return 'Provision wird vom gesamten Auszahlungsbetrag (Einsatz + Gewinn) abgezogen.';
  }

  function syncEditorFromDOM() {
    var t = document.getElementById('f-title'); if (t) draft.title = t.value;
    var d = document.getElementById('f-desc'); if (d) draft.description = d.value;
    var inputs = document.querySelectorAll('[data-outcome-idx]');
    inputs.forEach(function (inp) {
      var i = Number(inp.getAttribute('data-outcome-idx'));
      if (draft.outcomes[i]) draft.outcomes[i].label = inp.value;
    });
  }

  // ---------------------------------------------------------------- detail
  function renderDetail(bet) {
    var pool = totalPool(bet);
    var isSettled = !!bet.result;
    var settle = isSettled ? settlement(bet) : null;

    var html = '';
    html += topbar(bet.title || 'Ohne Titel',
      modeName(bet.mode) + ' · Pool ' + fmt(pool),
      { back: 'back-list', rightHtml: '<button class="icon ghost" data-act="edit-bet" aria-label="Bearbeiten">✎</button>' });
    html += '<div class="content">';

    // description
    if (bet.description) html += '<div class="card"><p class="desc" style="margin:0">' + esc(bet.description) + '</p></div>';

    // outcomes + live odds
    html += '<div class="card"><h3>Ausgänge & aktuelle Quoten</h3>';
    bet.outcomes.forEach(function (o) {
      var stake = stakeOnOutcome(bet, o.id);
      var odds = liveOdds(bet, o.id);
      var isWin = isSettled && bet.result.winningOutcomeId === o.id;
      html += '<div class="outcome-line' + (isWin ? ' winner' : '') + '">'
        + '<div class="grow"><div class="name">' + esc(o.label) + (isWin ? ' 🏆' : '') + '</div>'
        + '<div class="sub">Einsätze: ' + fmt(stake) + (pool > 0 ? ' · ' + Math.round(stake / pool * 100) + '% vom Pool' : '') + '</div></div>'
        + '<div class="odds"><div class="big">' + fmtOdds(odds) + '</div><div class="lbl">Quote</div></div>'
        + '</div>';
    });
    html += '</div>';

    // wagers
    html += '<div class="card"><h3>Einsätze</h3>';
    if (!bet.wagers.length) {
      html += '<p class="desc">Noch keine Einsätze. Tippe unten auf „+ Einsatz“.</p>';
    } else {
      bet.wagers.slice().sort(function (a, b) { return (a.placedAt || 0) - (b.placedAt || 0); }).forEach(function (w) {
        var row = settle ? settle.rows.find(function (r) { return r.w.id === w.id; }) : null;
        var quoteExplain = 'Quote ' + fmtOdds(w.oddsAtTime) + ' = ' + fmt(w.poolAtTime) + ' Pool ÷ ' + fmt(w.outcomeStakeAtTime) + ' auf „' + esc(outcomeLabel(bet, w.outcomeId)) + '“';
        var payoutHtml = '';
        if (row) {
          if (row.isWinner) payoutHtml = '<div class="payout win">→ ' + fmt0(row.rounded) + ' (' + (row.profit >= 0 ? '+' : '') + fmt(row.profit) + ')</div>';
          else payoutHtml = '<div class="payout lose">verloren</div>';
        }
        html += '<div class="wager">'
          + '<div class="grow">'
          + '<div class="who">' + esc(w.person || '—') + '</div>'
          + '<div class="on">auf „' + esc(outcomeLabel(bet, w.outcomeId)) + '“</div>'
          + '<div class="quote">' + quoteExplain + '</div>'
          + '</div>'
          + '<div style="text-align:right">'
          + '<div class="amount">' + fmt(w.amount) + '</div>'
          + payoutHtml
          + '<button class="del" data-act="del-wager" data-id="' + w.id + '" aria-label="Löschen">🗑</button>'
          + '</div>'
          + '</div>';
      });
    }
    html += '<div class="spacer"></div>';
    html += '<button class="primary block" data-act="add-wager">+ Einsatz</button>';
    html += '</div>';

    // settlement
    if (isSettled) {
      html += renderSettlementCard(bet, settle);
    } else {
      html += '<div class="card">';
      html += '<button class="primary block" data-act="enter-result"' + (bet.wagers.length ? '' : ' disabled') + '>🏁 Ergebnis eintragen</button>';
      if (!bet.wagers.length) html += '<p class="hint">Erst Einsätze hinzufügen.</p>';
      html += '</div>';
    }

    // danger
    html += '<button class="danger block" data-act="del-bet" style="margin-top:8px">Wette löschen</button>';

    html += '</div>';
    $app.innerHTML = html;
  }

  function renderSettlementCard(bet, s) {
    var html = '<div class="card">';
    html += '<div class="card-head"><h3 style="margin-top:0" class="grow">Abrechnung</h3>'
      + '<button class="link" data-act="enter-result">bearbeiten</button></div>';
    html += '<div class="meta-row"><span>Gewinner: <b>' + esc(outcomeLabel(bet, bet.result.winningOutcomeId)) + '</b></span>';
    if (bet.mode === 'pool' && s.effectiveOdds != null) html += '<span>End-Quote: <b>' + fmtOdds(s.effectiveOdds) + '</b></span>';
    html += '</div>';

    html += '<div class="settle-summary">';
    html += '<div class="k">Pool gesamt</div><div class="v">' + fmt(s.pool) + '</div>';
    html += '<div class="k">Bruttogewinne</div><div class="v">' + fmt(s.sumGross) + '</div>';
    html += '<div class="k">Provision (' + fmtOdds(s.c) + ' % auf ' + (s.base === 'profit' ? 'Gewinn' : 'Auszahlung') + ')</div><div class="v house">− ' + fmt(s.provision) + '</div>';
    html += '<div class="k">Auszahlung gesamt (gerundet)</div><div class="v">' + fmt0(s.sumRounded) + '</div>';
    html += '<div class="k">Rest beim Haus</div><div class="v house">' + fmt(s.houseRest) + '</div>';
    html += '</div>';

    var winners = s.rows.filter(function (r) { return r.isWinner; });
    if (winners.length) {
      html += '<div class="table-scroll"><table class="payout-table">';
      html += '<tr><th>Person</th><th>Einsatz</th><th>Exakt</th><th>n. Prov.</th><th>Auszahlung</th></tr>';
      winners.forEach(function (r) {
        html += '<tr>'
          + '<td>' + esc(r.w.person || '—') + '</td>'
          + '<td>' + fmt(r.w.amount) + '</td>'
          + '<td>' + fmt(r.gross) + '</td>'
          + '<td>' + fmt(r.afterCommission) + '</td>'
          + '<td class="final">' + fmt0(r.rounded) + '</td>'
          + '</tr>';
      });
      html += '</table></div>';
      html += '<p class="hint">„Exakt“ = Gewinn vor Provision · „n. Prov.“ = nach Abzug der Provision (vor Rundung) · „Auszahlung“ = auf glatten Euro gerundet.</p>';
    } else {
      html += '<p class="hint">Niemand hat auf den Gewinner-Ausgang gesetzt – keine Auszahlung.</p>';
    }
    html += '</div>';
    return html;
  }

  // ================================================================ SHEETS
  function closeSheet() { var s = document.querySelector('.sheet-backdrop'); if (s) s.remove(); }
  function openSheet(innerHtml) {
    closeSheet();
    var back = document.createElement('div');
    back.className = 'sheet-backdrop';
    back.innerHTML = '<div class="sheet">' + innerHtml + '</div>';
    back.addEventListener('click', function (e) { if (e.target === back) closeSheet(); });
    document.body.appendChild(back);
    return back;
  }

  // ---- add wager sheet
  function sheetAddWager(bet) {
    var opts = bet.outcomes.map(function (o) {
      return '<option value="' + o.id + '">' + esc(o.label) + '</option>';
    }).join('');
    var html = ''
      + '<h2>Einsatz hinzufügen</h2>'
      + '<label for="w-person">Person</label>'
      + '<input id="w-person" type="text" placeholder="Name" autocomplete="off" />'
      + '<label for="w-amount">Betrag (€)</label>'
      + '<div class="amt-chips">'
      + [5, 10, 15, 20].map(function (v) { return '<button type="button" class="amt-chip" data-amount="' + v + '">' + v + ' €</button>'; }).join('')
      + '</div>'
      + '<input id="w-amount" type="text" inputmode="decimal" placeholder="z. B. 10" />'
      + '<label for="w-outcome">Wettet auf</label>'
      + '<select id="w-outcome">' + opts + '</select>'
      + '<p class="hint" id="w-preview"></p>'
      + '<button type="button" class="ghost block" data-act="pp-qr" style="margin-top:10px">💶 PayPal-QR für diesen Betrag</button>'
      + '<div id="pp-qr"></div>'
      + '<div class="btn-row sheet-actions">'
      + '<button class="ghost" data-act="close-sheet">Abbrechen</button>'
      + '<button class="primary" data-act="save-wager">Hinzufügen</button>'
      + '</div>';
    var back = openSheet(html);
    var amountEl = back.querySelector('#w-amount');
    var outcomeEl = back.querySelector('#w-outcome');
    var preview = back.querySelector('#w-preview');
    function updatePreview() {
      var amt = parseAmount(amountEl.value);
      var oid = outcomeEl.value;
      if (!(amt > 0)) { preview.textContent = 'Quote wird beim Speichern zum aktuellen Stand eingefroren.'; return; }
      var poolAt = totalPool(bet) + amt;
      var stakeAt = stakeOnOutcome(bet, oid) + amt;
      var odds = stakeAt > 0 ? poolAt / stakeAt : null;
      preview.textContent = 'Eingefrorene Quote: ' + fmtOdds(odds) + '  (' + fmt(poolAt) + ' Pool ÷ ' + fmt(stakeAt) + ' auf „' + outcomeLabel(bet, oid) + '“)';
    }
    amountEl.addEventListener('input', function () {
      back.querySelectorAll('.amt-chip').forEach(function (c) { c.classList.remove('active'); });
      updatePreview();
    });
    outcomeEl.addEventListener('change', updatePreview);
    back.querySelectorAll('.amt-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        amountEl.value = chip.getAttribute('data-amount');
        updatePreview();
        back.querySelectorAll('.amt-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
      });
    });
    updatePreview();
    back.querySelector('#w-person').focus();
  }

  function saveWager(bet) {
    var person = (document.getElementById('w-person').value || '').trim();
    var amount = parseAmount(document.getElementById('w-amount').value);
    var outcomeId = document.getElementById('w-outcome').value;
    if (!person) { toast('Bitte einen Namen eingeben.'); return; }
    if (!(amount > 0)) { toast('Bitte einen gültigen Betrag eingeben.'); return; }
    var poolAt = totalPool(bet) + amount;
    var stakeAt = stakeOnOutcome(bet, outcomeId) + amount;
    var odds = stakeAt > 0 ? poolAt / stakeAt : null;
    bet.wagers.push({
      id: uid('w'), person: person, amount: amount, outcomeId: outcomeId,
      placedAt: Date.now(), poolAtTime: poolAt, outcomeStakeAtTime: stakeAt, oddsAtTime: odds
    });
    save(); closeSheet(); render();
  }

  // ---- result sheet
  function sheetResult(bet) {
    var cur = bet.result || { winningOutcomeId: bet.outcomes[0].id, commissionPct: 0, rounding: 'nearest' };
    var opts = bet.outcomes.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === cur.winningOutcomeId ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    var html = ''
      + '<h2>Ergebnis eintragen</h2>'
      + '<label for="r-winner">Gewinner-Ausgang</label>'
      + '<select id="r-winner">' + opts + '</select>'
      + '<label for="r-commission">Provision des Hauses (%)</label>'
      + '<input id="r-commission" type="text" inputmode="decimal" value="' + esc(cur.commissionPct || 0) + '" />'
      + '<label>Rundung der Auszahlung</label>'
      + '<div class="segment" id="seg-round">'
      + '<button type="button" data-round="down" class="' + (cur.rounding === 'down' ? 'active' : '') + '">Abrunden</button>'
      + '<button type="button" data-round="nearest" class="' + (cur.rounding === 'nearest' || !cur.rounding ? 'active' : '') + '">Kaufmännisch</button>'
      + '<button type="button" data-round="up" class="' + (cur.rounding === 'up' ? 'active' : '') + '">Aufrunden</button>'
      + '</div>'
      + '<div id="r-preview"></div>'
      + '<div class="btn-row sheet-actions">'
      + '<button class="ghost" data-act="close-sheet">Abbrechen</button>'
      + '<button class="primary" data-act="save-result">Speichern</button>'
      + '</div>';
    var back = openSheet(html);

    var pending = { winningOutcomeId: cur.winningOutcomeId, commissionPct: Number(cur.commissionPct) || 0, rounding: cur.rounding || 'nearest' };
    var winnerEl = back.querySelector('#r-winner');
    var commEl = back.querySelector('#r-commission');
    var previewEl = back.querySelector('#r-preview');

    function refresh() {
      pending.winningOutcomeId = winnerEl.value;
      pending.commissionPct = Math.max(0, Math.min(100, parseAmount(commEl.value) || 0));
      var s = computeWith(bet, pending);
      previewEl.innerHTML = previewHtml(bet, s);
    }
    winnerEl.addEventListener('change', refresh);
    commEl.addEventListener('input', refresh);
    back.querySelector('#seg-round').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-round]'); if (!b) return;
      pending.rounding = b.getAttribute('data-round');
      back.querySelectorAll('#seg-round button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      refresh();
    });
    // keep pending in dataset for save
    back._pending = pending;
    refresh();
  }

  function previewHtml(bet, s) {
    if (!s) return '';
    var winners = s.rows.filter(function (r) { return r.isWinner; });
    var h = '<div class="divider"></div>';
    h += '<div class="settle-summary">';
    h += '<div class="k">Pool gesamt</div><div class="v">' + fmt(s.pool) + '</div>';
    h += '<div class="k">Auszahlung gesamt</div><div class="v">' + fmt0(s.sumRounded) + '</div>';
    h += '<div class="k">Rest beim Haus</div><div class="v house">' + fmt(s.houseRest) + '</div>';
    h += '</div>';
    if (winners.length) {
      h += '<div class="table-scroll"><table class="payout-table">';
      h += '<tr><th>Person</th><th>Exakt</th><th>n. Prov.</th><th>Auszahlung</th></tr>';
      winners.forEach(function (r) {
        h += '<tr><td>' + esc(r.w.person) + '</td><td>' + fmt(r.gross) + '</td><td>' + fmt(r.afterCommission) + '</td><td class="final">' + fmt0(r.rounded) + '</td></tr>';
      });
      h += '</table></div>';
    } else {
      h += '<p class="hint">Niemand hat auf diesen Ausgang gesetzt – keine Auszahlung.</p>';
    }
    return h;
  }

  function saveResult(bet) {
    var back = document.querySelector('.sheet-backdrop');
    var p = back && back._pending;
    if (!p) return;
    bet.result = {
      winningOutcomeId: p.winningOutcomeId,
      commissionPct: Math.max(0, Math.min(100, Number(p.commissionPct) || 0)),
      rounding: p.rounding || 'nearest',
      settledAt: Date.now()
    };
    save(); closeSheet(); render();
    toast('Ergebnis gespeichert.');
  }

  // ================================================================ ACTIONS
  function startNewBet() {
    draft = {
      id: null, title: '', description: '', mode: 'pool', commissionBase: 'payout',
      outcomes: [{ id: uid('o'), label: '' }, { id: uid('o'), label: '' }]
    };
    route = { name: 'editor' };
    render();
  }

  function startEditBet(bet) {
    draft = {
      id: bet.id, title: bet.title, description: bet.description, mode: bet.mode,
      commissionBase: bet.commissionBase === 'profit' ? 'profit' : 'payout',
      outcomes: bet.outcomes.map(function (o) { return { id: o.id, label: o.label }; })
    };
    route = { name: 'editor' };
    render();
  }

  function saveBet() {
    syncEditorFromDOM();
    var title = (draft.title || '').trim();
    if (!title) { toast('Bitte einen Titel eingeben.'); return; }
    var outcomes = draft.outcomes
      .map(function (o) { return { id: o.id, label: (o.label || '').trim() }; })
      .filter(function (o) { return o.label !== ''; });
    if (outcomes.length < 2) { toast('Mindestens zwei Ausgänge mit Text angeben.'); return; }

    if (draft.id) {
      var bet = getBet(draft.id);
      // guard: don't drop an outcome that already has wagers
      var removed = bet.outcomes.filter(function (o) { return !outcomes.some(function (n) { return n.id === o.id; }); });
      var hasWagers = removed.some(function (o) { return stakeOnOutcome(bet, o.id) > 0; });
      if (hasWagers) { toast('Ein Ausgang mit Einsätzen kann nicht entfernt werden.'); return; }
      bet.title = title; bet.description = (draft.description || '').trim();
      bet.mode = draft.mode; bet.commissionBase = draft.commissionBase === 'profit' ? 'profit' : 'payout';
      bet.outcomes = outcomes;
      // if winning outcome was removed, clear result
      if (bet.result && !outcomes.some(function (o) { return o.id === bet.result.winningOutcomeId; })) bet.result = null;
      save(); route = { name: 'detail', betId: bet.id }; render();
    } else {
      var newBet = {
        id: uid('b'), title: title, description: (draft.description || '').trim(),
        mode: draft.mode, commissionBase: draft.commissionBase === 'profit' ? 'profit' : 'payout',
        outcomes: outcomes, wagers: [], result: null, createdAt: Date.now()
      };
      state.bets.push(newBet);
      save(); route = { name: 'detail', betId: newBet.id }; render();
    }
  }

  function deleteBet(bet) {
    if (!confirm('Diese Wette wirklich löschen?')) return;
    state.bets = state.bets.filter(function (b) { return b.id !== bet.id; });
    save(); route = { name: 'list' }; render();
  }

  function deleteWager(bet, wid) {
    if (!confirm('Diesen Einsatz löschen?')) return;
    bet.wagers = bet.wagers.filter(function (w) { return w.id !== wid; });
    save(); render();
  }

  // ---- export / import
  function exportBackup() {
    var data = JSON.stringify(state, null, 2);
    var stamp = new Date().toISOString().slice(0, 10);
    var filename = 'wettbuch-backup-' + stamp + '.json';
    // On iOS/Android, the native share sheet lets the user save to Files/iCloud or send it.
    var file = null;
    try { file = new File([data], filename, { type: 'application/json' }); } catch (e) { /* older browsers */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file], title: 'Wettbuch-Backup' })
        .then(function () { toast('Backup geteilt.'); })
        .catch(function (err) { if (err && err.name !== 'AbortError') downloadJson(data, filename); });
      return;
    }
    downloadJson(data, filename);
  }

  function downloadJson(data, filename) {
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup exportiert.');
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.bets)) throw new Error('ungültiges Format');
        if (!confirm('Backup importieren? Der aktuelle Stand (' + state.bets.length + ' Wetten) wird ersetzt durch ' + data.bets.length + ' Wetten.')) return;
        state = { version: 1, bets: data.bets, paypalHandle: typeof data.paypalHandle === 'string' ? data.paypalHandle : getPaypalHandle() };
        save(); route = { name: 'list' }; render();
        toast('Backup importiert.');
      } catch (e) {
        toast('Import fehlgeschlagen: keine gültige Backup-Datei.');
      }
    };
    reader.readAsText(file);
  }

  // ---- PayPal (recipient + payment link + QR)
  function getPaypalHandle() { return (state.paypalHandle || '').trim(); }

  function sanitizePaypal(v) {
    v = String(v || '').trim();
    var m = v.match(/paypal\.me\/([^\/\s?]+)/i);
    if (m) return m[1];
    return v.replace(/^@/, '').trim();
  }

  function setupPaypal() {
    var cur = getPaypalHandle();
    var v = prompt('PayPal-Empfänger für Zahlungen festlegen:\n• PayPal.Me-Benutzername (z. B. MoritzX) — empfohlen, ermöglicht „Freunde & Familie“\n• oder deine PayPal-E-Mail-Adresse', cur);
    if (v === null) return;               // cancelled
    state.paypalHandle = sanitizePaypal(v);
    save();
    toast(state.paypalHandle ? 'PayPal-Empfänger gespeichert.' : 'PayPal-Empfänger entfernt.');
  }

  // Build a payment link that pre-fills the exact amount.
  function paypalUrl(handle, amount, note) {
    var amt = (Math.round(amount * 100) / 100).toFixed(2);   // "12.50"
    if (handle.indexOf('@') >= 0) {
      // E-Mail → klassischer PayPal-Bezahllink mit vorausgefülltem Betrag
      return 'https://www.paypal.com/cgi-bin/webscr?cmd=_xclick'
        + '&business=' + encodeURIComponent(handle)
        + '&currency_code=EUR&amount=' + encodeURIComponent(amt)
        + (note ? '&item_name=' + encodeURIComponent(note) : '');
    }
    return 'https://www.paypal.me/' + encodeURIComponent(handle.replace(/^@/, '')) + '/' + amt + 'EUR';
  }

  function showPaypalQr(bet) {
    var amtEl = document.getElementById('w-amount');
    var container = document.getElementById('pp-qr');
    if (!amtEl || !container) return;
    var amt = parseAmount(amtEl.value);
    if (!(amt > 0)) { toast('Erst einen Betrag eingeben.'); return; }
    var handle = getPaypalHandle();
    if (!handle) { setupPaypal(); handle = getPaypalHandle(); if (!handle) return; }
    var person = (document.getElementById('w-person').value || '').trim();
    var note = (bet.title || 'Wette') + (person ? ' – ' + person : '');
    var url = paypalUrl(handle, amt, note);
    var svg = '';
    try {
      var qr = qrcode(0, 'M');          // type 0 = auto-size, error correction level M
      qr.addData(url);
      qr.make();
      svg = qr.createSvgTag({ cellSize: 8, margin: 32, scalable: true });
    } catch (e) { svg = ''; console.error('QR failed', e); }
    container.innerHTML = '<div class="qr-box">'
      + (svg ? '<div class="qr-svg">' + svg + '</div>'
             : '<div class="hint">QR konnte nicht erzeugt werden. Nutze „In PayPal öffnen“.</div>')
      + '<div class="qr-info">' + fmt(amt) + ' an <b>' + esc(handle) + '</b></div>'
      + '<a class="pp-open" href="' + esc(url) + '" target="_blank" rel="noopener">In PayPal öffnen</a>'
      + '<div class="hint">Mit der Kamera scannen, um genau ' + fmt(amt) + ' zu senden. '
      + '<button type="button" class="link" data-act="paypal-setup">Empfänger ändern</button></div>'
      + '</div>';
  }

  // ================================================================ EVENTS
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    // close menu when clicking elsewhere
    if (openMenuFlag && !(t && (t.getAttribute('data-act') === 'toggle-menu'))) {
      var m = document.querySelector('.menu');
      if (m && !m.contains(e.target)) { openMenuFlag = false; if (route.name === 'list') renderList(); }
    }
    if (!t) return;
    var act = t.getAttribute('data-act');

    switch (act) {
      case 'new': startNewBet(); break;
      case 'open': route = { name: 'detail', betId: t.getAttribute('data-id') }; render(); break;
      case 'back-list': route = { name: 'list' }; render(); break;
      case 'cancel-editor':
        if (draft && draft.id) { route = { name: 'detail', betId: draft.id }; } else { route = { name: 'list' }; }
        render(); break;

      case 'toggle-menu': openMenuFlag = !openMenuFlag; renderList(); break;
      case 'paypal-setup': openMenuFlag = false; setupPaypal(); if (route.name === 'list') renderList(); break;
      case 'pp-qr': showPaypalQr(getBet(route.betId)); break;
      case 'export': openMenuFlag = false; exportBackup(); break;
      case 'import':
        openMenuFlag = false;
        document.getElementById('import-file').click();
        break;

      // editor
      case 'add-outcome':
        syncEditorFromDOM(); draft.outcomes.push({ id: uid('o'), label: '' }); renderEditor(); break;
      case 'del-outcome':
        syncEditorFromDOM(); draft.outcomes.splice(Number(t.getAttribute('data-idx')), 1); renderEditor(); break;
      case 'save-bet': saveBet(); break;

      // detail
      case 'edit-bet': startEditBet(getBet(route.betId)); break;
      case 'del-bet': deleteBet(getBet(route.betId)); break;
      case 'add-wager': sheetAddWager(getBet(route.betId)); break;
      case 'save-wager': saveWager(getBet(route.betId)); break;
      case 'del-wager': deleteWager(getBet(route.betId), t.getAttribute('data-id')); break;
      case 'enter-result': sheetResult(getBet(route.betId)); break;
      case 'save-result': saveResult(getBet(route.betId)); break;
      case 'close-sheet': closeSheet(); break;
    }
  });

  // mode switch (editor) via delegation on the mode option cards
  document.addEventListener('click', function (e) {
    var mb = e.target.closest('.mode-card[data-mode]');
    if (mb && draft) {
      syncEditorFromDOM();
      draft.mode = mb.getAttribute('data-mode');
      renderEditor();
      return;
    }
    var cb = e.target.closest('#seg-commbase button[data-commbase]');
    if (cb && draft) {
      syncEditorFromDOM();
      draft.commissionBase = cb.getAttribute('data-commbase');
      renderEditor();
    }
  });

  document.getElementById('import-file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) importBackup(f);
    e.target.value = '';
  });

  // ---------------------------------------------------------------- boot
  render();
})();
