// Lógica compartida del servidor: precios, horario, almacenamiento, Mercado Pago y Telegram.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { CATALOG } from './catalog.mjs';

// Dependencias reemplazables en pruebas.
export const deps = {
  getStore: () => getStore({ name: 'pedidos', consistency: 'strong' }),
  fetch: (...a) => fetch(...a),
  now: () => new Date(),
};

export const env = (k) => {
  try { if (globalThis.Netlify && globalThis.Netlify.env) { const v = globalThis.Netlify.env.get(k); if (v != null) return v; } } catch (e) {}
  return process.env[k];
};

/* ------------------------------------------------------------------ */
/* Respuestas                                                          */
/* ------------------------------------------------------------------ */
export class UserError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export function handleError(e) {
  if (e instanceof UserError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: 'Ocurrió un error. Intenta de nuevo o pide por WhatsApp.' }, 500);
}

/* ------------------------------------------------------------------ */
/* Horario (Monterrey, UTC-6 sin horario de verano)                    */
/* ------------------------------------------------------------------ */
export const TZ = 'America/Monterrey';
// minutos desde medianoche; índice 0 = domingo
const SCHEDULE = {
  0: [14 * 60 + 30, 22 * 60],
  1: null,
  2: [16 * 60, 22 * 60],
  3: [16 * 60, 22 * 60],
  4: [16 * 60, 22 * 60],
  5: [16 * 60, 22 * 60],
  6: [14 * 60 + 30, 23 * 60],
};
// Se dejan de recibir pedidos en línea estos minutos antes del cierre.
export const LAST_CALL_MIN = 15;
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(date = deps.now()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  return {
    dow: DAYS[p.weekday],
    ymd: p.year + p.month + p.day,
    minutes: parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10),
  };
}

export function hoursState(date = deps.now()) {
  const { dow, minutes } = localParts(date);
  const span = SCHEDULE[dow];
  if (!span) return { open: false, orderable: false };
  const open = minutes >= span[0] && minutes < span[1];
  const orderable = minutes >= span[0] && minutes < span[1] - LAST_CALL_MIN;
  return { open, orderable };
}

/* ------------------------------------------------------------------ */
/* Precios: el servidor recalcula todo, nunca confía en el navegador   */
/* ------------------------------------------------------------------ */
const MEAT_LABELS = { 1: 'Sencilla', 2: 'Doble carne', 3: 'Triple carne', 4: 'Cuádruple carne', 5: 'Quíntuple carne' };
const PREP = ['Bañados', 'Aparte'];

function intIn(v, min, max, what) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError('Cantidad no válida en ' + what);
  return n;
}

export function priceCart(input) {
  const C = CATALOG;
  if (!Array.isArray(input) || input.length === 0) throw new UserError('Tu orden está vacía.');
  if (input.length > 40) throw new UserError('La orden es demasiado grande para pedir en línea.');
  const lines = [];
  let total = 0, units = 0;
  for (const raw of input) {
    if (!raw || typeof raw.key !== 'string') throw new UserError('Producto no válido.');
    const qty = intIn(raw.qty, 1, 20, 'la orden');
    let name, unit, parts = [];
    if (raw.key.startsWith('extra-aderezo-')) {
      const ad = raw.key.slice('extra-aderezo-'.length);
      if (!C.aderezos.includes(ad)) throw new UserError('Aderezo no disponible.');
      name = 'Aderezo extra: ' + ad;
      unit = C.aderezoPrice;
    } else {
      const p = C.items[raw.key];
      if (!p) throw new UserError('Un producto de tu orden ya no está disponible. Vacía la orden y vuelve a agregarlo.');
      name = p.name;
      unit = p.price;
      if (p.cat === 'burgers') {
        const meat = intIn(raw.meat == null ? 1 : raw.meat, 1, 5, p.name);
        unit += (meat - 1) * C.carneExtra;
        parts.push(MEAT_LABELS[meat]);
      } else if (raw.meat != null && raw.meat !== 1) {
        throw new UserError('Carne extra solo aplica a hamburguesas.');
      }
      if (raw.combo != null) {
        if (!p.combo) throw new UserError('Combo no disponible para ' + p.name + '.');
        if (!C.flavors.includes(raw.combo)) throw new UserError('Sabor de refresco no disponible.');
        unit += C.comboPrice;
        parts.push('Combo (' + raw.combo + ')');
      }
      if (p.aderezoChoice) {
        const a = raw.aderezo == null ? 'Natural' : raw.aderezo;
        if (a !== 'Natural' && !C.aderezos.includes(a)) throw new UserError('Aderezo no disponible.');
        const prep = raw.prep == null ? 'Bañados' : raw.prep;
        if (!PREP.includes(prep)) throw new UserError('Preparación no válida.');
        parts.push('Aderezo: ' + a, prep);
      }
      if (p.flavorChoice) {
        const f = raw.flavor == null ? C.flavors[0] : raw.flavor;
        if (!C.flavors.includes(f)) throw new UserError('Sabor no disponible.');
        parts.push(f);
      }
      const toc = intIn(raw.tocino == null ? 0 : raw.tocino, 0, 5, p.name);
      if (toc > 0) {
        if (!p.tocino) throw new UserError('Tocino extra no disponible para ' + p.name + '.');
        unit += toc * C.tocinoExtra;
        parts.push(toc === 1 ? 'Tocino extra' : toc + 'x Tocino extra');
      }
    }
    const subtotal = unit * qty;
    total += subtotal;
    units += qty;
    lines.push({ key: raw.key, name, detail: parts.join(' · '), qty, unit, subtotal });
  }
  if (units > 60) throw new UserError('Para pedidos tan grandes, escríbenos por WhatsApp.');
  return { lines, total, units };
}

