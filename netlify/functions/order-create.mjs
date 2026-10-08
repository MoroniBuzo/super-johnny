// Crea un pedido con precios recalculados en el servidor y abre el cobro en Mercado Pago.
import crypto from 'node:crypto';
import {
  json, handleError, UserError, priceCart, publicStatus, createOrderRecord,
  createPreference, updateOrder, deps, env,
} from '../lib/core.mjs';

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export default async (req) => {
  try {
    if (req.method !== 'POST') throw new UserError('Método no permitido.', 405);
    let body;
    try { body = await req.json(); } catch (e) { throw new UserError('Solicitud no válida.'); }
    const st = await publicStatus();
    if (!st.canOrder) throw new UserError(st.message || 'Por ahora no recibimos pedidos en línea.', 409);

    const { lines, total } = priceCart(body.items);
    if (total < 10) throw new UserError('Total no válido.');
    const clientTotal = Number(body.clientTotal);
    if (Number.isFinite(clientTotal) && clientTotal !== total) {
      // El menú del cliente está desactualizado: avisarle el total real antes de cobrar.
      return json({ error: 'El total de tu orden es $' + total + '. Revisa tu orden y vuelve a tocar Pagar.', total, priceChanged: true }, 409);
    }

    const order = await createOrderRecord({
      k: crypto.randomBytes(8).toString('hex'),
      createdAt: deps.now().toISOString(),
      status: 'pending_payment',
      mode: 'llevar',
      name: clean(body.name, 40),
      note: clean(body.note, 300),
      lines,
      total,
      history: [{ s: 'pending_payment', at: deps.now().toISOString() }],
    });

    const origin = (env('SITE_URL') || new URL(req.url).origin).replace(/\/$/, '');
    const pref = await createPreference(order, origin);
    await updateOrder(order.id, (o) => { o.prefId = pref.prefId; return o; });
    return json({ id: order.id, k: order.k, code: order.code, total, payUrl: pref.url, waitMinutes: st.waitMinutes });
  } catch (e) { return handleError(e); }
};
export const config = { path: '/api/order' };
