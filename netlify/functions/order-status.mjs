// Estado de un pedido para el cliente. Si sigue "esperando pago", le pregunta a Mercado Pago.
import { json, handleError, UserError, loadOrder, publicView, reconcileOrder, syncPaymentById, updateOrder, deps } from '../lib/core.mjs';

const RECHECK_MS = 8000;

export default async (req) => {
  try {
    const u = new URL(req.url);
    const id = u.searchParams.get('id');
    const k = u.searchParams.get('k');
    const paymentId = u.searchParams.get('payment_id');
    let r = await loadOrder(id);
    if (!r || !k || r.order.k !== k) throw new UserError('Pedido no encontrado.', 404);
    let o = r.order;
    if (o.status === 'pending_payment') {
      const last = o.lastCheck ? new Date(o.lastCheck).getTime() : 0;
      if (deps.now().getTime() - last > RECHECK_MS) {
        await updateOrder(o.id, (x) => { x.lastCheck = deps.now().toISOString(); return x; });
        try {
          if (paymentId && /^\d+$/.test(paymentId)) await syncPaymentById(paymentId);
          else await reconcileOrder(o.id);
        } catch (e) { console.error('reconcile', e.message); }
        o = (await loadOrder(id)).order;
      }
    }
    return json(publicView(o));
  } catch (e) { return handleError(e); }
};
export const config = { path: '/api/order-status' };