/* ------------------------------------------------------------------ */
/* Almacenamiento (Netlify Blobs)                                      */
/* ------------------------------------------------------------------ */
const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY34679'; // sin letras/números que se confunden
export function randomCode(n = 4) {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length];
  return s;
}

const orderKey = (id) => {
  const m = /^(\d{8})-([A-Z0-9]{4})$/.exec(String(id || ''));
  if (!m) return null;
  return 'o/' + m[1] + '/' + m[2];
};

export async function loadOrder(id) {
  const key = orderKey(id);
  if (!key) return null;
  const r = await deps.getStore().getWithMetadata(key, { type: 'json' });
  return r ? { order: r.data, etag: r.etag } : null;
}

// Actualiza un pedido sin pisar cambios simultáneos (reintenta si alguien más escribió).
export async function updateOrder(id, mutate) {
  const key = orderKey(id);
  if (!key) return null;
  const store = deps.getStore();
  for (let i = 0; i < 5; i++) {
    const r = await store.getWithMetadata(key, { type: 'json' });
    if (!r) return null;
    const next = mutate(structuredClone(r.data));
    if (!next) return { order: r.data, changed: false };
    const w = await store.setJSON(key, next, { onlyIfMatch: r.etag });
    if (w && w.modified === false) continue;
    return { order: next, changed: true };
  }
  throw new Error('No se pudo actualizar el pedido ' + id);
}

export async function createOrderRecord(base) {
  const store = deps.getStore();
  const { ymd } = localParts();
  for (let i = 0; i < 8; i++) {
    const code = randomCode();
    const id = ymd + '-' + code;
    const order = { ...base, id, code, ymd };
    const w = await store.setJSON(orderKey(id), order, { onlyIfNew: true });
    if (w && w.modified === false) continue;
    return order;
  }
  throw new Error('No se pudo generar folio');
}

export async function listOrders(ymd) {
  const store = deps.getStore();
  const { blobs } = await store.list({ prefix: 'o/' + ymd + '/' });
  const out = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return out.filter(Boolean);
}

const DEFAULT_SETTINGS = { accepting: true, waitMinutes: 20 };
export async function getSettings() {
  const s = await deps.getStore().get('settings', { type: 'json' });
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur };
  if (typeof patch.accepting === 'boolean') next.accepting = patch.accepting;
  if (patch.waitMinutes != null) {
    const w = Number(patch.waitMinutes);
    if (!Number.isInteger(w) || w < 5 || w > 120) throw new UserError('Tiempo de espera no válido.');
    next.waitMinutes = w;
  }
  next.updatedAt = deps.now().toISOString();
  await deps.getStore().setJSON('settings', next);
  return next;
}

