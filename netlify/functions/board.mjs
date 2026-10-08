// Tablero de cocina/caja (protegido con PIN).
import {
  json, handleError, UserError, checkPin, listOrders, localParts, getSettings, saveSettings,
  updateOrder, hoursState, deps, reconcileOrder,
} from '../lib/core.mjs';

const FLOW = ['paid', 'preparing', 'ready', 'delivered'];
const ALLOWED = new Set([...FLOW, 'cancelled']);

function boardView(o) {
  return {
    id: o.id, code: o.code, status: o.status, name: o.name, note: o.note, total: o.total,
    lines: o.lines, paidAt: o.paidAt, createdAt: o.createdAt, readyAt: o.readyAt || null,
    waitMinutes: o.waitMinutes, paymentId: o.paymentId || null,
    duplicatePayments: o.duplicatePayments || [],
  };
}

export default async (req) => {
  try {
    checkPin(req);
    if (req.method === 'GET') {
      const now = deps.now();
      const today = localParts(now).ymd;
      // incluye el día anterior para pedidos de cerca de medianoche
      const yest = localParts(new Date(now.getTime() - 6 * 3600 * 1000)).ymd;
      const days = today === yest ? [today] : [yest, today];
      let all = (await Promise.all(days.map(listOrders))).flat();

      // Pedidos recientes aún sin pago confirmado: revisar en Mercado Pago (por si se perdió un aviso).
      const stale = all.filter((o) => o.status === 'pending_payment' && now - new Date(o.createdAt) < 40 * 60000 &&
        (!o.lastCheck || now - new Date(o.lastCheck) > 60000)).slice(0, 3);
      for (const o of stale) {
        try {
          await updateOrder(o.id, (x) => { x.lastCheck = now.toISOString(); return x; });
          await reconcileOrder(o.id);
        } catch (e) { console.error('reconcile', e.message); }
      }
      if (stale.length) all = (await Promise.all(days.map(listOrders))).flat();

      const visible = all.filter((o) => ALLOWED.has(o.status) || o.status === 'review')
        .sort((a, b) => String(a.paidAt || a.createdAt).localeCompare(String(b.paidAt || b.createdAt)));
      return json({ orders: visible.map(boardView), settings: await getSettings(), hours: hoursState(now), serverTime: now.toISOString() });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { throw new UserError('Solicitud no válida.'); }
      if (body.action === 'settings') return json({ settings: await saveSettings(body) });
      if (body.action === 'status') {
        if (!ALLOWED.has(body.status)) throw new UserError('Estado no válido.');
        const r = await updateOrder(body.id, (o) => {
          if (o.status === 'pending_payment' || o.status === 'expired') throw new UserError('Ese pedido no está pagado.');
          if (o.status === body.status) return null;
          o.status = body.status;
          const at = deps.now().toISOString();
          if (body.status === 'ready') o.readyAt = at;
          o.history = [...(o.history || []), { s: body.status, at }];
          return o;
        });
        if (!r) throw new UserError('Pedido no encontrado.', 404);
        return json({ order: boardView(r.order) });
      }
      if (body.action === 'login') return json({ ok: true });
      throw new UserError('Acción no válida.');
    }
    throw new UserError('Método no permitido.', 405);
  } catch (e) { return handleError(e); }
};
export const config = { path: '/api/board' };