export async function publicStatus() {
  const s = await getSettings();
  const h = hoursState();
  const paymentsEnabled = !!env('MP_ACCESS_TOKEN');
  let message = '';
  if (!paymentsEnabled) message = 'El pago en línea aún no está activo.';
  else if (!h.orderable) message = h.open ? 'Ya no recibimos pedidos en línea por hoy. Pide en caja o por WhatsApp.' : 'Estamos cerrados. Revisa nuestro horario.';
  else if (!s.accepting) message = 'Por ahora no estamos recibiendo pedidos en línea. Intenta en unos minutos.';
  return {
    canOrder: paymentsEnabled && h.orderable && s.accepting,
    open: h.open,
    accepting: s.accepting,
    waitMinutes: s.waitMinutes,
    message,
  };
}

/* ------------------------------------------------------------------ */
/* Mercado Pago                                                        */
/* ------------------------------------------------------------------ */
const MP_API = 'https://api.mercadopago.com';

async function mp(path, opts = {}) {
  const token = env('MP_ACCESS_TOKEN');
  if (!token) throw new UserError('El pago en línea aún no está activo.', 503);
  const r = await deps.fetch(MP_API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) {
    const err = new Error('Mercado Pago ' + r.status + ' en ' + path + ': ' + text.slice(0, 300));
    err.status = r.status;
    throw err;
  }
  return data;
}

// Fecha ISO con la zona de Monterrey (-06:00), formato que pide Mercado Pago.
function mxIso(date) {
  const d = new Date(date.getTime() - 6 * 3600 * 1000);
  return d.toISOString().replace('Z', '-06:00');
}

export async function createPreference(order, origin) {
  const back = origin + '/?pedido=' + order.id + '&k=' + order.k;
  const now = deps.now();
  const body = {
    items: order.lines.map((l) => ({
      id: l.key,
      title: (l.name + (l.detail ? ' (' + l.detail + ')' : '')).slice(0, 250),
      quantity: l.qty,
      unit_price: l.unit,
      currency_id: 'MXN',
    })),
    external_reference: order.id,
    notification_url: origin + '/api/mp-webhook',
    back_urls: { success: back, failure: back, pending: back },
    auto_return: 'approved',
    binary_mode: true, // aprobado o rechazado al momento, sin pagos "pendientes"
    statement_descriptor: 'SUPERJOHNNY',
    payment_methods: {
      excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }, { id: 'bank_transfer' }],
      installments: 1,
    },
    expires: true,
    expiration_date_from: mxIso(now),
    expiration_date_to: mxIso(new Date(now.getTime() + 30 * 60 * 1000)),
    metadata: { order_id: order.id },
  };
  if (order.name) body.payer = { name: order.name.slice(0, 60) };
  const pref = await mp('/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': order.id },
    body: JSON.stringify(body),
  });
  const url = env('MP_SANDBOX') === '1' ? (pref.sandbox_init_point || pref.init_point) : pref.init_point;
  return { prefId: pref.id, url };
}

// Valida la firma x-signature de la notificación (HMAC-SHA256 con la clave secreta del webhook).
export function verifyMpSignature(req, dataId) {
  const secret = env('MP_WEBHOOK_SECRET');
  if (!secret) return 'sin-clave';
  const sig = req.headers.get('x-signature') || '';
  const reqId = req.headers.get('x-request-id') || '';
  let ts = '', v1 = '';
  for (const part of sig.split(',')) {
    const [k, v] = part.split('=').map((s) => (s || '').trim());
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v;
  }
  if (!ts || !v1) return 'invalida';
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : String(dataId);
  let manifest = '';
  if (id) manifest += 'id:' + id + ';';
  if (reqId) manifest += 'request-id:' + reqId + ';';
  manifest += 'ts:' + ts + ';';
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'invalida';
}

// Aplica a un pedido el estado real de un pago consultado directamente a Mercado Pago.
export async function applyPayment(payment) {
  const id = payment && payment.external_reference;
  if (!id) return null;
  const settings = await getSettings();
  const res = await updateOrder(id, (o) => {
    if (o.status !== 'pending_payment' && o.status !== 'expired') {
      // ya pagado o en proceso: solo registrar pagos duplicados para revisión
      const dup = o.duplicatePayments || [];
      if (payment.status === 'approved' && String(payment.id) !== String(o.paymentId) && !dup.includes(String(payment.id))) {
        o.duplicatePayments = Array.from(new Set([...(o.duplicatePayments || []), String(payment.id)]));
        return o;
      }
      return null;
    }
    o.paymentStatus = payment.status;
    o.paymentDetail = payment.status_detail || null;
    if (payment.status === 'approved') {
      const amountOk = payment.currency_id === 'MXN' && Number(payment.transaction_amount) + 0.001 >= o.total;
      if (!amountOk) { o.status = 'review'; o.paymentId = String(payment.id); return o; }
      o.status = 'paid';
      o.paymentId = String(payment.id);
      o.paidAt = deps.now().toISOString();
      o.waitMinutes = settings.waitMinutes;
      o.history = [...(o.history || []), { s: 'paid', at: o.paidAt }];
    }
    return o;
  });
  if (res && res.changed) {
    const o = res.order;
    if (o.status === 'paid' && !o.notifiedAt) await notifyNewOrder(o);
    if (o.status === 'review') await telegram('⚠️ Pago con monto distinto al pedido ' + o.code + '. Revisa Mercado Pago (pago ' + o.paymentId + ').');
    if (o.duplicatePayments && o.duplicatePayments.length) await telegram('⚠️ El pedido ' + o.code + ' recibió un pago duplicado (' + o.duplicatePayments.join(', ') + '). Reembolsa desde Mercado Pago.');
  }
  return res;
}

export async function syncPaymentById(paymentId) {
  const p = await mp('/v1/payments/' + encodeURIComponent(paymentId));
  return applyPayment(p);
}

// Busca pagos del pedido por su referencia (por si la notificación se retrasa).
export async function reconcileOrder(id) {
  const r = await mp('/v1/payments/search?sort=date_created&criteria=desc&external_reference=' + encodeURIComponent(id));
  const results = (r && r.results) || [];
  const approved = results.find((p) => p.status === 'approved');
  const pick = approved || results[0];
  if (pick) return applyPayment(pick);
  return null;
}

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */
export async function telegram(text) {
  const token = env('TELEGRAM_BOT_TOKEN');
  const chat = env('TELEGRAM_CHAT_ID');
  if (!token || !chat) return false;
  try {
    const r = await deps.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
    return r.ok;
  } catch (e) { console.error('telegram', e); return false; }
}

export function orderText(o) {
  const lines = o.lines.map((l) => '• ' + l.qty + 'x ' + l.name + (l.detail ? ' (' + l.detail + ')' : '') + ' — $' + l.subtotal);
  return [
    '🍔 PEDIDO PAGADO ' + o.code + (o.name ? ' — ' + o.name : ''),
    'Para llevar · Total $' + o.total + ' (pagado con tarjeta)',
    ...lines,
    o.note ? 'Notas: ' + o.note : '',
  ].filter(Boolean).join('\n');
}

async function notifyNewOrder(o) {
  const ok = await telegram(orderText(o));
  if (ok) await updateOrder(o.id, (x) => { x.notifiedAt = deps.now().toISOString(); return x; });
}

/* ------------------------------------------------------------------ */
/* Vista pública del pedido (lo que ve el cliente)                     */
/* ------------------------------------------------------------------ */
const PENDING_EXPIRE_MIN = 40;
export function publicView(o) {
  let status = o.status;
  if (status === 'pending_payment' && deps.now() - new Date(o.createdAt) > PENDING_EXPIRE_MIN * 60000) status = 'expired';
  return {
    id: o.id, code: o.code, status, name: o.name || '', total: o.total,
    lines: o.lines.map((l) => ({ name: l.name, detail: l.detail, qty: l.qty, subtotal: l.subtotal })),
    paidAt: o.paidAt || null, waitMinutes: o.waitMinutes || null,
    readyAt: o.readyAt || null, paymentStatus: o.paymentStatus || null,
  };
}

/* ------------------------------------------------------------------ */
/* PIN del tablero                                                     */
/* ------------------------------------------------------------------ */
export function checkPin(req) {
  const pin = env('BOARD_PIN');
  if (!pin) throw new UserError('Falta configurar BOARD_PIN en Netlify.', 503);
  const got = req.headers.get('x-pin') || '';
  const a = crypto.createHash('sha256').update(pin).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new UserError('PIN incorrecto.', 401);
}
